/**
 * @file network-monitor.ts
 * @description 网络状态监控器。
 * 定期检测与抖音服务器的连通性，断网时暂停调度，恢复时自动续发。
 * 为 7x24 小时稳定运行提供网络级保障。
 */

import { net } from 'electron';
import { WindowManager } from '../window/window-manager';
import { IpcChannels } from '../ipc/channels';

type NetworkState = 'ONLINE' | 'OFFLINE' | 'DEGRADED';
type NetworkChangeCallback = (state: NetworkState, previousState: NetworkState) => void;

export class NetworkMonitor {
  private static currentState: NetworkState = 'ONLINE';
  private static checkInterval: NodeJS.Timeout | null = null;
  private static listeners: Set<NetworkChangeCallback> = new Set();
  private static consecutiveFailures: number = 0;

  // 检测间隔（毫秒），正常 30 秒，断网后加快到 10 秒以便快速恢复
  private static readonly NORMAL_INTERVAL = 30000;
  private static readonly RECOVERY_INTERVAL = 10000;
  private static readonly FAILURE_THRESHOLD = 3; // 连续失败 3 次才判定为离线
  private static readonly DEGRADED_THRESHOLD = 1; // 连续失败 1 次为降级

  /**
   * 启动网络监控循环
   */
  public static start() {
    if (this.checkInterval) return;
    console.log('[NetworkMonitor] 🌐 启动网络连通性监控...');
    this.scheduleCheck(this.NORMAL_INTERVAL);
  }

  /**
   * 停止网络监控
   */
  public static stop() {
    if (this.checkInterval) {
      clearTimeout(this.checkInterval);
      this.checkInterval = null;
    }
    console.log('[NetworkMonitor] 停止网络监控');
  }

  /**
   * 获取当前网络状态
   */
  public static getState(): NetworkState {
    return this.currentState;
  }

  /**
   * 注册网络状态变化监听
   */
  public static onChange(callback: NetworkChangeCallback) {
    this.listeners.add(callback);
  }

  /**
   * 移除监听
   */
  public static removeListener(callback: NetworkChangeCallback) {
    this.listeners.delete(callback);
  }

  /**
   * 执行一次网络连通性检测
   * 使用 Electron net 模块直接发起 HTTP HEAD 请求
   */
  private static async performCheck(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const request = net.request({
          method: 'HEAD',
          url: 'https://live.douyin.com',
          redirect: 'follow'
        });

        const timeout = setTimeout(() => {
          request.abort();
          resolve(false);
        }, 8000); // 8 秒超时

        request.on('response', (response) => {
          clearTimeout(timeout);
          // HTTP 状态码在 200-499 范围内都说明网络通（4xx 是业务层错误，但网络通畅）
          resolve(response.statusCode >= 200 && response.statusCode < 500);
        });

        request.on('error', () => {
          clearTimeout(timeout);
          resolve(false);
        });

        request.end();
      } catch (e) {
        resolve(false);
      }
    });
  }

  /**
   * 调度下一次检测
   */
  private static scheduleCheck(intervalMs: number) {
    if (this.checkInterval) {
      clearTimeout(this.checkInterval);
    }

    this.checkInterval = setTimeout(async () => {
      const isOnline = await this.performCheck();
      const previousState = this.currentState;

      if (isOnline) {
        this.consecutiveFailures = 0;
        this.currentState = 'ONLINE';
      } else {
        this.consecutiveFailures++;
        if (this.consecutiveFailures >= this.FAILURE_THRESHOLD) {
          this.currentState = 'OFFLINE';
        } else if (this.consecutiveFailures >= this.DEGRADED_THRESHOLD) {
          this.currentState = 'DEGRADED';
        }
      }

      // 状态变更时通知所有监听者
      if (previousState !== this.currentState) {
        console.log(`[NetworkMonitor] 🌐 网络状态变更: ${previousState} → ${this.currentState}`);
        this.notifyListeners(previousState);
        this.notifyRenderer();
      }

      // 根据状态决定下次检测间隔
      const nextInterval = this.currentState === 'ONLINE'
        ? this.NORMAL_INTERVAL
        : this.RECOVERY_INTERVAL;

      this.scheduleCheck(nextInterval);
    }, intervalMs);
  }

  /**
   * 通知所有监听者
   */
  private static notifyListeners(previousState: NetworkState) {
    for (const listener of this.listeners) {
      try {
        listener(this.currentState, previousState);
      } catch (err) {
        console.error('[NetworkMonitor] 监听器执行异常:', err);
      }
    }
  }

  /**
   * 将网络状态同步到渲染进程 UI
   */
  private static notifyRenderer() {
    const mainWindow = WindowManager.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.NETWORK_STATE_CHANGE, {
        state: this.currentState,
        timestamp: Date.now()
      });
    }
  }
}
