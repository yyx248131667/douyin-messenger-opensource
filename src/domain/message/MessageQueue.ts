/**
 * @file MessageQueue.ts
 * @description 商业级全局防崩溃缓冲队列实体
 * 主要用于：防并发限流屏蔽、高优消息（感谢/中奖）插队、失败延时重试的缓冲
 */

import { Message } from './Message';

export class MessageQueue {
  private queue: Message[] = [];
  
  /**
   * 推入队列，并按优先级与 nextRetryTime（如有）重排，或者也可以在出队时进行过滤
   */
  public enqueue(msg: Message) {
    this.queue.push(msg);
    this.sortQueue();
  }

  /**
   * 获取队列中所有可以立即发射的消息（避开还在退避冷却期的重试消息）
   */
  public getReadyMessages(): Message[] {
    const now = Date.now();
    return this.queue.filter(msg => msg.nextRetryTime <= now && msg.status !== 'processing');
  }

  /**
   * 弹出最高优的可发射消息
   */
  public dequeueReady(): Message | undefined {
    const now = Date.now();
    const index = this.queue.findIndex(msg => msg.nextRetryTime <= now && msg.status !== 'processing');
    if (index !== -1) {
      const [msg] = this.queue.splice(index, 1);
      msg.status = 'processing';
      return msg;
    }
    return undefined;
  }

  /**
   * 重装载：对于失败的消息进行指数退避或线性惩罚
   */
  public requeueForRetry(msg: Message, delayMs: number) {
    if (msg.retryCount >= msg.maxRetries) {
      msg.status = 'dead-letter';
      console.warn(`[MessageQueue] 🚨 消息抵达重试上限被抛弃: [Acc:${msg.accountId}] ${msg.content}`);
      return; 
      // 真实商业场景也可入库保存，目前直接抛弃防内存溢出
    }
    
    msg.retryCount++;
    msg.status = 'pending';
    msg.nextRetryTime = Date.now() + delayMs;
    // 重发有一定优先权降级，防止一直卡死高优发送位 （可按诉求设定）
    msg.priority = Math.max(0, msg.priority - 1); 

    this.enqueue(msg);
    console.log(`[MessageQueue] 🔄 消息打回重试缓冲池，等待 ${delayMs}ms 后再次发射: [Acc:${msg.accountId}] ${msg.content}`);
  }

  /**
   * 彻底清空某账号的所有派发任务（如：触发下播熔断机制时）
   */
  public purgeByAccount(accountId: string) {
    const oldLength = this.queue.length;
    this.queue = this.queue.filter(m => m.accountId !== accountId);
    console.log(`[MessageQueue] 🛑 已清空账号 ${accountId} 缓冲池中共 ${oldLength - this.queue.length} 条待发积压区。`);
  }

  private sortQueue() {
    this.queue.sort((a, b) => {
      // 1. 优先按数字大的 priority 发送
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }
      // 2. priority 同等时，按入队或预定重试时间（先到先发）
      return a.nextRetryTime - b.nextRetryTime;
    });
  }

  public get size(): number {
    return this.queue.length;
  }
}
