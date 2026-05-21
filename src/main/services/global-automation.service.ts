/**
 * @file global-automation.service.ts
 * @description 全局自动化编排引擎。
 * 替代旧有的 setInterval 漏洞，并在收到已下播/掉线/关播信号时主动熔断自动发射行为。
 */

import { MessageScheduler, SendMessageConfig } from '../../application/scheduler/message-scheduler';
import { WindowManager } from '../window/window-manager';
import { ipcMain } from 'electron';
import fs from 'fs';
import path from 'path';
import { IpcChannels } from '../ipc/channels';
import { SchedulerInstance } from '../../application/scheduler/retry-scheduler';

export class GlobalAutomationService {
  private static taskAccounts: Set<string> = new Set();
  private static activeRoomId: string | null = null;
  private static globalTimer: NodeJS.Timeout | null = null;
  private static activeConfig: SendMessageConfig | null = null;
  
  private static taskAccountsList: { id: string, name: string }[] = [];
  private static currentAccountIndex: number = 0;
  private static currentScriptIndex: number = 0;
  private static currentLoop: number = 0;
  private static messagesSentTotal: number = 0;

  /**
   * 洗牌后的话术索引序列。
   * 先打乱整个数组，然后按顺序逐条发送，发完后重新洗牌开始下一轮。
   * 比 splice 抽取更高效：每次取值 O(1)，一轮整体 O(n)。
   */
  private static shuffledOrder: number[] = [];
  private static currentShuffleIndex: number = 0;

  /**
   * Fisher-Yates 洗牌算法，将索引数组原地打乱。
   * 时间复杂度 O(n)，均匀随机分布。
   */
  private static shuffleArray(length: number): number[] {
    const arr = Array.from({ length }, (_, i) => i);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  /**
   * 从洗牌序列中取下一条话术索引。
   * 如果当前轮已遍历完，重新洗牌开始下一轮。
   * @returns 话术索引
   */
  private static drawNext(scriptCount: number): { index: number; isNewRound: boolean } {
    if (this.shuffledOrder.length === 0 || this.currentShuffleIndex >= this.shuffledOrder.length) {
      this.shuffledOrder = this.shuffleArray(scriptCount);
      this.currentShuffleIndex = 0;
      console.log(`[GlobalAutomation] 🔄 话术已重新洗牌 (${scriptCount} 条)，新顺序: [${this.shuffledOrder.join(',')}]`);
      return { index: this.shuffledOrder[this.currentShuffleIndex++], isNewRound: true };
    }
    return { index: this.shuffledOrder[this.currentShuffleIndex++], isNewRound: false };
  }

  
  private static getStatePath(): string {
    const isDev = process.env.NODE_ENV === 'development';
    const basePath = isDev ? process.cwd() : process.resourcesPath;
    const dir = path.join(basePath, 'data');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'global_send_state.json');
  }

  private static saveState() {
    if (!this.activeConfig) return;
    const state = {
      scripts: this.activeConfig.scripts,
      currentAccountIndex: this.currentAccountIndex,
      currentScriptIndex: this.currentScriptIndex,
      currentLoop: this.currentLoop,
      messagesSentTotal: this.messagesSentTotal,
      shuffledOrder: this.shuffledOrder,
      currentShuffleIndex: this.currentShuffleIndex
    };
    try {
      fs.writeFileSync(this.getStatePath(), JSON.stringify(state, null, 2));
    } catch (e) {}
  }

  private static clearState() {
    try {
      if (fs.existsSync(this.getStatePath())) {
        fs.unlinkSync(this.getStatePath());
      }
    } catch (e) {}
  }

