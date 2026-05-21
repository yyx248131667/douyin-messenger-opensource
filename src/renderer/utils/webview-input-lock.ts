/**
 * @file webview-input-lock.ts
 * @description WebView 输入锁。发送期间锁定指定账号的 WebView，
 * 阻止物理键盘/鼠标干扰自动发送流程。
 *
 * 原理：
 * 1. JS 层：在 webview 内注入 capture 阶段事件拦截器，
 *    利用 event.isTrusted 仅阻止物理输入，不影响程序模拟的事件。
 * 2. DOM 层：在 webview-wrapper 上叠加透明遮罩，阻止鼠标点击+视觉反馈。
 * 3. 标签指示器：在对应标签右上角显示闪烁黄点。
 *
 * 安全保证：
 * - 不锁系统键盘（不使用 BlockInput / SetWindowsHookEx）
 * - 只影响正在发送的那一个 webview
 * - finally 块确保异常时也能解锁
 */

/** 当前已锁定的账号 ID 集合（防重入） */
const lockedAccounts = new Set<string>();

/** 注入到 webview 内部的键盘锁定代码 */
const LOCK_KEYBOARD_CODE = `
(function() {
  if (window.__inputLockHandler) return;
  window.__inputLockHandler = function(e) {
    // isTrusted === true → 物理键盘事件 → 拦截
    // isTrusted === false → 程序 dispatchEvent → 放行
    if (e.isTrusted) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      return false;
    }
  };
  ['keydown', 'keyup', 'keypress'].forEach(function(type) {
    document.addEventListener(type, window.__inputLockHandler, true);
  });
  console.log('[InputLock] 🔒 物理键盘已锁定');
})();
`;

/** 注入到 webview 内部的键盘解锁代码 */
const UNLOCK_KEYBOARD_CODE = `
(function() {
  if (!window.__inputLockHandler) return;
  ['keydown', 'keyup', 'keypress'].forEach(function(type) {
    document.removeEventListener(type, window.__inputLockHandler, true);
  });
  delete window.__inputLockHandler;
  console.log('[InputLock] 🔓 物理键盘已解锁');
})();
`;

/**
 * 在标签上显示闪烁黄点（发送中指示器）
 */
function showTabSendDot(accountId: string): void {
  const indicator = document.querySelector(`.tab-send-indicator[data-account-id="${accountId}"]`);
  if (!indicator) return;
  // 防止重复添加
  if (indicator.querySelector('.tab-send-dot')) return;

  const dot = document.createElement('span');
  dot.className = 'tab-send-dot';
  indicator.appendChild(dot);
}

/**
 * 移除标签上的闪烁黄点
 */
function hideTabSendDot(accountId: string): void {
  const indicator = document.querySelector(`.tab-send-indicator[data-account-id="${accountId}"]`);
  if (!indicator) return;

  const dot = indicator.querySelector('.tab-send-dot');
  if (dot) {
    dot.remove();
  }
}

/**
 * 锁定指定账号的 WebView 输入。
 * 发送前调用，阻止用户物理键盘干扰自动发送流程。
 */
export async function lockWebviewInput(accountId: string): Promise<void> {
  if (lockedAccounts.has(accountId)) return;

  const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
  if (!wrapper) return;

  const webview = wrapper.querySelector('webview') as any;
  if (!webview || typeof webview.executeJavaScript !== 'function') return;

  // 1. JS 层：注入键盘拦截器
  try {
    await webview.executeJavaScript(LOCK_KEYBOARD_CODE);
  } catch {
    // webview 未就绪时静默忽略
  }

  // 2. DOM 层：叠加透明遮罩（阻止鼠标 + 视觉反馈）
  let overlay = wrapper.querySelector('.input-lock-overlay') as HTMLElement;
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.className = 'input-lock-overlay';
    overlay.style.cssText = [
      'position: absolute',
      'top: 0', 'left: 0', 'right: 0', 'bottom: 0',
      'z-index: 9999',
      'cursor: not-allowed',
      'background: rgba(0, 0, 0, 0.03)',
      'pointer-events: all',
      'display: flex',
      'align-items: flex-start',
      'justify-content: center',
      'padding-top: 8px',
    ].join(';');

    const badge = document.createElement('span');
    badge.style.cssText = [
      'background: rgba(255, 77, 79, 0.85)',
      'color: white',
      'padding: 2px 10px',
      'border-radius: 10px',
      'font-size: 11px',
      'font-weight: 500',
      'pointer-events: none',
    ].join(';');
    badge.textContent = '🔒 发送中...';
    overlay.appendChild(badge);

    // 确保 wrapper 是定位容器
    const wrapperPosition = window.getComputedStyle(wrapper).position;
    if (wrapperPosition === 'static') {
      wrapper.style.position = 'relative';
    }

    wrapper.appendChild(overlay);
  }

  // 3. 标签指示器：显示闪烁黄点
  showTabSendDot(accountId);

  lockedAccounts.add(accountId);
}

/**
 * 解锁指定账号的 WebView 输入。
 * 发送完成后调用（必须放在 finally 中保证执行）。
 */
export async function unlockWebviewInput(accountId: string): Promise<void> {
  if (!lockedAccounts.has(accountId)) return;

  const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
  if (wrapper) {
    // 1. 移除 DOM 遮罩
    const overlay = wrapper.querySelector('.input-lock-overlay');
    if (overlay) {
      overlay.remove();
    }

    // 2. JS 层解锁
    const webview = wrapper.querySelector('webview') as any;
    if (webview && typeof webview.executeJavaScript === 'function') {
      try {
        await webview.executeJavaScript(UNLOCK_KEYBOARD_CODE);
      } catch {
        // 静默忽略
      }
    }
  }

  // 3. 标签指示器：移除闪烁黄点
  hideTabSendDot(accountId);

  lockedAccounts.delete(accountId);
}

/**
 * 检查指定账号的 WebView 是否已被锁定。
 */
export function isWebviewLocked(accountId: string): boolean {
  return lockedAccounts.has(accountId);
}
