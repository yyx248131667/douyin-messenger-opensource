/**
 * @file base-observer.ts
 * @description 状态观测器抽象基类
 * 负责侦听 Webview 中的状态变更、异常弹窗、DOM变化等，并通过 MessageBridge 同步至宿主。
 * 结合防抖、失败重试、统一健康上报功能。
 */

import { MessageBridge } from './message-bridge';
import { ObserverState, ObserverConfig, StateChangeEvent } from '../../shared/types/observer.types';

export abstract class BaseObserver<TState = any> {
  protected accountId: string;
  protected config: Required<ObserverConfig>;
  
  // 运行与健康状态
  protected state: ObserverState = {
    isRunning: false,
    lastCheckTime: 0,
    checkCount: 0,
    errorCount: 0,
    avgCheckDuration: 0,
  };

  // 防抖状态跟踪
  protected currentState: TState | null = null;
  private pendingState: TState | null = null;
  private matchCount: number = 0;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(config: ObserverConfig = {}) {
    this.accountId = new URLSearchParams(window.location.search).get('accountId') || `acc_${Date.now()}`;
    
    // 默认配置
    this.config = {
      checkInterval: 2000,
      debounceThreshold: 3,
      debounceResetTimeout: 5000,
      debug: false,
      maxErrorRetries: 5,
      heartbeatInterval: 10000,
      ...config
    };
  }

  /**
   * 必须在子类中实现的具体启动和清理逻辑
   */
  protected abstract onStart(...args: any[]): void;
  protected abstract onStop(): void;

  public start(...args: any[]): void {
    if (this.state.isRunning) return;
    this.state.isRunning = true;
    
    try {
      this.onStart(...args);
      if (this.config.debug) {
        console.log(`[Observer] 启动: ${this.constructor.name} (Account: ${this.accountId})`);
      }
    } catch (err) {
      this.handleError(err as Error);
    }
  }

  public stop(): void {
    if (!this.state.isRunning) return;
    this.state.isRunning = false;
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }

    try {
      this.onStop();
      if (this.config.debug) {
        console.log(`[Observer] 停止: ${this.constructor.name}`);
      }
    } catch (err) {
      console.error(`[Observer] 停止期间出错: ${this.constructor.name}`, err);
    }
  }

  /**
   * 暴露自身状态给监控中心收集心跳
   */
  public getHealthState(): ObserverState {
    return { ...this.state };
  }

  /**
   * 提供给子类的安全包装记录执行时间并防报错的检测钩子
   * @param checkFn 实际进行 DOM 检查的函数
   */
  protected runSecureCheck(checkFn: () => TState | undefined): TState | undefined {
    const startTime = Date.now();
    try {
      const result = checkFn();
      
      this.state.checkCount++;
      const duration = Date.now() - startTime;
      // 简单平滑均值
      this.state.avgCheckDuration = this.state.checkCount === 1 ? duration : 
         (this.state.avgCheckDuration * 0.9) + (duration * 0.1);
      this.state.lastCheckTime = Date.now();
      this.state.errorCount = 0; // 成功则重置错误

      return result;
    } catch (err) {
      this.handleError(err as Error);
      return undefined;
    }
  }

  /**
   * 状态防抖提交流水线
   * 用于平滑由于画面变动、加载抖动造成的 false-positive
   */
  protected commitStateWithDebounce(channel: string, newState: TState, confidence: number = 1.0, metadata?: Record<string, any>) {
    if (this.currentState === newState) {
      this.matchCount = 0; // 稳定状态无变化
      return;
    }

    if (this.pendingState === newState) {
      this.matchCount++;
    } else {
      this.pendingState = newState;
      this.matchCount = 1;
    }

    // 重置防抖倒计时
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this.pendingState = null;
      this.matchCount = 0;
    }, this.config.debounceResetTimeout);

    // 匹配超过阈值则正式确认状态并推向外部
    if (this.matchCount >= this.config.debounceThreshold) {
      const prevState = this.currentState;
      this.currentState = newState;
      this.pendingState = null;
      this.matchCount = 0;
      
      const payload: StateChangeEvent<TState> = {
        previousState: prevState,
        currentState: newState,
        confidence,
        consecutiveMatches: this.config.debounceThreshold,
        timestamp: Date.now(),
        metadata
      };

      if (this.config.debug) {
        console.log(`[Observer] 事件确立提交: ${this.constructor.name} ->`, payload);
      }
      this.reportState(channel, payload);
    }
  }

  protected reportState(channel: string, payload: Record<string, any>): void {
    MessageBridge.sendStateChange(channel, {
      accountId: this.accountId,
      ...payload
    });
  }

  private handleError(err: Error) {
    this.state.errorCount++;
    console.error(`[Observer Error] ${this.constructor.name}:`, err);
    if (this.state.errorCount >= this.config.maxErrorRetries) {
      console.warn(`[Observer Warning] ${this.constructor.name} 达到最大错误阈值，触发停机。`);
      this.stop();
      // 上报级联错误
      MessageBridge.sendStateChange('webview-error', {
         accountId: this.accountId,
         error: `Observer ${this.constructor.name} faulted: ${err.message}`,
         timestamp: Date.now()
      });
    }
  }
}
