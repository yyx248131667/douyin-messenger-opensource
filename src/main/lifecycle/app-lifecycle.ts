/**
 * @file app-lifecycle.ts
 * @description 应用生命周期管理（开源版：移除授权验证，直接进入主界面）
 */

import { app, Menu } from 'electron';
import { WindowManager } from '../window/window-manager';
import { NetworkMonitor } from '../services/network-monitor';
import { SchedulerInstance } from '../../application/scheduler/retry-scheduler';

export class AppLifecycle {
  public static initialize() {
    this.enforceSingleInstance();
    this.optimizeHardware();
    this.registerEvents();
  }

  private static enforceSingleInstance() {
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      console.warn('[AppLifecycle] Application already running. Shutting down duplicate.');
      app.quit();
      process.exit(0);
    }

    app.on('second-instance', () => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
  }

  private static optimizeHardware() {
    app.disableHardwareAcceleration();
    app.commandLine.appendSwitch('disable-site-isolation-trials');
    app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
    app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
    app.commandLine.appendSwitch('disable-software-rasterizer');
    app.commandLine.appendSwitch('disable-webrtc-hw-decoding');
    app.commandLine.appendSwitch('disable-webrtc-hw-encoding');
  }

  private static registerEvents() {
    app.on('ready', async () => {
      console.log('[AppLifecycle] Application Ready.');
      Menu.setApplicationMenu(null);

      // 开源版：直接进入主界面（无激活验证）
      WindowManager.createMainWindow();

      // 启动网络连通性监控
      NetworkMonitor.start();

      NetworkMonitor.onChange((state, previousState) => {
        if (state === 'OFFLINE') {
          console.warn('[AppLifecycle] ⚠️ 网络离线，暂停 RetryScheduler');
          SchedulerInstance.stop();
        } else if (state === 'ONLINE' && previousState === 'OFFLINE') {
          console.log('[AppLifecycle] ✅ 网络恢复，重启 RetryScheduler');
          SchedulerInstance.start();
        }
      });
    });

    app.on('before-quit', () => {
      NetworkMonitor.stop();
      SchedulerInstance.stop();
    });

    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('activate', () => {
      if (!WindowManager.getMainWindow()) {
        WindowManager.createMainWindow();
      }
    });

    process.on('uncaughtException', (error) => {
      console.error('[CRASH] Uncaught Exception:', error);
    });
  }
}
