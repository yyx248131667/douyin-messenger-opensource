/**
 * @file webview-controller.ts
 * @description 管理物理 <webview> 元素及其生命周期。
 * 
 * 核心设计原则：
 * 1. Partition 绑定：每个账号的 partition 必须通过 PartitionRegistry 获取，确保一致性
 * 2. 崩溃自恢复：webview 崩溃后自动使用原 partition 重建，保留登录态
 * 3. 串行化创建：避免多个 webview 同时初始化导致 ERR_FAILED 竞态
 * 4. 分层管理：活跃区正常渲染、冷却区节能模式、挂机区不创建 webview
 */

import { EventBus } from '../../renderer/core/event-bus';
import { Account } from '../../domain/account/Account';
import { PartitionRegistry } from '../../shared/partition-registry';
import path from 'path';

export class WebviewController {
  private containerId: string;
  private preloadPath: string;

  // 防止并发创建导致的竞态问题
  private creationQueue: Account[] = [];
  private isCreating: boolean = false;

  // 记录每个账号的 webview 元数据，用于崩溃恢复
  private webviewMeta: Map<string, { partition: string; lastUrl: string; crashCount: number }> = new Map();

  constructor(containerId: string = 'webviews-container') {
    this.containerId = containerId;
    
    // 强制运行时路径解析: 通过 main 进程请求实际 basePath，或者依赖当前 window.location
    // 如果处在 "electron ." 中，process.defaultApp 会是 true。在 Renderer 中我们可以直接使用确定的远端应用根目录。
    // 为了最大兼容，我们可以从 __dirname 推导（因为此代码在 renderer 被打包执行）。
    // 在 renderer/dist/renderer 下跑，往上两级就是 dist。如果不能依赖 __dirname 伪装，最安全就是用 process.cwd() fallback。
    let basePath = process.cwd();
    // 探测是否打包
    if (process.resourcesPath && process.resourcesPath.includes('app.asar')) {
       basePath = path.join(process.resourcesPath, 'app.asar');
    } else if (process.resourcesPath && !process.env.ELECTRON_RUN_AS_NODE && !basePath.includes('Douyin')) {
       // Packaged app raw folder
       basePath = path.join(process.resourcesPath, 'app');
    }
    // 无论如何强制覆盖回当前绝对路径以修复开发模式下的错位
    if (__dirname.includes('douyinnew') || __dirname.includes('dist')) {
       const projectRoot = __dirname.substring(0, __dirname.indexOf('dist') - 1);
       if (projectRoot) basePath = projectRoot;
    }

    this.preloadPath = `file://${path.join(basePath, 'dist', 'preload', 'index.js').replace(/\\/g, '/')}`;
    console.log(`[WebviewController] 解析 preload 路径为: ${this.preloadPath}`);

    this.bindEvents();
  }

  private bindEvents() {
    EventBus.on('ui:render-webviews', (accounts: Account[], selectedId: string | null) => {
      this.syncWebviewInstances(accounts);
      if (selectedId) {
        this.switchWebviewVisibility(selectedId);
      }
    });

    EventBus.on('ui:switch-webview', (accountId: string) => {
      this.switchWebviewVisibility(accountId);
    });

    EventBus.on('action:reload-webview', (accountId: string) => {
       const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
       if (wrapper) {
         const webview = wrapper.querySelector('webview') as any;
         if (webview) webview.reload();
       }
    });

    EventBus.on('ui:navigate-webview', (accountId: string, targetUrl: string) => {
      const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
      if (!wrapper) {
        console.warn(`[WebviewController] ⚠️ 导航失败: 找不到 webview-wrapper-${accountId}`);
        return;
      }
      const webview = wrapper.querySelector('webview') as any;
      if (!webview) {
        console.warn(`[WebviewController] ⚠️ 导航失败: webview 元素不存在 (${accountId})`);
        return;
      }

      // URL 规范化比较：只比对 origin + pathname（忽略查询参数、尾斜杠差异）
      const normalizeUrl = (raw: string): string => {
        try {
          const u = new URL(raw);
          return u.origin + u.pathname.replace(/\/+$/, '');
        } catch {
          return raw.replace(/\/+$/, '').replace(/\?.*$/, '');
        }
      };

      const currentUrl = (typeof webview.getURL === 'function') ? webview.getURL() : (webview.src || '');
      const normalizedCurrent = normalizeUrl(currentUrl);
      const normalizedTarget = normalizeUrl(targetUrl);

      if (normalizedCurrent === normalizedTarget) {
        console.log(`[WebviewController] ${accountId} 已在目标页面，跳过导航`);
        return;
      }

      // 使用 loadURL 代替直接设置 src，更可靠（支持 about:blank 状态的 webview）
      console.log(`[WebviewController] 🔄 导航 ${accountId}: ${normalizedCurrent} → ${normalizedTarget}`);
      try {
        if (typeof webview.loadURL === 'function') {
          webview.loadURL(targetUrl);
        } else {
          webview.src = targetUrl;
        }
      } catch (err) {
        console.error(`[WebviewController] ❌ 导航失败 (${accountId}):`, err);
        // Fallback: 强制设置 src
        webview.src = targetUrl;
      }
    });

    // 崩溃恢复事件：外部通知重新创建指定账号的 webview
    EventBus.on('ui:webview-crashed', (accountId: string) => {
      console.log(`[WebviewController] 收到崩溃恢复请求: ${accountId}`);
    });
  }

