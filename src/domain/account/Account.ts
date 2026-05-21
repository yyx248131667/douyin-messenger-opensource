/**
 * @file Account.ts
 * @description 账号领域模型。
 * 定义账号数据结构、状态机、以及分层管理（活跃/冷却/挂机）所需的元数据。
 */

export type AccountState = 'INIT' | 'LOGGED_IN' | 'OFFLINE' | 'LOCKED' | 'BLOCKED';

/**
 * 账号所处的管理分区：
 * - ACTIVE：活跃区，正在使用/查看
 * - COOLING：冷却区，已打开但未查看（启用节能）
 * - IDLE：挂机区，标签已关闭（不创建 webview，保留 partition 数据）
 */
export type AccountZone = 'ACTIVE' | 'COOLING' | 'IDLE';

export interface AccountData {
  id: string;
  name: string;
  url: string;
  isActive?: boolean;
  isLocked?: boolean;
  isClosed?: boolean;
  isDeleted?: boolean;

  // 持久化字段：用于恢复时精确还原上下文
  lastUrl?: string;         // 最后访问的 URL（恢复时导航到此页面）
  lastLoginAt?: number;     // 最后登录时间戳
  zone?: AccountZone;       // 当前所处分区
  crashCount?: number;      // 累计崩溃次数（用于健康度评估）
}

export class Account {
  public data: AccountData;
  public state: AccountState = 'INIT';
  private lastStateChangedAt: number = Date.now();

  constructor(data: AccountData) {
    this.data = data;
    // 从持久化的 isLocked 标记恢复锁定状态
    // 如果用户在上次使用时手动锁定了账号，重启后应保持锁定
    if (data.isLocked === true) {
      this.state = 'LOCKED';
    }
    // 其余情况从 INIT 开始，由 LoginObserver 实时检测后更新
    // 默认分区：如果标签关闭则为挂机区，否则为冷却区
    if (!data.zone) {
      data.zone = data.isClosed ? 'IDLE' : 'COOLING';
    }
  }

  public updateState(newState: AccountState) {
    if (this.state !== newState) {
      this.state = newState;
      this.lastStateChangedAt = Date.now();
      // 登录成功时记录时间戳
      if (newState === 'LOGGED_IN') {
        this.data.lastLoginAt = Date.now();
      }
    }
  }

  public get getState() {
    return this.state;
  }

  /**
   * 更新账号所在的管理分区
   */
  public setZone(zone: AccountZone) {
    this.data.zone = zone;
  }

  /**
   * 判断账号是否健康（崩溃次数未超阈值）
   */
  public isHealthy(): boolean {
    return (this.data.crashCount || 0) < 10;
  }

  /**
   * 获取上次状态变更至今的秒数
   */
  public getIdleDurationSeconds(): number {
    return Math.floor((Date.now() - this.lastStateChangedAt) / 1000);
  }
}
