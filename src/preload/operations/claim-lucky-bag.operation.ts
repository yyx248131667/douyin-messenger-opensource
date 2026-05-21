/**
 * @file claim-lucky-bag.operation.ts
 * @description 福袋自动领取流水线。
 *
 * 流程：点击福袋图标 → 检查参与条件 → 等待开奖 → 点击领取按钮
 * 使用 Main World 脚本注入执行 DOM 操作。
 */

import { ipcRenderer, webFrame } from 'electron';

export class ClaimLuckyBagOperation {
  private isProcessing = false;

  /**
   * 在 Main World 执行脚本
   */
  private async runInMainWorld<T = any>(code: string): Promise<T> {
    try {
      const result = await webFrame.executeJavaScript(code);
      return result as T;
    } catch (err: any) {
      console.log(`[LuckyBag Debug] ❌ webFrame 执行异常: ${err.message}`);
      return { error: err.message } as any;
    }
  }

  private async runWithSimulateClick<T = any>(code: string): Promise<T> {
    const wrappedCode = `
      (async function() {
        function _wait(ms) { return new Promise(r => setTimeout(r, ms)); }
        function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
        async function simulateClick(element) {
          if (!element) return false;
          try {
            // 福袋参与也增加随机时间200-600ms
            await _wait(randomBetween(200, 600));

            element.click();
            await _wait(100);
            var rect = element.getBoundingClientRect();
            var cx = rect.left + rect.width / 2;
            var cy = rect.top + rect.height / 2;
            
            var mouseEvents = ['mousedown', 'mouseup', 'click'];
            for (var i = 0; i < mouseEvents.length; i++) {
              var ev = new MouseEvent(mouseEvents[i], {
                view: window, bubbles: true, cancelable: true, buttons: 1,
                clientX: cx, clientY: cy, screenX: cx, screenY: cy
              });
              element.dispatchEvent(ev);
            }
            await _wait(100);

            var pointerEvents = ['pointerdown', 'pointerup'];
            for (var i = 0; i < pointerEvents.length; i++) {
              try {
                var pe = new PointerEvent(pointerEvents[i], {
                  bubbles: true, cancelable: true, isPrimary: true,
                  clientX: cx, clientY: cy
                });
                element.dispatchEvent(pe);
              } catch (e) {}
            }
            return true;
          } catch(e) {
            return false;
          }
        }
        ${code}
      })();
    `;
    return this.runInMainWorld<T>(wrappedCode);
  }

