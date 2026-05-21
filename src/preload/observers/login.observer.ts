/**
 * @file login.observer.ts
 * @description 监听平台账号的登录状态并同步给底层系统
 */

import { DouyinSelectors } from '../../shared/constants/selectors';
import { BaseObserver } from '../core/base-observer';

export class LoginObserver extends BaseObserver {
  private intervalId: NodeJS.Timeout | null = null;
  private lastState: boolean | null = null;

  protected onStart() {
    this.intervalId = setInterval(() => {
      this.runSecureCheck(() => {
        const isLogged = this.checkIsLoggedIn();
        
        // 使用基类的防抖检测提交流水线，防闪烁
        this.commitStateWithDebounce('account-state-change', isLogged, 1.0, {
           source: 'login-observer'
        });
        
        return isLogged; // 暂存状态以备观测记录
      });
    }, this.config.checkInterval || 2000);
  }

  protected onStop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      this.lastState = null;
    }
  }

  private checkIsLoggedIn(): boolean {
    const domReady = document.readyState === 'complete' || document.readyState === 'interactive';
    const apiReady = typeof window.fetch === 'function';

    // 检查是否有明确的未登录按钮（如有，则必定没有登录）
    let hasLoginButton = false;
    for (const sel of DouyinSelectors.login.loginBtn) {
      try {
        const el = document.querySelector(sel);
        if (el && (el as HTMLElement).offsetParent !== null) {
          hasLoginButton = true;
          break;
        }
      } catch (e) {
        // ignore invalid selectors like :contains
      }
    }

    if (hasLoginButton) {
      return false;
    }

    if ((window as any)._apiSendFailedWith20003 === true) {
      this.lastState = false; // 断开残留缓存
      return false;
    }

    const isLoggedIn = domReady && apiReady;
    
    if (isLoggedIn) {
       this.lastState = true;
    }

    return isLoggedIn || (this.lastState === true);
  }
}
