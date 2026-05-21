/**
 * @file retry-scheduler.ts
 * @description 带指数退避的分布式队列重试收发器。
 * 取代原来的无脑 send，接管核心发送任务调度，控制整体并发/QPS 速率，
 * 并拦截失败后抛入缓冲池。
 * 
 * P1-5: 使用 IpcChannels 常量替代硬编码字符串。
 * P1-7: 通过 sendFn 注入消除 AccountWorker 对 WindowManager 的跨层依赖。
 */

import { ipcMain } from 'electron';
import { Message } from '../../domain/message/Message';
import { AccountWorker } from './account-worker';
import { WindowManager } from '../../main/window/window-manager';
import { IpcChannels } from '../../main/ipc/channels';
import { AccountManagerService } from '../../main/services/account-manager.service';
import { GlobalAutomationService } from '../../main/services/global-automation.service';

export class GlobalSemaphore {
  private maxConcurrency: number;
  private currentRunners: number = 0;
  private waitingQueue: Array<() => void> = [];

  constructor(maxConcurrency: number = 5) {
    this.maxConcurrency = maxConcurrency;
  }

  public acquire(): Promise<void> {
    return new Promise(resolve => {
      if (this.currentRunners < this.maxConcurrency) {
        this.currentRunners++;
        resolve();
      } else {
        this.waitingQueue.push(resolve);
      }
    });
  }

  public release() {
    if (this.waitingQueue.length > 0) {
      const next = this.waitingQueue.shift()!;
      next();
    } else {
      this.currentRunners--;
    }
  }
}


export class RetryScheduler {
  private workers: Map<string, AccountWorker> = new Map();
  private isRunning: boolean = false;
  private globalSemaphore = new GlobalSemaphore(5); // 全局限流并发 5

  constructor() {
    this.bindAcks();
  }

  /**
   * 将普通发信请求推入托管重试流
   */
  public dispatch(accountId: string, content: string, priority: number = 0, maxRetries: number = 3, accountName?: string) {
    const msg: Message = {
      id: 'msg_' + Math.random().toString(36).substr(2, 9),
      accountId,
      accountName,
      content,
      timestamp: Date.now(),
      status: 'pending',
      retryCount: 0,
      maxRetries,
      priority,
      nextRetryTime: Date.now()
    };
    
    const worker = this.getOrCreateWorker(accountId);
    worker.enqueue(msg);
  }

  /**
   * 取消某个账号的一切堆积动作（如掉线拔管时）
   */
  public cancelAllForAccount(accountId: string) {
    const worker = this.workers.get(accountId);
    if (worker) {
      worker.clearQueue();
      worker.stop();
      this.workers.delete(accountId);
    }
  }

  /**
   * 启动消费传送带
   */
  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[GlobalScheduler] ⚙️ 初始化全局架构：账户独立列队引擎...');
    
    this.workers.forEach(w => w.start());
  }

  public stop() {
    this.isRunning = false;
    this.workers.forEach(w => w.stop());
  }

  public getStats() {
    const stats: { accountId: string, queueSize: number, isProcessing: boolean }[] = [];
    this.workers.forEach((worker, id) => {
      stats.push({
        accountId: id,
        queueSize: worker.getQueueSize(),
        isProcessing: (worker as any).isProcessing || false
      });
    });
    return stats;
  }

  /**
   * P1-7: 创建 AccountWorker 时注入 sendFn，保持 Application 层与 Main Process 解耦。
   * sendFn 内部引用 WindowManager，但仅在 RetryScheduler（桥接层）中引入。
   */
  private getOrCreateWorker(accountId: string): AccountWorker {
    let worker = this.workers.get(accountId);
    if (!worker) {
      // 注入发送函数：直接通过 renderer 对 webview 执行剪贴板键盘操作
      // 绕过 PAGE_ACTION → preload 的隔离上下文，确保消息真正发送到服务器
      const sendFn = (acctId: string, msg: Message) => {
        const roomId = GlobalAutomationService.getWatchRoomId();
        if (!roomId) {
            throw new Error('未获取到目标直播间编号');
        }

        const mainWindow = WindowManager.getMainWindow();
        if (!mainWindow) {
          throw new Error('核心渲染进程未就绪');
        }
        // 使用直发通道，renderer 侧通过 webview 原生方法操作
        mainWindow.webContents.send('direct-send-message', {
          accountId: msg.accountId,
          messageId: msg.id,
          content: msg.content,
          roomId: roomId
        });
      };
      const onLog = (logStr: string, color: string) => {
          const mainWindow = WindowManager.getMainWindow();
          if (mainWindow) {
             mainWindow.webContents.send(IpcChannels.RENDERER_LOG, logStr, color);
          }
      };

      worker = new AccountWorker(accountId, sendFn, this.globalSemaphore, onLog);
      this.workers.set(accountId, worker);
      if (this.isRunning) {
        worker.start();
      }
    }
    return worker;
  }

  /**
   * 监听 Preload 层回传的 ACK，路由到从属 AccountWorker 完成 Promise 闭环
   */
  private bindAcks() {
     ipcMain.on(IpcChannels.API_ACTION_ACK, (_event, response) => {
         const { accountId, messageId, success, error } = response;
         if (!accountId || !messageId) return;

         const worker = this.workers.get(accountId);
         if (worker) {
            worker.handleAck(messageId, success, error);
         }
     });
  }
}

// 暴露唯一单例
export const SchedulerInstance = new RetryScheduler();
