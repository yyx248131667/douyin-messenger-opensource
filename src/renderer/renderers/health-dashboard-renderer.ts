/**
 * @file health-dashboard-renderer.ts
 * @description 账号健康度仪表盘 — 展示每个账号的运行状态、崩溃次数、分区信息、心跳状态等。
 * 
 * 设计风格：白底卡片式布局，与现有 UI 保持一致。
 * 数据实时刷新：打开面板后每 3 秒自动更新。
 */

import { AccountController } from '../controllers/account-controller';
import { ipcRenderer } from 'electron';
import { Account, AccountZone } from '../../domain/account/Account';
import { IpcChannels } from '../../main/ipc/channels';

export class HealthDashboardRenderer {
  private accountController: AccountController;
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor(accountController: AccountController) {
    this.accountController = accountController;
  }

  public initialize(triggerBtnId: string) {
    const btn = document.getElementById(triggerBtnId);
    if (btn) {
      btn.addEventListener('click', () => this.openDashboard());
    }
  }

  private openDashboard() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-health-dashboard';

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 800px; min-height: 500px;">
        <div class="modal-header" style="background: #f8f9fa; border-bottom: 1px solid #eee;">
          <div class="modal-title" style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;"></span>
            <span style="font-weight: bold; font-size: 15px; color: #333;">账号健康度仪表盘</span>
            <span id="dashboard-network-badge" style="margin-left: 12px; font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #f6ffed; color: #52c41a; border: 1px solid #b7eb8f;">在线</span>
          </div>
          <span class="modal-close" id="btn-close-health-dashboard" style="cursor: pointer; font-size: 20px; color: #999;">&times;</span>
        </div>
        <div class="modal-body" style="background: #fff; padding: 0;">

          <!-- 顶部统计概览 -->
          <div id="dashboard-overview" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border-bottom: 1px solid #f0f0f0;">
          </div>

          <!-- 账号列表 -->
          <div style="padding: 16px;">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
              <span style="font-weight: bold; font-size: 13px; color: #666;">各账号详细状态</span>
              <span id="dashboard-refresh-indicator" style="font-size: 11px; color: #bbb;">实时刷新中...</span>
            </div>
            <div id="dashboard-account-list" style="max-height: 380px; overflow-y: auto;">
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 绑定关闭按钮
    document.getElementById('btn-close-health-dashboard')?.addEventListener('click', () => {
      this.closeDashboard(overlay);
    });

    // 首次渲染
    this.renderDashboard();

