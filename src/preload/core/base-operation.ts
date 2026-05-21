/**
 * @file base-operation.ts
 * @description 被动交互指令的抽象基类。
 * 负责接收宿主 Main 层发来的 Action，并执行 Webview 内部专属的复杂（甚至带侵入式的）操作，
 * 封装返回标准结构，由 MessageBridge 回馈给宿主。
 */

import { ActionResult, MessageBridge } from './message-bridge';

export abstract class BaseOperation {
  /**
   * 此操作对应的指令名，如 'api-send-message', 'send-gift'
   */
  public abstract readonly actionName: string;

  /**
   * 将当前操作类的执行逻辑挂载到 MessageBridge
   */
  public register(): void {
    MessageBridge.registerAction(this.actionName, async (data) => {
      // 提供统一的拦截和错误封装块
      console.log(`[Operation] 🎬 正在执行指令: ${this.actionName}`, data.payload || data);
      try {
        const result = await this.execute(data);
        return result;
      } catch (err: any) {
         console.error(`[Operation] ❌ 指令执行崩溃: ${this.actionName}`, err);
         return { success: false, error: err.message || 'Unknown Exception' };
      }
    });
  }

  /**
   * 子类必须实现的具体执行逻辑。
   * 入参是宿主传递下来的整个对象结构（可带 payload、accountId 等）。
   * 必须返回符合 ActionResult 的 Promise 结果。
   */
  public abstract execute(data: any): Promise<ActionResult>;
}
