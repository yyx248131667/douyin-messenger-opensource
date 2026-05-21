/**
 * @file index.ts
 * @description UI Entrypoint. Binds Controllers and Renderers via EventBus.
 */

import { EventBus } from './core/event-bus';
import { AccountController } from './controllers/account-controller';
import { TabRenderer } from './renderers/tab-renderer';
import { WebviewController } from '../infrastructure/webview/webview-controller';
import { ipcRenderer } from 'electron';
import { IpcChannels } from '../main/ipc/channels';
import { GlobalAutomationRenderer } from './renderers/global-automation-renderer';
import { ScriptRenderer } from './renderers/script-renderer';
import { GiftRenderer } from './renderers/gift-renderer';
import { AccountManagementRenderer } from './renderers/account-management-renderer';
import { RoomManagementRenderer } from './renderers/room-management-renderer';
import { TimerRenderer } from './renderers/timer-renderer';
import { HealthDashboardRenderer } from './renderers/health-dashboard-renderer';
import { lockWebviewInput, unlockWebviewInput } from './utils/webview-input-lock';

const accountController = new AccountController();
const tabRenderer = new TabRenderer();
const webviewController = new WebviewController('webviews-container');
const globalAutomationRenderer = new GlobalAutomationRenderer('control-panel-container');
const scriptRenderer = new ScriptRenderer('control-panel-container');

// Gift Renderer logic moved to separate window
// const giftRenderer = new GiftRenderer(accountController);
const accountMgtRenderer = new AccountManagementRenderer(accountController);
const roomMgtRenderer = new RoomManagementRenderer();
const timerRenderer = new TimerRenderer();
const healthDashboard = new HealthDashboardRenderer(accountController);

