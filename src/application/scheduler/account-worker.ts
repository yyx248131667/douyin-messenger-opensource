import { MessageQueue } from '../../domain/message/MessageQueue';
import { Message } from '../../domain/message/Message';
import { GlobalSemaphore } from './retry-scheduler';

/**
 * 发送函数签名。
 * 通过依赖注入提供，消除 AccountWorker 对 WindowManager 的直接依赖。
 */
type SendFn = (accountId: string, msg: Message) => void;

type AcknowledgmentPromise = { resolve: (val: boolean) => void, reject: (err: any) => void };

/**
 * 账号级独立工作线程 (Worker)
 * 负责单一账号的发送循环、退避计算、状态挂账隔离。
 * 
 * P1-7 重构：通过构造函数注入 sendFn，Application 层不再直接依赖 Main Process 窗口管理。
 */
export class AccountWorker {
  private queue: MessageQueue;
  private isProcessing: boolean = false;
  private workerId: NodeJS.Timeout | null = null;
  private ackWaiters: Map<string, AcknowledgmentPromise> = new Map();
  private sendFn: SendFn;

  // 每账号独立的限流护城河
  private readonly TICK_RATE_MS = 1500; // 账号操作基准间隔 (防单账号风控)
  private readonly MAX_CONCURRENT_PER_TICK = 1;

  private globalSemaphore?: GlobalSemaphore;

  private onLog?: (logStr: string, color: string) => void;

  constructor(public readonly accountId: string, sendFn: SendFn, globalSemaphore?: GlobalSemaphore, onLog?: (logStr: string, color: string) => void) {
    this.queue = new MessageQueue();
    this.sendFn = sendFn;
    this.globalSemaphore = globalSemaphore;
    this.onLog = onLog;
  }

  public start() {
    if (this.workerId) return;
    console.log(`[AccountWorker] 🚀 启动独立工作流: Account=${this.accountId}`);
    this.workerId = setInterval(() => this.processTick(), this.TICK_RATE_MS);
  }

  public stop() {
    if (this.workerId) clearInterval(this.workerId);
    this.workerId = null;
    this.ackWaiters.forEach(waiter => waiter.reject(new Error('Worker停机，中止发送')));
    this.ackWaiters.clear();
    
    if (this.isProcessing) {
      console.warn(`[AccountWorker] ⚠️ 拦截停机: 发送流仍在运行中 (${this.accountId})，但定时器已彻底切断。`);
    }
  }

  public enqueue(msg: Message) {
    this.queue.enqueue(msg);
  }

  public clearQueue() {
    this.queue.purgeByAccount(this.accountId);
  }

  public getQueueSize(): number {
    return this.queue.size;
  }

  /**
   * 被 GlobalScheduler 调度进行 ACK 闭环处理
   */
  public handleAck(messageId: string, success: boolean, error?: string) {
    const waiter = this.ackWaiters.get(messageId);
    if (!waiter) return;

    if (success) {
      waiter.resolve(true);
    } else {
      waiter.reject(error || 'Unknown Error');
    }
    this.ackWaiters.delete(messageId);
  }

  private async processTick() {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      let dispatchedCount = 0;
      while (dispatchedCount < this.MAX_CONCURRENT_PER_TICK) {
        const msg = this.queue.dequeueReady();
        if (!msg) break;

        dispatchedCount++;

        if (this.globalSemaphore) {
          await this.globalSemaphore.acquire();
        }

        const shortId = this.accountId.length > 6 ? this.accountId.substring(0, 6) : this.accountId;
        const displayName = msg.accountName || shortId;

        this.fireAndAwait(msg).then(() => {
          console.log(`[AccountWorker][${this.accountId}] ✅ 发送成功`);
          if (this.onLog) this.onLog(`[${displayName}] 发送成功: ${msg.content}`, '#52c41a');
        }).catch(err => {
          const backoffMs = Math.pow(2, msg.retryCount + 1) * 1500; // 3s, 6s, 12s
          console.error(`[AccountWorker][${this.accountId}] ❌ 发送失败 (Attempt: ${msg.retryCount + 1}/${msg.maxRetries}), 等待 ${backoffMs}ms 退避. err: ${err}`);
          if (this.onLog) this.onLog(`[${displayName}] 发送失败(${msg.retryCount + 1}次重试): ${msg.content} - ${err}`, '#faad14');
          
          if (msg.retryCount + 1 >= msg.maxRetries) {
             if (this.onLog) this.onLog(`[${displayName}] 放弃发送(达上限): ${msg.content}`, '#ff4d4f');
          }
          
          this.queue.requeueForRetry(msg, backoffMs);
        }).finally(() => {
          if (this.globalSemaphore) {
            this.globalSemaphore.release();
          }
        });
      }
    } finally {
      this.isProcessing = false;
    }
  }

  private fireAndAwait(msg: Message): Promise<boolean> {
     return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
           if (this.ackWaiters.has(msg.id)) {
              this.ackWaiters.delete(msg.id);
              reject(new Error('发信指令被沙盒超时吞没（Deadlock）'));
           }
        }, 15000); // 增加到 15s 以容纳 3.5s sleep 和网络延迟

        this.ackWaiters.set(msg.id, {
           resolve: (val) => { clearTimeout(timeout); resolve(val); },
           reject: (err) => { clearTimeout(timeout); reject(err); }
        });

        // 使用注入的发送函数，而非直接引用 WindowManager
        this.sendFn(this.accountId, msg);
     });
  }
}
