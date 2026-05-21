/**
 * @file window-manager.ts
 * @description Manages the lifecycle and state of main Application Windows.
 */

import { BrowserWindow, app, shell, session } from 'electron';
import path from 'path';

export class WindowManager {
  private static mainWindow: BrowserWindow | null = null;
  private static activationWindow: BrowserWindow | null = null;

  public static createMainWindow() {
    // 基础防注入与安全会话权限设置
    // 基础防注入与安全会话权限设置
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          // 'Content-Security-Policy': ["default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: http: https: ws: wss:"]
        }
      });
    });

    // 绝对屏蔽物理层面的拉起请求（防止出现 "无法打开此 bitbrowser 链接"）
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (details.url.startsWith('bitbrowser:') || details.url.startsWith('douyin:') || details.url.startsWith('snssdk:') || details.url.startsWith('bytedance:')) {
        console.log(`[Security] Blocked system-level protocol request: ${details.url}`);
        callback({ cancel: true });
        return;
      }
      callback({});
    });

    this.mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      center: true,
      title: 'Douyin Messenger',
      icon: path.join(app.getAppPath(), 'dist', 'renderer', 'assets', '图标.ico'),
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false, // In complete standard mode, you should use contextIsolation: true with preloads
        webviewTag: true, // Needed for embedded account isolation
        webSecurity: false
      },
      autoHideMenuBar: true,
      show: false // Wait to show until ready-to-show
    });

    const entryPath = path.join(app.getAppPath(), 'dist', 'renderer', 'views', 'app.html');

    // Support hot-reload setup or static load
    if (process.env.NODE_ENV === 'development') {
      // In a real dev environment, this might point to a Webpack DevServer URL
      this.mainWindow.loadFile(entryPath);
    } else {
      this.mainWindow.loadFile(entryPath);
    }

    this.mainWindow.once('ready-to-show', () => {
      this.mainWindow?.show();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
    });

    // 拦截新窗口弹出，无条件拒绝并丢弃所有外部系统的拉起动作！绝对禁止拉出任何东西到 Windows 系统！
    this.mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      console.log(`[Security] Firmly blocked layout escape to: ${url}`);
      return { action: 'deny' };
    });
  }

  public static getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  private static randomWindow: BrowserWindow | null = null;

  public static createRandomWindow() {
    if (this.randomWindow) {
      if (this.randomWindow.isMinimized()) this.randomWindow.restore();
      this.randomWindow.focus();
      return;
    }

    this.randomWindow = new BrowserWindow({
      width: 420,
      height: 650,
      title: '随机发信控制',
      resizable: false,
      maximizable: false,
      alwaysOnTop: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      show: false,
      autoHideMenuBar: true
    });

    const entryPath = path.join(app.getAppPath(), 'dist', 'renderer', 'views', 'random.html');
    this.randomWindow.loadFile(entryPath);

    this.randomWindow.once('ready-to-show', () => {
      this.randomWindow?.show();
    });

    this.randomWindow.on('closed', () => {
      this.randomWindow = null;
    });
  }

  public static setRandomWindowAlwaysOnTop(isAlwaysOnTop: boolean) {
    if (this.randomWindow) {
      this.randomWindow.setAlwaysOnTop(isAlwaysOnTop);
    }
  }

  public static hideRandomWindow() {
    if (this.randomWindow) {
      this.randomWindow.hide();
    }
  }

  private static giftWindow: BrowserWindow | null = null;

  public static createGiftWindow() {
    if (this.giftWindow) {
      if (this.giftWindow.isMinimized()) this.giftWindow.restore();
      this.giftWindow.focus();
      return;
    }

    this.giftWindow = new BrowserWindow({
      width: 420,
      height: 650,
      title: '自动送礼控制',
      resizable: false,
      maximizable: false,
      alwaysOnTop: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      show: false,
      autoHideMenuBar: true
    });

    const entryPath = path.join(app.getAppPath(), 'dist', 'renderer', 'views', 'gift.html');
    this.giftWindow.loadFile(entryPath);

    this.giftWindow.once('ready-to-show', () => {
      this.giftWindow?.show();
    });

    this.giftWindow.on('closed', () => {
      this.giftWindow = null;
    });
  }

  public static setGiftWindowAlwaysOnTop(isAlwaysOnTop: boolean) {
    if (this.giftWindow) {
      this.giftWindow.setAlwaysOnTop(isAlwaysOnTop);
    }
  }

  public static hideGiftWindow() {
    if (this.giftWindow) {
      this.giftWindow.hide();
    }
  }

  private static lotteryWindow: BrowserWindow | null = null;

  public static createLotteryWindow() {
    if (this.lotteryWindow) {
      if (this.lotteryWindow.isMinimized()) this.lotteryWindow.restore();
      this.lotteryWindow.focus();
      return;
    }

    this.lotteryWindow = new BrowserWindow({
      width: 450,
      height: 700,
      title: '福袋自动检测',
      resizable: false,
      maximizable: false,
      alwaysOnTop: false,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
      },
      show: false,
      autoHideMenuBar: true
    });

    const entryPath = path.join(app.getAppPath(), 'dist', 'renderer', 'views', 'lottery.html');
    this.lotteryWindow.loadFile(entryPath);

    this.lotteryWindow.once('ready-to-show', () => {
      this.lotteryWindow?.show();
    });

    this.lotteryWindow.on('closed', () => {
      this.lotteryWindow = null;
    });
  }

  public static setLotteryWindowAlwaysOnTop(isAlwaysOnTop: boolean) {
    if (this.lotteryWindow) {
      this.lotteryWindow.setAlwaysOnTop(isAlwaysOnTop);
    }
  }

  public static hideLotteryWindow() {
    if (this.lotteryWindow) {
      this.lotteryWindow.hide();
    }
  }


  private static verifyWindows: Map<string, BrowserWindow> = new Map();

  public static createVerifyWindow(accountId: string) {
    if (this.verifyWindows.has(accountId)) {
      const win = this.verifyWindows.get(accountId)!;
      if (win.isMinimized()) win.restore();
      win.focus();
      return;
    }

    const partitionName = `persist:${accountId}`;
    const win = new BrowserWindow({
      width: 1000,
      height: 700,
      title: `抖音滑块验证 - 账号: ${accountId}`,
      webPreferences: {
        partition: partitionName,
        nodeIntegration: false,
        contextIsolation: true,
      },
      autoHideMenuBar: true
    });

    win.loadURL('https://www.douyin.com/');

    win.on('closed', () => {
      this.verifyWindows.delete(accountId);
    });

    this.verifyWindows.set(accountId, win);
  }

  public static getGiftWindow(): BrowserWindow | null {
    return this.giftWindow;
  }

  public static getRandomWindow(): BrowserWindow | null {
    return this.randomWindow;
  }

  public static getLotteryWindow(): BrowserWindow | null {
    return this.lotteryWindow;
  }

  // ==================== Activation Window ====================

  public static createActivationWindow() {
    this.activationWindow = new BrowserWindow({
      width: 560,
      height: 680,
      center: true,
      title: 'Douyin Messenger',
      icon: path.join(app.getAppPath(), 'dist', 'renderer', 'assets', '图标.ico'),
      resizable: false,
      maximizable: false,
      frame: true,
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        devTools: false, // 禁止 DevTools，防止控制台 IPC 绕过
      },
      autoHideMenuBar: true,
      show: false
    });

    const entryPath = path.join(app.getAppPath(), 'dist', 'renderer', 'views', 'activation.html');
    this.activationWindow.loadFile(entryPath);

    // 拦截导航（防止通过地址栏或 JS 跳转）
    this.activationWindow.webContents.on('will-navigate', (event) => {
      event.preventDefault();
    });

    // 拦截键盘快捷键（Ctrl+Shift+I / F12 / Ctrl+R）
    this.activationWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.key === 'F12' ||
        (input.control && input.shift && input.key.toLowerCase() === 'i') ||
        (input.control && input.key.toLowerCase() === 'r')) {
        _event.preventDefault();
      }
    });

    this.activationWindow.once('ready-to-show', () => {
      this.activationWindow?.show();
    });

    this.activationWindow.on('closed', () => {
      this.activationWindow = null;
      // 如果主窗口没有打开，则退出应用
      if (!this.mainWindow) {
        app.quit();
      }
    });
  }

  public static getActivationWindow(): BrowserWindow | null {
    return this.activationWindow;
  }

  /**
   * 激活成功后，关闭激活窗口，打开主应用窗口
   */
  public static loadMainAppFromActivation() {
    if (this.activationWindow) {
      this.activationWindow.close();
      this.activationWindow = null;
    }
    this.createMainWindow();
  }
}