// 1. Initialize Renderers
document.addEventListener('DOMContentLoaded', () => {
  tabRenderer.initialize('tabs-header');
  globalAutomationRenderer.render(accountController);
  scriptRenderer.render('btn-script-mgt');

  document.getElementById('btn-lottery')?.addEventListener('click', () => {
    ipcRenderer.send(IpcChannels.OPEN_LOTTERY_WINDOW);
  });

  document.getElementById('btn-auto-gift')?.addEventListener('click', () => {
    ipcRenderer.send(IpcChannels.OPEN_GIFT_WINDOW);
  });
  accountMgtRenderer.initialize('btn-account-mgt');
  roomMgtRenderer.initialize('btn-room-mgt');
  timerRenderer.render('btn-timer-mgt');
  healthDashboard.initialize('btn-health-dashboard');

  // Load and auto-save global inputs
  const urlInput = document.getElementById('global-room-url') as HTMLInputElement;
  const minInput = document.getElementById('global-interval-min') as HTMLInputElement;
  const maxInput = document.getElementById('global-interval-max') as HTMLInputElement;

  if (urlInput) {
    const savedUrl = localStorage.getItem('global-room-url');
    if (savedUrl) urlInput.value = savedUrl;
    urlInput.addEventListener('input', () => localStorage.setItem('global-room-url', urlInput.value));
  }

  // 初始化主界面直播间下拉选择（Combo-box 模式）
  const dropdownBtn = document.getElementById('room-url-dropdown-btn');
  const dropdownList = document.getElementById('room-url-dropdown-list');

  function populateRoomDropdown(): void {
    if (!dropdownList) return;
    dropdownList.innerHTML = '';
    try {
      const stored = localStorage.getItem('cfg_saved_rooms');
      if (stored) {
        const rooms: { name: string; url: string }[] = JSON.parse(stored);
        if (rooms.length === 0) {
          dropdownList.innerHTML = '<div style="padding:10px;color:#999;text-align:center;font-size:13px;">暂无保存的直播间</div>';
          return;
        }
        rooms.forEach(r => {
          const item = document.createElement('div');
          const roomId = r.url.replace('https://live.douyin.com/', '');
          item.textContent = `${r.name}  (${roomId})`;
          item.style.cssText = 'padding:8px 12px;cursor:pointer;font-size:13px;color:#333;border-bottom:1px solid #f0f0f0;transition:background 0.15s;';
          item.addEventListener('mouseenter', () => { item.style.background = '#e6f7ff'; });
          item.addEventListener('mouseleave', () => { item.style.background = '#fff'; });
          item.addEventListener('click', () => {
            if (urlInput) {
              urlInput.value = r.url;
              localStorage.setItem('global-room-url', r.url);
            }
            dropdownList.style.display = 'none';
          });
          dropdownList.appendChild(item);
        });
      } else {
        dropdownList.innerHTML = '<div style="padding:10px;color:#999;text-align:center;font-size:13px;">请先在房间管理中添加直播间</div>';
      }
    } catch { /* ignore */ }
  }

  if (dropdownBtn && dropdownList) {
    dropdownBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      populateRoomDropdown();
      dropdownList.style.display = dropdownList.style.display === 'none' ? 'block' : 'none';
    });

    // 点击其他区域关闭下拉
    document.addEventListener('click', (e) => {
      const combo = document.getElementById('room-url-combo');
      if (combo && !combo.contains(e.target as Node)) {
        dropdownList.style.display = 'none';
      }
    });
  }
  if (minInput) {
    const savedMin = localStorage.getItem('global-interval-min');
    if (savedMin) minInput.value = savedMin;
    minInput.addEventListener('input', () => localStorage.setItem('global-interval-min', minInput.value));
  }
  if (maxInput) {
    const savedMax = localStorage.getItem('global-interval-max');
    if (savedMax) maxInput.value = savedMax;
    maxInput.addEventListener('input', () => localStorage.setItem('global-interval-max', maxInput.value));
  }

  // Bind Add Account
  const btnAdd = document.getElementById('btn-add-account');
  if (btnAdd) {
    btnAdd.addEventListener('click', () => {
      const restorableAccount = accountController.getFirstRestorableClosedAccount();
      if (restorableAccount) {
        accountController.recoverAccountAndLogin(restorableAccount.data.id);
        return;
      }

      const nextName = `账号${accountController.getNextAvailableAccountNumber()}`;

      const urlInput = document.getElementById('global-room-url') as HTMLInputElement;
      const targetUrl = urlInput?.value || 'https://live.douyin.com';
      accountController.addAccount(nextName, targetUrl);
    });
  }
  // Bind Refresh All
  const btnRefreshAll = document.getElementById('btn-refresh-all');
  if (btnRefreshAll) {
    btnRefreshAll.addEventListener('click', async () => {
      btnRefreshAll.setAttribute('disabled', 'true');
      const originalActiveId = accountController.getSelectedAccountId();
      
      const accounts = accountController.getAccounts()
        .filter(acc => !acc.data.isClosed && !acc.data.isDeleted)
        .sort((a, b) => {
          const numA = parseInt(a.data.name.match(/\d+/)?.[0] || '0', 10);
          const numB = parseInt(b.data.name.match(/\d+/)?.[0] || '0', 10);
          return numA - numB;
        });

      for (const acc of accounts) {
        accountController.selectAccount(acc.data.id);
        // 等待 UI 切换
        await new Promise(resolve => setTimeout(resolve, 50));
        
        const wrapper = document.getElementById(`webview-wrapper-${acc.data.id}`);
        let hasChatBox = false;
        
        if (wrapper) {
          const webview = wrapper.querySelector('webview') as any;
          if (webview && typeof webview.executeJavaScript === 'function') {
            try {
              hasChatBox = await webview.executeJavaScript(`
                (function() {
                  var isVisible = function(el) {
                    if (!el) return false;
                    var style = window.getComputedStyle(el);
                    var rect = el.getBoundingClientRect();
                    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
                  };
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
                      if (isVisible(list[j])) return true;
                    }
                  }
                  return false;
                })();
              `);
            } catch (e) {
              hasChatBox = false;
            }
          }
        }
        
        if (!hasChatBox) {
          // 仅在没有聊天框时强制刷新
          EventBus.emit('action:reload-webview', acc.data.id);
        }
        
        // 极短延迟以满足“3秒内全部点击一次”
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      
      if (originalActiveId) {
        accountController.selectAccount(originalActiveId);
      }
      btnRefreshAll.removeAttribute('disabled');
    });
  }
});

// 2. Wire up Actions -> Controllers
EventBus.on('action:switch-account', (accountId: string) => {
  accountController.selectAccount(accountId);
});

EventBus.on('action:close-tab', (accountId: string) => {
  accountController.closeTab(accountId);
});

EventBus.on('action:remove-account', (accountId: string) => {
  if (confirm('确认删除该账号？')) {
    accountController.deleteAccountSoft(accountId);
  }
});

EventBus.on('action:hard-remove-account', (accountId: string) => {
  if (confirm('确认彻底删除该账号？（缓存与数据将被永久抹除且不可恢复）')) {
    accountController.deleteAccountHard(accountId);
  }
});

