/**
 * @file main-handler.ts
 * @description 主进程 IPC 事件处理注册中心。
 * 
 * P0-2 重构：所有通道名来自 IpcChannels，禁止硬编码。
 * 按功能域分组注册：系统 → 账号 → 自动化 → 配置 → 遗产兼容 → 随机模块。
 */

import { ipcMain } from 'electron';
import { IpcChannels } from './channels';
import { WindowManager } from '../window/window-manager';
import { DouyinSignService } from '../plugins/douyin-sec/sign-service';
import { CookieManager } from '../auth/cookie-manager';
import { PartitionRegistry } from '../../shared/partition-registry';

export class MainIpcHandler {
  public static register() {
    console.log('[MainIpcHandler] Registering IPC channels...');

    this.registerSystemHandlers();
    this.registerAccountHandlers();
    this.registerAutomationHandlers();
    this.registerConfigHandlers();
    this.registerLegacyHandlers();
    this.registerRandomModuleHandlers();
    this.registerNetworkHandlers();
  }

  // ==================== 系统级 ====================
  private static registerSystemHandlers() {
    // Page action 转发：Main → Renderer
    ipcMain.on(IpcChannels.PAGE_ACTION, (_event, data) => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.PAGE_ACTION, data);
      }
    });

    // 动态 JS 执行转发：Other Window -> Main Window
    ipcMain.on(IpcChannels.EXECUTE_WEBVIEW_JS, (_event, data) => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.EXECUTE_WEBVIEW_JS, data);
      }
    });

    // Preload 结果回传：Preload → Main → Renderer
    ipcMain.on(IpcChannels.PAGE_ACTION_RESULT, (_event, result) => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.PAGE_ACTION_RESULT, result);
      }
    });

    ipcMain.on('execute-webview-js-result', (_event, data) => {
      // Forward to lottery window (since it's the one using it)
      const { replyChannel, result } = data;
      const win = WindowManager['lotteryWindow']; // Internal access or expose a getter
      if (win) win.webContents.send(replyChannel, result);
    });

    // 账号状态同步：Preload → Main → Renderer
    ipcMain.on(IpcChannels.ACCOUNT_STATE_CHANGE, (_event, data) => {
      console.log(`[IPC] State change: ${data.accountId} isLoggedIn=${data.isLoggedIn}`);
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.ACCOUNT_STATE_CHANGE, data);
      }
    });

    // 清除默认 session 缓存
    ipcMain.on(IpcChannels.WEBVIEW_CLEAR_CACHE, async (event) => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        await mainWindow.webContents.session.clearCache();
        event.reply('cache-cleared', true);
      }
    });

    // 退出应用
    ipcMain.on(IpcChannels.APP_QUIT, () => {
      console.log('[MainIpcHandler] Received app-quit command');
      const { app } = require('electron');
      app.quit();
    });

    // 签名服务
    ipcMain.handle(IpcChannels.REQUEST_A_BOGUS, async (_event, { query, data }) => {
      return DouyinSignService.generateABogus(query, data);
    });

    // 透传日志
    ipcMain.on(IpcChannels.LOG_MESSAGE, (_event, msg) => {
      console.log(`[Webview Logger] ${msg}`);
    });

    // Main World JS 注入执行
    ipcMain.handle(IpcChannels.EXECUTE_MAIN_WORLD, async (event, code) => {
      try {
        if (!event.sender) return { success: false, error: 'No sender' };
        // Execute code directly in the frame's Main World
        const res = await event.sender.executeJavaScript(code);
        return { success: true, result: res };
      } catch (e: any) {
        return { success: false, error: e.message };
      }
    });
  }

  // ==================== 账号 CRUD ====================
  private static registerAccountHandlers() {
    const fs = require('fs');
    const path = require('path');
    const { app } = require('electron');
    const dbPath = path.join(app.getPath('userData'), 'accounts.json');

    ipcMain.handle(IpcChannels.READ_ACCOUNTS, async () => {
      try {
        if (!fs.existsSync(dbPath)) return [];
        const raw = fs.readFileSync(dbPath, 'utf8');
        const accounts = JSON.parse(raw);
        
        if (!Array.isArray(accounts) || accounts.length === 0) return [];

        // 检测是否为旧版格式（旧版含有 isLoggedIn / createdAt / liveRoomUrl 字段）
        const isLegacyFormat = accounts.some((a: any) => 
          a.hasOwnProperty('isLoggedIn') || a.hasOwnProperty('createdAt') || a.hasOwnProperty('liveRoomUrl')
        );

        if (!isLegacyFormat) return accounts;

        // 旧版格式自动迁移为新版 AccountData 格式
        console.log(`[IPC] 🔄 检测到旧版账号格式 (${accounts.length} 个)，执行自动迁移...`);
        const migrated = accounts.map((old: any) => ({
          id: old.id,                       // 保留原始 ID（匹配 Partition 目录）
          name: old.name || old.id,
          url: old.url || old.liveRoomUrl || '',
          isActive: false,
          isLocked: old.isLocked || false,
          isClosed: false,
          isDeleted: false,
          zone: 'COOLING' as const,
          crashCount: 0,
        }));

        // 自动保存迁移后的格式（下次读取不再触发迁移）
        fs.writeFileSync(dbPath, JSON.stringify(migrated, null, 2), 'utf8');
        console.log(`[IPC] ✅ 账号迁移完成，已保存新格式`);

        return migrated;
      } catch (e) {
        console.error('[IPC] Failed to read accounts', e);
        return [];
      }
    });

    ipcMain.handle(IpcChannels.SAVE_ACCOUNTS, async (_event, accounts) => {
      try {
        fs.writeFileSync(dbPath, JSON.stringify(accounts, null, 2), 'utf8');
        return { success: true };
      } catch (error: any) {
        console.error('[IPC] Save accounts error:', error);
        return { success: false, error: error.message };
      }
    });

    /**
     * 彻底删除账号的 partition 数据。
     * ⚠️ 仅在用户主动"彻底删除"时调用，绝不在启动时批量执行。
     */
    ipcMain.handle(IpcChannels.CLEAR_PARTITION_STORAGE, async (_event, accountId: string) => {
      try {
        if (!PartitionRegistry.isValidAccountId(accountId)) {
          console.error(`[IPC] 非法 accountId: ${accountId}，拒绝清除`);
          return false;
        }

        const { session } = require('electron');
        const partitionName = PartitionRegistry.getPartitionName(accountId);
        const accountSession = session.fromPartition(partitionName);
        await accountSession.clearStorageData({
          storages: ['appcache', 'cookies', 'filesystem', 'indexdb', 'localstorage', 'shadercache', 'websql', 'serviceworkers', 'cachestorage']
        });
        console.log(`[IPC] ✅ 彻底清除 partition: ${accountId} (${partitionName})`);
        return true;
      } catch (err) {
        console.error(`[IPC] ❌ 清除 partition 失败: ${accountId}`, err);
        return false;
      }
    });

    ipcMain.handle(IpcChannels.GET_NATIVE_COOKIE_TOKENS, async (_event, accountId: string) => {
      try {
        if (!accountId) return { csrfToken: '', msToken: '' };
        
        const partitionName = PartitionRegistry.getPartitionName(accountId);
        const accountSession = require('electron').session.fromPartition(partitionName);
        const cookies = await accountSession.cookies.get({});
        
        let csrfToken = '';
        let msToken = '';
        const cookieNames: string[] = [];
        cookies.forEach((c: any) => {
           cookieNames.push(c.name);
           if (c.name === 'tt_csrf_token') csrfToken = c.value;
           if (!csrfToken && c.name === 'passport_csrf_token') csrfToken = c.value; // Fallback
           if (!csrfToken && c.name === 'passport_csrf_token_default') csrfToken = c.value; // Deep Fallback
           if (c.name === 'msToken') msToken = c.value;
        });
        
        console.log(`[IPC] get-native-cookie-tokens for ${accountId}: Found ${cookies.length} cookies. Names: ${cookieNames.join(', ')}`);
        
        return { csrfToken, msToken };
      } catch (e) {
        console.error(`[IPC] GET_NATIVE_COOKIE_TOKENS 异常:`, e);
        return { csrfToken: '', msToken: '' };
      }
    });
  }

  // ==================== 自动化 / 调度 ====================
  private static registerAutomationHandlers() {
    // 福袋检测（实际由 LuckyBagObserver 异步处理）
    ipcMain.handle(IpcChannels.CHECK_AND_CLAIM_LOTTERY, async () => {
      return { success: true, found: false, message: '已交由底层异步扫描引擎实时检索' };
    });

    // 下播信号转发：Preload Observer → Main → Renderer（触发全局自动发送停止）
    ipcMain.on(IpcChannels.LIVE_STATUS_OFFLINE, (_event, data) => {
      console.log(`[MainIpcHandler] 📴 收到下播信号: accountId=${data?.accountId}`);
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.LIVE_STATUS_OFFLINE, data);
      }
    });
  }

  // ==================== 配置 ====================
  private static registerConfigHandlers() {
    const fs = require('fs');

    ipcMain.handle(IpcChannels.GET_GIFTS_LIST, async () => {
      try {
        const giftPath = require('path').join(process.cwd(), 'douyin_gifts.json');
        if (!fs.existsSync(giftPath)) return [];
        const raw = fs.readFileSync(giftPath, 'utf8');
        return JSON.parse(raw);
      } catch (e) {
        console.error('[IPC] Failed to read gifts list', e);
        return [];
      }
    });
  }

  // ==================== 旧版兼容 ====================
  private static registerLegacyHandlers() {
    ipcMain.handle(IpcChannels.GET_LEGACY_METADATA, () => {
      try {
        const path = require('path');
        const fs = require('fs');
        const legacyPath = path.join(process.cwd(), '..', 'accounts.json');
        const legacyPath2 = path.join(process.cwd(), 'accounts.json');
        let finalPath = '';
        if (fs.existsSync(legacyPath)) finalPath = legacyPath;
        else if (fs.existsSync(legacyPath2)) finalPath = legacyPath2;

        if (finalPath) {
          return JSON.parse(fs.readFileSync(finalPath, 'utf8'));
        }
      } catch (e) {
        console.error('[IPC] Failed to parse legacy metadata', e);
      }
      return null;
    });

    ipcMain.handle(IpcChannels.GET_LEGACY_ACCOUNTS, () => {
      return CookieManager.getLegacyAccountIds();
    });
  }

  // ==================== 随机模块 & 窗口控制 ====================
  private static registerRandomModuleHandlers() {
    ipcMain.on(IpcChannels.OPEN_RANDOM_WINDOW, () => {
      WindowManager.createRandomWindow();
    });

    ipcMain.on(IpcChannels.SET_RANDOM_ALWAYS_ON_TOP, (_event, isAlwaysOnTop) => {
      WindowManager.setRandomWindowAlwaysOnTop(isAlwaysOnTop);
    });

    ipcMain.on(IpcChannels.HIDE_RANDOM_WINDOW, () => {
      WindowManager.hideRandomWindow();
    });

    // ==================== 礼物控制模块 ====================
    ipcMain.on(IpcChannels.OPEN_GIFT_WINDOW, () => {
      WindowManager.createGiftWindow();
    });

    ipcMain.on(IpcChannels.SET_GIFT_ALWAYS_ON_TOP, (_event, isAlwaysOnTop) => {
      WindowManager.setGiftWindowAlwaysOnTop(isAlwaysOnTop);
    });

    // ==================== 福袋检测模块 ====================
    ipcMain.on(IpcChannels.OPEN_LOTTERY_WINDOW, () => {
      WindowManager.createLotteryWindow();
    });

    ipcMain.on(IpcChannels.SET_LOTTERY_ALWAYS_ON_TOP, (_event, isAlwaysOnTop) => {
      WindowManager.setLotteryWindowAlwaysOnTop(isAlwaysOnTop);
    });

    ipcMain.on(IpcChannels.HIDE_LOTTERY_WINDOW, () => {
      WindowManager.hideLotteryWindow();
    });

    // ==================== 验证模块 ====================
    ipcMain.on(IpcChannels.OPEN_VERIFY_WINDOW, (_event, accountId: string) => {
      WindowManager.createVerifyWindow(accountId);
    });

    ipcMain.on(IpcChannels.SOLVE_IFRAME_CAPTCHA, async (event) => {
      try {
        const webContents = event.sender;
        const frames = webContents.mainFrame.frames;
        // 查找包含滑块验证码的跨域 iframe
        const captchaFrame = frames.find(f => f.url.includes('rmc.bytedance.com') || f.url.includes('captcha') || f.url.includes('verify.snssdk.com'));
        if (captchaFrame) {
          console.log('[MainIpcHandler] Found Captcha Frame:', captchaFrame.url);
          // 在该跨域 iframe 内直接执行滑块破解代码
          await captchaFrame.executeJavaScript(`
            (async function() {
              console.log('[CaptchaFrame] 🤖 开始尝试自动滑动...');
              function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
              await wait(1500); 

              const bgImg = document.getElementById('captcha-verify-image') || document.getElementById('captcha_verify_image') || document.querySelector('img');
              const dragBtn = document.querySelector('.secsdk-captcha-drag-icon') || document.querySelector('.captcha-slider-btn') || document.querySelector('.secsdk-captcha-drag-slide') || document.querySelector('[class*="drag-icon"]') || document.querySelector('[class*="slider-btn"]');
              
              if (!bgImg || !dragBtn) {
                console.log('[CaptchaFrame] 找不到滑块或背景图');
                return;
              }

              const canvas = document.createElement('canvas');
              const ctx = canvas.getContext('2d');
              const naturalW = bgImg.naturalWidth || 340;
              const naturalH = bgImg.naturalHeight || 212;
              canvas.width = naturalW;
              canvas.height = naturalH;
              ctx.drawImage(bgImg, 0, 0, naturalW, naturalH);
              const bgData = ctx.getImageData(0, 0, naturalW, naturalH).data;

              let slideImg = document.getElementById('captcha-verify-image-slide') || document.querySelector('.captcha_verify_img_slide');
              if (!slideImg) {
                  const imgs = document.querySelectorAll('img');
                  if (imgs.length >= 2) slideImg = imgs[1];
              }

              let targetX = 0;

              if (slideImg) {
                  const slideW = slideImg.naturalWidth || slideImg.width || 55;
                  const slideH = slideImg.naturalHeight || slideImg.height || 55;
                  const slideCanvas = document.createElement('canvas');
                  const slideCtx = slideCanvas.getContext('2d');
                  slideCanvas.width = slideW;
                  slideCanvas.height = slideH;
                  slideCtx.drawImage(slideImg, 0, 0, slideW, slideH);
                  const slideData = slideCtx.getImageData(0, 0, slideW, slideH).data;
                  
                  const get2DEdges = (data, w, h) => {
                      const edges = new Float32Array(w * h);
                      for (let y = 1; y < h - 1; y++) {
                          for (let x = 1; x < w - 1; x++) {
                              const i = (y * w + x) * 4;
                              const dx = Math.abs(data[i+4] - data[i-4]) + Math.abs(data[i+5] - data[i-3]) + Math.abs(data[i+6] - data[i-2]);
                              const dy = Math.abs(data[i+w*4] - data[i-w*4]) + Math.abs(data[i+w*4+1] - data[i-w*4+1]) + Math.abs(data[i+w*4+2] - data[i-w*4+2]);
                              edges[y * w + x] = dx + dy;
                          }
                      }
                      return edges;
                  };

                  const bgEdges2D = get2DEdges(bgData, naturalW, naturalH);
                  const slideEdges2D = get2DEdges(slideData, slideW, slideH);

                  let minX = slideW, maxX = 0, minY = slideH, maxY = 0;
                  for (let y = 0; y < slideH; y++) {
                      for (let x = 0; x < slideW; x++) {
                          if (slideData[(y * slideW + x) * 4 + 3] > 20) {
                              if (x < minX) minX = x;
                              if (x > maxX) maxX = x;
                              if (y < minY) minY = y;
                              if (y > maxY) maxY = y;
                          }
                      }
                  }
                  
                  if (maxX >= minX && maxY >= minY) {
                      const pieceW = maxX - minX + 1;
                      const pieceH = maxY - minY + 1;
                      
                      const slideTopStr = window.getComputedStyle(slideImg).top;
                      // 如果图片是充满整个容器的，CSS top 通常是 0
                      const slideTop = parseInt(slideTopStr) || 0;
                      
                      let maxCorr = -1;
                      let bestX = 0;
                      
                      // 缺口一般在 40 到 width - pieceWidth 之间
                      for (let x = 40; x < naturalW - pieceW - 5; x++) {
                          let corr = 0;
                          let bgEnergy = 0;
                          let slideEnergy = 0;
                          
                          for (let py = 0; py < pieceH; py++) {
                              for (let px = 0; px < pieceW; px++) {
                                  const sx = minX + px;
                                  const sy = minY + py;
                                  
                                  // 仅对非透明区域计算相关性
                                  if (slideData[(sy * slideW + sx) * 4 + 3] > 20) {
                                      const sEdge = slideEdges2D[sy * slideW + sx];
                                      const bx = x + px;
                                      const by = sy + slideTop;
                                      
                                      if (by >= 0 && by < naturalH && bx >= 0 && bx < naturalW) {
                                          const bEdge = bgEdges2D[by * naturalW + bx];
                                          corr += sEdge * bEdge;
                                          bgEnergy += bEdge * bEdge;
                                          slideEnergy += sEdge * sEdge;
                                      }
                                  }
                              }
                          }
                          
                          // 归一化互相关 (NCC)
                          const ncc = corr / (Math.sqrt(bgEnergy) * Math.sqrt(slideEnergy) + 0.00001);
                          if (ncc > maxCorr) {
                              maxCorr = ncc;
                              bestX = x;
                          }
                      }
                      
                      const slideLeftStr = window.getComputedStyle(slideImg).left;
                      const slideLeft = parseInt(slideLeftStr) || 0;
                      targetX = bestX - minX - slideLeft;
                      console.log('[CaptchaFrame] 2D特征模板匹配完成，NCC:', maxCorr.toFixed(4), '距离:', targetX);
                  }
              }

              if (targetX <= 0) {
                  // 降级算法...
                  const colDiffs = new Array(naturalW).fill(0);
                  for (let x = 1; x < naturalW; x++) {
                    let diffSum = 0;
                    for (let y = 10; y < naturalH - 10; y++) {
                      const i = (y * naturalW + x) * 4;
                      const prevI = (y * naturalW + x - 1) * 4;
                      const diff = Math.abs(bgData[i] - bgData[prevI]) + Math.abs(bgData[i+1] - bgData[prevI+1]) + Math.abs(bgData[i+2] - bgData[prevI+2]);
                      diffSum += diff;
                    }
                    colDiffs[x] = diffSum;
                  }

                  let maxScore = 0;
                  for (let x = 40; x < naturalW - 60; x++) {
                    let localMax = 0;
                    for (let w = 40; w <= 55; w++) {
                       const score = colDiffs[x] + colDiffs[x + w];
                       if (score > localMax) localMax = score;
                    }
                    if (localMax > maxScore) {
                      maxScore = localMax;
                      targetX = x;
                    }
                  }
                  console.log('[CaptchaFrame] 采用双边沿差分法降级，绝对位置:', targetX);
              }
              
              const displayWidth = bgImg.getBoundingClientRect().width || 340;
              let distance = Math.floor(targetX * (displayWidth / naturalW));
              // 添加少许容差
              distance = distance > 0 ? distance - 2 : distance;
              console.log('[CaptchaFrame] 计算出拖动距离:', distance);

              const rect = dragBtn.getBoundingClientRect();
              const startX = rect.left + rect.width / 2;
              const startY = rect.top + rect.height / 2;

              const mousedown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: startX, clientY: startY });
              dragBtn.dispatchEvent(mousedown);
              await wait(200 + Math.random() * 200);

              // 构造真人滑动轨迹（突破深度学习风控）
              // 特征1：X轴呈 Sigmoid/EaseInOut 变速（起步慢，中间快，靠近终点减速）
              // 特征2：Y轴受手腕转轴影响，呈现轻微抛物线
              // 特征3：必然发生过冲（Overshoot）然后回拉
              const trajectory = [];
              const moveSteps = 30 + Math.floor(Math.random() * 15);
              const overshoot = distance + Math.random() * 10 + 2; // 随机超出2~12像素
              const yControl = (Math.random() > 0.5 ? 1 : -1) * (Math.random() * 6 + 2); // Y轴最大偏离量

              // 前进阶段
              for (let i = 1; i <= moveSteps; i++) {
                  let t = i / moveSteps;
                  // EaseInOutCubic 曲线
                  let xProgress = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
                  
                  let x = overshoot * xProgress;
                  // 叠加随机白噪声，越到后面抖动越小
                  x += (Math.random() - 0.5) * 2 * (1 - t);
                  
                  // Y轴抛物线，结合轻微随机波动
                  let yDev = 4 * yControl * t * (1 - t);
                  yDev += (Math.random() - 0.5) * 1.5;
                  
                  trajectory.push({ x, yDev, delay: 12 + Math.random() * 12 });
              }

              // 回拉阶段
              const backSteps = 8 + Math.floor(Math.random() * 6);
              const lastY = trajectory[trajectory.length - 1].yDev;
              for (let i = 1; i <= backSteps; i++) {
                  let t = i / backSteps;
                  let xProgress = t * (2 - t); // EaseOutQuad
                  let x = overshoot - (overshoot - distance) * xProgress;
                  let yDev = lastY * (1 - t) + (Math.random() - 0.5);
                  
                  trajectory.push({ x, yDev, delay: 20 + Math.random() * 20 });
              }

              // 执行轨迹
              for (const p of trajectory) {
                  const currentX = startX + p.x;
                  const currentY = startY + p.yDev;
                  const mousemove = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: currentX, clientY: currentY });
                  document.dispatchEvent(mousemove);
                  await wait(p.delay);
              }

              // 微调对准
              const mousemoveFinal = new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: startX + distance, clientY: startY + (Math.random() - 0.5) });
              document.dispatchEvent(mousemoveFinal);
              await wait(100 + Math.random() * 100);

              const mouseup = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: startX + distance, clientY: startY });
              document.dispatchEvent(mouseup);
              console.log('[CaptchaFrame] 滑块操作完毕');
            })();
          `);
        } else {
           console.log('[MainIpcHandler] Captcha frame not found.');
        }
      } catch (e) {
        console.error('[MainIpcHandler] Failed to solve iframe captcha:', e);
      }
    });

    ipcMain.on(IpcChannels.HIDE_GIFT_WINDOW, () => {
      WindowManager.hideGiftWindow();
    });

    ipcMain.on(IpcChannels.REQUEST_ACCOUNTS, () => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.REQUEST_ACCOUNTS);
      }
    });

    ipcMain.on(IpcChannels.RECEIVE_ACCOUNTS, (_event, accounts) => {
      const giftWindow = WindowManager.getGiftWindow();
      if (giftWindow) {
        giftWindow.webContents.send(IpcChannels.RECEIVE_ACCOUNTS, accounts);
      }
      const randomWindow = WindowManager.getRandomWindow();
      if (randomWindow) {
        randomWindow.webContents.send(IpcChannels.RECEIVE_ACCOUNTS, accounts);
      }
      const lotteryWindow = WindowManager.getLotteryWindow();
      if (lotteryWindow) {
        lotteryWindow.webContents.send(IpcChannels.RECEIVE_ACCOUNTS, accounts);
      }
    });

    ipcMain.on(IpcChannels.EXECUTE_RANDOM_SEND, (_event, phrase) => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.EXECUTE_RANDOM_SEND, phrase);
      }
    });

    ipcMain.on(IpcChannels.PUSH_RANDOM_LOG, (_event, msg) => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send(IpcChannels.RENDERER_LOG, msg);
      }
    });

    // 独立随机窗口 → 主渲染窗口的直发通道（绕过 PAGE_ACTION IPC 链路）
    ipcMain.on('random-direct-send', (_event, data) => {
      const mainWindow = WindowManager.getMainWindow();
      if (mainWindow) {
        mainWindow.webContents.send('random-direct-send', data);
      }
    });

    // 主渲染窗口回执 → 随机窗口
    ipcMain.on('random-direct-send-result', (_event, result) => {
      const randomWindow = WindowManager.getRandomWindow();
      if (randomWindow) {
        randomWindow.webContents.send('random-direct-send-result', result);
      }
    });
  }

  // ==================== 网络状态 ====================
  private static registerNetworkHandlers() {
    ipcMain.handle(IpcChannels.GET_NETWORK_STATE, () => {
      try {
        const { NetworkMonitor } = require('../services/network-monitor');
        return NetworkMonitor.getState();
      } catch (e) {
        return 'ONLINE';
      }
    });
  }
}
