/**
 * @file tab-renderer.ts
 * @description Renders the UI tabs based on state events.
 */

import { EventBus } from '../core/event-bus';
import { Account } from '../../domain/account/Account';

export class TabRenderer {
  private tabsContainer: HTMLElement | null = null;

  public initialize(containerId: string = 'tabs-header') {
    this.tabsContainer = document.getElementById(containerId);
    
    // Bind UI Events to EventBus
    EventBus.on('ui:render-tabs', (accounts: Account[], selectedId: string | null) => {
      this.renderTabs(accounts, selectedId);
    });

    EventBus.on('ui:select-tab', (selectedId: string) => {
      this.updateActiveTab(selectedId);
    });
  }

  private renderTabs(accounts: Account[], selectedId: string | null) {
    if (!this.tabsContainer) return;

    const visibleAccounts = accounts
      .filter(a => !a.data.isClosed && !a.data.isDeleted)
      .sort((a, b) => {
        const numA = parseInt(a.data.name.match(/\d+/)?.[0] || '0', 10);
        const numB = parseInt(b.data.name.match(/\d+/)?.[0] || '0', 10);
        return numA - numB;
      });

    this.tabsContainer.innerHTML = visibleAccounts.map(account => {
      const isSelected = selectedId === account.data.id ? 'active' : '';
      const isLocked = account.state === 'LOCKED' ? 'tab-locked' : '';
      // 绿点表示抖音实际在线状态：LOCKED 只是用户手动锁定，不影响登录状态
      const isLoggedIn = account.state === 'LOGGED_IN' || account.state === 'LOCKED';
      
      // 在线状态绿点（右上角）
      const statusDot = isLoggedIn 
        ? `<span class="tab-status-dot tab-status-dot--online" title="已登录在线"></span>` 
        : '';

      // 发送锁定指示器容器（由 webview-input-lock 动态填充黄色闪烁点）
      const sendIndicator = `<span class="tab-send-indicator" data-account-id="${account.data.id}"></span>`;
        
      const closeBtn = account.state === 'LOCKED' 
        ? '' 
        : `<span class="tab-close" data-action="close-tab" data-id="${account.data.id}">×</span>`;

      return `
        <div class="tab-item ${isSelected} ${isLocked}" 
             style="position: relative;"
             data-account-id="${account.data.id}">
          <span>${account.data.name}</span>
          ${statusDot}
          ${sendIndicator}
          ${closeBtn}
        </div>
      `;
    }).join('');

    // Attach delegated events
    this.attachEvents();
  }

  private updateActiveTab(selectedId: string) {
    if (!this.tabsContainer) return;
    
    // Remove active from all
    this.tabsContainer.querySelectorAll('.tab-item').forEach(tab => {
      tab.classList.remove('active');
    });

    // Add to specific
    const activeTab = this.tabsContainer.querySelector(`.tab-item[data-account-id="${selectedId}"]`);
    if (activeTab) {
      activeTab.classList.add('active');
    }
  }

  private attachEvents() {
    if (!this.tabsContainer) return;
    
    this.tabsContainer.querySelectorAll('.tab-item').forEach(tab => {
      const htmlTab = tab as HTMLElement;
      const accountId = htmlTab.getAttribute('data-account-id');
      if (!accountId) return;

      htmlTab.onclick = (e) => {
        // Prevent click if we hit the close button
        const action = (e.target as HTMLElement).getAttribute('data-action');
        if (action === 'close-tab') {
          EventBus.emit('action:close-tab', accountId);
          return;
        } else if (action === 'remove') {
          EventBus.emit('action:remove-account', accountId);
          return;
        }
        EventBus.emit('action:switch-account', accountId);
      };

      htmlTab.ondblclick = () => {
         EventBus.emit('action:reload-webview', accountId);
      };
    });
  }
}
