/**
 * @file memory-optimizer.ts
 * @description 内存优化模块 - 仅保留DOM清理机制。
 * 已移除视频播放拦截和 blob 流阻断，避免导致画面无法显示与 V8 崩溃引发的账号刷新。
 */

export class MemoryOptimizer {
  private static isInitialized = false;
  private static prunerInterval: NodeJS.Timeout | null = null;

  public static initialize() {
    if (this.isInitialized) return;
    this.isInitialized = true;
    
    console.log('[MemoryOptimizer] Initializing DOM pruner (video interception disabled)...');

    // 【已移除】interceptVideoPlayback() 和 interceptBlobStreams()
    // 原因：拦截 HTMLVideoElement.play 和 blob setAttribute 导致画面完全无法显示，
    // 配合 V8 内存限制容易引发渲染进程崩溃 → 账号刷新 → 消息发送中断

    this.startDomPruner(8000, 60);
  }

  /**
   * DOM 定期清道夫机制（防止无限期挂机导致的内存泄漏和 V8 GC 停顿）
   * @param intervalMs 巡检间隔时间
   * @param maxNodes 保留的最大节点数量
   */
  private static startDomPruner(intervalMs: number, maxNodes: number) {
    if (this.prunerInterval) clearInterval(this.prunerInterval);

    this.prunerInterval = setInterval(() => {
      try {
        // 抖音常见的弹幕区域选择器 (应对混淆 hash)
        const chatContainers = document.querySelectorAll(
          '[class*="chatroom__items"], [class*="chat-room__list"], [data-e2e="chat-room-list"] div'
        );
        
        chatContainers.forEach(container => {
          if (container.children.length > maxNodes) {
            const toRemoveCount = container.children.length - maxNodes;
            for (let i = 0; i < toRemoveCount; i++) {
              if (container.firstElementChild) {
                container.firstElementChild.remove();
              }
            }
          }
        });
        
        // 清剿过多滞留的入场炫酷动画 canvas 与 DOM 残骸
        const animContainers = document.querySelectorAll('canvas, [class*="animation"]');
        if (animContainers.length > (maxNodes + 20)) {
          animContainers.forEach((el, index) => {
            if (index < animContainers.length - 30) el.remove();
          });
        }
      } catch (e) {
        console.error('[MemoryOptimizer] Pruning Error:', e);
      }
    }, intervalMs);
  }

  public static destroy() {
    if (this.prunerInterval) {
      clearInterval(this.prunerInterval);
      this.prunerInterval = null;
    }
  }
}
