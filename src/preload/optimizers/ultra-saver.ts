/**
 * @file ultra-saver.ts
 * @description High-performance video/canvas shielding mechanism to reduce CPU usage.
 * Protects DOM, prevents canvas regeneration, and provides a fake player UI.
 */

export function injectUltraSaver() {
  (function () {
    const STATE = {
      enabled: false,
      injected: false,
      container: null as HTMLElement | null,
      fakeEl: null as HTMLElement | null,
    };

    function findPlayerContainer() {
      return document.querySelector(
        '.xgplayer, [class*="player"], [class*="Player"]'
      ) as HTMLElement | null;
    }

    function freezeMedia(container: HTMLElement) {
      // 1. 暂停 + 静音视频（不移除 src！移除 src 会破坏抖音推流连接，导致聊天功能失效）
      container.querySelectorAll('video').forEach(v => {
        try {
          v.pause();
          v.muted = true;
          v.volume = 0;
          // 通过 CSS 隐藏视频画面，而不是销毁 src（保持 WebSocket 连接存活）
          v.style.opacity = '0';
          v.style.pointerEvents = 'none';
        } catch (e) {}
      });

      // 2. 隐藏 canvas 而不是删除（删除会触发 React 重建，消耗更多 CPU）
      container.querySelectorAll('canvas').forEach(c => {
        try {
          (c as HTMLElement).style.display = 'none';
        } catch (e) {}
      });
    }

    function injectFake(container: HTMLElement) {
      if (STATE.injected) return;

      const fake = document.createElement('div');
      fake.id = '__fake_player__';

      fake.style.cssText = `
        position:absolute;
        inset:0;
        background:#0f0f1a;
        display:flex;
        align-items:center;
        justify-content:center;
        color:#666;
        font-size:12px;
        z-index:9999;
        user-select:none;
        pointer-events:none;
      `;

      fake.innerHTML = `
        <div style="text-align: center;">
          ⚡ 节能模式运行中<br/>
          <span style="font-size:10px;opacity:.6">UltraSaver</span>
        </div>
      `;

      container.style.position = 'relative';
      container.appendChild(fake);

      STATE.fakeEl = fake;
      STATE.injected = true;
    }

    function enable() {
      if (STATE.enabled) return { success: true, msg: 'already enabled' };

      const container = findPlayerContainer();
      // Even if the container is not found initially (maybe dom not ready), we mark it enabled.
      // The lifecycle guard loop will inject it later when container appears.
      if (container) {
          STATE.container = container;
          freezeMedia(container);
          injectFake(container);
      }

      STATE.enabled = true;
      console.log('[UltraSaver] enabled');
      return { success: true };
    }

    function disable() {
      if (!STATE.enabled) return { success: true };

      try {
        STATE.fakeEl?.remove();

        // Resume video element natively if possible
        STATE.container?.querySelectorAll('video').forEach(v => {
          try { v.play(); } catch (e) {}
        });
      } catch (e) {}

      STATE.enabled = false;
      STATE.injected = false;
      console.log('[UltraSaver] disabled');

      return { success: true };
    }

    // Expose Global API
    (window as any).UltraSaver = {
      enable,
      disable,
      status: () => ({
        enabled: STATE.enabled,
        injected: STATE.injected
      })
    };

    // --- Lifecycle Guard (Anti-Explosion Core) ---

    // 1. One Time Init Protection
    if ((window as any).__ULTRA_SAVER_INIT__) return;
    (window as any).__ULTRA_SAVER_INIT__ = true;

    // 2. Page Navigation Guard
    let lastUrl = location.href;
    setInterval(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        setTimeout(() => {
          if (STATE.enabled) {
              const container = findPlayerContainer();
              if (container) {
                 STATE.container = container;
                 freezeMedia(container);
                 injectFake(container);
              }
          }
        }, 2000);
      }
    }, 3000);

    // 3. Heartbeat Guard
    // ONLY checks if our fake element is still alive. DO NOT repeatedly remove canvas to prevent CPU jitter!
    setInterval(() => {
      if (!STATE.enabled) return;

      const container = STATE.container || findPlayerContainer();
      if (!container) return;

      // Ensure injected Fake Element survives.
      if (!STATE.fakeEl || !document.getElementById('__fake_player__')) {
         STATE.injected = false;
         injectFake(container);
      }
      
      // We explicitly DO NOT query and remove canvas here anymore, respecting the red lines.
      // If Douyin recreates media elements, our overlay covers it.
    }, 5000);

  })();
}
