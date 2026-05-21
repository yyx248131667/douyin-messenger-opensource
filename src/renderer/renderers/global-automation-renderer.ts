import { EventBus } from '../core/event-bus';
import { ipcRenderer } from 'electron';
import { AccountController } from '../controllers/account-controller';
import { IpcChannels } from '../../main/ipc/channels';
import { lockWebviewInput, unlockWebviewInput } from '../utils/webview-input-lock';

export class GlobalAutomationRenderer {
  private containerId: string;
  private sendMode: 'random' | 'sequential' = 'random';
  public isRunning: boolean = false;
  private pollTimer: any = null;
  private logHistory: string[] = [];
  private maxLogs: number = 1000;
  
  private randomTimer: any = null;
  private isRandomRunning: boolean = false;
  private offlineListenerRegistered: boolean = false;

  constructor(containerId: string) {
    this.containerId = containerId;
    this.registerOfflineListener();
  }

  /**
   * 注册下播信号监听器。
   * 当 LiveStatusObserver / BtoolsService 检测到直播结束时，自动停止全局发送。
   */
  private registerOfflineListener(): void {
    if (this.offlineListenerRegistered) return;
    this.offlineListenerRegistered = true;

    ipcRenderer.on(IpcChannels.LIVE_STATUS_OFFLINE, (_event: any, data: any) => {
      const accountId = data?.accountId || '未知';
      console.log(`[GlobalAutomation] 📴 收到下播信号: ${accountId}`);
      this.appendLog(`📴 检测到下播 (${accountId})，自动停止全局发送`, '#ff4d4f');

      // 检查全局发送和随机发送，任一运行中都必须停止
      if (this.isRunning || this.isRandomRunning) {
        this.forceStop(`下播自动停止 (${accountId})`);
      }
    });

    // 下播5分钟保护：断开所有 webview 的网络连接
    ipcRenderer.on(IpcChannels.OFFLINE_PROTECTION_DISCONNECT, (_event: any, data: any) => {
      const roomId = data?.roomId || '未知';
      console.log(`[GlobalAutomation] 🚨 下播超过5分钟，执行断网保护: roomId=${roomId}`);
      this.appendLog(`🚨 直播间 ${roomId} 已下播超过5分钟，正在断开网络连接防止风控...`, '#ff4d4f');

      // 停止自动发送
      if (this.isRandomRunning) {
        this.forceStop(`下播断网保护 (${roomId})`);
      }

      // 将所有 webview 导航到 about:blank 断开网络
      const container = document.getElementById('webviews-container');
      if (container) {
        const wrappers = Array.from(container.children) as HTMLElement[];
        wrappers.forEach(wrapper => {
          const webview = wrapper.querySelector('webview') as any;
          if (webview) {
            try {
              const currentUrl = webview.getURL?.() || webview.src || '';
              if (currentUrl.includes(roomId) || currentUrl.includes('live.douyin.com')) {
                console.log(`[GlobalAutomation] 🔌 断开 webview: ${wrapper.getAttribute('data-account-id')}`);
                webview.src = 'about:blank';
              }
            } catch (e) {}
          }
        });
      }

      this.appendLog(`✅ 已断开所有直播间连接，重新打开软件即可恢复`, '#52c41a');
    });
  }

  /**
   * 外部/内部强制停止全局自动发送。
   * 同时清理定时器并更新 UI 状态。
   */
  public forceStop(reason?: string): void {
    const msg = reason || '外部信号停止';
    console.log(`[GlobalAutomation] ⛔ 强制停止: ${msg}`);
    this.appendLog(`⛔ ${msg}`, '#ff4d4f');

    // 停止渲染进程本地状态
    this.isRandomRunning = false;
    this.isRunning = false;
    if (this.randomTimer) {
      clearTimeout(this.randomTimer);
      this.randomTimer = null;
    }

    // 核心修复：必须通知主进程停止 GlobalAutomationService 的 globalTimer
    ipcRenderer.send(IpcChannels.STOP_GLOBAL_SEND);

    // 更新主界面的发送按钮状态
    try {
      const btnToggle = document.getElementById('btn-global-toggle');
      if (btnToggle) {
        btnToggle.innerText = '开始';
        btnToggle.style.background = '#52c41a';
      }
    } catch (e) {}

    // 更新随机弹窗的按钮状态
    try {
      const btnStart = document.querySelector('#modal-random .rnd-btn:not(.rnd-btn-danger)') as HTMLButtonElement;
      const btnStop = document.querySelector('#modal-random .rnd-btn-danger') as HTMLButtonElement;
      if (btnStart) btnStart.disabled = false;
      if (btnStop) btnStop.disabled = true;
    } catch (e) {}
  }





  private appendLog(msg: string, color?: string) {
    this.logHistory.push(msg);
    if (this.logHistory.length > this.maxLogs) {
      this.logHistory.shift();
    }
    const logBox = document.getElementById('global-status-log');
    if (logBox) {
      logBox.innerText = msg;
      if (color) {
        logBox.style.color = color;
      } else {
        logBox.style.color = '#52c41a'; // Default
      }
    }
    
    // Update modal if it's visible
    const modalContent = document.getElementById('log-modal-content');
    if (modalContent && modalContent.parentElement?.parentElement?.style.display === 'flex') {
      modalContent.innerText = this.logHistory.join('\n');
      modalContent.scrollTop = modalContent.scrollHeight; // Auto-scroll down
    }
  }

