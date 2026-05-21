import * as http from 'http';
import * as url from 'url';
import { BrowserWindow } from 'electron';
import { WindowManager } from '../window/window-manager';
import { IpcChannels } from '../ipc/channels';

/**
 * @file btools.service.ts
 * @description Local HTTP Server on port 18110 for douyin_btools (bililive-go plugin).
 * This allows external tools to query live room status using the Electron app's context.
 * 
 * 增强：当检测到下播（living=false）时，主动向渲染进程发送 LIVE_STATUS_OFFLINE 信号，
 * 触发全局自动发送停止。
 */

/** 记录每个 roomId 上次已知的在线状态，防止重复触发下播信号 */
const roomStatusCache: Map<string, boolean> = new Map();

/** 下播保护计时器：5分钟后若仍下播则断开网络 */
const offlineProtectionTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

export class BtoolsService {
  private static server: http.Server;

  /**
   * 向渲染进程发送下播信号
   */
  private static notifyOffline(roomId: string): void {
    console.log(`[BtoolsService] 📴 检测到下播: roomId=${roomId}`);
    const mainWindow = WindowManager.getMainWindow();
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.LIVE_STATUS_OFFLINE, {
        accountId: `room_${roomId}`,
        roomId,
        source: 'btools-service',
        timestamp: Date.now()
      });
    }

    // 启动5分钟下播保护计时器
    this.startOfflineProtection(roomId);
  }

  /**
   * 下播保护：5分钟后若直播间仍未恢复，断开该账号网络连接
   */
  private static startOfflineProtection(roomId: string): void {
    // 清除之前的计时器（防止重复）
    const existing = offlineProtectionTimers.get(roomId);
    if (existing) clearTimeout(existing);

    console.log(`[BtoolsService] ⏳ 启动下播保护: roomId=${roomId}，5分钟后检查...`);

    const timer = setTimeout(async () => {
      offlineProtectionTimers.delete(roomId);

      // 5分钟后再次检查直播间状态
      let stillOffline = true;
      try {
        const fetchRes = await fetch(`https://live.douyin.com/${roomId}`, {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
        });
        const html = await fetchRes.text();
        const match = html.match(/id="RENDER_DATA"[^>]*>([\s\S]+?)<\/script>/);
        if (match && match[1]) {
          const jsonStr = decodeURIComponent(match[1]);
          const data = JSON.parse(jsonStr);
          const status = data?.app?.initialState?.roomStore?.roomInfo?.room?.status;
          if (status === 2) {
            stillOffline = false;
          }
        }
      } catch (err) {
        console.warn(`[BtoolsService] 下播保护检查失败: ${err}`);
      }

      if (stillOffline) {
        console.log(`[BtoolsService] 🚨 roomId=${roomId} 下播超过5分钟，执行断网保护！`);
        const mainWindow = WindowManager.getMainWindow();
        if (mainWindow) {
          mainWindow.webContents.send(IpcChannels.OFFLINE_PROTECTION_DISCONNECT, {
            roomId,
            timestamp: Date.now()
          });
        }
      } else {
        console.log(`[BtoolsService] ✅ roomId=${roomId} 已恢复直播，取消断网保护`);
        // 更新缓存
        roomStatusCache.set(roomId, true);
      }
    }, 5 * 60 * 1000); // 5分钟

    offlineProtectionTimers.set(roomId, timer);
  }

  /**
   * 取消下播保护（当直播恢复时）
   */
  private static cancelOfflineProtection(roomId: string): void {
    const timer = offlineProtectionTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      offlineProtectionTimers.delete(roomId);
      console.log(`[BtoolsService] ✅ 取消下播保护: roomId=${roomId}（直播已恢复）`);
    }
  }

  public static init() {
    this.server = http.createServer(async (req, res) => {
      try {
        const parsedUrl = url.parse(req.url || '', true);
        const pathname = parsedUrl.pathname;
        const query = parsedUrl.query;

        // Basic Auth check
        const authHeader = req.headers['authorization'];
        if (authHeader !== 'Basic YTph') {
          res.writeHead(401);
          res.end('Unauthorized');
          return;
        }

        if (pathname === '/bgo/channel-info') {
          const targetUrl = query.url as string;
          let roomId = '';
          if (targetUrl) {
            const match = targetUrl.match(/douyin\.com\/([0-9a-zA-Z]+)/);
            if (match) roomId = match[1];
          }
          
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: roomId,
            title: 'Live Room',
            owner: 'Host',
            avatar: '',
            uid: ''
          }));
          return;
        }

        if (pathname === '/bgo/live-info') {
          const roomId = query.roomId as string;
          let living = false;

          if (roomId) {
            try {
              // Fetch latest HTML to check RENDER_DATA
              const fetchRes = await fetch(`https://live.douyin.com/${roomId}`, { 
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
              });
              const html = await fetchRes.text();
              const match = html.match(/id="RENDER_DATA"[^>]*>([\s\S]+?)<\/script>/);
              if (match && match[1]) {
                const jsonStr = decodeURIComponent(match[1]);
                const data = JSON.parse(jsonStr);
                const status = data?.app?.initialState?.roomStore?.roomInfo?.room?.status;
                if (status === 2) {
                  living = true;
                }
              }
            } catch (err) {
              console.warn('[BtoolsService] Error fetching live-info:', err);
            }

            // ===== 下播自动停止联动 =====
            const previousStatus = roomStatusCache.get(roomId);
            roomStatusCache.set(roomId, living);

            // 仅在状态从"在线"变为"下线"时触发（防止重复通知）
            if (previousStatus === true && living === false) {
              this.notifyOffline(roomId);
            }
            // 状态从"下线"恢复为"在线"时，取消保护计时器
            if (previousStatus === false && living === true) {
              this.cancelOfflineProtection(roomId);
            }
            // 首次查询且已下播，也记录状态（不触发，避免误报）
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            title: 'Live Room',
            owner: 'Host',
            living: living
          }));
          return;
        }

        if (pathname === '/bgo/stream-info') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            stream: 'https://example.com/stream.flv' // Placeholder, bililive-go only needs valid stream info if downloading
          }));
          return;
        }

        res.writeHead(404);
        res.end('Not Found');
      } catch (e) {
        console.error('[BtoolsService] Request error:', e);
        res.writeHead(500);
        res.end('Internal Error');
      }
    });

    this.server.listen(18110, '127.0.0.1', () => {
      console.log('[BtoolsService] btools server listening on 127.0.0.1:18110');
    });
  }
}
