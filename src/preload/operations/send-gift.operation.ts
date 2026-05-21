/**
 * @file send-gift.operation.ts
 * @description 送礼流水线 — webFrame.executeJavaScript + a_bogus 签名模式
 *
 * 核心改动：
 * 1. 使用 webFrame.executeJavaScript 替代 DOM script 注入，绕过 CSP
 * 2. 保留 a_bogus 签名逻辑
 * 3. 礼物缓存机制不变
 */

import { ipcRenderer, webFrame } from 'electron';
import { BaseOperation } from '../core/base-operation';
import { ActionResult } from '../core/message-bridge';

export class SendGiftOperation extends BaseOperation {
  public readonly actionName = 'send-gift';
  // 缓存完整的礼物对象信息（包含 id, name, diamond_count, type 等）
  private static giftCache: Map<string, any> = new Map();

  private logToMain(msg: string) {
    console.log(msg);
    ipcRenderer.send('log-message', msg);
  }

  /**
   * 在 Main World 执行代码（绕过 CSP）
   * 使用 webFrame.executeJavaScript 直接注入
   */
  private async runInMainWorld<T = any>(code: string): Promise<T> {
    try {
      const result = await webFrame.executeJavaScript(code);
      return result as T;
    } catch (err: any) {
      this.logToMain(`[Gift] ❌ webFrame 执行异常: ${err.message}`);
      return { error: err.message } as any;
    }
  }