EventBus.on('action:recover-login', (accountId: string) => {
  accountController.recoverAccountAndLogin(accountId);
});

EventBus.on('action:reload-webview', (accountId: string) => {
  console.log(`[Renderer] User requested webview reload for ${accountId}`);
  ipcRenderer.send(IpcChannels.WEBVIEW_RELOAD, { accountId });
});

// 3. Receive signals from Preload / Main
ipcRenderer.on(IpcChannels.REQUEST_ACCOUNTS, () => {
  const accounts = accountController.getAccounts()
    .filter(acc => !acc.data.isDeleted && !acc.data.isClosed)
    .map(acc => ({
      id: acc.data.id,
      name: acc.data.name
    }));
  ipcRenderer.send(IpcChannels.RECEIVE_ACCOUNTS, accounts);
});
ipcRenderer.on(IpcChannels.PAGE_ACTION, async (event, data) => {
  const logPrefix = `[Renderer IPC] -> Webview (${data.accountId} / ${data.action})`;
  ipcRenderer.send(IpcChannels.LOG_MESSAGE, `${logPrefix} 收到动作请求`);

  const wrapper = document.getElementById(`webview-wrapper-${data.accountId}`);
  if (!wrapper) {
    ipcRenderer.send(IpcChannels.LOG_MESSAGE, `${logPrefix} ❌ 找不到 webview 容器`);
    return;
  }

  const webview = wrapper.querySelector('webview') as any;
  if (!webview) {
    ipcRenderer.send(IpcChannels.LOG_MESSAGE, `${logPrefix} ❌ 找不到内部的 webview 标签`);
    return;
  }

  // 检查 webview 是否就绪
  if (typeof webview.executeJavaScript !== 'function') {
    ipcRenderer.send(IpcChannels.LOG_MESSAGE, `${logPrefix} ❌ webview 未就绪`);
    return;
  }

  // URL 验证
  const roomId = data.payload?.roomId;
  if (roomId) {
    const currentUrl = webview.getURL() || '';
    if (!currentUrl.includes(`live.douyin.com/${roomId}`)) {
      ipcRenderer.send(IpcChannels.LOG_MESSAGE, `${logPrefix} ⚠️ URL不匹配, 导航中...`);
      webview.loadURL(`https://live.douyin.com/${roomId}`);
      return;
    }
  }

  // ---- 所有操作统一转发到 preload 层处理 ----
  // send-message / send-gift 由 preload 层 SendMessageOperation / SendGiftOperation 处理
  // 使用 webFrame.executeJavaScript 绕过 CSP，并集成 a_bogus 签名
  // ---- 其他动作：继续走 preload IPC ----
  if (typeof webview.send === 'function') {
    ipcRenderer.send(IpcChannels.LOG_MESSAGE, `${logPrefix} ✔️ 执行 webview.send 发布指令...`);
    webview.send(IpcChannels.PAGE_ACTION, data);
  } else {
    ipcRenderer.send(IpcChannels.LOG_MESSAGE, `${logPrefix} ❌ webview.send 不是一个函数`);
  }
});

ipcRenderer.on(IpcChannels.EXECUTE_WEBVIEW_JS, async (event, data) => {
  const { accountId, code, replyChannel } = data;
  const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
  if (!wrapper) {
    if (replyChannel) ipcRenderer.send(replyChannel, { error: '未找到对应账号容器' });
    return;
  }
  const webview = wrapper.querySelector('webview') as any;
  if (!webview || typeof webview.executeJavaScript !== 'function') {
    if (replyChannel) ipcRenderer.send(replyChannel, { error: 'webview未就绪' });
    return;
  }
  try {
    const result = await webview.executeJavaScript(code);
    if (replyChannel) ipcRenderer.send('execute-webview-js-result', { replyChannel, result });
  } catch (e: any) {
    if (replyChannel) ipcRenderer.send('execute-webview-js-result', { replyChannel, result: { error: e.message } });
  }
});

ipcRenderer.on(IpcChannels.ACCOUNT_STATE_CHANGE, (event, data) => {
  const isLogged = data.currentState !== undefined ? data.currentState : data.isLoggedIn;
  accountController.updateLoginState(data.accountId, isLogged);
});

// 4. Initialization Boot (Must run AFTER DOM is completely loaded and renderers are listening!)
document.addEventListener('DOMContentLoaded', () => {
  ipcRenderer.invoke(IpcChannels.READ_ACCOUNTS).then((savedAccounts: any[]) => {
    if (savedAccounts && Array.isArray(savedAccounts)) {
      // Pass to controller, fallback to empty if nothing saved
      accountController.loadAccounts(savedAccounts);
    } else {
      accountController.loadAccounts([]);
    }
  }).catch((err) => {
    console.error('[Renderer] Failed to load accounts locally, booting empty', err);
    accountController.loadAccounts([]);
  });
});

