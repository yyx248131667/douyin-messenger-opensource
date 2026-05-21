/**
 * @file risk.observer.ts
 * @description 防风控守护者
 * 负责自动监听 DOM 的变动并隐写“滑动验证码”、“风险提示”、“未成年人保护”、“升级提示”等阻塞式强提醒。
 * 不进行 API 交互，只做静态清除，恢复画面洁净，保证长效挂机不断联。
 */

import { BaseObserver } from '../core/base-observer';

export class RiskObserver extends BaseObserver {
  private observer: MutationObserver | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  
  // 商业级风控、挽留、拉新弹窗拦截特征库
  private readonly BLACKLIST_SELECTORS = [
    // 强制验证码、风险弹窗
    '.secsdk-captcha-container',
    '.captcha_verify_container',
    '.risk-alert-container',
    // 未成年人、防沉迷提示
    '#guard-teen-dialog',
    '.youth-mode-dialog',
    // 直播间各种干扰：升级粉丝团、领券、新手引导
    '.login-guide-container',
    '.download-app-guide',
    '.xgplayer-error',
    // 如果有遮罩层也一并移除防止 DOM “灰屏点击穿透失败”
    '.dy-account-overlay',
    '.bui-modal-mask',
    '.bui-dialog-mask',
    // 关播后的挽留弹窗 / 推荐弹窗
    '.webcast-live-end-recommend'
  ];

  protected onStart() {
    // 1. Initial cleanup on load
    this.cleanUpDOM();

    // 2. Continuous cleanup using MutationObserver
    this.observer = new MutationObserver((mutations) => {
      let shouldClean = false;
      for (const mutation of mutations) {
        if (mutation.addedNodes.length > 0) {
          shouldClean = true;
          break;
        }
      }
      if (shouldClean) {
        this.cleanUpDOM();
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // 3. Fallback Heartbeat (应对非常狡猾且避开了 Mutation 的 ShadowDOM 等机制)
    this.intervalId = setInterval(() => {
       this.cleanUpDOM();
    }, 15000); // 15秒兜底扫描一次
  }

  protected onStop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private isSolvingCaptcha = false;

  private async autoSolveCaptcha(container: HTMLElement) {
    if (this.isSolvingCaptcha) return;
    this.isSolvingCaptcha = true;
    try {
      console.log('[RiskObserver] 🤖 检测到滑块验证，通知主进程跨域破解...');
      
      // 跨域 iframe 无法在 preload 中直接读取 DOM，通过 IPC 交给主进程寻找对应的 webContents frame
      const { ipcRenderer } = require('electron');
      ipcRenderer.send('solve-iframe-captcha');
      
      // 等待主进程破解验证结果
      await this.wait(5000);
      console.log('[RiskObserver] 主进程滑块操作指令发送完毕');
    } catch (e) {
      console.error('[RiskObserver] 自动滑块发生异常', e);
    } finally {
      this.isSolvingCaptcha = false;
    }
  }

  private wait(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private cleanUpDOM() {
    let removed = 0;

    // 1. 优先扫描独立的验证码 iframe
    const allIframes = document.querySelectorAll('iframe');
    for (let i = 0; i < allIframes.length; i++) {
        const src = allIframes[i].src || '';
        if (src.includes('rmc.bytedance.com') || src.includes('captcha') || src.includes('verify.snssdk.com')) {
            if (!this.isSolvingCaptcha) {
                this.autoSolveCaptcha(allIframes[i] as HTMLElement);
            }
            // 不要移除验证码iframe
        }
    }

    // 2. 扫描黑名单
    this.BLACKLIST_SELECTORS.forEach((selector) => {
      const nodes = document.querySelectorAll(selector);
      nodes.forEach((node) => {
        try {
          // 如果是验证码，则拦截并自动处理，而不是直接删除
          if (selector === '.secsdk-captcha-container' || selector === '.captcha_verify_container' || selector === '#captcha_container') {
             if (!this.isSolvingCaptcha) {
                this.autoSolveCaptcha(node as HTMLElement);
             }
             return; // 跳过删除
          }

          // 如果该节点内包含验证码iframe，也不要删除！
          const iframes = (node as HTMLElement).querySelectorAll?.('iframe');
          if (iframes) {
             for (let i = 0; i < iframes.length; i++) {
                const src = iframes[i].src || '';
                if (src.includes('rmc.bytedance.com') || src.includes('captcha') || src.includes('verify.snssdk.com')) {
                   if (!this.isSolvingCaptcha) {
                      this.autoSolveCaptcha(iframes[i] as HTMLElement);
                   }
                   return; // 跳过删除
                }
             }
          }

          (node as HTMLElement).style.display = 'none'; // 先软隐蔽防闪烁
          node.parentNode?.removeChild(node);
          removed++;
        } catch (e) {}
      });
    });

    if (removed > 0) {
      console.log(`[RiskObserver] 🧹 侦测到并清除了 ${removed} 个干扰型风控弹窗。`);
    }

    // 处理特殊异常：如果body被锁定不可滚动，强制解锁
    if (document.body.style.overflow === 'hidden' && removed > 0) {
      document.body.style.overflow = 'auto';
    }
  }
}
