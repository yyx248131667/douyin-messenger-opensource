/**
 * @file message-bridge.ts
 * @description 沙箱统一消息通信桥梁。
 * 收口所有 ipcRenderer 操作，防止全局到处直接使用 ipc 引发混乱。
 * 分为：
 * 1. 响应宿主的主动行为调用（Command Listener）
 * 2. 主动上报观测状态（State Emitter）
 */

import { ipcRenderer } from 'electron';
import { BaseObserver } from './base-observer';
import { HeartbeatData, WebViewHealth } from '../../shared/types/observer.types';
import { IpcChannels } from '../../main/ipc/channels';

export interface ActionPayload {
  accountId: string;
  action: string;
  messageId?: string;
  payload?: any;
  [key: string]: any;
}

export interface ActionResult {
  success: boolean;
  error?: string;
  [key: string]: any;
}

export class MessageBridge {
  private static registeredActions: Map<string, (payload: any) => Promise<ActionResult>> = new Map();
  private static registeredObservers: Map<string, BaseObserver> = new Map();
  private static heartbeatTimer: NodeJS.Timeout | null = null;
  private static accountId: string;

  private static logToMain(msg: string) {
    console.log(msg);
    ipcRenderer.send(IpcChannels.LOG_MESSAGE, msg);
  }

  /**
   * 初始化沙箱层面唯一的全局事件监听通道，并开启心跳
   */
  public static init() {
    this.logToMain('[MessageBridge] 🌉 初始化统一通信桥...');
    this.accountId = new URLSearchParams(window.location.search).get('accountId') || 'unknown';

    ipcRenderer.on('page-action', async (event, data: ActionPayload) => {
       const handler = this.registeredActions.get(data.action);
       
       this.logToMain(`[MessageBridge] 收到外部执行指令: ${data.action} | Handler exists: ${!!handler}`);
       
       let result: ActionResult = { success: false, error: `Action '${data.action}' not registered in Sandbox` };

       if (handler) {
         try {
           result = await handler(data);
         } catch (e: any) {
           result = { success: false, error: e.message || String(e) };
         }
       } else {
         this.logToMain(`[MessageBridge] ⚠️ 未知指令: ${data.action}`);
       }

       // 统一 ACK 响应机制格式 (用于后端调度器)
       ipcRenderer.send('API_ACTION_ACK', {
          accountId: data.accountId,
          messageId: data.messageId, // 如果是需要被 RetryScheduler 追踪的任务，原样传回
          action: data.action,
          ...result
       });

       // 同步向前端发回即时操作结果 (用于 UI 等待)
       if (data.actionId) {
         ipcRenderer.send(IpcChannels.PAGE_ACTION_RESULT, {
           actionId: data.actionId,
           ...result
         });
       }
    });

    // 接收诊断响应
    ipcRenderer.on('heartbeat-response', () => {
      // 能收到回复说明 IPC 两侧连通
    });

    this.startHeartbeat();
  }

  /**
   * 注册观测器节点用于全量健康采集
   */
  public static registerObserver(name: string, observer: BaseObserver) {
    this.registeredObservers.set(name, observer);
  }

  private static startHeartbeat() {
     if (this.heartbeatTimer) return;
     this.heartbeatTimer = setInterval(() => {
        const observerStates: Record<string, any> = {};
        for (const [name, obs] of this.registeredObservers.entries()) {
           observerStates[name] = obs.getHealthState();
        }

        // 可以采集当前沙盒的 Web 层级指标（如 V8 heap limit 需要用到 browser window performance 特性，在此我们可用基础版替代）
        let memoryUsage = undefined;
        const memory = (performance as any).memory;
        if (memory) {
           memoryUsage = {
             jsHeapSizeLimit: memory.jsHeapSizeLimit,
             totalJSHeapSize: memory.totalJSHeapSize,
             usedJSHeapSize: memory.usedJSHeapSize
           };
        }

        const heartbeat: HeartbeatData = {
           timestamp: Date.now(),
           health: WebViewHealth.HEALTHY,
           observerStates,
           memoryUsage,
           pageInfo: {
              url: window.location.href,
              title: document.title,
              readyState: document.readyState
           }
        };

        this.sendStateChange('webview-heartbeat', heartbeat);
     }, 10000); // 10秒心跳
  }

  /**
   * 给 Operation 提供注册渠道
   */
  public static registerAction(actionName: string, handler: (payload: any) => Promise<ActionResult>) {
    this.registeredActions.set(actionName, handler);
    console.log(`[MessageBridge] 📝 已注册被动指令处理器: ${actionName}`);
  }

  /**
   * 给 Observer 提供上报状态的回传渠道
   */
  public static sendStateChange(channel: string, data: Record<string, any>) {
    ipcRenderer.send(channel, data);
  }
}