  public async execute(data: any): Promise<ActionResult> {
    const giftName = data?.payload?.giftName || data?.giftName || '';
    const comboCount = data?.payload?.comboCount || data?.comboCount || 1;
    try {
      this.logToMain(`[Gift Debug] 送礼入口调用! 完整 payload: ${JSON.stringify(data)}`);
      this.logToMain(`[Gift] 送礼: ${giftName} x ${comboCount}`);


      // 1. 获取直播间 URL ID
      this.logToMain(`[Gift Debug] 当前 URL: ${window.location.href}`);
      const roomMatch = window.location.href.match(/live\.douyin\.com\/(\d+)/);
      if (!roomMatch) throw new Error('Not in a valid live room');
      const urlRoomId = roomMatch[1];
      this.logToMain(`[Gift Debug] 提取到 URL roomId: ${urlRoomId}`);

      // 2. 在 Main World 提取 room_id + host_id + csrf + msToken
      const envResult = await this.runInMainWorld<{
        csrf: string;
        msToken: string;
        realRoomId: string;
        hostId: string;
        error?: string;
      }>(`
        (function() {
          try {
            var csrf = '';
            var msToken = '';

            // 优先从拦截器活体 token 获取
            if (window.__dyNativeTokens) {
              csrf = window.__dyNativeTokens.csrf || '';
              msToken = window.__dyNativeTokens.msToken || '';
            }

            // cookie 补充
            var cs = document.cookie.split(';');
            for (var i = 0; i < cs.length; i++) {
              var t = cs[i].trim();
              if (!csrf && t.indexOf('tt_csrf_token=') === 0) csrf = t.split('=')[1];
              if (!csrf && t.indexOf('passport_csrf_token=') === 0) csrf = t.split('=')[1];
              if (!msToken && t.indexOf('msToken=') === 0) msToken = t.split('=')[1];
            }
            if (!csrf) { return { error: "csrfToken缺失", csrf: '', msToken: '', realRoomId: '', hostId: '' }; }

            // 提取真实 room_id 和主播 ID
            var realRoomId = '${urlRoomId}';
            var hostId = '';
            var html = document.documentElement.innerHTML || '';

            // Try RENDER_DATA first
            try {
              var state = window._SSR_PRERENDER_DATA || window.RENDER_DATA;
              if (!state) {
                var d = document.getElementById('RENDER_DATA');
                if (d && d.innerText) state = JSON.parse(decodeURIComponent(d.innerText));
              }
              if (state && state.app && state.app.initialState && state.app.initialState.roomStore) {
                var ri = state.app.initialState.roomStore.roomInfo;
                if (ri.roomId) realRoomId = ri.roomId.toString();
                if (ri.anchor && ri.anchor.id_str) hostId = ri.anchor.id_str;
                else if (ri.owner && ri.owner.id_str) hostId = ri.owner.id_str;
              }
            } catch(e) {}

            // Fallback for anchorId (hostId)
            if (!hostId) {
                try {
                    if (window.__pace_f && Array.isArray(window.__pace_f)) {
                       for (let chunk of window.__pace_f) {
                           if (typeof chunk === 'string' && chunk.includes('owner_user_id')) {
                               let m = chunk.match(/"owner_user_id"\\s*:\\s*"?(\\d{10,})"?/);
                               if (m) { hostId = m[1]; break; }
                           }
                       }
                    }
                } catch(e) {}
            }
            if (!hostId) {
                let m1 = html.match(/owner_user_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                if (m1) hostId = m1[1];
            }
            if (!hostId) {
                let m2 = html.match(/author_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                if (m2) hostId = m2[1];
            }
            if (!hostId) {
                let m3 = html.match(/anchor_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                if (m3) hostId = m3[1];
            }
            if (!hostId) {
                let userLink = document.querySelector('a[href*="user/"]');
                if (userLink) {
                     let linkMatch = userLink.href.match(/user\\/((?:MS4wLj)?[a-zA-Z0-9_-]+)/);
                     if (linkMatch) hostId = linkMatch[1];
                }
            }

            // Fallback for realRoomId
            if (!realRoomId || !/^\\d+$/.test(realRoomId)) {
                 let rm = html.match(/room_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                 if (rm) realRoomId = rm[1];
                 else {
                     let rm2 = html.match(/id_str[^0-9a-zA-Z]{1,10}(\\d{15,})/);
                     if (rm2) realRoomId = rm2[1];
                 }
            }

            return { csrf: csrf, msToken: msToken, realRoomId: realRoomId, hostId: hostId };
          } catch(err) {
            return { error: err.message, csrf: '', msToken: '', realRoomId: '', hostId: '' };
          }
        })();
      `);

      this.logToMain(`[Gift Debug] 环境提取结果: csrf=${envResult?.csrf?.substring(0,8)}... msToken=${envResult?.msToken?.substring(0,8)}... realRoomId=${envResult?.realRoomId} hostId=${envResult?.hostId} error=${envResult?.error}`);
      if (envResult?.error) throw new Error(envResult.error);
      const { csrf, msToken, realRoomId, hostId } = envResult;
      if (!hostId) throw new Error('无法提取主播 ID');

      // 3. 解析礼物信息
      this.logToMain(`[Gift Debug] 开始解析礼物 ID, giftName=${giftName}`);
      const giftInfo = await this.resolveGiftInfo(giftName, realRoomId, urlRoomId, csrf, msToken);
      this.logToMain(`[Gift Debug] 解析结果: ${JSON.stringify(giftInfo)}`);
      if (!giftInfo) return { success: false, error: `未匹配到礼物 [${giftName}]` };

      // 4. 构建请求体 — 使用原始参数格式
      const bodyStr = `live_id=1&room_id=${realRoomId}&to_user_id=${hostId}&gift_id=${giftInfo.id}&count=${comboCount}`;

      const qp = new URLSearchParams();
      qp.append('aid', '6383');
      qp.append('app_name', 'douyin_web');
      qp.append('live_id', '1');
      qp.append('device_platform', 'web');
      qp.append('language', 'zh-CN');
      qp.append('enter_from', 'web_others_homepage');
      qp.append('cookie_enabled', 'true');
      qp.append('screen_width', '2560');
      qp.append('screen_height', '1440');
      qp.append('browser_language', 'zh-CN');
      qp.append('browser_platform', 'Win32');
      qp.append('browser_name', 'Chrome');
      qp.append('browser_version', '120.0.0.0');
      qp.append('room_id', realRoomId);
      if (msToken) qp.append('msToken', msToken);
      const queryStr = qp.toString();

      // 5. 不再手动签名，直接使用 XMLHttpRequest 交给底层 SecSDK 自动签名
      const apiUrl = `/webcast/gift/send/?room_id=${realRoomId}&aid=6383&device_platform=web`;
      this.logToMain(`[Gift Debug] 发送 API URL: ${apiUrl}`);
      this.logToMain(`[Gift Debug] 发送 Body: ${bodyStr}`);
      const sendResult = await this.runInMainWorld<any>(`
        (function() {
          return new Promise(function(resolve, reject) {
            try {
              var xhr = new XMLHttpRequest();
              xhr.open('POST', '${apiUrl}', true);
              xhr.withCredentials = true;
              xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
              xhr.timeout = 10000;
              xhr.onerror = function() { resolve({ error: 'Network error or blocked' }); };
              xhr.ontimeout = function() { resolve({ error: 'Network timeout' }); };
              xhr.onreadystatechange = function() {
                  if (xhr.readyState === 4) {
                      if (xhr.status === 200) {
                          try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({ status_code: xhr.status }); }
                      } else if (xhr.status !== 0) { resolve({ error: "HTTP"+xhr.status }); }
                  }
              };
              xhr.send(${JSON.stringify(bodyStr)});
            } catch(err) {
              resolve({ error: err.message });
            }
          });
        })();
      `);

      this.logToMain(`[Gift Debug] API 响应: ${JSON.stringify(sendResult).substring(0, 300)}`);
      if (sendResult?.error) {
        return { success: false, error: sendResult.error };
      }

      if (sendResult?.status_code === 0) {
        this.logToMain(`[Gift] ✓✓✓ 送礼成功 [${giftName}] ✓✓✓`);
        return { success: true };
      } else {
        const errMsg = sendResult?.data?.prompts || sendResult?.data?.message || sendResult?.message || `status_code=${sendResult?.status_code}`;
        this.logToMain(`[Gift] 送礼失败: ${errMsg}`);
        return { success: false, error: errMsg };
      }

    } catch (err: any) {
      this.logToMain(`[Gift] 错误: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  /**
   * 解析礼物完整信息，通过 Main World XHR 拉取礼物列表
   */
  private async resolveGiftInfo(giftName: string, realRoomId: string, urlRoomId: string, csrf: string, msToken: string): Promise<any | null> {
    if (SendGiftOperation.giftCache.has(giftName)) {
      return SendGiftOperation.giftCache.get(giftName)!;
    }

    try {
      this.logToMain('[Gift] 拉取礼物列表...');
      const listUrl = `/webcast/gift/list/?room_id=${realRoomId}&aid=6383&device_platform=web`;
      this.logToMain(`[Gift Debug] 礼物列表 URL: ${listUrl}`);

      const result = await this.runInMainWorld<any>(`
        (function() {
          return new Promise(function(resolve, reject) {
            try {
              var xhr = new XMLHttpRequest();
              xhr.open('GET', '${listUrl}', true);
              xhr.withCredentials = true;
              xhr.timeout = 10000;
              xhr.onerror = function() { resolve({ error: 'Gift list GET network error' }); };
              xhr.ontimeout = function() { resolve({ error: 'Gift list GET timeout' }); };
              xhr.onreadystatechange = function() {
                  if (xhr.readyState === 4) {
                      if (xhr.status === 200) {
                          try { resolve(JSON.parse(xhr.responseText)); } catch(e) { resolve({ error: e.message }); }
                      } else if (xhr.status !== 0) { resolve({ error: 'Gift list GET failed with status ' + xhr.status }); }
                  }
              };
              xhr.send(null);
            } catch(err) {
              resolve({ error: err.message });
            }
          });
        })();
      `);

      this.logToMain(`[Gift Debug] 礼物列表 API 响应 status_code=${result?.status_code} error=${result?.error}`);
      if (result?.status_code === 0 && result?.data) {
        let totalGifts = 0;
        // 统一处理：解析所有礼物并缓存完整对象
        // 同名礼物冲突时，优先保留价格最低的版本（用户通常想送便宜的）
        const processGift = (item: any) => {
          const cost = item.diamond_count || item.gift_price || 0;
          const info = {
            id: String(item.id),
            name: item.name,
            diamond_count: cost,
            type: item.type || 0
          };
          const existing = SendGiftOperation.giftCache.get(item.name);
          if (!existing || cost < existing.diamond_count) {
            SendGiftOperation.giftCache.set(item.name, info);
          }
          totalGifts++;
        };

        if (result.data.gifts) {
          result.data.gifts.forEach(processGift);
        }
        if (result.data.pages) {
          for (const p of result.data.pages) {
            if (p.gifts) p.gifts.forEach(processGift);
          }
        }

        // 打印目标礼物的完整匹配信息
        const matched = SendGiftOperation.giftCache.get(giftName);
        this.logToMain(`[Gift Debug] 共缓存 ${totalGifts} 个礼物, 命中[${giftName}]: ${JSON.stringify(matched)}`);
      } else {
        this.logToMain(`[Gift Debug] 礼物列表拉取失败或数据为空, 完整响应: ${JSON.stringify(result).substring(0, 500)}`);
      }
    } catch (err) {
      this.logToMain(`[Gift] 拉取礼物列表失败: ${err}`);
    }

    return SendGiftOperation.giftCache.get(giftName) || null;
  }
}
