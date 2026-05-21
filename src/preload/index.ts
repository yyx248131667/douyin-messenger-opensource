import { contextBridge, ipcRenderer, webFrame } from 'electron';
// API operations moved to renderer webview execution
import { LoginObserver } from './observers/login.observer';
import { LiveStatusObserver } from './observers/live-status.observer';
import { LuckyBagObserver } from './observers/lucky-bag.observer';
import { SendGiftOperation } from './operations/send-gift.operation';
import { RiskObserver } from './observers/risk.observer';

import { MessageBridge } from './core/message-bridge';

// Set global tag
(window as any).__autoSendInstalled = true;
(window as any)._preloadLoaded = true;
(window as any)._instanceId = Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

// Initialize Global Message Bridge
MessageBridge.init();

// Register Operations
// 移除废弃的 ApiMessageOperation

const sendGiftOp = new SendGiftOperation();
sendGiftOp.register();

import { SendMessageOperation } from './operations/send-message.operation';
const sendMsgOp = new SendMessageOperation();
sendMsgOp.register();

import { injectUltraSaver } from './optimizers/ultra-saver';
injectUltraSaver();

// 心跳保活：模拟人类行为防止 Sec-SDK 判定为机器人
import { initHeartbeat } from './optimizers/heartbeat-keeper';
initHeartbeat();

// 直播间屏蔽层：隐藏视频/推荐等元素，仅保留 #root > iframe（聊天区），降低风控触发
import { injectLiveRoomShield } from './optimizers/live-room-shield';
injectLiveRoomShield();

