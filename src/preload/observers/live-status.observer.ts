/**
 * @file live-status.observer.ts
 * @description Listens for the HTML UI signals corresponding to a live stream crash, closure, or host leaving.
 * 
 * 检测策略（三层冗余）：
 * 1. RENDER_DATA 解析：从页面 HTML 中提取 status 字段（最精准但可能因页面变更失效）
 * 2. DOM 文本检测：扫描页面中的"直播已结束"等可见文字（用户所见即所得）
 * 3. 聊天输入框消失检测：直播结束后聊天输入框会被移除
 */

import { BaseObserver } from '../core/base-observer';
import { IpcChannels } from '../../main/ipc/channels';

/** 已知的下播 DOM 文本标记 */
const OFFLINE_TEXT_MARKERS = [
  '直播已结束',
  '主播已离开',
  '直播间已关闭',
  '该直播已结束',
  '直播已关闭',
  '暂时离开'
];

export class LiveStatusObserver extends BaseObserver {
  private pollingTimer: NodeJS.Timeout | null = null;
  private currentStatus: number | null = null;
  private domOfflineConfirmCount: number = 0;
  /** DOM 连续确认阈值：连续 2 次检测到下播文本才确认（防止页面加载中的闪烁误判） */
  private readonly DOM_CONFIRM_THRESHOLD = 2;

  protected onStart() {
    const checkLiveStatus = async () => {
      try {
        const url = location.href;
        if (!url.includes('live.douyin.com')) return;

        let isOfflineDetected = false;
        let detectionSource = '';

        // ====== 策略 1：RENDER_DATA 解析 ======
        try {
          const res = await fetch(url, { cache: 'no-store' });
          const html = await res.text();

          const match = html.match(/id="RENDER_DATA"[^>]*>([\s\S]+?)<\/script>/);
          if (match && match[1]) {
            const jsonStr = decodeURIComponent(match[1]);
            const data = JSON.parse(jsonStr);

            const status = data?.app?.initialState?.roomStore?.roomInfo?.room?.status;
            if (status !== undefined) {
              // status === 2 means Living (开播)
              // status === 4 means Ended (下播)
              const isLiving = status === 2;

              if (this.currentStatus !== status) {
                this.currentStatus = status;
                console.log(`[LiveStatusObserver] Live status changed to: ${status} (Living: ${isLiving}) for ${this.accountId}`);
              }

              if (!isLiving) {
                isOfflineDetected = true;
                detectionSource = `RENDER_DATA(status=${status})`;
              }
            }
          }
        } catch (fetchErr) {
          console.warn(`[LiveStatusObserver] RENDER_DATA fetch failed:`, fetchErr);
          // fetch 失败不意味着下播，跳过此策略继续检测
        }

        // 获取页面文本（供策略 2 和策略 3 共用）
        const bodyText = document.body?.innerText || '';

        // ====== 策略 2：DOM 文本扫描 ======
        if (!isOfflineDetected) {
          for (const marker of OFFLINE_TEXT_MARKERS) {
            if (bodyText.includes(marker)) {
              isOfflineDetected = true;
              detectionSource = `DOM文本("${marker}")`;
              break;
            }
          }
        }

        // ====== 策略 3：聊天输入框消失检测 ======
        if (!isOfflineDetected) {
          const chatSelectors = [
            'div[data-e2e="living-chat-input"]',
            'div[contenteditable="true"][data-e2e*="chat"]'
          ];
          const hasChat = chatSelectors.some(sel => {
            try {
              const el = document.querySelector(sel);
              return el && (el as HTMLElement).offsetParent !== null;
            } catch {
              return false;
            }
          });

          // 只有在页面完全加载后才以"无聊天框"作为辅助信号
          if (!hasChat && document.readyState === 'complete') {
            // 聊天框消失是弱信号，需结合其他条件；这里仅作为辅助增强 DOM 文本检测
            // 如果页面标题包含"直播"但聊天框消失了，大概率是下播
            const titleIndicatesLive = document.title.includes('直播');
            if (titleIndicatesLive) {
              // 弱信号，仅在 DOM 文本也部分匹配时才确认
              const partialTextMatch = bodyText && (bodyText.includes('结束') || bodyText.includes('离开'));
              if (partialTextMatch) {
                isOfflineDetected = true;
                detectionSource = '聊天框消失+文本辅助';
              }
            }
          }
        }

        // ====== 综合判定 ======
        if (isOfflineDetected) {
          this.domOfflineConfirmCount++;
          console.log(`[LiveStatusObserver] 下播检测 (${detectionSource})，连续确认: ${this.domOfflineConfirmCount}/${this.DOM_CONFIRM_THRESHOLD}`);

          if (this.domOfflineConfirmCount >= this.DOM_CONFIRM_THRESHOLD) {
            console.log(`[LiveStatusObserver] ✅ 确认下播: ${detectionSource}，发送停止信号`);

            // 向主进程发送下播信号
            this.commitStateWithDebounce(IpcChannels.ACCOUNT_STATE_CHANGE, false, 1.0, {
              stateOverride: 'LOCKED',
              source: 'live-status-observer'
            });
            // 直接发送下播通知
            require('electron').ipcRenderer.send(IpcChannels.LIVE_STATUS_OFFLINE, { accountId: this.accountId });

            // 重置计数器，防止重复发送
            this.domOfflineConfirmCount = 0;
          }
        } else {
          // 在线状态，重置连续确认计数
          this.domOfflineConfirmCount = 0;
        }
      } catch (err) {
        console.warn(`[LiveStatusObserver] Fetch check error:`, err);
      }
    };

    // 初始检测并设置 15 秒轮询（从 20 秒缩短到 15 秒，加快下播检测响应速度）
    checkLiveStatus();
    this.pollingTimer = setInterval(() => {
      this.runSecureCheck(() => {
        checkLiveStatus();
        return undefined;
      });
    }, 15000);
  }

  protected onStop() {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.currentStatus = null;
    this.domOfflineConfirmCount = 0;
  }
}