EventBus.on('ipc:save-accounts', (accountsData: any[]) => {
  ipcRenderer.invoke(IpcChannels.SAVE_ACCOUNTS, accountsData).catch(err => {
    console.error('[Renderer] Failed to save accounts to backend', err);
  });
});


// ==================== 独立随机模块：直发通道 ====================
// 接收随机窗口的发送请求，直接对 webview 执行 JS，绕过 PAGE_ACTION 链路
ipcRenderer.on('random-direct-send', async (event, data: { accountId: string, message: string }) => {
  const { accountId, message } = data;
  const logPrefix = `[RandomDirect] ${accountId}`;

  const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
  if (!wrapper) {
    ipcRenderer.send('random-direct-send-result', { success: false, error: '找不到 webview 容器' });
    return;
  }

  const webview = wrapper.querySelector('webview') as any;
  if (!webview || typeof webview.executeJavaScript !== 'function') {
    ipcRenderer.send('random-direct-send-result', { success: false, error: 'webview 未就绪' });
    return;
  }

  // 🔒 发送前锁定物理键盘
  await lockWebviewInput(accountId);

  try {
    const escapedMsg = JSON.stringify(message);
        const result = await webview.executeJavaScript(`
      (async function() {
        function wait(ms) { return new Promise(r => setTimeout(r, ms)); }
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
              if (text === '发送' || text === 'Send') {
                 var rect = el.getBoundingClientRect();
                 if (rect.width > 0 && rect.width < 150 && rect.height > 0 && rect.height < 60) return el;
              }
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
          if (!inputArea) return { success: false, error: '未找到输入框' };

          var cleanMsg = ${escapedMsg};
          var isEditable = inputArea.isContentEditable || inputArea.getAttribute('contenteditable') === 'true';

          inputArea.removeAttribute && inputArea.removeAttribute('readonly');
          inputArea.removeAttribute && inputArea.removeAttribute('disabled');
          inputArea.focus();
          await wait(randomBetween(100, 200));

          try {
            inputArea.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
            inputArea.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
            inputArea.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
          } catch (e) {}
          await wait(randomBetween(50, 100));

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
            await wait(randomBetween(50, 100));
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
            var proto = inputArea.tagName.toLowerCase() === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
            if (nativeSetter) nativeSetter.call(inputArea, '');
            else inputArea.value = '';
            inputArea.dispatchEvent(new Event('input', { bubbles: true }));
            await wait(randomBetween(50, 100));
            if (nativeSetter) nativeSetter.call(inputArea, cleanMsg);
            else inputArea.value = cleanMsg;
            inputArea.selectionStart = cleanMsg.length;
            inputArea.selectionEnd = cleanMsg.length;
          }

          try { inputArea.dispatchEvent(new InputEvent('input', { bubbles: true, data: cleanMsg, inputType: 'insertText' })); }
          catch (e) { inputArea.dispatchEvent(new Event('input', { bubbles: true })); }
          inputArea.dispatchEvent(new Event('change', { bubbles: true }));
          inputArea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: cleanMsg.slice(-1) || ' ' }));

          await wait(randomBetween(200, 400));
          sendBtn = findSendButton(inputArea);

          if (sendBtn) {
            var srect = sendBtn.getBoundingClientRect();
            var cx = srect.left + srect.width / 2;
            var cy = srect.top + srect.height / 2;
            var options = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
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
            await wait(randomBetween(100, 200));
            inputArea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true }));
            inputArea.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
            inputArea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          }

          await wait(randomBetween(200, 400));
          return { success: true };
        } catch (e) {
          return { success: false, error: e && e.message ? e.message : String(e) };
        }
      })();
    `, true);

    ipcRenderer.send('random-direct-send-result', result || { success: false, error: '空结果' });
  } catch (err: any) {
    ipcRenderer.send('random-direct-send-result', { success: false, error: err.message });
  } finally {
    // 🔓 无论成功失败，必须解锁
    await unlockWebviewInput(accountId);
  }
});