// ========== 全局诊断：Main World 网络拦截器 ==========
// 使用 postMessage 跨越 contextIsolation 边界
(function installGlobalInterceptor() {
  // 监听来自 Main World 的 postMessage
  window.addEventListener('message', (e: MessageEvent) => {
    if (e.data && e.data.__interceptor) {
      try {
         ipcRenderer.send('log-message', '[Webview Logger] ' + e.data.msg);
      } catch(ex) {
         console.log(e.data.msg);
      }
    }
  });
  // DOM 加载后注入
  const inject = () => {
    ipcRenderer.send('log-message', '[Webview Logger] [PRELOAD] 🚀 Executing inject() logic - Attempting to inject Main World Hook!');
    const code = `
(function() {
  if (window.__interceptorInstalled) return;
  window.__interceptorInstalled = true;

  function _log(msg) {
    window.postMessage({ __interceptor: true, msg: msg }, '*');
  }

  // ==== WebSocket Interceptor (Level 3 ACK 劫持者) ====
  const _origWS = window.WebSocket;
  window.WebSocket = function(url, protocols) {
    const ws = protocols ? new _origWS(url, protocols) : new _origWS(url);
    if (typeof url === 'string' && url.indexOf('webcast') > -1) {
       _log('[WS_DEBUG] 成功劫持到 Webcast WebSocket 连接: ' + url.substring(0, 80));
       
       ws.addEventListener('message', async function(event) {
          if (!window.__wsAckTarget) return; // 没下达侦听指令时忽略
          
          try {
             let buffer;
             if (event.data instanceof Blob) {
                 buffer = await event.data.arrayBuffer();
             } else if (event.data instanceof ArrayBuffer) {
                 buffer = event.data;
             } else {
                 return;
             }
             
             const u8 = new Uint8Array(buffer);
             // 暴力扫描 GZIP 头 (1F 8B 08)
             let gzipStart = -1;
             for (let i = 0; i < u8.length - 2; i++) {
                 if (u8[i] === 0x1f && u8[i+1] === 0x8b && u8[i+2] === 0x08) {
                     gzipStart = i;
                     break;
                 }
             }
             
             let text = "";
             if (gzipStart >= 0) {
                 // 解压 GZIP 块 (兼容末尾可能的脏数据错误)
                 const ds = new DecompressionStream('gzip');
                 const writer = ds.writable.getWriter();
                 writer.write(buffer.slice(gzipStart)).catch(function(){});
                 writer.close().catch(function(){}); // 不 await
                 
                 const reader = ds.readable.getReader();
                 const chunks = [];
                 try {
                     while(true) {
                         const res = await reader.read();
                         if (res.value) chunks.push(res.value);
                         if (res.done) break;
                     }
                 } catch(e) {} // 故意忽略尾部数据导致的报错，保留已解压数据
                 
                 const total = chunks.reduce((a, c) => a + c.length, 0);
                 const out = new Uint8Array(total);
                 let p = 0;
                 for(const c of chunks) { out.set(c, p); p += c.length; }
                 text = new TextDecoder('utf-8', {fatal: false}).decode(out);
             } else {
                 text = new TextDecoder('utf-8', {fatal: false}).decode(buffer);
             }
             
             const target = window.__wsAckTarget;
             if (text.includes(target)) {
                 _log('[WS_ACK] 🔥 绝对上屏确认！WebSocket 下行流中捕获到：' + target);
                 window.postMessage({ type: 'WS_ACK_SUCCESS', msg: target }, '*');
                 window.__wsAckTarget = null; // 抓到即重置
             }
          } catch(e) {
             // 吞没错误不干扰页面的正太反序列化
          }
       });
    }
    return ws;
  };

  // 接收从 Renderer 传来的握手指令
  window.addEventListener('message', function(e) {
     if (e.data && e.data.type === 'START_WS_ACK') {
         // e.data.msg 此处现在是 msgId！不再是简单的模糊文本
         window.__wsAckTarget = e.data.msg;
         _log('[WS_ACK] 已开启底网侦听，精确跟踪 Target MsgId: ' + e.data.msg);
     }
     
     if (e.data && e.data.type === 'DX_TOKEN_REQ') {
         window.postMessage({ type: 'DX_TOKEN_REP', reqId: e.data.reqId, tokens: window.__dyNativeTokens }, '*');
     }

     if (e.data && e.data.type === 'DX_REHEAT_TOKEN') {
         var roomId = window.location.pathname.replace(/[^0-9]/g, '');
         window.fetch("https://live.douyin.com/webcast/im/fetch/?device_platform=web&aid=6383&room_id=" + roomId + "&live_id=1", { credentials: "include" }).catch(function(){});
     }

     if (e.data && e.data.type === 'DX_NATIVE_FETCH') {
         var reqId = e.data.reqId;
         _log('[MainWorld] ⚡ Started DX_NATIVE_FETCH for ' + reqId);
         try {
             window.fetch(e.data.url, e.data.payload)
                .then(function(res) {
                   _log('[MainWorld] Fetch resolved. Status: ' + res.status);
                   return res.text().then(function(text) {
                      _log('[MainWorld] Fetch text parsed. len: ' + text.length);
                      window.postMessage({ type: 'DX_NATIVE_FETCH_RES', reqId: reqId, status: res.status, text: text }, '*');
                   });
                })
                .catch(function(err) {
                   _log('[MainWorld] Fetch rejected: ' + String(err));
                   window.postMessage({ type: 'DX_NATIVE_FETCH_ERR', reqId: reqId, error: err ? err.message : String(err) }, '*');
                });
         } catch (ex) {
             _log('[MainWorld] Fetch synchronous exception: ' + String(ex));
             window.postMessage({ type: 'DX_NATIVE_FETCH_ERR', reqId: reqId, error: ex ? ex.message : String(ex) }, '*');
         }
     }
  });

  // 劫持所有的 API 探针来精准“白嫖”活体 Token
  window.__dyNativeTokens = { csrf: '', msToken: '', updateTime: 0 };

  // Hook fetch
  var _origFetch = window.fetch;
  window.fetch = function(url, opts) {
    var urlStr = (typeof url === 'string') ? url : (url && url.url ? url.url : String(url));
    if (urlStr.indexOf('/webcast/') >= 0) {
      // url 可能是一个 Request 对象，此时 headers 在 url.headers 里
      var reqHeaders = (url instanceof Request) ? url.headers : null;
      var optHeaders = opts && opts.headers ? opts.headers : null;
      
      var checkHeader = function(hdrs) {
         if (!hdrs) return false;
         if (hdrs instanceof Headers) {
            var keys = []; hdrs.forEach(function(v,k){keys.push(k.toLowerCase())});
            keys.forEach(function(k) {
               if (k === 'x-secsdk-csrf-token' || k === 'x-secsdk-csrf-token'.toLowerCase()) {
                  window.__dyNativeTokens.csrf = hdrs.get(k);
                  window.__dyNativeTokens.updateTime = Date.now();
                  _log('[INTERCEPTOR] 🔥 活体网络流(Headers对象)捕获到 CSRF: ' + window.__dyNativeTokens.csrf);
               }
            });
         } else {
            for (var k in hdrs) {
               if (k.toLowerCase() === 'x-secsdk-csrf-token') {
                  window.__dyNativeTokens.csrf = hdrs[k];
                  window.__dyNativeTokens.updateTime = Date.now();
                  _log('[INTERCEPTOR] 🔥 活体网络流(普通对象)捕获到 CSRF: ' + window.__dyNativeTokens.csrf);
               }
            }
         }
      };

      checkHeader(reqHeaders);
      checkHeader(optHeaders);

      var msMatch = urlStr.match(/msToken=([^&]+)/);
      if (msMatch) {
         window.__dyNativeTokens.msToken = msMatch[1];
         window.__dyNativeTokens.updateTime = Date.now();
         _log('[INTERCEPTOR] 🔥 活体网络流捕获到 msToken: ' + msMatch[1].substring(0, 15) + '...');
      }
    }
    return _origFetch.apply(this, arguments);
  };

  // Hook XHR
  var _origOpen = XMLHttpRequest.prototype.open;
  var _origSend = XMLHttpRequest.prototype.send;
  var _origSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.open = function(method, url) {
     this._dyUrl = (typeof url === 'string') ? url : (url && url.url ? url.url : String(url));
     var msMatch = this._dyUrl.match(/msToken=([^&]+)/);
     if (msMatch) { 
       window.__dyNativeTokens.msToken = msMatch[1];
       window.__dyNativeTokens.updateTime = Date.now();
       _log('[INTERCEPTOR] 🔥 XHR 流捕获到 msToken: ' + msMatch[1].substring(0, 15) + '...');
     }
     return _origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
     if (header.toLowerCase() === 'x-secsdk-csrf-token') {
        window.__dyNativeTokens.csrf = value;
        window.__dyNativeTokens.updateTime = Date.now();
     }
     return _origSetRequestHeader.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    return _origSend.apply(this, arguments);
  };

  // ✅ 定时养号防封与自动激活 msToken
  setInterval(function() {
     try {
         // 刺激弹幕重连与Token下发
         fetch('/webcast/room/reflow/info/?live_id=1').catch(function(){});
         // 强制下发鼠标滑动模拟
         document.body.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 100 }));
     } catch (err) {}
  }, 3000);

  _log('[INTERCEPTOR] ✅ 拦截器 (含 WS ACK 核心) 已安装 (url: ' + window.location.href.substring(0, 60) + ')');
})();
    `;
    // 使用 webFrame.executeJavaScript 绕过 CSP（BUG-006 核心修复）
    webFrame.executeJavaScript(code).then(() => {
      ipcRenderer.send('log-message', '[Webview Logger] [PRELOAD] ✅ 拦截器已通过 webFrame.executeJavaScript 成功注入 Main World');
    }).catch((err: any) => {
      ipcRenderer.send('log-message', `[Webview Logger] [PRELOAD] ❌ webFrame 注入失败: ${err.message}`);
    });
  };

  // ✅ 监听 Main World 发出的调试日志
  window.addEventListener('message', (e) => {
    if (e.data && e.data.type === 'DX_DEBUG_LOG' && e.data.msg) {
        try { ipcRenderer.send('log-message', e.data.msg); } catch(err){}
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', inject);
  } else {
    inject();
  }
})();

// Provide bridge for legacy compatibility and native Douyin Fetching
contextBridge.exposeInMainWorld('douyinAPI', {
  getInstanceId: () => (window as any)._instanceId,

  // Token 预热
  enterRoom: async (roomId: string) => {
    window.postMessage({ type: 'DX_REHEAT_TOKEN' }, '*');
    return new Promise(r => setTimeout(() => r(true), 1000));
  },

  // 发送弹幕 — 已迁移到 SendMessageOperation（webFrame.executeJavaScript 模式）
  // 此接口保留兼容性，内部直接委托给 SendMessageOperation
  sendChat: async (roomId: string, msg: string, accountId?: string) => {
    try {
      const _log = (s: string) => { try { ipcRenderer.send('log-message', s); } catch(e){} };
      _log(`[douyinAPI.sendChat] 委托给 webFrame 模式发送: room=${roomId}`);

      // 使用 webFrame.executeJavaScript 绕过 CSP，在 Main World 执行
      const result = await webFrame.executeJavaScript(`
        (async function() {
          try {
            var csrf = '';
            var msToken = '';

            if (window.__dyNativeTokens) {
              csrf = window.__dyNativeTokens.csrf || '';
              msToken = window.__dyNativeTokens.msToken || '';
            }

            document.cookie.split(';').forEach(function(c) {
              var t = c.trim();
              if (!csrf && t.indexOf('tt_csrf_token=') === 0) csrf = t.split('=')[1];
              if (!csrf && t.indexOf('passport_csrf_token=') === 0) csrf = t.split('=')[1];
              if (!msToken && t.indexOf('msToken=') === 0) msToken = t.split('=')[1];
            });

            if (!csrf) return { error: "csrfToken缺失", status_code: 20003, requireRefresh: true };

            var roomId = ${JSON.stringify(roomId)};
            var msg = ${JSON.stringify(msg)};
            var qp = "aid=6383&app_name=douyin_web&live_id=1&device_platform=web&language=zh-CN&room_id=" + roomId;
            if (msToken) qp += "&msToken=" + msToken;
            var bodyStr = "live_id=1&type=0&room_id=" + roomId + "&content=" + encodeURIComponent(msg);

            var resp = await fetch("https://live.douyin.com/webcast/room/chat/?" + qp, {
              method: "POST",
              credentials: "include",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                "x-secsdk-csrf-token": csrf,
                "Accept": "application/json, text/plain, */*",
                "Origin": "https://live.douyin.com",
                "Referer": location.href
              },
              body: bodyStr
            });
            var data = await resp.json();
            if (data.data && data.data.msg_id) data.internal_msg_id = data.data.msg_id;
            return data;
          } catch(e) {
            return { error: e.message };
          }
        })();
      `);

      return result;
    } catch (e: any) {
      return { error: `[sendChat Error]: ${e.message}` };
    }
  }
});

// Initialize Lifecycle & UI Observers
document.addEventListener('DOMContentLoaded', () => {
  const accountId = new URLSearchParams(window.location.search).get('accountId') || `acc_${Date.now()}`;
  
  const loginObserver = new LoginObserver();
  loginObserver.start();
  MessageBridge.registerObserver('LoginObserver', loginObserver);
  
  const liveStatusObserver = new LiveStatusObserver();
  liveStatusObserver.start(accountId);
  MessageBridge.registerObserver('LiveStatusObserver', liveStatusObserver);

  const riskObserver = new RiskObserver();
  riskObserver.start();
  MessageBridge.registerObserver('RiskObserver', riskObserver);

  const luckyBagObserver = new LuckyBagObserver();
  luckyBagObserver.start();
  MessageBridge.registerObserver('LuckyBagObserver', luckyBagObserver);
});
