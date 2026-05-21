/**
 * @file protocol-guard.ts
 * @description 5层协议安全拦截器。
 * 
 * 统一管理所有自定义协议（bitbrowser://、douyin://、snssdk:// 等）的拦截逻辑，
 * 防止抖音页面通过任何途径唤起外部应用（如 BitBrowser）。
 * 
 * 拦截层级：
 * 1. protocol.handle — 在协议层面静默消化
 * 2. shell.openExternal — 劫持系统级打开
 * 3. web-contents-created — 拦截 will-navigate / will-redirect / window.open
 * 4. session-created — 每个 partition session 上注册协议处理器
 * 5. webRequest — 网络请求层面拦截
 */

import { app, protocol, shell, session as electronSession } from 'electron';

// 所有需要拦截的自定义协议
const BLOCKED_PROTOCOLS = ['bitbrowser', 'douyin', 'bytedance', 'snssdk', 'intent'];

/**
 * 判断 URL 是否为被屏蔽的协议
 */
function isBlockedUrl(url: string): boolean {
  const u = url.toLowerCase();
  return BLOCKED_PROTOCOLS.some(p => u.startsWith(`${p}:`));
}

export class ProtocolGuard {
  /**
   * 初始化全部 5 层安全拦截。
   * 必须在 app ready 之前调用 Layer 2（shell 劫持）和 Layer 3（web-contents-created），
   * Layer 1、4、5 在 app ready 之后注册。
   */
  public static initialize() {
    this.setupShellInterception();       // Layer 2: 同步，立即生效
    this.setupWebContentsGuard();        // Layer 3: 监听所有 webContents 创建

    app.whenReady().then(() => {
      this.setupProtocolHandlers();      // Layer 1: 默认 session 协议处理
      this.setupSessionInterceptors();   // Layer 4 + 5: 每个 partition session
    });
  }

  /**
   * Layer 1: 在默认 session 上注册自定义协议处理器
   */
  private static setupProtocolHandlers() {
    const noopHandler = () => new Response('');
    for (const proto of BLOCKED_PROTOCOLS) {
      try {
        if (typeof protocol.handle === 'function') {
          protocol.handle(proto, noopHandler);
        }
      } catch (e) {
        // 某些协议可能已被注册
      }
    }
  }

  /**
   * Layer 2: 劫持 shell.openExternal，阻止系统级应用唤起
   */
  private static setupShellInterception() {
    const originalOpenExternal = shell.openExternal;
    shell.openExternal = (url: string, options?: any) => {
      if (isBlockedUrl(url)) {
        console.log(`[ProtocolGuard] 🛡️ Blocked shell.openExternal: ${url}`);
        return Promise.resolve();
      }
      return originalOpenExternal(url, options);
    };
  }

  /**
   * Layer 3: 监听所有 WebContents (主窗口 + 所有 WebView) 的导航事件
   */
  private static setupWebContentsGuard() {
    app.on('web-contents-created', (_event, contents) => {
      // 阻止 target="_blank" 弹窗
      contents.setWindowOpenHandler(({ url }) => {
        console.log(`[ProtocolGuard] 🛡️ Blocked window.open: ${url}`);
        return { action: 'deny' };
      });

      // 拦截 location.href / <a> 导航
      contents.on('will-navigate', (e: any, url: string) => {
        if (isBlockedUrl(url)) {
          console.log(`[ProtocolGuard] 🛡️ Blocked will-navigate: ${url}`);
          e.preventDefault();
        }
      });

      // 拦截服务端/META 重定向
      contents.on('will-redirect', (e: any, url: string) => {
        if (isBlockedUrl(url)) {
          console.log(`[ProtocolGuard] 🛡️ Blocked will-redirect: ${url}`);
          e.preventDefault();
        }
      });
    });
  }

  /**
   * Layer 4 + 5: 为每个新创建的 session（含 webview partition）注册协议 + webRequest 拦截
   */
  private static setupSessionInterceptors() {
    const noopHandler = () => new Response('');

    // 为动态创建的 partition session 注册拦截
    app.on('session-created', (sess) => {
      // Layer 4: 每个 session 上注册协议处理器
      for (const proto of BLOCKED_PROTOCOLS) {
        try {
          if (sess.protocol && typeof sess.protocol.handle === 'function') {
            sess.protocol.handle(proto, noopHandler);
          } else if (sess.protocol && typeof sess.protocol.registerStringProtocol === 'function') {
            sess.protocol.registerStringProtocol(proto, (_request, callback) => {
              callback('');
            });
          }
        } catch (e) {
          // 协议可能已注册
        }
      }

      // Layer 5: webRequest 级别拦截
      sess.webRequest.onBeforeRequest((details, callback) => {
        if (isBlockedUrl(details.url)) {
          console.log(`[ProtocolGuard] 🛡️ Blocked webRequest: ${details.url}`);
          return callback({ cancel: true });
        }
        callback({});
      });

      // Layer 6: 为每个 session 随机分配固定内网 IP，防止风控探测关联
      // 从 RFC 1918 私有地址空间 (10.x.x.x, 172.16-31.x.x, 192.168.x.x) 中随机选择
      const getRandomPrivateIp = () => {
        const type = Math.floor(Math.random() * 3);
        if (type === 0) {
          // 10.0.0.0/8
          return `10.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
        } else if (type === 1) {
          // 172.16.0.0/12 (172.16.0.0 到 172.31.255.255)
          const secondOctet = Math.floor(Math.random() * 16) + 16;
          return `172.${secondOctet}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
        } else {
          // 192.168.0.0/16
          return `192.168.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 254) + 1}`;
        }
      };
      
      const randomIntranetIp = getRandomPrivateIp();
      sess.webRequest.onBeforeSendHeaders((details, callback) => {
        details.requestHeaders['X-Forwarded-For'] = randomIntranetIp;
        details.requestHeaders['X-Real-IP'] = randomIntranetIp;
        details.requestHeaders['Client-IP'] = randomIntranetIp;
        callback({ cancel: false, requestHeaders: details.requestHeaders });
      });

      // Layer 7: 彻底禁用 WebRTC 本地真实 IP 泄漏，强制对方只能依赖我们上面伪造的 HTTP X-Forwarded-For IP
      try {
        if (typeof (sess as any).setWebRTCIPHandlingPolicy === 'function') {
          (sess as any).setWebRTCIPHandlingPolicy('disable_non_proxied_udp');
        }
      } catch (e) {
        console.error('[ProtocolGuard] Failed to set WebRTC policy:', e);
      }
    });

    // 默认 session 也要拦截
    electronSession.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      if (isBlockedUrl(details.url)) {
        console.log(`[ProtocolGuard] 🛡️ Blocked defaultSession webRequest: ${details.url}`);
        return callback({ cancel: true });
      }
      callback({});
    });
  }
}