  private static loadState() {
    try {
      const p = this.getStatePath();
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
      }
    } catch (e) {}
    return null;
  }

  public static getWatchRoomId(): string | null {
    return this.activeRoomId;
  }

  private static getAccountOrder(name: string): number {
    const match = (name || '').match(/账号(\d+)/);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  }

  private static getNextDelaySeconds(config: SendMessageConfig, isNewRound: boolean): number {
    const min = Math.max(1, Number(config.minInterval) || 2);
    const max = Math.max(min, Number(config.maxInterval) || min);
    const baseDelay = Math.floor(Math.random() * (max - min + 1)) + min;
    const jitter = Math.random() * 1.4;
    const roundCooldown = isNewRound ? (2 + Math.random() * 4) : 0;
    return Math.max(1, baseDelay + jitter + roundCooldown);
  }

  public static init() {
    console.log('[GlobalAutomation] 初始化全局发送与直播存活检测引擎 (单线程自动切换)...');

    SchedulerInstance.start(); // 拉起底层消费者队列

    // 启动全局发信以及并入探测
    ipcMain.on(IpcChannels.START_GLOBAL_SEND, (event, { accounts, roomUrl, config }: { accounts: { id: string, name: string }[], roomUrl: string, config: SendMessageConfig }) => {
      this.stopGlobalTimer();
      
      this.taskAccounts.clear();
      this.taskAccountsList = (accounts || []).slice().sort((a, b) => {
        const orderDiff = this.getAccountOrder(a.name) - this.getAccountOrder(b.name);
        if (orderDiff !== 0) return orderDiff;
        return a.name.localeCompare(b.name, 'zh-CN');
      });
      this.taskAccountsList.forEach(a => this.taskAccounts.add(a.id));
      
      let finalRoomId = roomUrl;
      try {
        if (roomUrl && roomUrl.includes('live.douyin.com')) {
          const u = new URL(roomUrl);
          finalRoomId = u.pathname.replace('/', '').split('?')[0];
        }
      } catch (e) { }

      this.activeRoomId = finalRoomId;
      this.activeConfig = config;
      
      const savedState = this.loadState();
      const currentScriptsStr = JSON.stringify(config.scripts || []);
      const savedScriptsStr = savedState ? JSON.stringify(savedState.scripts || []) : '';
      
      if (savedState && currentScriptsStr === savedScriptsStr) {
        console.log(`[GlobalAutomation] 恢复上次发送进度 (话术索引: ${savedState.currentScriptIndex}, 循环: ${savedState.currentLoop}, 洗牌进度: ${savedState.currentShuffleIndex || 0}/${(savedState.shuffledOrder || []).length})`);
        this.currentAccountIndex = savedState.currentAccountIndex || 0;
        this.currentScriptIndex = savedState.currentScriptIndex || 0;
        this.currentLoop = savedState.currentLoop || 0;
        this.messagesSentTotal = savedState.messagesSentTotal || 0;
        this.shuffledOrder = savedState.shuffledOrder || [];
        this.currentShuffleIndex = savedState.currentShuffleIndex || 0;
      } else {
        this.currentAccountIndex = 0;
        this.currentScriptIndex = 0;
        this.currentLoop = 0;
        this.messagesSentTotal = 0;
        // 随机模式：初始化洗牌序列
        this.shuffledOrder = config.sendMode === 'random' && config.scripts
          ? this.shuffleArray(config.scripts.length)
          : [];
        this.currentShuffleIndex = 0;
      }
      
      console.log(`[GlobalAutomation] 🔗 锁定目标直播间: ${finalRoomId}`);

      const nextTick = () => {
          if (!this.activeRoomId) return; // 掉线或人为中断
          if (this.taskAccountsList.length === 0) return; // 没有选中账号
          
          if (!config.scripts || config.scripts.length === 0) {
              console.warn(`[GlobalAutomation] 无可用话术，停止发送。`);
              return;
          }

          // 检查循环次数
          if (config.loopCount && config.loopCount > 0) {
            if (config.sendMode === 'sequential' && this.currentLoop >= config.loopCount) {
              console.log(`[GlobalAutomation] 当前话术包已达到设定的循环次数 ${config.loopCount}，请求轮转推进。`);
              this.stopGlobalTimer();
              const mainWindow = WindowManager.getMainWindow();
              if (mainWindow) {
                // 先发送 ROTATE_ADVANCE，让渲染进程检查是否还有下一个话术包
                mainWindow.webContents.send(IpcChannels.ROTATE_ADVANCE);
              }
              return;
            } else if (config.sendMode === 'random' && this.messagesSentTotal >= config.scripts.length * config.loopCount) {
              console.log(`[GlobalAutomation] 随机模式已发送足够的总条数 (目标 ${config.scripts.length * config.loopCount})，请求轮转推进。`);
              this.stopGlobalTimer();
              const mainWindow = WindowManager.getMainWindow();
              if (mainWindow) {
                mainWindow.webContents.send(IpcChannels.ROTATE_ADVANCE);
              }
              return;
            }
          }

          // 选账号
          const account = this.taskAccountsList[this.currentAccountIndex];
          this.currentAccountIndex = (this.currentAccountIndex + 1) % this.taskAccountsList.length;
          const isNewRound = this.currentAccountIndex === 0 && this.taskAccountsList.length > 1;
          
          // 选话术
          let scriptToSend = '';
          if (config.sendMode === 'sequential') {
              scriptToSend = config.scripts[this.currentScriptIndex];
              this.currentScriptIndex++;
              if (this.currentScriptIndex >= config.scripts.length) {
                this.currentScriptIndex = 0;
                this.currentLoop++; // 增加循环计数
              }
          } else {
              // 洗牌模式：先打乱整个数组，按顺序发送，发完重新打乱
              const { index: drawnIdx, isNewRound: isShuffleNewRound } = this.drawNext(config.scripts.length);
              if (isShuffleNewRound && this.messagesSentTotal > 0) {
                this.currentLoop++;
              }
              scriptToSend = config.scripts[drawnIdx];
              this.messagesSentTotal++;

              const progress = this.currentShuffleIndex;
              console.log(`[GlobalAutomation] 🎲 洗牌发送话术[${drawnIdx}], 进度: ${progress}/${config.scripts.length}`);
          }

          console.log(`[GlobalAutomation] 🧩 将新一轮自动发信挂入重试防撞队列: Account=${account.name}, Msg=${scriptToSend}, Loop=${this.currentLoop}`);
          
          
          // 下发到重试队列
          SchedulerInstance.dispatch(account.id, scriptToSend, 1, 3, account.name);

          // 安排下一次
          const delay = this.getNextDelaySeconds(config, isNewRound);
          
          this.saveState();
          
          this.globalTimer = setTimeout(nextTick, Math.round(delay * 1000));
      };

      // 首发启动留出准备时间，避免启动后立刻发送
      const initialDelayMs = 2500 + Math.floor(Math.random() * 2500);
      this.globalTimer = setTimeout(nextTick, initialDelayMs);
    });

    // 人工手动停止全局发信
    ipcMain.on(IpcChannels.STOP_GLOBAL_SEND, () => {
      this.stopGlobalTimer();
      this.clearState();
      // 取消所有排队
      this.taskAccounts.forEach(accountId => {
         SchedulerInstance.cancelAllForAccount(accountId);
      });
      this.taskAccounts.clear();
      this.activeRoomId = null;
      this.activeConfig = null;
      console.log(`[GlobalAutomation] 🛑 所有全局账号已停止。`);
      // 通知渲染进程更新 UI 状态
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.GLOBAL_SEND_STOPPED);
      }
    });

    // 下播信号直接熔断：当 BtoolsService 或 LiveStatusObserver 检测到下播时，立即停止全局发送
    ipcMain.on(IpcChannels.LIVE_STATUS_OFFLINE, (_event, data) => {
      if (!this.activeRoomId) return; // 未在发送中，忽略

      const accountId = data?.accountId || '未知';
      console.log(`[GlobalAutomation] 📴 主进程收到下播熔断信号: ${accountId}，立即停止全局发送。`);

      this.stopGlobalTimer();
      this.saveState(); // 保留进度以便恢复

      // 取消所有排队中的消息
      this.taskAccounts.forEach(id => {
        SchedulerInstance.cancelAllForAccount(id);
      });

      this.activeRoomId = null;
      this.activeConfig = null;

      // 通知渲染进程更新 UI
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.GLOBAL_SEND_STOPPED);
        mainWindow.webContents.send(IpcChannels.RENDERER_LOG, `📴 检测到下播 (${accountId})，已自动停止全局发送`, '#ff4d4f');
      }
    });

    // 自动轮转动态更新话术列表 + 间隔时间
    ipcMain.on(IpcChannels.UPDATE_GLOBAL_SCRIPTS, (_event, data: { scripts: string[], minInterval?: number, maxInterval?: number }) => {
      if (this.activeConfig && data.scripts && data.scripts.length > 0) {
        this.activeConfig.scripts = data.scripts;
        this.currentScriptIndex = 0; // 重新从第一条开始
        // 重新洗牌
        this.shuffledOrder = this.activeConfig.sendMode === 'random'
          ? this.shuffleArray(data.scripts.length)
          : [];
        this.currentShuffleIndex = 0;

        // 同步间隔时间
        if (data.minInterval !== undefined && data.minInterval > 0) {
          this.activeConfig.minInterval = data.minInterval;
        }
        if (data.maxInterval !== undefined && data.maxInterval > 0) {
          this.activeConfig.maxInterval = data.maxInterval;
        }

        console.log(`[GlobalAutomation] 🔄 轮转切换话术列表 (${data.scripts.length} 条)，间隔 ${this.activeConfig.minInterval}-${this.activeConfig.maxInterval}s，已重置索引`);
      }
    });

    // Provide queue stats to renderer
    ipcMain.handle(IpcChannels.QUEUE_STATS_GET, () => {
      return SchedulerInstance.getStats();
    });
  }

  private static stopGlobalTimer() {
     if (this.globalTimer) {
         clearTimeout(this.globalTimer);
         this.globalTimer = null;
     }
  }
}