// ==================== 全局自动发送：Main World 直发通道 ====================
// 完全绕过 preload 隔离上下文，使用 webview.executeJavaScript() 在页面 Main World 执行
// 参考原项目 sendSingleMessage 实现：focus → selectAll → delete → insertText → click send
// 所有步骤间添加随机延迟（≤3秒），模拟人类行为
ipcRenderer.on('direct-send-message', async (_event, data: {
  accountId: string,
  messageId: string,
  content: string,
  roomId: string
}) => {
  const { accountId, messageId, content } = data;
  const logTag = `[DirectSend][${accountId.substring(0, 6)}]`;

  const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
  if (!wrapper) {
    console.error(`${logTag} 找不到 webview 容器`);
    ipcRenderer.send(IpcChannels.API_ACTION_ACK, { accountId, messageId, success: false, error: '找不到 webview 容器' });
    return;
  }

  const webview = wrapper.querySelector('webview') as any;
  if (!webview || typeof webview.executeJavaScript !== 'function') {
    console.error(`${logTag} webview 未就绪`);
    ipcRenderer.send(IpcChannels.API_ACTION_ACK, { accountId, messageId, success: false, error: 'webview 未就绪' });
    return;
  }

  // 🔒 发送前锁定物理键盘
  await lockWebviewInput(accountId);

  try {
    const escapedMsg = JSON.stringify(content);
    // 在页面 Main World 中完整执行发送流程（参考原项目 sendSingleMessage）
    const result: any = await webview.executeJavaScript(`
      (async function() {
        function wait(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
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
            '[role="button"][class*="send"]'
          ];
          for (var i = 0; i < selectors.length; i++) {
            var list = document.querySelectorAll(selectors[i]);
            for (var j = 0; j < list.length; j++) {
              if (isVisible(list[j])) return list[j];
            }
          }
          // 通过文本内容查找
          var allClickables = document.querySelectorAll('button, div[role="button"], span[role="button"], [class*="send"], [class*="Send"]');
          for (var k = 0; k < allClickables.length; k++) {
            if (allClickables[k].offsetParent !== null) {
              var text = (allClickables[k].textContent || '').trim();
              if (text === '发送' || text === 'Send') return allClickables[k];
            }
          }
          // 在输入框附近查找
          if (inputArea) {
            var parent = inputArea.closest('[class*="chat"]') || inputArea.parentElement || inputArea;
            var nearby = parent.querySelectorAll('button, [role="button"], [class*="btn"], [class*="send"], div, span');
            for (var n = 0; n < nearby.length; n++) {
              var el = nearby[n];
              if (!isVisible(el)) continue;
              var btnText = (el.textContent || '').trim();
              if (btnText === '发送' || btnText === 'Send') {
                var rect = el.getBoundingClientRect();
                if (rect.width > 0 && rect.width < 150 && rect.height > 0 && rect.height < 60) return el;
              }
            }
          }
          // TreeWalker 兜底
          var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
          var node;
          while ((node = walker.nextNode())) {
            var txt = (node.textContent || '').trim();
            if (txt !== '发送' && txt !== 'Send') continue;
            var p = node.parentElement;
            for (var depth = 0; depth < 4 && p; depth++) {
              if (p.offsetParent !== null) {
                var prect = p.getBoundingClientRect();
                if (prect.width > 0 && prect.width < 150 && prect.height > 0 && prect.height < 60) return p;
              }
              p = p.parentElement;
            }
          }
          return null;
        }

        try {
          // 关闭可能存在的弹窗
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
            document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
          } catch(e) {}
          await wait(100);

          // Step 1: 查找输入框
          var inputArea = null;
          for (var attempt = 0; attempt < 3; attempt++) {
            inputArea = findInput();
            if (inputArea) break;
            await wait(100);
          }
          if (!inputArea) return { success: false, error: '未找到输入框' };

          var cleanMsg = ${escapedMsg};
          var isEditable = inputArea.isContentEditable || inputArea.getAttribute('contenteditable') === 'true';

          // Step 2: 聚焦（随机延迟）
          inputArea.removeAttribute && inputArea.removeAttribute('readonly');
          inputArea.removeAttribute && inputArea.removeAttribute('disabled');
          inputArea.focus();
          inputArea.click();
          inputArea.focus();
          inputArea.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
          inputArea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
          await wait(randomBetween(200, 1500));

          // Step 3: 全选输入框内容（仅输入框，不是整个页面！）
          if (isEditable) {
            var sel = window.getSelection();
            var range = document.createRange();
            range.selectNodeContents(inputArea);
            sel.removeAllRanges();
            sel.addRange(range);
          } else {
            inputArea.select();
          }
          await wait(randomBetween(100, 800));

          // Step 4: 删除选中内容
          try {
            document.execCommand('delete', false, null);
          } catch (e) {
            if (isEditable) {
              inputArea.textContent = '';
              inputArea.innerHTML = '';
            } else {
              inputArea.value = '';
            }
          }

          // 确保完全清空
          var afterClear = isEditable ? inputArea.textContent : inputArea.value;
          if (afterClear && afterClear.trim().length > 0) {
            if (isEditable) {
              inputArea.textContent = '';
              inputArea.innerHTML = '';
              while (inputArea.firstChild) inputArea.removeChild(inputArea.firstChild);
            } else {
              inputArea.value = '';
            }
          }

          inputArea.focus();
          await wait(randomBetween(200, 1200));

          // Step 5: 使用 execCommand 插入文本（模拟真实键盘输入）
          try {
            var inserted = document.execCommand('insertText', false, cleanMsg);
            if (!inserted) throw new Error('insertText failed');
          } catch (e) {
            if (isEditable) {
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
            } else {
              var proto = inputArea.tagName.toLowerCase() === 'textarea' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
              var nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value') && Object.getOwnPropertyDescriptor(proto, 'value').set;
              if (nativeSetter) nativeSetter.call(inputArea, cleanMsg);
              else inputArea.value = cleanMsg;
              inputArea.selectionStart = cleanMsg.length;
              inputArea.selectionEnd = cleanMsg.length;
            }
          }

          // 触发 input 事件让 React 识别
          try { inputArea.dispatchEvent(new InputEvent('input', { bubbles: true, data: cleanMsg, inputType: 'insertText' })); }
          catch (e) { inputArea.dispatchEvent(new Event('input', { bubbles: true })); }
          inputArea.dispatchEvent(new Event('change', { bubbles: true }));
          inputArea.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: cleanMsg.slice(-1) || ' ' }));

          await wait(randomBetween(300, 2000));

          // Step 6: 点击发送
          var sendBtn = findSendButton(inputArea);
          var sendSuccess = false;

          if (sendBtn) {
            sendBtn.removeAttribute && sendBtn.removeAttribute('disabled');
            var srect = sendBtn.getBoundingClientRect();
            var cx = srect.left + srect.width / 2;
            var cy = srect.top + srect.height / 2;
            var opts = { bubbles: true, cancelable: true, view: window, clientX: cx, clientY: cy };
            try { sendBtn.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch(e){}
            sendBtn.dispatchEvent(new MouseEvent('mousedown', opts));
            await wait(randomBetween(30, 90));
            try { sendBtn.dispatchEvent(new PointerEvent('pointerup', opts)); } catch(e){}
            sendBtn.dispatchEvent(new MouseEvent('mouseup', opts));
            await wait(randomBetween(30, 90));
            sendBtn.dispatchEvent(new MouseEvent('click', opts));
            try { sendBtn.click(); } catch(e) {}
            sendSuccess = true;
          } else {
            // 使用 Enter 键发送
            inputArea.focus();
            var enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
            inputArea.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
            inputArea.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
            inputArea.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
            sendSuccess = true;
          }

          // 点击发送后必须等待足够长的时间让抖音 React 处理完毕
          // 如果过早 blur() 或转移焦点，会导致 React 事件链中断，消息未实际发出
          await wait(randomBetween(800, 1500));
          inputArea.blur();
          if (document.body) document.body.focus();

          await wait(randomBetween(500, 800));
          return { success: sendSuccess, method: sendBtn ? 'button' : 'enter' };
        } catch (e) {
          return { success: false, error: e && e.message ? e.message : String(e) };
        }
      })();
    `, true);

    if (result && result.success) {
      console.log(`${logTag} ✅ 发送完成 (${result.method}): ${content}`);
      ipcRenderer.send(IpcChannels.API_ACTION_ACK, { accountId, messageId, success: true });
    } else {
      console.error(`${logTag} ❌ 发送失败: ${result?.error || '未知错误'}`);
      ipcRenderer.send(IpcChannels.API_ACTION_ACK, { accountId, messageId, success: false, error: result?.error || '未知错误' });
    }
  } catch (err: any) {
    console.error(`${logTag} ❌ 执行异常:`, err.message);
    ipcRenderer.send(IpcChannels.API_ACTION_ACK, { accountId, messageId, success: false, error: err.message });
  } finally {
    // 🔓 无论成功失败，必须解锁
    await unlockWebviewInput(accountId);
  }
});

export { EventBus };
