/**
 * @file heartbeat-keeper.ts
 * @description 心跳保活机制 — 防止抖音 Sec-SDK 判定为机器人。
 * 
 * 核心原理：
 * 抖音的风控 SDK 会监测用户行为指纹（鼠标移动、滚动、点击频率等），
 * 长时间无交互的 WebView 会被标记为"非活跃/机器人"，导致 Cookie 失效。
 * 
 * 本模块在每个 webview 的 preload 层注入，定期模拟随机化的人类行为：
 * - 随机鼠标移动（贝塞尔曲线轨迹）
 * - 随机页面滚动（微小幅度）
 * - 随机间隔（30s~120s），避免固定节奏被识别
 * - 可视区域内的随机坐标，避免越界
 */

export class HeartbeatKeeper {
  private timer: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private actionCount: number = 0;

  // 心跳间隔范围（毫秒）：3-5分钟，拟人化随机
  private readonly MIN_INTERVAL = 180000;
  private readonly MAX_INTERVAL = 300000;

  /**
   * 启动心跳保活循环
   */
  public start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('[HeartbeatKeeper] 💓 启动心跳保活（防 Sec-SDK 机器人检测）');
    this.scheduleNextBeat();
  }

  /**
   * 停止心跳保活
   */
  public stop() {
    this.isRunning = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    console.log('[HeartbeatKeeper] 停止心跳保活');
  }

  /**
   * 调度下一次心跳
   */
  private scheduleNextBeat() {
    if (!this.isRunning) return;

    const interval = this.randomBetween(this.MIN_INTERVAL, this.MAX_INTERVAL);
    
    this.timer = setTimeout(() => {
      this.performBeat();
      this.scheduleNextBeat(); // 递归调度下一次
    }, interval);
  }

  /**
   * 执行一次心跳行为（随机选择一种拟人操作）
   */
  private performBeat() {
    if (!this.isRunning) return;

    this.actionCount++;
    const actionType = this.randomBetween(0, 100);

    try {
      if (actionType < 40) {
        // 40% 概率：模拟鼠标移动
        this.simulateMouseMove();
      } else if (actionType < 70) {
        // 30% 概率：模拟微小滚动
        this.simulateScroll();
      } else if (actionType < 85) {
        // 15% 概率：模拟鼠标悬停（移动到随机位置并停留）
        this.simulateMouseHover();
      } else {
        // 15% 概率：模拟焦点切换（tabindex 元素间切换）
        this.simulateFocusShift();
      }
    } catch (e) {
      // 静默处理，不因心跳异常影响主业务
    }
  }

  /**
   * 模拟鼠标移动 — 使用多点贝塞尔路径模拟人类非直线轨迹
   */
  private simulateMouseMove() {
    const viewWidth = window.innerWidth || 1200;
    const viewHeight = window.innerHeight || 800;

    // 起点：当前视口中的随机位置
    const startX = this.randomBetween(100, viewWidth - 100);
    const startY = this.randomBetween(100, viewHeight - 100);

    // 终点：起点附近的随机偏移（50~200px 范围）
    const endX = Math.min(viewWidth - 50, Math.max(50, startX + this.randomBetween(-200, 200)));
    const endY = Math.min(viewHeight - 50, Math.max(50, startY + this.randomBetween(-150, 150)));

    // 控制点：制造曲线轨迹
    const cpX = (startX + endX) / 2 + this.randomBetween(-80, 80);
    const cpY = (startY + endY) / 2 + this.randomBetween(-80, 80);

    // 沿贝塞尔曲线生成 5~8 个中间点
    const steps = this.randomBetween(5, 8);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = Math.round((1 - t) * (1 - t) * startX + 2 * (1 - t) * t * cpX + t * t * endX);
      const y = Math.round((1 - t) * (1 - t) * startY + 2 * (1 - t) * t * cpY + t * t * endY);

      // 使用 setTimeout 模拟时间间隔，让事件看起来像人类移动速度
      setTimeout(() => {
        this.dispatchMouseEvent('mousemove', x, y);
      }, i * this.randomBetween(15, 40));
    }
  }

  /**
   * 模拟页面微小滚动 — 模仿人类无意识的页面浏览
   */
  private simulateScroll() {
    const scrollAmount = this.randomBetween(-80, 80); // 微小幅度
    const chatList = document.querySelector('[class*="chatroom"], [data-e2e="chat-room-list"]');

    if (chatList) {
      // 优先滚动弹幕区域（更贴近真实行为）
      chatList.scrollTop += scrollAmount;
    } else {
      // 回退到页面滚动
      window.scrollBy({
        top: scrollAmount,
        behavior: 'smooth'
      });
    }
  }

  /**
   * 模拟鼠标悬停 — 移动到某个 DOM 元素附近并触发 hover 效果
   */
  private simulateMouseHover() {
    // 找到页面上可交互的元素
    const interactiveElements = document.querySelectorAll(
      'button, a, [class*="tab"], [class*="item"], [class*="avatar"]'
    );

    if (interactiveElements.length === 0) return;

    const target = interactiveElements[this.randomBetween(0, interactiveElements.length - 1)] as HTMLElement;
    const rect = target.getBoundingClientRect();
    
    if (rect.width === 0 || rect.height === 0) return; // 不可见元素

    const x = Math.round(rect.left + rect.width * Math.random());
    const y = Math.round(rect.top + rect.height * Math.random());

    this.dispatchMouseEvent('mouseenter', x, y, target);
    this.dispatchMouseEvent('mouseover', x, y, target);

    // 300~800ms 后移开（模拟短暂悬停）
    setTimeout(() => {
      this.dispatchMouseEvent('mouseleave', x + 10, y + 10, target);
    }, this.randomBetween(300, 800));
  }

  /**
   * 模拟焦点切换 — 触发 document focus/blur 事件
   */
  private simulateFocusShift() {
    // 简单的 visibility 状态抖动，让 Sec-SDK 认为用户在操作
    document.dispatchEvent(new Event('visibilitychange'));
    
    // 100-300ms 后触发一次 focus
    setTimeout(() => {
      window.dispatchEvent(new FocusEvent('focus'));
    }, this.randomBetween(100, 300));
  }

  /**
   * 分发标准化的鼠标事件
   */
  private dispatchMouseEvent(type: string, x: number, y: number, target?: EventTarget | null) {
    const event = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window,
      clientX: x,
      clientY: y,
      screenX: x,
      screenY: y
    });
    (target || document.elementFromPoint(x, y) || document.body).dispatchEvent(event);
  }

  /**
   * 生成 [min, max] 范围内的随机整数
   */
  private randomBetween(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  /**
   * 获取心跳统计（供监控仪表盘使用）
   */
  public getStats() {
    return {
      isRunning: this.isRunning,
      actionCount: this.actionCount
    };
  }
}

/**
 * 全局单例，在 preload 层自动初始化
 */
let heartbeatInstance: HeartbeatKeeper | null = null;

export function initHeartbeat(): HeartbeatKeeper {
  if (!heartbeatInstance) {
    heartbeatInstance = new HeartbeatKeeper();
    heartbeatInstance.start();
  }
  return heartbeatInstance;
}

// 暴露到 window 上，供 webview-controller 远程控制
(window as any).HeartbeatKeeper = {
  start: () => {
    if (!heartbeatInstance) heartbeatInstance = new HeartbeatKeeper();
    heartbeatInstance.start();
  },
  stop: () => heartbeatInstance?.stop(),
  getStats: () => heartbeatInstance?.getStats() || { isRunning: false, actionCount: 0 }
};
