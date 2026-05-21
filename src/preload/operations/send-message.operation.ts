import { ipcRenderer, webFrame } from 'electron';
import { BaseOperation } from '../core/base-operation';
import { ActionResult } from '../core/message-bridge';
import { IpcChannels } from '../../main/ipc/channels';

export class SendMessageOperation extends BaseOperation {
  public readonly actionName = 'send-message';

  private logToMain(msg: string) {
    console.log(msg);
    ipcRenderer.send(IpcChannels.LOG_MESSAGE, msg);
  }

  /**
   * 在 Main World 执行代码，绕过页面 CSP。
   */
  private async runInMainWorld<T = any>(code: string): Promise<T> {
    try {
      const result = await webFrame.executeJavaScript(code);
      return result as T;
    } catch (err: any) {
      this.logToMain(`[SendMsg] webFrame 执行异常: ${err.message}`);
      return { error: err.message } as any;
    }
  }

  public async execute(data: any): Promise<ActionResult> {
    const msg = (data?.payload?.content || data?.message || '').trim();
    const accountId = data?.payload?.accountId || data?.accountId || '';
    this.logToMain(`[SendMsg] 开始 DOM 发送 "${msg.substring(0, 20)}..." (accountId=${accountId})`);

    try {
      const sendResult = await this.runInMainWorld<any>(`
        (async function() {
          function wait(ms) { return new Promise(function(resolve) { setTimeout(resolve, ms); }); }
          function randomBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
          function isVisible(el) {
            if (!el) return false;
            var style = window.getComputedStyle(el);
            var rect = el.getBoundingClientRect();
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
          }
          function findInput() {
            var selectors = [
              'div[data-e2e="living-chat-input"]',
              'div[contenteditable="true"][data-e2e*="chat"]',
              'div[contenteditable="plaintext-only"]',
              'div[contenteditable="true"]',
              'textarea[placeholder*="说点什么"]',
              'textarea[placeholder*="聊点什么"]',
              'textarea',
              'input[type="text"]'
            ];

            for (var i = 0; i < selectors.length; i++) {
              var list = document.querySelectorAll(selectors[i]);
              for (var j = 0; j < list.length; j++) {
                if (isVisible(list[j])) return list[j];
              }
            }
            return null;
          }
          function findSendButton(inputArea) {
            var selectors = [
              'button[data-e2e="living-chat-send-btn"]',
              'div[data-e2e="living-chat-send-btn"]',
              '[data-e2e="living-chat-send-btn"]',
              'button[data-e2e*="send"]',
              '[data-e2e*="send"]',
              '[data-e2e*="chat-send"]',
              '[data-e2e*="send-btn"]',
              'button[class*="send"]',
              '[role="button"][class*="send"]',
              '.webcast-chatroom___send-btn',
              'svg.webcast-chatroom___send-btn',
              '#chatInput > svg'
            ];

            for (var i = 0; i < selectors.length; i++) {
              var list = document.querySelectorAll(selectors[i]);
              for (var j = 0; j < list.length; j++) {
                if (isVisible(list[j])) return list[j];
              }
            }

            if (inputArea) {
              var parent = inputArea.closest('[class*="chat"]') || inputArea.parentElement || inputArea;
              var nearby = parent.querySelectorAll('button, [role="button"], [class*="btn"], [class*="send"], div, span');
              for (var k = 0; k < nearby.length; k++) {
                var el = nearby[k];
                if (!isVisible(el)) continue;
                var text = (el.textContent || '').trim();
                var className = String(el.className || '');
                if (text === '发送' || text === 'Send') {
                   var rect = el.getBoundingClientRect();
                   if (rect.width > 0 && rect.width < 150 && rect.height > 0 && rect.height < 60) {
                     return el;
                   }
                }
              }
            }

            var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            var node;
            while ((node = walker.nextNode())) {
              var txt = (node.textContent || '').trim();
              if (txt !== '发送' && txt !== 'Send') continue;
              var p = node.parentElement;
              for (var depth = 0; depth < 4 && p; depth++) {
                if (isVisible(p)) {
                  var prect = p.getBoundingClientRect();
                  if (prect.width > 0 && prect.width < 150 && prect.height > 0 && prect.height < 60) {
                    return p;
                  }
                }
                p = p.parentElement;
              }
            }

            return null;
          }

          try {
            var inputArea = null;
            var sendBtn = null;
            for (var attempt = 0; attempt < 3; attempt++) {
              inputArea = findInput();
              if (inputArea) break;
              await wait(120);
            }

            if (!inputArea) {
              return { success: false, error: '未找到真实输入元素' };
            }

            var foundTagName = inputArea.className || inputArea.tagName || '';
            var cleanMsg = ${JSON.stringify(msg)}.trim();
            var isEditable = inputArea.isContentEditable || inputArea.getAttribute('contenteditable') === 'true';

            inputArea.removeAttribute && inputArea.removeAttribute('readonly');
            inputArea.removeAttribute && inputArea.removeAttribute('disabled');
            inputArea.focus();
            await wait(randomBetween(120, 260));

            try {
              inputArea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              inputArea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              inputArea.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
            } catch (e) {}

            await wait(randomBetween(80, 180));

            if (isEditable) {
              try {
                var sel = window.getSelection();
                var range = document.createRange();
                range.selectNodeContents(inputArea);
                sel.removeAllRanges();
                sel.addRange(range);
                document.execCommand('delete', false, null);
              } catch (e) {
                inputArea.textContent = '';
                inputArea.innerHTML = '';
              }

              await wait(randomBetween(60, 140));

              try {
                var inserted = document.execCommand('insertText', false, cleanMsg);
                if (!inserted) throw new Error('insertText failed');
              } catch (e) {
                inputArea.textContent = '';
                inputArea.innerHTML = '';
                var textNode = document.createTextNode(cleanMsg);
                inputArea.appendChild(textNode);
                var sel2 = window.getSelection();
                var range2 = document.createRange();
                range2.setStart(textNode, cleanMsg.length);
                range2.collapse(true);
                sel2.removeAllRanges();
                sel2.addRange(range2);
              }
            } else {
              var proto = inputArea.tagName.toLowerCase() === 'textarea'
                ? window.HTMLTextAreaElement.prototype
                : window.HTMLInputElement.prototype;
              var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
              if (nativeSetter) nativeSetter.call(inputArea, '');
              else inputArea.value = '';
              inputArea.dispatchEvent(new Event('input', { bubbles: true }));

              await wait(randomBetween(80, 160));

              if (nativeSetter) nativeSetter.call(inputArea, cleanMsg);
              else inputArea.value = cleanMsg;
              inputArea.selectionStart = cleanMsg.length;
              inputArea.selectionEnd = cleanMsg.length;
            }

            try {
              inputArea.dispatchEvent(new InputEvent('input', { bubbles: true, data: cleanMsg, inputType: 'insertText' }));
            } catch (e) {
              inputArea.dispatchEvent(new Event('input', { bubbles: true }));
            }
            inputArea.dispatchEvent(new Event('change', { bubbles: true }));
            inputArea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: cleanMsg.slice(-1) || ' ' }));

            // 按照请求：放在评论区随机等200-400ms再发出，防止风控
            await wait(randomBetween(200, 400));

            // Re-find sendBtn after input because some platforms disable it until text is present
            sendBtn = findSendButton(inputArea);

            if (sendBtn) {
              var srect = sendBtn.getBoundingClientRect();
              var cx = srect.left + srect.width / 2;
              var cy = srect.top + srect.height / 2;
              var options = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
              // 模拟鼠标悬停、点击的一些微小间隔
              await wait(randomBetween(20, 50));
              try { sendBtn.dispatchEvent(new PointerEvent('pointerdown', options)); } catch(e){}
              sendBtn.dispatchEvent(new MouseEvent('mousedown', options));
              await wait(randomBetween(30, 90));
              try { sendBtn.dispatchEvent(new PointerEvent('pointerup', options)); } catch(e){}
              sendBtn.dispatchEvent(new MouseEvent('mouseup', options));
              await wait(randomBetween(30, 90));
              try { sendBtn.dispatchEvent(new PointerEvent('click', options)); } catch(e){}
              sendBtn.dispatchEvent(new MouseEvent('click', options));
              try { sendBtn.click(); } catch (e) {}
            } else {
              await wait(randomBetween(200, 400)); // 放在评论区随机等200-400ms再发出
              var eventInit = {
                key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13, 
                bubbles: true, cancelable: true, composed: true
              };
              inputArea.dispatchEvent(new KeyboardEvent('keydown', eventInit));
              inputArea.dispatchEvent(new KeyboardEvent('keypress', eventInit));
              inputArea.dispatchEvent(new KeyboardEvent('keyup', eventInit));
              
              // 兼容部分 React 16+ 版本需要触发 onKeyDown
              try {
                var reactKey = Object.keys(inputArea).find(k => k.startsWith('__reactProps$') || k.startsWith('__reactEventHandlers$'));
                if (reactKey && inputArea[reactKey] && inputArea[reactKey].onKeyDown) {
                  inputArea[reactKey].onKeyDown({
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13, charCode: 13, preventDefault: function(){}
                  });
                }
              } catch(e) {}
            }

            await wait(randomBetween(260, 480));

            // ===== 发送后验证 =====
            // 等待 Douyin 处理发送（清空输入框表示真实成功）
            await wait(randomBetween(400, 800));

            // 检查1：输入框是否被清空
            var postSendContent = '';
            if (isEditable) {
              postSendContent = (inputArea.textContent || '').trim();
            } else {
              postSendContent = (inputArea.value || '').trim();
            }

            // 检查2：页面是否出现错误提示
            var errorToast = '';
            var errorSelectors = [
              '[class*="toast"]', '[class*="Toast"]',
              '[class*="error"]', '[class*="Error"]',
              '[class*="tip"]', '[class*="warn"]'
            ];
            for (var es = 0; es < errorSelectors.length; es++) {
              try {
                var toasts = document.querySelectorAll(errorSelectors[es]);
                for (var ti = 0; ti < toasts.length; ti++) {
                  var toast = toasts[ti];
                  var toastRect = toast.getBoundingClientRect();
                  if (toastRect.width > 0 && toastRect.height > 0) {
                    var toastText = (toast.textContent || '').trim();
                    if (toastText.length > 0 && toastText.length < 100) {
                      var errorKeywords = ['禁言', '频繁', '稍后', '限制', '不能', '无法', '封禁', '违规', '发送失败', '冷却', '请稍', '被限', '操作过快', '发言'];
                      for (var ek = 0; ek < errorKeywords.length; ek++) {
                        if (toastText.indexOf(errorKeywords[ek]) >= 0) {
                          errorToast = toastText;
                          break;
                        }
                      }
                    }
                  }
                  if (errorToast) break;
                }
              } catch(e) {}
              if (errorToast) break;
            }

            if (errorToast) {
              return {
                success: false,
                method: 'DOM',
                error: '页面提示: ' + errorToast,
                verified: false
              };
            }

            if (postSendContent === cleanMsg) {
              return {
                success: false,
                method: 'DOM',
                error: '输入框未被清空，消息可能未发出',
                verified: false
              };
            }

            return {
              success: true,
              method: 'DOM',
              details: '输入=' + foundTagName.substring(0, 30) + ', hasBtn=' + (!!sendBtn),
              verified: true
            };
          } catch (e) {
            return { success: false, error: e && e.message ? e.message : String(e) };
          }
        })();
      `);

      if (sendResult?.success) {
        const verifiedTag = sendResult.verified ? '(已验证)' : '(未验证)';
        this.logToMain(`[SendMsg] DOM 发送成功 ${verifiedTag} [${msg}]`);
        return { success: true };
      } else {
        this.logToMain(`[SendMsg] DOM 发送失败: ${sendResult?.error}`);
        return { success: false, error: sendResult?.error };
      }
    } catch (err: any) {
      this.logToMain(`[SendMsg] 严重错误: ${err.message}`);
      return { success: false, error: err.message };
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async executeApiFallback(msg: string, accountId: string): Promise<ActionResult> {
    const envResult = await this.runInMainWorld<any>(`...`);
    void envResult;
    void msg;
    void accountId;
    return { success: false, error: 'Not implemented in this active block' };
  }
}