    // 每 3 秒自动刷新
    this.refreshTimer = setInterval(() => {
      this.renderDashboard();
    }, 3000);
  }

  private closeDashboard(overlay: HTMLElement) {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    overlay.remove();
  }

  private async renderDashboard() {
    const accounts = this.accountController.getAccounts();
    
    // 获取网络状态
    let networkState = 'ONLINE';
    try {
      networkState = await ipcRenderer.invoke(IpcChannels.GET_NETWORK_STATE);
    } catch(e) {}

    this.renderOverview(accounts, networkState);
    this.renderNetworkBadge(networkState);
    this.renderAccountList(accounts);
  }

  /**
   * 渲染顶部统计概览（4个指标卡片）
   */
  private renderOverview(accounts: Account[], networkState: string) {
    const overviewEl = document.getElementById('dashboard-overview');
    if (!overviewEl) return;

    const totalCount = accounts.length;
    const activeCount = accounts.filter(a => !a.data.isClosed && !a.data.isDeleted).length;
    const loggedInCount = accounts.filter(a => a.state === 'LOGGED_IN').length;
    const totalCrashes = accounts.reduce((sum, a) => sum + (a.data.crashCount || 0), 0);

    const cards = [
      { 
        label: '总账号', 
        value: totalCount, 
        icon: '', 
        color: '#1890ff',
        bgGradient: 'linear-gradient(135deg, #e6f7ff 0%, #bae7ff 100%)'
      },
      { 
        label: '活跃中', 
        value: activeCount, 
        icon: '', 
        color: '#52c41a',
        bgGradient: 'linear-gradient(135deg, #f6ffed 0%, #d9f7be 100%)'
      },
      { 
        label: '已登录', 
        value: loggedInCount, 
        icon: '', 
        color: '#13c2c2',
        bgGradient: 'linear-gradient(135deg, #e6fffb 0%, #b5f5ec 100%)'
      },
      { 
        label: '累计崩溃', 
        value: totalCrashes, 
        icon: '', 
        color: totalCrashes > 10 ? '#ff4d4f' : '#faad14',
        bgGradient: totalCrashes > 10 
          ? 'linear-gradient(135deg, #fff1f0 0%, #ffa39e 100%)' 
          : 'linear-gradient(135deg, #fffbe6 0%, #ffe58f 100%)'
      },
    ];

    overviewEl.innerHTML = cards.map(card => `
      <div style="padding: 16px 20px; background: ${card.bgGradient}; text-align: center; border-right: 1px solid rgba(0,0,0,0.04);">
        <div style="font-size: 20px; margin-bottom: 4px;">${card.icon}</div>
        <div style="font-size: 24px; font-weight: bold; color: ${card.color};">${card.value}</div>
        <div style="font-size: 11px; color: #8c8c8c; margin-top: 2px;">${card.label}</div>
      </div>
    `).join('');
  }

  /**
   * 渲染网络状态徽章
   */
  private renderNetworkBadge(networkState: string) {
    const badge = document.getElementById('dashboard-network-badge');
    if (!badge) return;

    const stateMap: Record<string, { text: string; bg: string; color: string; border: string }> = {
      'ONLINE': { text: '网络正常', bg: '#f6ffed', color: '#52c41a', border: '#b7eb8f' },
      'DEGRADED': { text: '网络波动', bg: '#fffbe6', color: '#faad14', border: '#ffe58f' },
      'OFFLINE': { text: '网络断开', bg: '#fff1f0', color: '#ff4d4f', border: '#ffa39e' }
    };

    const s = stateMap[networkState] || stateMap['ONLINE'];
    badge.textContent = s.text;
    badge.style.background = s.bg;
    badge.style.color = s.color;
    badge.style.border = `1px solid ${s.border}`;
  }

  /**
   * 渲染账号列表（每个账号一个健康度卡片）
   */
  private renderAccountList(accounts: Account[]) {
    const listEl = document.getElementById('dashboard-account-list');
    if (!listEl) return;

    if (accounts.length === 0) {
      listEl.innerHTML = `
        <div style="text-align: center; padding: 40px; color: #bbb;">
          暂无账号数据
        </div>
      `;
      return;
    }

    listEl.innerHTML = accounts.map(acc => this.renderAccountCard(acc)).join('');

    // 绑定心跳控制按钮事件
    listEl.querySelectorAll('.btn-heartbeat-toggle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const target = e.currentTarget as HTMLElement;
        const accountId = target.getAttribute('data-id');
        if (!accountId) return;
        this.toggleHeartbeat(accountId);
      });
    });
  }

  /**
   * 渲染单个账号的健康度卡片
   */
  private renderAccountCard(acc: Account): string {
    const zoneBadge = this.getZoneBadge(acc.data.zone || 'IDLE');
    const stateBadge = this.getStateBadge(acc.state);
    const crashInfo = this.getCrashInfo(acc.data.crashCount || 0);
    const loginTime = this.formatLoginTime(acc.data.lastLoginAt);
    const isHealthy = acc.isHealthy();
    const idleDuration = acc.getIdleDurationSeconds();

    // 健康度评分（0~100）
    const healthScore = this.calculateHealthScore(acc);
    const healthColor = healthScore >= 80 ? '#52c41a' : healthScore >= 50 ? '#faad14' : '#ff4d4f';
    const healthBarWidth = Math.max(5, healthScore);

    return `
      <div style="
        padding: 12px 16px; 
        border: 1px solid ${isHealthy ? '#f0f0f0' : '#ffa39e'}; 
        border-radius: 8px; 
        margin-bottom: 8px; 
        background: ${acc.data.isDeleted ? '#fafafa' : '#fff'};
        transition: all 0.2s;
        ${acc.data.isDeleted ? 'opacity: 0.6;' : ''}
      ">
        <!-- 第一行：名称 + 状态标签 -->
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-weight: bold; font-size: 13px; color: #333;">${acc.data.name || acc.data.id.substring(0, 10)}</span>
            ${stateBadge}
            ${zoneBadge}
            ${acc.data.isDeleted ? '<span style="font-size:10px; padding:1px 6px; background:#fff1f0; color:#ff4d4f; border-radius:8px; border:1px solid #ffa39e;">已删除</span>' : ''}
          </div>
          <div style="display: flex; align-items: center; gap: 6px;">
            <span style="font-size: 11px; color: ${healthColor}; font-weight: bold;">${healthScore}分</span>
            <button class="btn-heartbeat-toggle" data-id="${acc.data.id}" style="
              border: 1px solid #d9d9d9; 
              background: #fafafa; 
              padding: 2px 8px; 
              border-radius: 4px; 
              font-size: 10px; 
              cursor: pointer;
              color: #666;
              transition: all 0.2s;
            " title="切换心跳保活">心跳</button>
          </div>
        </div>

        <!-- 第二行：健康度进度条 -->
        <div style="height: 4px; background: #f5f5f5; border-radius: 2px; overflow: hidden; margin-bottom: 8px;">
          <div style="height: 100%; width: ${healthBarWidth}%; background: ${healthColor}; border-radius: 2px; transition: width 0.5s ease;"></div>
        </div>

        <!-- 第三行：详细指标 -->
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; font-size: 11px;">
          <div style="text-align: center;">
            <div style="color: #bbb; margin-bottom: 2px;">崩溃次数</div>
            <div style="color: ${crashInfo.color}; font-weight: bold;">${crashInfo.icon} ${acc.data.crashCount || 0}</div>
          </div>
          <div style="text-align: center;">
            <div style="color: #bbb; margin-bottom: 2px;">最后登录</div>
            <div style="color: #666;">${loginTime}</div>
          </div>
          <div style="text-align: center;">
            <div style="color: #bbb; margin-bottom: 2px;">空闲时长</div>
            <div style="color: #666;">${this.formatDuration(idleDuration)}</div>
          </div>
          <div style="text-align: center;">
            <div style="color: #bbb; margin-bottom: 2px;">分区 ID</div>
            <div style="color: #999; font-family: monospace; font-size: 10px;" title="${acc.data.id}">${acc.data.id.length > 12 ? acc.data.id.substring(0, 12) + '…' : acc.data.id}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * 计算账号健康度评分（0~100）
   * 
   * 标准：正常登录 + 正常发送消息 = 满分 100
   * 扣分项只来自异常状态（崩溃、离线、删除、锁定）
   */
  private calculateHealthScore(acc: Account): number {
    let score = 100;

    // 已删除：直接归零
    if (acc.data.isDeleted) {
      return 0;
    }

    // 基于 state 统一扣分（state 是运行时唯一事实来源）
    switch (acc.state) {
      case 'LOGGED_IN':
        // 正常登录在线 → 不扣分
        break;
      case 'INIT':
      case 'OFFLINE':
        // 未登录或初始化中 → 轻度扣分
        score -= 20;
        break;
      case 'LOCKED':
      case 'BLOCKED':
        // 锁定或封禁 → 严重扣分
        score -= 50;
        break;
    }

    // 崩溃扣分：每次 -5 分，最多扣 30 分
    const crashPenalty = Math.min(30, (acc.data.crashCount || 0) * 5);
    score -= crashPenalty;

    return Math.max(0, Math.min(100, score));
  }

  /**
   * 获取分区（Zone）徽章 HTML
   */
  private getZoneBadge(zone: AccountZone | string): string {
    const zoneMap: Record<string, { text: string; bg: string; color: string; border: string }> = {
      'ACTIVE':  { text: '活跃区', bg: '#fff7e6', color: '#fa8c16', border: '#ffd591' },
      'COOLING': { text: '冷却区', bg: '#e6f7ff', color: '#1890ff', border: '#91d5ff' },
      'IDLE':    { text: '挂机区', bg: '#f5f5f5', color: '#8c8c8c', border: '#d9d9d9' }
    };

    const z = zoneMap[zone] || zoneMap['IDLE'];
    return `<span style="font-size:10px; padding:1px 6px; background:${z.bg}; color:${z.color}; border-radius:8px; border:1px solid ${z.border};">${z.text}</span>`;
  }

  /**
   * 获取状态徽章 HTML
   */
  private getStateBadge(state: string): string {
    const stateMap: Record<string, { text: string; bg: string; color: string; border: string }> = {
      'INIT':      { text: '初始化',  bg: '#f5f5f5', color: '#8c8c8c', border: '#d9d9d9' },
      'LOGGED_IN': { text: '在线',    bg: '#f6ffed', color: '#52c41a', border: '#b7eb8f' },
      'OFFLINE':   { text: '离线',    bg: '#f5f5f5', color: '#8c8c8c', border: '#d9d9d9' },
      'LOCKED':    { text: '锁定',    bg: '#fff1f0', color: '#ff4d4f', border: '#ffa39e' },
      'BLOCKED':   { text: '封禁',    bg: '#fff1f0', color: '#ff4d4f', border: '#ffa39e' }
    };

    const s = stateMap[state] || stateMap['INIT'];
    return `<span style="font-size:10px; padding:1px 6px; background:${s.bg}; color:${s.color}; border-radius:8px; border:1px solid ${s.border};">${s.text}</span>`;
  }

  /**
   * 获取崩溃次数着色信息
   */
  private getCrashInfo(count: number): { icon: string; color: string } {
    if (count === 0) return { icon: '', color: '#52c41a' };
    if (count <= 3) return { icon: '!', color: '#faad14' };
    if (count <= 7) return { icon: '!!', color: '#fa541c' };
    return { icon: '!!!', color: '#ff4d4f' };
  }

  /**
   * 格式化登录时间
   */
  private formatLoginTime(timestamp?: number): string {
    if (!timestamp) return '未登录';
    
    const now = Date.now();
    const diff = now - timestamp;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    
    const date = new Date(timestamp);
    return `${date.getMonth() + 1}/${date.getDate()} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
  }

  /**
   * 格式化持续时间（秒 → 人类可读）
   */
  private formatDuration(seconds: number): string {
    if (seconds < 60) return `${seconds}秒`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时`;
    return `${Math.floor(seconds / 86400)}天`;
  }

  /**
   * 切换指定账号的心跳保活状态
   */
  private toggleHeartbeat(accountId: string) {
    const wrapper = document.getElementById(`webview-wrapper-${accountId}`);
    if (!wrapper) {
      alert('该账号的 WebView 尚未激活（可能处于挂机区）');
      return;
    }

    const webview = wrapper.querySelector('webview') as any;
    if (!webview || typeof webview.executeJavaScript !== 'function') {
      alert('无法连接到该账号的 WebView');
      return;
    }

    // 切换心跳状态
    webview.executeJavaScript(`
      (function() {
        if (window.HeartbeatKeeper) {
          const stats = window.HeartbeatKeeper.getStats();
          if (stats.isRunning) {
            window.HeartbeatKeeper.stop();
            return '已停止心跳保活 (累计 ' + stats.actionCount + ' 次心跳)';
          } else {
            window.HeartbeatKeeper.start();
            return '已启动心跳保活';
          }
        } else {
          return '心跳模块未加载';
        }
      })()
    `).then((result: string) => {
      console.log(`[HealthDashboard] ${accountId}: ${result}`);
      // 刷新仪表盘以反映最新状态
      this.renderDashboard();
    }).catch(() => {
      console.warn(`[HealthDashboard] 心跳切换失败: ${accountId}`);
    });
  }
}
