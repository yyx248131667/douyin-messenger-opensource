/**
 * @file lucky-bag.observer.ts
 * @description 福袋自动检测与领取。
 *
 * 抖音直播间福袋的 DOM 结构会随版本更新变化，
 * 本模块使用多层宽泛选择器 + MutationObserver + 定时轮询兜底。
 *
 * 关键修复：
 * 1. 不依赖 offsetParent 判断可见性（shield CSS 隐藏父级时 offsetParent === null）
 * 2. 使用 getBoundingClientRect 的宽高 > 0 作为唯一可见性判断
 * 3. 增加 IPC 上报让 lottery 窗口能追踪检测结果
 */

import { BaseObserver } from '../core/base-observer';
import { ClaimLuckyBagOperation } from '../operations/claim-lucky-bag.operation';
import { ipcRenderer } from 'electron';

function logToMain(msg: string): void {
  console.log(msg);
  try { ipcRenderer.send('log-message', msg); } catch (e) {}
}

export class LuckyBagObserver extends BaseObserver {
  private observer: MutationObserver | null = null;
  private processedBags = new Set<string>();
  private checkTimer: ReturnType<typeof setInterval> | null = null;

  /** 福袋可能出现的 DOM 选择器（按优先级排列） */
  private static readonly BAG_SELECTORS: string[] = [
    // E2E 标签（最稳定，抖音测试框架使用的标签）
    'div[data-e2e="interactive-component-treasure-box"]',
    'div[data-e2e="interactive-component-lucky-bag"]',
    'div[data-e2e="treasure-box"]',
    'div[data-e2e="lucky-bag"]',
    // 类名模糊匹配（覆盖混淆后的哈希类名）
    'div[class*="TreasureBox"]',
    'div[class*="treasureBox"]',
    'div[class*="treasure-box"]',
    'div[class*="LuckyBag"]',
    'div[class*="luckyBag"]',
    'div[class*="lucky-bag"]',
    'div[class*="lucky_bag"]',
    // 旧版精确类名
    '.ycjwPFJI',
    '.redpacket',
    // 容器内查找
    '#ShortTouchLayout div[class*="treasure"]',
    '#ShortTouchLayout div[class*="lucky"]',
    '#ShortTouchLayout div[class*="Treasure"]',
    '#ShortTouchLayout div[class*="Lucky"]',
    // 互动组件区域泛匹配
    'div[class*="InteractiveComponent"] div[class*="treasure"]',
    'div[class*="InteractiveComponent"] div[class*="lucky"]',
    'div[class*="interactive-component"] div[class*="treasure"]',
    'div[class*="interactive-component"] div[class*="lucky"]',
  ];

  /** 可能的福袋父容器类名前缀 */
  private static readonly CONTAINER_SELECTORS: string[] = [
    '.LMUtLyr9',
    '.dVxrjT_h',
    'div[class*="InteractiveComponent"]',
    'div[class*="interactive-component"]',
  ];

  protected onStart(): void {
    logToMain('[LuckyBagObserver] 🎁 福袋检测器启动...');

    const checkAndClaim = (): void => {
      const foundBagElement = this.findBagElement();
      if (!foundBagElement) return;

      const bagId = this.generateBagId(foundBagElement);
      if (this.processedBags.has(bagId)) return;

      this.processedBags.add(bagId);
      logToMain(`[LuckyBagObserver] 🎁 捕获福袋: ${bagId}`);

      // 通知 lottery 窗口
      try {
        ipcRenderer.send('page-action', {
          accountId: this.accountId,
          action: 'lucky-bag-found',
          payload: { bagId }
        });
      } catch (e) {}

      const operation = new ClaimLuckyBagOperation();
      operation.execute(foundBagElement).catch(err => {
        logToMain(`[LuckyBagObserver] 福袋领取失败: ${err.message}`);
      });
    };

    // MutationObserver 监控 DOM 变化
    this.observer = new MutationObserver(() => {
      requestAnimationFrame(checkAndClaim);
    });

    const target = document.querySelector('.webcast-chatroom')
                || document.querySelector('#ShortTouchLayout')
                || document.body;
    this.observer.observe(target, { childList: true, subtree: true });

    // 定时轮询兜底（某些福袋可能不触发 mutation）
    this.checkTimer = setInterval(checkAndClaim, 3000);

    // 初始扫描
    checkAndClaim();

    // 定期清理过期的已处理记录（防止内存持续增长）
    setInterval(() => {
      if (this.processedBags.size > 100) {
        this.processedBags.clear();
        logToMain('[LuckyBagObserver] 已清理过期福袋记录');
      }
    }, 300000); // 每5分钟清理一次
  }

  /**
   * 在 DOM 中搜索福袋元素
   * 不依赖 offsetParent（shield CSS 会导致其为 null），
   * 仅使用 getBoundingClientRect 判断可见性。
   */
  private findBagElement(): HTMLElement | null {
    for (const selector of LuckyBagObserver.BAG_SELECTORS) {
      try {
        const els = document.querySelectorAll(selector);
        for (let i = 0; i < els.length; i++) {
          const el = els[i] as HTMLElement;
          const rect = el.getBoundingClientRect();

          // 仅要求宽高 > 0（即使被 shield CSS 的父级 display:none 影响，
          // 只要福袋本身有实际布局大小即可认为存在）
          if (rect.width > 0 && rect.height > 0) {
            // 向上找可点击的父容器
            const container = this.findClickableContainer(el);
            return container;
          }

          // 降级：即使 rect 为 0（可能被隐藏），只要 DOM 节点存在且有内容，也尝试处理
          if (el.innerHTML && el.innerHTML.length > 10) {
            const style = window.getComputedStyle(el);
            // 如果是 visibility:hidden 或 opacity:0 但 display 不是 none，可能是被 shield 覆盖
            if (style.display !== 'none') {
              const container = this.findClickableContainer(el);
              return container;
            }
          }
        }
      } catch (e) {
        // 忽略选择器执行异常
      }
    }

    return null;
  }

  /**
   * 向上查找可点击的父容器
   */
  private findClickableContainer(el: HTMLElement): HTMLElement {
    for (const containerSelector of LuckyBagObserver.CONTAINER_SELECTORS) {
      const container = el.closest(containerSelector) as HTMLElement | null;
      if (container) return container;
    }
    return el;
  }

  /**
   * 生成福袋唯一标识（用于去重）
   */
  private generateBagId(el: HTMLElement): string {
    const dataId = el.getAttribute('data-id');
    if (dataId) return `id_${dataId}`;

    const e2e = el.getAttribute('data-e2e');
    if (e2e) return `e2e_${e2e}_${Date.now()}`;

    const className = (el.className || '').substring(0, 40);
    const rect = el.getBoundingClientRect();
    return `cls_${className}_${Math.round(rect.top)}_${Math.round(rect.left)}`;
  }

  protected onStop(): void {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = null;
    }
    logToMain('[LuckyBagObserver] 福袋检测器已停止');
  }
}