  /**
   * 同步 DOM <webview> 与内部 Account 数组列表。
   * 只创建缺失的 webview，已存在的保持不动，防止会话断开。
   */
  private syncWebviewInstances(accounts: Account[]) {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    const existingIds = new Set(
      Array.from(container.children)
        .map(child => child.getAttribute('data-account-id'))
        .filter(Boolean) as string[]
    );

    // 只为活跃账号（未关闭、未删除）创建 webview
    const activeAccounts = accounts.filter(a => !a.data.isClosed && !a.data.isDeleted);

    activeAccounts.forEach(account => {
      if (!existingIds.has(account.data.id)) {
        // 加入创建队列而不是直接创建，避免 ERR_FAILED 竞态
        this.enqueueCreation(container, account);
      } else {
        existingIds.delete(account.data.id);
      }
    });

    // 销毁已移除的账号 webview（仅从 DOM 移除，不清除 partition 数据）
    existingIds.forEach(idToRemove => {
      console.log(`[WebviewController] 从 DOM 移除 webview（保留 partition 数据）: ${idToRemove}`);
      const obsolete = document.getElementById(`webview-wrapper-${idToRemove}`);
      if (obsolete) {
        const webview = obsolete.querySelector('webview') as any;
        if (webview) {
          // 记录最后访问 URL 用于未来恢复
          try {
            const meta = this.webviewMeta.get(idToRemove);
            if (meta) {
              meta.lastUrl = webview.getURL?.() || webview.src || '';
            }
          } catch(e) {}

          // 安全卸载：先导航到空白页再移除 DOM，防止 V8 内存泄漏
          webview.src = 'about:blank';
        }
        obsolete.remove();
        // P0-3: 清除监听器追踪，允许恢复时重新绑定
        this.attachedListeners.delete(idToRemove);
      }
    });
  }

  /**
   * 将 webview 创建请求加入串行队列。
   * 避免多个 webview 同时 load about:blank → 部分被 abort → ERR_FAILED (-2) 竞态。
   */
  private enqueueCreation(container: HTMLElement, account: Account) {
    this.creationQueue.push(account);
    this.processCreationQueue(container);
  }