  public async execute(bagElement: HTMLElement): Promise<void> {
    if (this.isProcessing) return;

    try {
      this.isProcessing = true;
      console.log('[LuckyBagOperation] 🎁 开始福袋领取流程...');

      // --- [NEW] 提取账号标签与环境信息 ---
      console.log(`[LuckyBag Debug] 当前 URL: ${window.location.href}`);
      const roomMatch = window.location.href.match(/live\.douyin\.com\/(\d+)/);
      const urlRoomId = roomMatch ? roomMatch[1] : '';
      console.log(`[LuckyBag Debug] 提取到 URL roomId: ${urlRoomId}`);

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
                       for (var chunk of window.__pace_f) {
                           if (typeof chunk === 'string' && chunk.indexOf('owner_user_id') > -1) {
                               var m = chunk.match(/"owner_user_id"\\s*:\\s*"?(\\d{10,})"?/);
                               if (m) { hostId = m[1]; break; }
                           }
                       }
                    }
                } catch(e) {}
            }
            if (!hostId) {
                var m1 = html.match(/owner_user_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                if (m1) hostId = m1[1];
            }
            if (!hostId) {
                var m2 = html.match(/author_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                if (m2) hostId = m2[1];
            }
            if (!hostId) {
                var m3 = html.match(/anchor_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                if (m3) hostId = m3[1];
            }
            if (!hostId) {
                var userLink = document.querySelector('a[href*="user/"]');
                if (userLink) {
                     var linkMatch = userLink.href.match(/user\\/((?:MS4wLj)?[a-zA-Z0-9_-]+)/);
                     if (linkMatch) hostId = linkMatch[1];
                }
            }

            // Fallback for realRoomId
            if (!realRoomId || !/^\\d+$/.test(realRoomId)) {
                 var rm = html.match(/room_id[^0-9a-zA-Z]{1,10}(\\d+)/);
                 if (rm) realRoomId = rm[1];
                 else {
                     var rm2 = html.match(/id_str[^0-9a-zA-Z]{1,10}(\\d{15,})/);
                     if (rm2) realRoomId = rm2[1];
                 }
            }

            return { csrf: csrf, msToken: msToken, realRoomId: realRoomId, hostId: hostId };
          } catch(err) {
            return { error: err.message, csrf: '', msToken: '', realRoomId: '', hostId: '' };
          }
        })();
      `);

      console.log(`[LuckyBag Debug] 环境提取结果: csrf=${envResult?.csrf?.substring(0,8)}... msToken=${envResult?.msToken?.substring(0,8)}... realRoomId=${envResult?.realRoomId} hostId=${envResult?.hostId} error=${envResult?.error}`);

      const bagContext = {
          realRoomId: envResult?.realRoomId,
          hostId: envResult?.hostId,
          csrf: envResult?.csrf,
          msToken: envResult?.msToken
      };
      // -------------------------------------------------------------

      // 1. 随机延迟模拟真人
      await this.randomDelay(500, 1500);

      // 2. 点击福袋图标打开面板
      await this.runWithSimulateClick(`
        try {
          var bagElement = document.querySelector('[data-id="${bagElement.getAttribute('data-id') || ''}"]') || 
                           document.querySelector('.ycjwPFJI')?.closest('.LMUtLyr9') || 
                           document.querySelector('.ycjwPFJI')?.closest('.dVxrjT_h') || 
                           document.querySelector('.redpacket')?.closest('.LMUtLyr9') || 
                           document.querySelector('.redpacket')?.closest('.dVxrjT_h');
          
          if (!bagElement) {
             var selectors = [
               '.ycjwPFJI', '.redpacket', 
               'div[data-e2e="interactive-component-treasure-box"]', 
               'div[data-e2e="interactive-component-lucky-bag"]'
             ];
             for(var s of selectors) {
               var el = document.querySelector(s);
               if(el) {
                 bagElement = el.closest('.LMUtLyr9') || el.closest('.dVxrjT_h') || el;
                 break;
               }
             }
          }

          if (bagElement) {
            await simulateClick(bagElement);
            return { success: true };
          } else {
            return { success: false, error: 'Cannot re-select bagElement in MainWorld' };
          }
        } catch(e) {
          return { error: e.message };
        }
      `);
      
      console.log('[LuckyBagOperation] 已点击福袋图标');
      await this.randomDelay(1000, 2000);

      // 3. 检查参与条件（是否需要发弹幕）
      const conditionResult = await this.runInMainWorld(`
        (function() {
          try {
            var condEl = document.querySelector('[class*="condition"]')
                      || document.querySelector('[class*="requirement"]')
                      || document.querySelector('[class*="lottery-condition"]');
            var text = condEl ? (condEl.textContent || '') : '';
            return { text: text };
          } catch(e) {
            return { text: '' };
          }
        })();
      `);

      if (conditionResult?.text) {
        const requiredMsg = this.extractRequiredMessage(conditionResult.text);
        if (requiredMsg) {
          console.log(`[LuckyBag Debug] 需要发送暗号: ${requiredMsg}, 账号标签/环境: `, bagContext);
          ipcRenderer.send('page-action', {
            accountId: new URLSearchParams(window.location.search).get('accountId'),
            action: 'send-message',
            payload: { 
              content: requiredMsg,
              realRoomId: bagContext.realRoomId,
              hostId: bagContext.hostId
            }
          });
          await this.randomDelay(1500, 3000);
        }
      }

      // 4. 等待领取按钮可用（轮询，最长等 5 分钟）
      await this.waitForClaimButton(300000);

      // 5. 点击领取按钮
      const claimResult = await this.runWithSimulateClick(`
        try {
            var claimKeywords = [
              '一键发评论参与福袋', '一键发评论', '参与福袋',
              '等待开奖',
              '立即领取', '马上领取', '点击领取', '去领取',
              '立即参与', '马上参与', '去参与',
              '立即抢', '马上抢',
              '确定', '确认'
            ];
          var buttonSelectors = [
            'button:not([disabled])',
            'div[role="button"]',
            'span[role="button"]',
            '[class*="Button"]:not([disabled])',
            '[class*="button"]:not([disabled])',
            '[class*="Btn"]:not([disabled])',
            '[class*="btn"]:not([disabled])',
            '[class*="claim"]',
            '[class*="Claim"]',
            '[class*="receive"]',
            '[class*="Receive"]',
            '[class*="join"]',
            '[class*="Join"]',
            '[class*="participate"]',
            '[class*="Participate"]'
          ];
          var candidates = [];
          for (var s = 0; s < buttonSelectors.length; s++) {
            try {
              var els = document.querySelectorAll(buttonSelectors[s]);
              for (var j = 0; j < els.length; j++) {
                candidates.push(els[j]);
              }
            } catch(e) {}
          }
          // Also grab generic tags with exact text match fallback
          var generic = document.querySelectorAll('div, span');
          for (var j = 0; j < generic.length; j++) candidates.push(generic[j]);
          
          var bestBtn = null;
          var bestPriority = 999;
          var minArea = 9999999;

          for (var i = 0; i < candidates.length; i++) {
            var btn = candidates[i];
            var style = window.getComputedStyle(btn);
            if (btn.offsetParent === null || style.display === 'none' || style.visibility === 'hidden') continue;

            var rect = btn.getBoundingClientRect();
            var area = rect.width * rect.height;
            if (area === 0 || area > 80000) continue; // too big or hidden

            var txt = (btn.textContent || '').trim();
            var fullText = txt + ' ' + (btn.getAttribute('aria-label') || '') + ' ' + (btn.getAttribute('title') || '');
            
            for (var k = 0; k < claimKeywords.length; k++) {
              if (fullText.indexOf(claimKeywords[k]) >= 0) {
                // Prefer exact or close text match, and smaller elements (to avoid clicking giant parent containers)
                if (k < bestPriority || (k === bestPriority && area < minArea)) {
                  bestPriority = k;
                  bestBtn = btn;
                  minArea = area;
                }
                break;
              }
            }
          }

          if (bestBtn) {
            await simulateClick(bestBtn);
            return { success: true, text: bestBtn.textContent };
          } else {
            return { success: false, error: '未找到领取按钮' };
          }
        } catch(e) {
          return { error: e.message };
        }
      `);

      if (claimResult?.success) {
        console.log(`[LuckyBagOperation] ✓ 成功点击领取: "${claimResult.text}"`);
        // 针对 "一键发评论参与福袋"，点击后文字会在输入框内，需要在此处补充发送操作
        if ((claimResult.text || '').indexOf('评论') >= 0 || (claimResult.text || '').indexOf('参与') >= 0) {
          await this.randomDelay(200, 600); // 福袋参与也增加随机时间200-600ms
          await this.runWithSimulateClick(`
            try {
              var sendBtn = document.querySelector('.webcast-chatroom___send-btn') || 
                            document.querySelector('svg.webcast-chatroom___send-btn') ||
                            document.querySelector('#chatInput > svg') ||
                            document.querySelector('.webcast-chatroom___bottom-message textarea ~ svg') ||
                            document.querySelector('[data-e2e="chat-send-icon"]');
              if (sendBtn) {
                var opts = { bubbles: true, cancelable: true, view: window, composed: true };
                sendBtn.dispatchEvent(new MouseEvent('mousedown', opts));
                await _wait(randomBetween(20, 50));
                sendBtn.dispatchEvent(new MouseEvent('mouseup', opts));
                await _wait(randomBetween(20, 50));
                sendBtn.dispatchEvent(new MouseEvent('click', opts));
                try { sendBtn.click(); } catch(e) {}
              } else {
                // 回车兜底
                var inputArea = document.querySelector('.webcast-chatroom___input') || 
                                document.querySelector('.webcast-chatroom___textarea') ||
                                document.querySelector('#chatInput');
                if (inputArea) {
                  var eventInit = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13, bubbles: true, cancelable: true, composed: true };
                  inputArea.dispatchEvent(new KeyboardEvent('keydown', eventInit));
                  inputArea.dispatchEvent(new KeyboardEvent('keypress', eventInit));
                  inputArea.dispatchEvent(new KeyboardEvent('keyup', eventInit));
                  try {
                    var reactKey = Object.keys(inputArea).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                    if (reactKey && inputArea[reactKey] && inputArea[reactKey].onKeyDown) {
                      inputArea[reactKey].onKeyDown({ key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13, preventDefault: function(){} });
                    }
                  } catch(e) {}
                }
              }
            } catch(e) {}
            return {};
          `);
        }
      } else {
        console.warn('[LuckyBagOperation] 未能领取:', claimResult?.error);
      }

    } catch (err) {
      console.error('[LuckyBagOperation] 错误:', err);
    } finally {
      this.isProcessing = false;
      // 清理：关闭可能残留的面板
      setTimeout(() => {
        this.runWithSimulateClick(`
          var closeBtn = document.querySelector('[class*="close"], [class*="Close"]');
          if (closeBtn) await simulateClick(closeBtn);
          return {};
        `);
      }, 3000);
    }
  }

  /**
   * 轮询等待领取按钮出现
   */
  private async waitForClaimButton(timeoutMs: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const result = await this.runInMainWorld(`
        (function() {
          try {
            var claimKeywords = [
              '一键发评论参与福袋', '一键发评论', '参与福袋',
              '等待开奖',
              '立即领取', '马上领取', '点击领取', '去领取',
              '立即参与', '马上参与', '去参与',
              '立即抢', '马上抢',
              '确定', '确认'
            ];
            var buttonSelectors = [
              'button:not([disabled])',
              'div[role="button"]',
              'span[role="button"]',
              '[class*="Button"]:not([disabled])',
              '[class*="button"]:not([disabled])',
              '[class*="Btn"]:not([disabled])',
              '[class*="btn"]:not([disabled])',
              '[class*="claim"]',
              '[class*="Claim"]',
              '[class*="receive"]',
              '[class*="Receive"]',
              '[class*="join"]',
              '[class*="Join"]',
              '[class*="participate"]',
              '[class*="Participate"]'
            ];
            var btns = [];
            for (var s = 0; s < buttonSelectors.length; s++) {
              try {
                var els = document.querySelectorAll(buttonSelectors[s]);
                for (var j = 0; j < els.length; j++) btns.push(els[j]);
              } catch(e) {}
            }
            var generic = document.querySelectorAll('div, span');
            for (var j = 0; j < generic.length; j++) btns.push(generic[j]);

            var minArea = 9999999;
            var found = false;
            
            for (var i = 0; i < btns.length; i++) {
              var btn = btns[i];
              var style = window.getComputedStyle(btn);
              if (btn.offsetParent === null || style.display === 'none' || style.visibility === 'hidden') continue;

              var rect = btn.getBoundingClientRect();
              var area = rect.width * rect.height;
              if (area === 0 || area > 80000) continue;

              var txt = (btn.textContent || '').trim();
              var fullText = txt + ' ' + (btn.getAttribute('aria-label') || '');
              
              for (var k = 0; k < claimKeywords.length; k++) {
                if (fullText.indexOf(claimKeywords[k]) >= 0) {
                  found = true;
                  break;
                }
              }
              if (found) break;
            }
            return { found: found };
          } catch(e) {
            return { found: false };
          }
        })();
      `);
      if (result?.found) return;
      await this.randomDelay(800, 1500);
    }
    throw new Error('等待福袋开奖超时');
  }

  private extractRequiredMessage(text: string): string | null {
    // 兼容带引号、括号的格式，如：发送评论 "xxxx" 或 发送 [xxxx]
    const match = text.match(/(?:发送|发评论|评论)\s*[：""]*\s*[\[""]([^\]""]+)[\]""]/);
    if (match) return match[1];

    // 兼容无引号的纯文本冒号格式，如：发送评论：升学早知道，中考不迷茫！
    const colonMatch = text.match(/(?:发送|评论|条件)[^\:：]*[\:：]\s*([^！!。，,]+[！!。]?)/);
    if (colonMatch) return colonMatch[1].trim();
    
    return null;
  }

  private randomDelay(min: number, max: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, Math.random() * (max - min) + min));
  }
}
