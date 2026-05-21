/**
 * @file live-room-shield.ts
 * @description 直播间轻量屏蔽模块。
 * 作用：参考原版逻辑，精准覆盖视频播放器（不破坏 DOM 结构），
 * 隐藏礼物特效、推荐浮层、错误提示等，保留聊天区域、输入框、弹幕等核心交互功能。
 */

import { ipcRenderer } from 'electron';

function logToMain(msg: string) {
  console.log(msg);
  try { ipcRenderer.send('log-message', msg); } catch (e) {}
}

export function injectLiveRoomShield() {
  // 防重复注入
  if ((window as any).__liveRoomShieldInstalled) return;
  (window as any).__liveRoomShieldInstalled = true;

  logToMain('[LiveRoomShield] 🛡️ 初始化直播间屏蔽层（参考原版）...');

  const CONFIG = {
    BACKGROUND_COLOR: '#0f0f1a'
  };

  /**
   * 注入 CSS 屏蔽规则
   */
  function injectShieldCSS() {
    if (document.getElementById('__live-room-shield-css__')) return;

    const style = document.createElement('style');
    style.id = '__live-room-shield-css__';
    style.textContent = `
      /* ===== 直播间精准屏蔽规则 ===== */

      /* 1. 强制覆盖播放器背景，而不是 display: none 以防黑屏崩溃 */
      .xgplayer,
      .xgplayer-container,
      xg-video-container,
      [class*="xgplayer"] {
        background-color: ${CONFIG.BACKGROUND_COLOR} !important;
        background-image: none !important;
      }
      
      /* 隐藏实际的视频内容视觉，但不破坏 DOM */
      video {
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* 2. 隐藏常见错误/提示层/加载状态 */
      .xgplayer-error,
      .xgplayer-prompt,
      .xgplayer-toast,
      .xgplayer-loading,
      .xgplayer-poster,
      .xgplayer-controls,
      [class*="player-error"],
      [class*="loading-mask"],
      [class*="player-loading"] {
        display: none !important;
        opacity: 0 !important;
        visibility: hidden !important;
      }

      /* 3. 礼物动画 / 入场特效 / 全屏动画 canvas */
      [class*="gift-animation"],
      [class*="enter-animation"],
      [class*="gift-effect"],
      [class*="effect-container"],
      [class*="GiftAnimationPlayer"],
      [class*="AnimationContainer"],
      canvas[class*="gift"],
      canvas[class*="enter"],
      canvas[class*="effect"] {
        display: none !important;
        opacity: 0 !important;
        pointer-events: none !important;
      }

      /* 4. 直播结束遮罩 / 推荐浮层 */
      [class*="end-screen"],
      [class*="ended-mask"],
      [class*="live-end"],
      [class*="recommend-card"],
      [class*="recommend-list"],
      [class*="offline"] {
        display: none !important;
      }

      /* 5. 强制保留福袋/宝箱元素（不被上方规则误杀） */
      div[data-e2e*="treasure-box"],
      div[data-e2e*="lucky-bag"],
      div[data-e2e*="interactive-component"],
      div[class*="TreasureBox"],
      div[class*="treasureBox"],
      div[class*="treasure-box"],
      div[class*="LuckyBag"],
      div[class*="luckyBag"],
      div[class*="lucky-bag"],
      div[class*="lucky_bag"],
      .ycjwPFJI,
      .redpacket {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
        z-index: 10001 !important;
      }

      /* 5.1 福袋弹窗及其所有子元素必须可见可交互 */
      div[data-e2e*="treasure-box"] *,
      div[data-e2e*="lucky-bag"] *,
      div[class*="TreasureBox"] *,
      div[class*="treasureBox"] *,
      div[class*="treasure-box"] *,
      div[class*="LuckyBag"] *,
      div[class*="luckyBag"] *,
      div[class*="lucky-bag"] * {
        pointer-events: auto !important;
        visibility: visible !important;
      }

      /* 5.2 强制保留福袋所在的父容器层 */
      #ShortTouchLayout,
      div[class*="InteractiveComponent"],
      div[class*="interactive-component"],
      div[class*="interactiveComponent"] {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }

      /* 6. 强制保留 #root > iframe（防风控：确保某些安全组件或挂载点可见） */
      #root > iframe {
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        pointer-events: auto !important;
      }
    `;

    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(style);
      logToMain('[LiveRoomShield] ✅ CSS 原版兼容屏蔽规则已注入');
    }
  }

  // ===== 初始化流程 =====
  function bootstrap() {
    // 1. 立即注入 CSS
    injectShieldCSS();

    // 2. 周期性心跳守卫（每 5 秒），确保样式不被篡改，静音视频
    setInterval(() => {
      // 确保 CSS 还在
      if (!document.getElementById('__live-room-shield-css__')) {
        injectShieldCSS();
      }

      // 静音视频，但不强制清除 src，以免引发 React/播放器引擎异常导致页面黑屏崩溃
      document.querySelectorAll('video').forEach(v => {
        try { 
          if (!v.muted) v.muted = true;
        } catch (e) {}
      });
    }, 5000);

    logToMain('[LiveRoomShield] ✅ 直播间屏蔽层已激活（原版兼容模式）');
  }

  bootstrap();
}