  /**
   * 串行处理创建队列，每个 webview 创建完毕后再创建下一个
   */
  private async processCreationQueue(container: HTMLElement) {
    if (this.isCreating) return;
    this.isCreating = true;

    while (this.creationQueue.length > 0) {
      const account = this.creationQueue.shift()!;
      
      // 再次检查是否已存在（避免重复创建）
      if (document.getElementById(`webview-wrapper-${account.data.id}`)) {
        continue;
      }

      this.createWebview(container, account);
      
      // 等待 DOM 渲染完成再处理下一个，防止竞态
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    this.isCreating = false;

    // 队列清空后，启动热身轮循（让非活跃 webview 也完成页面渲染）
    this.scheduleWarmupCycle(container);
  }

  /**
   * 热身轮循：逐个短暂显示非活跃 webview，触发 React 渲染。
   * 对未在直播间页面的 webview 执行 reload，修复无法刷新的 bug。
   */
  private async scheduleWarmupCycle(container: HTMLElement) {
    // 等待 3 秒让活跃账号先完成初始化
    await new Promise(resolve => setTimeout(resolve, 3000));

    const wrappers = Array.from(container.children) as HTMLElement[];
    console.log(`[WebviewController] 🔥 启动热身轮循: ${wrappers.length} 个账号`);

    for (const wrapper of wrappers) {
      if (wrapper.classList.contains('active')) continue;

      const accountId = wrapper.getAttribute('data-account-id') || '未知';
      const webview = wrapper.querySelector('webview') as any;
      if (!webview) continue;

      // 已就绪的跳过
      if (wrapper.dataset.chatReady === 'true') continue;

      // 检查是否在直播间页面，不在则强制 reload
      try {
        const currentUrl = webview.getURL?.() || webview.src || '';
        if (!currentUrl.includes('live.douyin.com/')) {
          console.log(`[WebviewController] 🔄 ${accountId} 不在直播间 (${currentUrl})，强制 reload`);
          webview.reload();
        }
      } catch (e) {}

      // 短暂显示（opacity:0 用户不可见），触发 React 渲染
      wrapper.style.display = 'block';
      wrapper.style.opacity = '0';
      wrapper.style.pointerEvents = 'none';
      wrapper.style.position = 'absolute';

      // 800ms 足够触发 React 渲染
      await new Promise(resolve => setTimeout(resolve, 800));

      wrapper.style.display = 'none';
      wrapper.style.opacity = '';
      wrapper.style.pointerEvents = '';

      // 200ms 间隔
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    console.log(`[WebviewController] 🔥 热身轮循完成`);
  }

  /**
   * 创建单个 webview 实例。
   * ⚠️ 核心：partition 必须通过 PartitionRegistry 获取，确保与 CookieManager、IPC 一致。
   */
  private createWebview(container: HTMLElement, account: Account) {
    // 通过注册表获取标准化的 partition 名称
    const partitionName = PartitionRegistry.getPartitionName(account.data.id);
    
    // 记录 webview 元数据用于崩溃恢复
    if (!this.webviewMeta.has(account.data.id)) {
      this.webviewMeta.set(account.data.id, {
        partition: partitionName,
        lastUrl: account.data.url,
        crashCount: 0
      });
    }

    const wrapper = document.createElement('div');
    wrapper.id = `webview-wrapper-${account.data.id}`;
    wrapper.className = 'webview-wrapper';
    wrapper.setAttribute('data-account-id', account.data.id);
    wrapper.style.display = 'none';
    wrapper.style.width = '100%';
    wrapper.style.height = '100%';
    wrapper.style.position = 'absolute';

    // ✅ 使用 PartitionRegistry 生成的标准化 partition
    // ⚠️ 关键：webpreferences 必须设置 contextIsolation=no, nodeIntegration=yes
    // 原项目要求 webview 内部 preload 和页面共享同一 window 对象，
    // 否则 executeJavaScript 执行的 DOM 操作（如 execCommand）无法被 React 正确识别
    wrapper.innerHTML = `
      <webview 
        id="webview-${account.data.id}" 
        src="${account.data.url}" 
        preload="${this.preloadPath}" 
        useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        partition="${partitionName}" 
        allowpopups
        disablewebsecurity
        webpreferences="nodeIntegration=yes, contextIsolation=no, webSecurity=no, sandbox=no, allowRunningInsecureContent=yes, backgroundThrottling=no"
        style="width: 100%; height: 100%; display: flex; outline: none; border: none; flex: 1;">
      </webview>
    `;

    container.appendChild(wrapper);
    
    console.log(`[WebviewController] ✅ 创建 webview: ${account.data.id} | partition: ${partitionName}`);

    // 延迟附加生命周期监听器，确保 DOM 已绘制
    requestAnimationFrame(() => {
      this.attachLifecycleListeners(account.data.id);
    });
  }

  // 📌 P0-3 修复：记录已绑定监听器的 webview，防止重复绑定导致 MaxListeners 泄漏
  private attachedListeners: Set<string> = new Set();

  /**
   * 为指定 webview 附加所有生命周期监听器。
   * 包含：安全拦截、DOM Ready、加载失败处理、崩溃自恢复。
   * ⚠️ 使用 attachedListeners 集合防止重复绑定（MaxListenersExceeded 修复）
   */
  private attachLifecycleListeners(accountId: string) {
    const webview = document.getElementById(`webview-${accountId}`) as any;
    if (!webview) return;

    // 防止对同一个 webview 元素重复绑定监听器
    if (this.attachedListeners.has(accountId)) return;
    this.attachedListeners.add(accountId);

    // 判断 URL 是否为被屏蔽的自定义协议
    const isBlockedProtocol = (url: string): boolean => {
      const u = (url || '').toLowerCase();
      return u.startsWith('bitbrowser:') || u.startsWith('douyin:') || 
             u.startsWith('snssdk:') || u.startsWith('bytedance:') || u.startsWith('intent:');
    };

    // 🛡️ 最早拦截点：did-start-navigation（在导航开始前触发）
    webview.addEventListener('did-start-navigation', (e: any) => {
      if (isBlockedProtocol(e.url)) {
        console.warn(`[Security] 🛡️ 拦截导航(did-start-navigation): ${e.url}`);
        // 立即导航回当前页面，阻止协议穿透到 OS
        try { webview.stop(); } catch(err) {}
      }
    });

    // 🛡️ 安全拦截：阻止任何通过打开新窗口拉起 APP 的行为
    webview.addEventListener('new-window', (e: any) => {
      if (isBlockedProtocol(e.url)) {
        console.warn(`[Security] 🛡️ 拦截弹窗: ${e.url}`);
        if (typeof e.preventDefault === 'function') e.preventDefault();
      }
    });

    // 🛡️ 安全拦截：阻止 WebView 内的导航到外部协议
    webview.addEventListener('will-navigate', (e: any) => {
      if (isBlockedProtocol(e.url)) {
        console.warn(`[Security] 🛡️ 拦截导航(will-navigate): ${e.url}`);
        webview.stop();
      }
    });

    // DOM Ready：根据可见性自动切换节能模式并注入保活心跳
    webview.addEventListener('dom-ready', () => {
      console.log(`[WebviewController] ${accountId} DOM Ready.`);
      
      // 💖 保活心跳机制：DOM加载完毕后，注入 30 秒循环请求，保持 session 活跃（防止 101/20003）
      const injectHeartbeat = `
        (function() {
          if (window.__dy_heartbeat_injected) return;
          window.__dy_heartbeat_injected = true;
          var match = window.location.href.match(/live\\.douyin\\.com\\/(\\d+)/);
          if (match) {
            var roomId = match[1];
            setInterval(() => {
              fetch("https://live.douyin.com/webcast/im/fetch/?room_id=" + roomId + "&live_id=1", {
                credentials: "include"
              }).catch(() => {});
            }, 30000);
            console.log('[Heartbeat] Auto-fetch session keepalive active: ' + roomId);
          }
        })();
      `;
      webview.executeJavaScript(injectHeartbeat).catch(() => {});
      
      const isActive = document.getElementById(`webview-wrapper-${accountId}`)?.classList.contains('active');
      const script = isActive 
          ? 'if(window.UltraSaver) { window.UltraSaver.disable(); }' 
          : 'if(window.UltraSaver) { window.UltraSaver.enable(); }';
          
      webview.executeJavaScript(script).catch(() => {});

      // 🔍 聊天框持续检测：每秒轮询，最多3分钟，找到即停止
      const wrapperEl = document.getElementById(`webview-wrapper-${accountId}`);
      if (wrapperEl) {
        wrapperEl.dataset.chatReady = 'false';

        // 清除之前可能残留的检测定时器
        const oldTimer = (webview as any).__chatCheckTimer;
        if (oldTimer) clearInterval(oldTimer);

        let attempts = 0;
        const maxAttempts = 180; // 1秒 × 180 = 3分钟

        const chatCheckScript = `
          (function() {
            if (!location.href.includes('live.douyin.com/')) return false;
            var selectors = [
              'div[data-e2e="living-chat-input"]',
              'div[contenteditable="true"][data-e2e*="chat"]',
              'div[contenteditable="plaintext-only"]',
              'textarea[placeholder*="说点什么"]',
              'textarea[placeholder*="聊点什么"]'
            ];
            for (var i = 0; i < selectors.length; i++) {
              if (document.querySelector(selectors[i])) return true;
            }
            return false;
          })();
        `;

        const timer = setInterval(() => {
          attempts++;
          webview.executeJavaScript(chatCheckScript)
            .then((found: boolean) => {
              const w = document.getElementById(`webview-wrapper-${accountId}`);
              if (found && w) {
                w.dataset.chatReady = 'true';
                console.log(`[WebviewController] ${accountId} 聊天框检测: ✅ 已就绪 (${attempts}s)`);
                clearInterval(timer);
                (webview as any).__chatCheckTimer = null;
              } else if (attempts >= maxAttempts) {
                console.log(`[WebviewController] ${accountId} 聊天框检测: ❌ 3分钟超时，停止检测`);
                clearInterval(timer);
                (webview as any).__chatCheckTimer = null;
              }
            })
            .catch(() => {
              if (attempts >= maxAttempts) {
                clearInterval(timer);
                (webview as any).__chatCheckTimer = null;
              }
            });
        }, 1000);

        (webview as any).__chatCheckTimer = timer;
      }
    });

    // 加载失败处理（忽略 abort 类错误码 -3）
    webview.addEventListener('did-fail-load', (e: any) => {
      if (e.errorCode === -3) return; // 被安全拦截器中止的导航
      console.warn(`[WebviewController] ${accountId} 加载失败. Code: ${e.errorCode}, URL: ${e.validatedURL || 'unknown'}`);
    });

    // ⚠️ 崩溃自恢复：webview 渲染进程崩溃后自动使用原 partition 重建
    webview.addEventListener('crashed', () => {
      const meta = this.webviewMeta.get(accountId);
      const crashCount = meta ? meta.crashCount + 1 : 1;

      console.error(`[WebviewController][CRASH] ${accountId} 渲染进程崩溃! 累计: ${crashCount} 次, 3秒后自动恢复...`);
      
      // 更新崩溃计数
      if (meta) {
        meta.crashCount = crashCount;
      }

      // 如果短时间内崩溃超过 5 次，延长恢复等待避免无限重启
      const recoveryDelay = crashCount > 5 ? 15000 : 3000;

      EventBus.emit('ui:webview-crashed', accountId);
      
      setTimeout(() => {
        try {
          // 使用原 partition 重新加载，保持登录态
          webview.reload();
          console.log(`[WebviewController] ${accountId} 崩溃恢复完成 (使用原 partition)`);
        } catch(e) {
          console.error(`[WebviewController] ${accountId} 崩溃恢复失败:`, e);
        }
      }, recoveryDelay);
    });

    // 监听 webview 进程被杀（区别于崩溃，可能是系统内存不足）
    webview.addEventListener('render-process-gone', (e: any) => {
      console.error(`[WebviewController][GONE] ${accountId} 渲染进程消失! reason: ${e.details?.reason || 'unknown'}`);
      
      // 延迟更长时间后尝试恢复
      setTimeout(() => {
        try {
          webview.reload();
        } catch(err) {
          console.error(`[WebviewController] ${accountId} 进程消失恢复失败:`, err);
        }
      }, 5000);
    });
  }

  /**
   * 切换 webview 可见性：
   * - 当前查看的标签：显示 + 关闭节能
   * - 其他打开的标签：隐藏 + 开启节能（冷却区）
   */
  private switchWebviewVisibility(activeId: string) {
    const container = document.getElementById(this.containerId);
    if (!container) return;

    Array.from(container.children).forEach((child) => {
      const wrapper = child as HTMLElement;
      const webview = wrapper.querySelector('webview') as any;
      const isVisible = wrapper.getAttribute('data-account-id') === activeId;

      if (isVisible) {
        wrapper.classList.add('active');
        wrapper.style.display = 'block';
        // 活跃区：关闭节能，恢复正常渲染
        if (webview && typeof webview.executeJavaScript === 'function') {
           webview.executeJavaScript(`if(window.UltraSaver) window.UltraSaver.disable();`).catch(() => {});
        }
      } else {
        wrapper.classList.remove('active');
        wrapper.style.display = 'none';
        // 冷却区：开启节能，使用假画面替代
        if (webview && typeof webview.executeJavaScript === 'function') {
           webview.executeJavaScript(`if(window.UltraSaver) window.UltraSaver.enable();`).catch(() => {});
        }
      }
    });
  }
}