  private openRandomModal(accountController: AccountController) {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-random';

    const defaultPhrases = "666\n主播真棒\n支持一下\n太秀了\n厉害厉害\n加油";
    const savedPhrases = localStorage.getItem('cfg_random_phrases') || defaultPhrases;
    const accounts = accountController.getAccounts().filter(acc => !acc.data.isDeleted);
    
    const accountTags = accounts.map(acc =>
      `<span class="rnd-acc-tag rnd-acc-selected" data-id="${acc.data.id}">${acc.data.name}</span>`
    ).join('') || '<span style="color:#999; font-size:13px;">无可用账号</span>';

    const savedMin = localStorage.getItem('cfg_random_interval_min') || '3';
    const savedMax = localStorage.getItem('cfg_random_interval_max') || '8';
    const savedMode = localStorage.getItem('cfg_random_send_mode') || 'random';
    const statusText = this.isRandomRunning ? '运行中...' : '已停止';
    const statusColor = this.isRandomRunning ? '#52c41a' : '#ff4d4f';

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 420px; width: 420px; padding: 0; background: #f5f7fa; border-radius: 8px; border: none; box-shadow: 0 8px 32px rgba(0,0,0,0.18); overflow: hidden;">
        <style>
          .rnd-card { background: #fff; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); padding: 16px; margin: 0 20px 12px 20px; }
          .rnd-label { font-size: 14px; font-weight: 600; color: #555; margin-bottom: 8px; display: block; }
          .rnd-row { display: flex; align-items: center; margin-bottom: 10px; gap: 10px; flex-wrap: wrap; }
          .rnd-row:last-child { margin-bottom: 0; }
          .rnd-btn { background: #1890ff; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 14px; font-weight: 500; transition: all 0.2s; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          .rnd-btn:hover { background: #40a9ff; transform: translateY(-1px); }
          .rnd-btn:disabled { background: #d9d9d9; cursor: not-allowed; transform: none; box-shadow: none; }
          .rnd-btn-stop { background: #ff4d4f; }
          .rnd-btn-stop:hover { background: #ff7875; }
          .rnd-btn-success { background: #52c41a; }
          .rnd-btn-success:hover { background: #73d13d; }
          .rnd-btn-small { padding: 6px 12px; font-size: 13px; }
          .rnd-btn-warning { background: #faad14; }
          .rnd-btn-warning:hover { background: #ffc53d; }
          .rnd-input { border: 1px solid #e8e8e8; border-radius: 6px; padding: 8px 12px; font-size: 14px; outline: none; transition: border-color 0.2s; }
          .rnd-input:focus { border-color: #1890ff; box-shadow: 0 0 0 2px rgba(24,144,255,0.2); }
          .rnd-input-number { width: 80px; text-align: center; }
          .rnd-acc-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; padding: 4px 0; min-height: 30px; max-height: 100px; overflow-y: auto; }
          .rnd-acc-tag { display: inline-flex; align-items: center; background: #fff; padding: 5px 14px; border-radius: 16px; font-size: 13px; cursor: pointer; border: 1px solid #e8e8e8; transition: all 0.2s; user-select: none; }
          .rnd-acc-tag:hover { border-color: #1890ff; }
          .rnd-acc-tag.rnd-acc-selected { background: #52c41a; color: #fff; border-color: #52c41a; }
          .rnd-textarea { width: 100%; min-height: 100px; max-height: 160px; border: 1px solid #e8e8e8; border-radius: 6px; padding: 10px 12px; font-size: 13px; font-family: inherit; resize: vertical; outline: none; box-sizing: border-box; }
          .rnd-textarea:focus { border-color: #1890ff; box-shadow: 0 0 0 2px rgba(24,144,255,0.2); }
          .rnd-log { font-size: 13px; color: #444; background: #f0f5ff; padding: 0 16px; border: 1px solid #adc6ff; border-radius: 6px; height: 36px; line-height: 36px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; display: flex; align-items: center; justify-content: flex-start; margin: 0 20px 20px 20px; font-weight: 500; }
          .rnd-log-time { color: #888; margin-right: 8px; font-size: 12px; font-weight: 400; }
        </style>

        <!-- 标题栏 -->
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 16px 20px; background: #fff; border-bottom: 1px solid #e8e8e8;">
          <span style="font-size: 16px; font-weight: 600; color: #333;">随机发信控制</span>
          <span id="btn-close-random" style="color: #999; font-size: 22px; cursor: pointer; line-height: 1;">&times;</span>
        </div>

        <div style="padding-top: 16px;"></div>

        <!-- 账号选择 -->
        <div class="rnd-card">
          <div class="rnd-row" style="justify-content: space-between; margin-bottom: 0;">
            <span class="rnd-label" style="margin:0;">选择发信账号（可多选）</span>
            <div style="display: flex; gap: 6px;">
              <button class="rnd-btn rnd-btn-small" id="rnd-sel-all">全选</button>
              <button class="rnd-btn rnd-btn-small rnd-btn-stop" id="rnd-sel-none">清空</button>
            </div>
          </div>
          <div class="rnd-acc-list" id="rnd-account-list">${accountTags}</div>
        </div>

        <!-- 话术配置 -->
        <div class="rnd-card">
          <span class="rnd-label">话术来源</span>
          <select class="rnd-input" id="rnd-script-source" style="width: 100%; box-sizing: border-box; margin-bottom: 10px;">
            <option value="custom">自定义话术（下方输入）</option>
          </select>
          <span class="rnd-label">话术内容（每行一句）</span>
          <textarea class="rnd-textarea" id="rnd-phrases">${savedPhrases}</textarea>
        </div>

        <!-- 发送设置 -->
        <div class="rnd-card">
          <div class="rnd-row">
            <span class="rnd-label" style="margin:0; flex-shrink:0;">发送模式</span>
            <select class="rnd-input" id="rnd-send-mode" style="flex: 1;">
              <option value="random" ${savedMode === 'random' ? 'selected' : ''}>随机发送</option>
              <option value="sequential" ${savedMode === 'sequential' ? 'selected' : ''}>顺序发送</option>
            </select>
          </div>
          <div class="rnd-row" style="margin-bottom: 0;">
            <span class="rnd-label" style="margin:0; flex-shrink:0;">发送间隔 (秒)</span>
            <input type="number" class="rnd-input rnd-input-number" id="rnd-interval-min" value="${savedMin}" min="1" max="60" />
            <span>至</span>
            <input type="number" class="rnd-input rnd-input-number" id="rnd-interval-max" value="${savedMax}" min="1" max="60" />
          </div>
        </div>

        <!-- 操作按钮 -->
        <div style="display: flex; gap: 10px; margin: 0 20px 12px 20px;">
          <button class="rnd-btn rnd-btn-success" id="rnd-btn-start" style="flex:1;">开始发送</button>
          <button class="rnd-btn rnd-btn-stop" id="rnd-btn-stop" style="flex:1;" disabled>停止</button>
        </div>

        <!-- 日志 -->
        <div class="rnd-log" id="rnd-log">
          <span class="rnd-log-time">[${new Date().toLocaleTimeString()}]</span>状态: <span style="color:${statusColor}; margin-left: 4px;">${statusText}</span>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // DOM 引用
    const btnClose = document.getElementById('btn-close-random')!;
    const btnStart = document.getElementById('rnd-btn-start') as HTMLButtonElement;
    const btnStop = document.getElementById('rnd-btn-stop') as HTMLButtonElement;
    const phrasesInput = document.getElementById('rnd-phrases') as HTMLTextAreaElement;
    const scriptSourceEl = document.getElementById('rnd-script-source') as HTMLSelectElement;
    const sendModeEl = document.getElementById('rnd-send-mode') as HTMLSelectElement;
    const intervalMinEl = document.getElementById('rnd-interval-min') as HTMLInputElement;
    const intervalMaxEl = document.getElementById('rnd-interval-max') as HTMLInputElement;
    const logEl = document.getElementById('rnd-log')!;
    let sequentialIdx = 0;
    let currentAccountIdx = 0;

    // 关闭
    btnClose.addEventListener('click', () => overlay.remove());

    // 账号标签点击切换
    document.querySelectorAll('.rnd-acc-tag').forEach(el => {
      el.addEventListener('click', () => el.classList.toggle('rnd-acc-selected'));
    });
    document.getElementById('rnd-sel-all')?.addEventListener('click', () => {
      document.querySelectorAll('.rnd-acc-tag').forEach(el => el.classList.add('rnd-acc-selected'));
    });
    document.getElementById('rnd-sel-none')?.addEventListener('click', () => {
      document.querySelectorAll('.rnd-acc-tag').forEach(el => el.classList.remove('rnd-acc-selected'));
    });

    // 日志工具 (横屏单行展示)
    const addModalLog = (msg: string, color?: string) => {
      logEl.innerHTML = `<span class="rnd-log-time">[${new Date().toLocaleTimeString()}]</span><span style="color:${color || '#333'}">${msg}</span>`;
      // 同步到主UI日志
      this.appendLog(msg, color);
    };

    // 话术来源加载
    ipcRenderer.invoke('get-scripts').then((scripts: any[]) => {
      if (scripts && Array.isArray(scripts)) {
        scripts.forEach(s => {
          const opt = document.createElement('option');
          opt.value = s.id;
          opt.textContent = s.title;
          scriptSourceEl.appendChild(opt);
        });
        const savedSrc = localStorage.getItem('cfg_random_script_source');
        if (savedSrc && scriptSourceEl.querySelector(`option[value="${savedSrc}"]`)) {
          scriptSourceEl.value = savedSrc;
          const matched = scripts.find(s => s.id === savedSrc);
          if (matched) { phrasesInput.value = matched.content; phrasesInput.disabled = true; }
        }
        scriptSourceEl.addEventListener('change', () => {
          const val = scriptSourceEl.value;
          localStorage.setItem('cfg_random_script_source', val);
          if (val === 'custom') {
            phrasesInput.disabled = false;
            const saved = localStorage.getItem('cfg_random_phrases') || defaultPhrases;
            phrasesInput.value = saved;
          } else {
            const s = scripts.find(x => x.id === val);
            if (s) { phrasesInput.value = s.content; phrasesInput.disabled = true; }
          }
        });
      }
    });

    // 自定义话术保存
    phrasesInput.addEventListener('input', () => {
      if (scriptSourceEl.value === 'custom') {
        localStorage.setItem('cfg_random_phrases', phrasesInput.value);
      }
    });

    // 配置持久化
    sendModeEl.addEventListener('change', () => localStorage.setItem('cfg_random_send_mode', sendModeEl.value));
    intervalMinEl.addEventListener('change', () => localStorage.setItem('cfg_random_interval_min', intervalMinEl.value));
    intervalMaxEl.addEventListener('change', () => localStorage.setItem('cfg_random_interval_max', intervalMaxEl.value));

    // 获取选中账号
    const getSelectedIds = () => Array.from(document.querySelectorAll('.rnd-acc-tag.rnd-acc-selected')).map(el => (el as HTMLElement).dataset.id!);

    // 随机间隔
    const getInterval = () => {
      const min = Math.max(1, parseInt(intervalMinEl.value) || 3);
      const max = Math.max(min, parseInt(intervalMaxEl.value) || 8);
      return (Math.floor(Math.random() * (max - min + 1)) + min) * 1000;
    };

    // 获取话术行
    const getLines = () => phrasesInput.value.split('\n').map(s => s.trim()).filter(s => s.length > 0);

    /**
     * 直接对 webview 执行 JS 发送消息（参考原项目 sendSingleMessage 方式）。
     * 使用 webview.executeJavaScript() 在页面 Main World 中完整执行，
     * 通过 window.getSelection()+selectNodeContents 仅选中输入框内容（而非整个页面），
     * 确保 DOM 事件能正确触发 Douyin 的 React 事件系统。
     */
    const directSendToWebview = async (accountId: string, message: string): Promise<boolean> => {
      const wrapper = document.getElementById(`webview-wrapper-\${accountId}`);
      if (!wrapper) {
        addModalLog(`❌ 找不到 webview 容器: \${accountId}`, '#ff4d4f');
        return false;
      }
      const webview = wrapper.querySelector('webview') as any;
      if (!webview || typeof webview.executeJavaScript !== 'function') {
        addModalLog(`❌ webview 未就绪: \${accountId}`, '#ff4d4f');
        return false;
      }

      // 🔒 发送前锁定物理键盘
      await lockWebviewInput(accountId);

      try {
        const escapedMsg = JSON.stringify(message);
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
              var allClickables = document.querySelectorAll('button, div[role="button"], span[role="button"], [class*="send"], [class*="Send"]');
              for (var k = 0; k < allClickables.length; k++) {
                if (allClickables[k].offsetParent !== null) {
                  var text = (allClickables[k].textContent || '').trim();
                  if (text === '发送' || text === 'Send') return allClickables[k];
                }
              }
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
              try {
                document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
                document.dispatchEvent(new KeyboardEvent('keyup', { key: 'Escape', keyCode: 27, bubbles: true }));
              } catch(e) {}
              await wait(100);

              var inputArea = null;
              for (var attempt = 0; attempt < 3; attempt++) {
                inputArea = findInput();
                if (inputArea) break;
                await wait(100);
              }
              if (!inputArea) return { success: false, error: '未找到输入框' };

              var cleanMsg = \\${escapedMsg};
              var isEditable = inputArea.isContentEditable || inputArea.getAttribute('contenteditable') === 'true';

              // Step 1: 聚焦
              inputArea.removeAttribute && inputArea.removeAttribute('readonly');
              inputArea.removeAttribute && inputArea.removeAttribute('disabled');
              inputArea.focus();
              inputArea.click();
              inputArea.focus();
              inputArea.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
              inputArea.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
              await wait(randomBetween(200, 1500));

              // Step 2: 全选输入框内容（仅输入框，不是整个页面！）
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

              // Step 3: 删除选中内容
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

              // Step 4: 使用 execCommand 插入文本
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

              // Step 5: 点击发送
              var sendBtn = findSendButton(inputArea);
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
              } else {
                inputArea.focus();
                var enterOpts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true, composed: true };
                inputArea.dispatchEvent(new KeyboardEvent('keydown', enterOpts));
                inputArea.dispatchEvent(new KeyboardEvent('keypress', enterOpts));
                inputArea.dispatchEvent(new KeyboardEvent('keyup', enterOpts));
              }

              // 点击发送后必须等待足够长的时间让抖音 React 处理完毕
              // 如果过早 blur() 或转移焦点，会导致 React 事件链中断，消息未实际发出
              await wait(randomBetween(800, 1500));
              inputArea.blur();
              if (document.body) document.body.focus();

              // ===== Step 6: 发送后验证 =====
              // 额外等待，确认抖音已清空输入框（表示消息已发出）
              await wait(randomBetween(500, 800));

              // 检查1：输入框是否被清空（抖音发送成功后会自动清空输入框）
              var postSendContent = '';
              if (isEditable) {
                postSendContent = (inputArea.textContent || '').trim();
              } else {
                postSendContent = (inputArea.value || '').trim();
              }

              // 检查2：页面是否出现错误提示（禁言/频率限制/风控）
              var errorToast = '';
              var errorSelectors = [
                '[class*="toast"]',
                '[class*="Toast"]',
                '[class*="error"]',
                '[class*="Error"]',
                '[class*="tip"]',
                '[class*="warn"]',
                '[class*="notice"]',
                '[class*="notification"]'
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
                return { success: false, error: '页面提示: ' + errorToast, verified: false };
              }

              // 如果输入框内容跟发送前一样（没被清空），说明发送可能没生效
              if (postSendContent === cleanMsg) {
                return { success: false, error: '输入框未被清空，消息可能未发出（React 状态未同步）', verified: false };
              }

              return { success: true, verified: true };
            } catch (e) {
              return { success: false, error: e && e.message ? e.message : String(e) };
            }
          })();
        `, true);

        if (result && result.success) return true;
        addModalLog(`❌ 发送失败: \${result?.error || '未知错误'}`, '#ff4d4f');
        return false;
      } catch (err: any) {
        addModalLog(`❌ 执行异常: \${err.message}`, '#ff4d4f');
        return false;
      } finally {
        // 🔓 无论成功失败，必须解锁
        await unlockWebviewInput(accountId);
      }
    };


    const stopRandom = () => {
      this.isRandomRunning = false;
      if (this.randomTimer) { clearTimeout(this.randomTimer); this.randomTimer = null; }
      btnStart.disabled = false;
      btnStop.disabled = true;
      phrasesInput.disabled = (scriptSourceEl.value !== 'custom');
      addModalLog('已停止发送', '#ff4d4f');
    };

    // 核心批量发送逻辑（异步自驱动，消息池模式）
    const executeBatchSend = async () => {
      const lines = getLines();
      const ids = getSelectedIds();
      const activeAccs = accountController.getAccounts().filter(acc => ids.includes(acc.data.id));

      if (activeAccs.length === 0 || lines.length === 0) {
        stopRandom();
        return;
      }

      // 场景1：只有一条话术 → 同时发给所有选中账号
      if (lines.length === 1) {
        const phrase = lines[0];
        addModalLog(`单条话术模式：将发给 ${activeAccs.length} 个账号`, '#faad14');

        for (let i = 0; i < activeAccs.length; i++) {
          if (!this.isRandomRunning) { addModalLog('已被手动停止', '#ff4d4f'); return; }
          const acc = activeAccs[i];
          addModalLog(`[${acc.data.name}] 正在发送: 1`, '#1890ff');
          const ok = await directSendToWebview(acc.data.id, phrase);
          if (ok) {
            addModalLog(`[${acc.data.name}] ✓ 发送成功`, '#52c41a');
            await new Promise(r => setTimeout(r, 3000)); // 发送成功停留3秒
          }

          // 账号间加随机短延迟，防止风控
          if (i < activeAccs.length - 1) {
            const gap = 500 + Math.floor(Math.random() * 1000);
            await new Promise(r => setTimeout(r, gap));
          }
        }

        addModalLog('✅ 所有账号已发送完毕，任务结束', '#52c41a');
        stopRandom();
        return;
      }

      // 场景2：多条话术 → 洗牌模式（先打乱，按顺序发，发完重新打乱）
      // 性能优于 splice 抽取：洗牌 O(n) + 遍历 O(1)/条，总体 O(n)/轮
      addModalLog(`洗牌模式：${lines.length} 条话术分配给 ${activeAccs.length} 个账号`, '#faad14');

      // Fisher-Yates 洗牌
      const shuffle = (len: number): number[] => {
        const arr = Array.from({ length: len }, (_, i) => i);
        for (let i = arr.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr;
      };

      let shuffledOrder = shuffle(lines.length);
      let shuffleIdx = 0;
      let roundCount = 1;
      let totalSent = 0;
      let accountIdx = 0;

      addModalLog(`🎲 第 ${roundCount} 轮开始，已洗牌 ${lines.length} 条话术`, '#1890ff');

      while (this.isRandomRunning) {
        // 当前轮遍历完，重新洗牌开始新一轮
        if (shuffleIdx >= shuffledOrder.length) {
          roundCount++;
          shuffledOrder = shuffle(lines.length);
          shuffleIdx = 0;
          addModalLog(`🔄 第 ${roundCount} 轮开始，话术已重新洗牌 (${lines.length} 条)`, '#faad14');
        }

        // 按洗牌后的顺序取下一条（O(1)）
        const scriptIdx = shuffledOrder[shuffleIdx];
        shuffleIdx++;

        const phrase = lines[scriptIdx];
        const acc = activeAccs[accountIdx % activeAccs.length];
        accountIdx++;
        totalSent++;

        addModalLog(`[${acc.data.name}] 🎲 发送话术[${scriptIdx}] (${shuffleIdx}/${lines.length}): ${phrase}`, '#1890ff');

        const ok = await directSendToWebview(acc.data.id, phrase);
        if (ok) {
          addModalLog(`[${acc.data.name}] ✓ 发送成功 (已发 ${totalSent} 条)`, '#52c41a');
          await new Promise(r => setTimeout(r, 3000)); // 发送成功停留3秒
        }

        if (!this.isRandomRunning) { addModalLog('已被手动停止', '#ff4d4f'); return; }

        // 话术间加随机间隔
        const interval = getInterval();
        addModalLog(`⏳ 等待 ${interval / 1000} 秒后继续...`, '#999');
        await new Promise(r => {
          this.randomTimer = setTimeout(r, interval);
        });
      }

      addModalLog('已被手动停止', '#ff4d4f');
    };

    // 开始按钮
    btnStart.addEventListener('click', async () => {
      const lines = getLines();
      if (lines.length === 0) { addModalLog('话术不能为空', '#ff4d4f'); return; }
      const ids = getSelectedIds();
      if (ids.length === 0) { addModalLog('请至少选择一个账号', '#ff4d4f'); return; }

      btnStart.disabled = true;

      // 预检通过，启动发送
      this.isRandomRunning = true;
      sequentialIdx = 0;
      currentAccountIdx = 0;
      btnStop.disabled = false;
      phrasesInput.disabled = true;

      addModalLog(`已启动发送，${ids.length} 个账号，${lines.length} 条话术`, '#52c41a');

      // 异步启动批量发送
      executeBatchSend();
    });

    // 停止
    btnStop.addEventListener('click', stopRandom);

    // 如果已在运行，更新 UI 状态
    if (this.isRandomRunning) {
      btnStart.disabled = true;
      btnStop.disabled = false;
      phrasesInput.disabled = true;
    }
  }

  public render(accountController: AccountController) {
    // Bind directly to app.html static IDs
    this.bindEvents(accountController);
  }

  private bindEvents(accountController: AccountController) {
    const btnToggle = document.getElementById('btn-global-toggle') as HTMLButtonElement;
    const btnRandom = document.getElementById('btn-random-mode') as HTMLButtonElement;
    const btnSyncRoom = document.getElementById('btn-sync-room') as HTMLButtonElement;
    
    const inputMin = document.getElementById('global-interval-min') as HTMLInputElement;
    const inputMax = document.getElementById('global-interval-max') as HTMLInputElement;
    const logBox = document.getElementById('global-status-log') as HTMLElement;
    const roomUrlInput = document.getElementById('global-room-url') as HTMLInputElement;

    // Load defaults and handle input saving and digit-only restriction
    const restrictAndSave = (inputEl: HTMLInputElement, storageKey: string) => {
       if (!inputEl) return;
       const savedVal = localStorage.getItem(storageKey);
       if (savedVal) inputEl.value = savedVal;

       inputEl.addEventListener('input', (e) => {
         // Restrict to digits only
         const val = inputEl.value;
         const filtered = val.replace(/\\D/g, '');
         if (val !== filtered) {
             inputEl.value = filtered;
         }
         localStorage.setItem(storageKey, inputEl.value);
       });
    };

    restrictAndSave(inputMin, 'cfg_global_interval_min');
    restrictAndSave(inputMax, 'cfg_global_interval_max');

    if (logBox) {
      logBox.style.cursor = 'pointer';
      logBox.title = '点击查看完整日志';
      logBox.addEventListener('click', () => {
        const modal = document.getElementById('log-modal-overlay');
        const modalContent = document.getElementById('log-modal-content');
        if (modal && modalContent) {
          modal.style.display = 'flex';
          modalContent.innerText = this.logHistory.join('\n');
          setTimeout(() => {
            modalContent.scrollTop = modalContent.scrollHeight;
          }, 50);
        }
      });
    }

    const btnCloseModal = document.getElementById('btn-close-log-modal');
    if (btnCloseModal) {
      btnCloseModal.addEventListener('click', () => {
        const modal = document.getElementById('log-modal-overlay');
        if (modal) modal.style.display = 'none';
      });
      // Allow clicking outside the modal content to close
      const modal = document.getElementById('log-modal-overlay');
      if (modal) {
        modal.addEventListener('click', (e) => {
          if (e.target === modal) {
            modal.style.display = 'none';
          }
        });
      }
    }

    const btnCopyLogs = document.getElementById('btn-copy-logs');
    if (btnCopyLogs) {
      btnCopyLogs.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(this.logHistory.join('\n'));
          const originalText = btnCopyLogs.innerText;
          btnCopyLogs.innerText = '已复制';
          setTimeout(() => {
            btnCopyLogs.innerText = originalText;
          }, 2000);
        } catch (err) {
          console.error('Failed to copy logs', err);
        }
      });
    }

    // Random Module - 打开独立窗口（与送礼模块一致）
    if (btnRandom) {
      btnRandom.innerText = '独立随机';
      btnRandom.addEventListener('click', () => {
        ipcRenderer.send(IpcChannels.OPEN_RANDOM_WINDOW);
      });
    }

    // Sync Room URL to all webviews logic
    if (btnSyncRoom) {
      btnSyncRoom.addEventListener('click', async () => {
        const url = roomUrlInput?.value?.trim();
        if (!url) {
          this.appendLog(`[${new Date().toLocaleTimeString()}] ⚠️ 请先输入直播间地址`, '#ff4d4f');
          return;
        }

        // 防止重复点击
        btnSyncRoom.disabled = true;
        const originalText = btnSyncRoom.innerText;
        btnSyncRoom.innerText = '同步中...';

        const accounts = accountController.getAccounts().filter(acc => !acc.data.isClosed && !acc.data.isDeleted);
        
        if (accounts.length === 0) {
          this.appendLog(`[${new Date().toLocaleTimeString()}] ⚠️ 没有可用账号`, '#ff4d4f');
          btnSyncRoom.disabled = false;
          btnSyncRoom.innerText = originalText;
          return;
        }

        let successCount = 0;
        let failCount = 0;

        this.appendLog(`[${new Date().toLocaleTimeString()}] 🔄 开始同步地址至 ${accounts.length} 个账号...`, '#1890ff');

        // 串行同步：逐个导航，每个间隔 300ms，避免 Electron webview 并发导航 ERR_FAILED 竞态
        for (const acc of accounts) {
          try {
            acc.data.url = url;

            const wrapper = document.getElementById(`webview-wrapper-${acc.data.id}`);
            if (!wrapper) {
              this.appendLog(`  ❌ ${acc.data.name}: 容器不存在`, '#ff4d4f');
              failCount++;
              continue;
            }

            const webview = wrapper.querySelector('webview') as any;
            if (!webview) {
              this.appendLog(`  ❌ ${acc.data.name}: webview 未创建`, '#ff4d4f');
              failCount++;
              continue;
            }

            // 直接使用 loadURL（比 EventBus + src setter 更可靠）
            if (typeof webview.loadURL === 'function') {
              webview.loadURL(url);
            } else {
              webview.src = url;
            }

            // 重置聊天框就绪标记（新页面需要重新检测）
            wrapper.dataset.chatReady = 'false';

            successCount++;
          } catch (err: any) {
            this.appendLog(`  ❌ ${acc.data.name}: ${err.message || '未知错误'}`, '#ff4d4f');
            failCount++;
          }

          // 串行间隔：防止多个 webview 同时导航导致 ERR_FAILED
          await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 日志汇总
        if (failCount === 0) {
          this.appendLog(`[${new Date().toLocaleTimeString()}] ✅ 全部 ${successCount} 个账号同步成功`, '#52c41a');
        } else {
          this.appendLog(`[${new Date().toLocaleTimeString()}] ⚠️ 同步完成: ${successCount} 成功, ${failCount} 失败`, '#faad14');
        }

        // Save new config
        EventBus.emit('ipc:save-accounts', accounts.map(a => a.data));

        // 恢复按钮
        btnSyncRoom.disabled = false;
        btnSyncRoom.innerText = originalText;
      });
    }

    // Toggle Lock functionality
    const btnUnlock = document.getElementById('btn-unlock-accounts');
    if (btnUnlock) {
      // 初始化按钮文本：根据持久化的锁定状态显示正确的按钮文字
      const initAccounts = accountController.getAccounts().filter(acc => !acc.data.isClosed && !acc.data.isDeleted);
      const allLocked = initAccounts.length > 0 && initAccounts.every(acc => acc.data.isLocked === true);
      if (allLocked) {
        btnUnlock.innerText = '解锁';
      }

      btnUnlock.addEventListener('click', () => {
        const accounts = accountController.getAccounts().filter(acc => !acc.data.isClosed && !acc.data.isDeleted);
        const hasUnlocked = accounts.some(acc => acc.getState !== 'LOCKED');
        accounts.forEach(acc => {
          if (hasUnlocked) {
            acc.updateState('LOCKED');
            acc.data.isLocked = true;
          } else {
            acc.updateState('LOGGED_IN'); // unlock assumes implicitly logged in or generic state
            acc.data.isLocked = false;
          }
        });
        btnUnlock.innerText = hasUnlocked ? '锁定' : '解锁';
        this.appendLog(`[${new Date().toLocaleTimeString()}] ${hasUnlocked ? '已锁定全部账号' : '已解锁全部账号'}`, '#faad14');
        // The state update inside accountController triggers UI rerender automatically
        EventBus.emit('ui:render-tabs', accounts, accountController.getSelectedAccountId());
        EventBus.emit('ipc:save-accounts', accounts.map(a => a.data));
      });
    }

    if (btnToggle) {
      btnToggle.addEventListener('click', async () => {
        if (this.isRunning) {
          // 停止
          this.isRunning = false;
          btnToggle.innerText = '开始';
          btnToggle.style.background = '#52c41a';
          btnToggle.style.cursor = 'pointer';
          this.appendLog("已停止所有工作流", '#ff7875');
          ipcRenderer.send(IpcChannels.STOP_GLOBAL_SEND);
        } else {
          // 启动
          const accounts = accountController.getAccounts().filter(acc => !acc.data.isClosed && !acc.data.isDeleted);
          if (accounts.length === 0) {
             this.appendLog("无法启动，当前没有活跃的平台账号。", '#ff4d4f');
             return;
          }

          // 直接启动（不再进行防呆预检）

          const minVal = parseInt(inputMin?.value || '2');
          const maxVal = parseInt(inputMax?.value || '4');
          const savedMode = localStorage.getItem('cfg_send_mode') as 'random' | 'sequential' || this.sendMode;
          const savedScripts = localStorage.getItem('cfg_global_scripts') || '';
          const loopCountStr = localStorage.getItem('cfg_loop_count') || '0';
          const loopCount = parseInt(loopCountStr, 10);
          
          let rawScripts = savedScripts.split('\n').map(s => s.trim()).filter(s => s.length > 0);
          
          if (rawScripts.length === 0) {
             rawScripts = ['主播好', '支持一下', '不错啊', '来了来了'];
          }
          
          this.isRunning = true;
          btnToggle.disabled = false;
          btnToggle.innerText = '暂停';
          btnToggle.style.background = '#ff7875';
          btnToggle.style.cursor = 'pointer';
          
          const modeName = savedMode === 'random' ? '随机' : '顺序';
          const loopName = loopCount === 0 ? '无限循环' : `循环${loopCount}次`;
          this.appendLog(`[${new Date().toLocaleTimeString()}] 集群工作流启动 (${modeName}, ${loopName})，${minVal}-${maxVal}秒`, '#52c41a');

          const accountsPayload = accounts.map(a => ({ id: a.data.id, name: a.data.name || a.data.id }));
          const roomUrl = accounts[0].data.url;
          
          ipcRenderer.send(IpcChannels.START_GLOBAL_SEND, {
             accounts: accountsPayload,
             roomUrl: roomUrl, 
             config: {
               minInterval: minVal,
               maxInterval: maxVal,
               sendMode: savedMode,
               scripts: rawScripts,
               loopCount: isNaN(loopCount) ? 0 : loopCount
             }
          });
        }
      });
    }

    ipcRenderer.on(IpcChannels.RENDERER_LOG, (event, logStr, color) => {
       this.appendLog(`[${new Date().toLocaleTimeString()}] ${logStr}`, color || '#1890ff');
    });

    ipcRenderer.on(IpcChannels.GLOBAL_SEND_STOPPED, () => {
      this.isRunning = false;
      const btnToggle = document.getElementById('btn-global-toggle');
      if (btnToggle) {
        btnToggle.innerText = '开始';
        btnToggle.style.background = '#52c41a';
      }
      this.appendLog("自动化发送已完成设定循环，自动停止", '#52c41a');
    });

    // ==================== 轮转推进：一轮话术发完后自动切换到下一个话术包 ====================
    ipcRenderer.on(IpcChannels.ROTATE_ADVANCE, async () => {
      // 检查轮转配置是否启用
      const rawRotate = localStorage.getItem('cfg_auto_rotate');
      let rotateCfg: { enabled: boolean; rows: { scriptId: string; min: number; max: number }[] } | null = null;
      try {
        if (rawRotate) rotateCfg = JSON.parse(rawRotate);
      } catch (e) { /* ignore */ }

      if (!rotateCfg || !rotateCfg.enabled || !rotateCfg.rows || rotateCfg.rows.length === 0) {
        // 轮转未启用 → 走正常停止逻辑
        this.isRunning = false;
        const btnToggle = document.getElementById('btn-global-toggle');
        if (btnToggle) {
          btnToggle.innerText = '开始';
          btnToggle.style.background = '#52c41a';
        }
        this.appendLog("自动化发送已完成设定循环，自动停止", '#52c41a');
        return;
      }

      // 轮转启用 → 推进到下一个话术包
      const rotateIdxKey = 'cfg_rotate_current_idx';
      let currentIdx = parseInt(localStorage.getItem(rotateIdxKey) || '0', 10);
      currentIdx = (currentIdx + 1) % rotateCfg.rows.length;
      localStorage.setItem(rotateIdxKey, String(currentIdx));

      const nextRow = rotateCfg.rows[currentIdx];
      if (!nextRow || !nextRow.scriptId) {
        // 跳过空行，标记停止
        this.isRunning = false;
        const btnToggle = document.getElementById('btn-global-toggle');
        if (btnToggle) {
          btnToggle.innerText = '开始';
          btnToggle.style.background = '#52c41a';
        }
        this.appendLog("轮转所有话术包已完成，自动停止", '#52c41a');
        return;
      }

      // 获取话术包内容
      let scripts: any[] = [];
      try {
        scripts = await ipcRenderer.invoke('get-scripts');
      } catch (e) { /* fallback empty */ }

      const targetScript = scripts.find((s: any) => s.id === nextRow.scriptId);
      if (!targetScript) {
        this.appendLog(`❌ 轮转找不到话术包 ID=${nextRow.scriptId}，停止`, '#ff4d4f');
        this.isRunning = false;
        const btnToggle = document.getElementById('btn-global-toggle');
        if (btnToggle) {
          btnToggle.innerText = '开始';
          btnToggle.style.background = '#52c41a';
        }
        return;
      }

      // 更新 localStorage
      localStorage.setItem('cfg_global_scripts', targetScript.content);
      localStorage.setItem('cfg_global_interval_min', String(nextRow.min));
      localStorage.setItem('cfg_global_interval_max', String(nextRow.max));

      // 更新 UI 面板（如果可见）
      const txtCurrent = document.getElementById('txt-current-script') as HTMLTextAreaElement;
      if (txtCurrent) txtCurrent.value = targetScript.content;
      const uiMin = document.getElementById('global-interval-min') as HTMLInputElement;
      const uiMax = document.getElementById('global-interval-max') as HTMLInputElement;
      if (uiMin) uiMin.value = String(nextRow.min);
      if (uiMax) uiMax.value = String(nextRow.max);

      const newScripts = targetScript.content.split('\n').map((s: string) => s.trim()).filter((s: string) => s.length > 0);
      this.appendLog(`[${new Date().toLocaleTimeString()}] 🔄 轮转切换至话术包: ${targetScript.title} (${newScripts.length} 条)`, '#1890ff');

      // 通知 Main 进程更新话术 + 间隔 + 重置循环计数器
      ipcRenderer.send(IpcChannels.UPDATE_GLOBAL_SCRIPTS, {
        scripts: newScripts,
        minInterval: nextRow.min,
        maxInterval: nextRow.max
      });

      // 短暂等待后重启全局发送（重新触发 START_GLOBAL_SEND）
      const accounts = accountController.getAccounts().filter(acc => !acc.data.isClosed && !acc.data.isDeleted);
      const savedMode = localStorage.getItem('cfg_send_mode') as 'random' | 'sequential' || 'sequential';
      const loopCount = parseInt(localStorage.getItem('cfg_loop_count') || '0', 10);

      // 等一个随机间隔再开始下一轮，模拟人类
      const waitSec = nextRow.min + Math.floor(Math.random() * (nextRow.max - nextRow.min + 1));
      this.appendLog(`[${new Date().toLocaleTimeString()}] ⏱️ ${waitSec}秒后开始发送下一轮话术`, '#faad14');

      setTimeout(() => {
        if (!this.isRunning) return; // 被手动停止

        const accountsPayload = accounts.map(a => ({ id: a.data.id, name: a.data.name || a.data.id }));
        const roomUrl = accounts[0]?.data.url || '';

        ipcRenderer.send(IpcChannels.START_GLOBAL_SEND, {
          accounts: accountsPayload,
          roomUrl,
          config: {
            minInterval: nextRow.min,
            maxInterval: nextRow.max,
            sendMode: savedMode,
            scripts: newScripts,
            loopCount: isNaN(loopCount) ? 0 : loopCount
          }
        });

        this.appendLog(`[${new Date().toLocaleTimeString()}] ▶️ 已启动发送: ${targetScript.title}`, '#52c41a');
      }, waitSec * 1000);
    });

    ipcRenderer.on(IpcChannels.EXECUTE_RANDOM_SEND, (event, phraseObj) => {
      // phraseObj should ideally be { count: number, phrase: string } or similar
      const count = phraseObj.count || 1;
      const phrase = phraseObj.phrase || phraseObj;
      
      const activeAccounts = accountController.getAccounts().filter(acc => acc.getState === 'LOGGED_IN' && !acc.data.isLocked);
      if (activeAccounts.length === 0) {
        this.appendLog(`[${new Date().toLocaleTimeString()}] 独立随机失败: 没有可用账号`, '#ff4d4f');
        return;
      }
      
      // Randomly shuffle without replacement and pick `count` accounts
      const shuffledAccounts = [...activeAccounts].sort(() => 0.5 - Math.random());
      const selectedAccounts = shuffledAccounts.slice(0, Math.min(count, activeAccounts.length));
      
      selectedAccounts.forEach(luckyAccount => {
        const accountId = luckyAccount.data.id;
        const accountName = luckyAccount.data.name || accountId.substring(0, 6);
        
        // 使用 random-direct-send 通道，直接通过 webview.executeJavaScript() 在 Main World 执行
        // 避免走 PAGE_ACTION → preload 的隔离上下文导致消息不可见
        ipcRenderer.send('random-direct-send', { accountId, message: phrase });

        this.appendLog(`[${new Date().toLocaleTimeString()}] 随机抽签 => [${accountName}] 发送: ${phrase}`, '#faad14');
      });
    });

    // 接收子进程或底层探测器发出的断播通知
    ipcRenderer.on(IpcChannels.LIVE_STATUS_OFFLINE, (_event, roomId) => {
       this.appendLog(`[${new Date().toLocaleTimeString()}] 收到房间 ${roomId} 断播/掉线信号，暂停全局发送。`, '#ff4d4f');
       const btnToggle = document.getElementById('btn-global-toggle');
       if (btnToggle && this.isRunning) {
         btnToggle.click(); // 触发暂停逻辑
       }
    });
  }
}
