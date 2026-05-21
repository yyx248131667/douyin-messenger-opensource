/**
 * @file account-controller.ts
 * @description 管理账号数据获取、持久化、以及 UI 逻辑流转。
 * 
 * 核心职责：
 * 1. 账号 CRUD（增删改查）
 * 2. 关闭/恢复标签（不销毁 partition 数据）
 * 3. 软删除/硬删除（硬删除才清空 partition）
 * 4. 账号恢复（使用原 partition 重建 webview）
 */

import { EventBus } from '../core/event-bus';
import { Account, AccountData } from '../../domain/account/Account';
import { ipcRenderer } from 'electron';
import { IpcChannels } from '../../main/ipc/channels';

export class AccountController {
  private accounts: Account[] = [];
  private selectedAccountId: string | null = null;

  private getAccountOrder(account: Account): number {
    const match = account.data.name.match(/账号(\d+)/);
    return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
  }

  public loadAccounts(initialAccounts: AccountData[]) {
    this.accounts = initialAccounts.map(data => new Account(data));
    if (this.accounts.length > 0 && !this.selectedAccountId) {
      // 优先选择非关闭的活跃账号
      const activeAcc = this.accounts.find(a => !a.data.isClosed && !a.data.isDeleted);
      this.selectedAccountId = activeAcc ? activeAcc.data.id : this.accounts[0].data.id;
    }

    // 通知视图重新绘制
    EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
    EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);
  }

  public addAccount(name: string, url: string, specificId?: string) {
    const newAccount = new Account({
      id: specificId || `acc_${Date.now()}`,
      name,
      url,
      isActive: false
    });

    this.accounts.push(newAccount);
    this.selectedAccountId = newAccount.data.id;

    // Store logic (would go through IPC or infrastructure)
    EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));

    // Re-render
    EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
    EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);
  }

  public getFirstRestorableClosedAccount(): Account | null {
    const closedAccounts = this.accounts
      .filter(account => account.data.isClosed || account.data.isDeleted)
      .sort((a, b) => this.getAccountOrder(a) - this.getAccountOrder(b));

    return closedAccounts[0] || null;
  }

  public restoreClosedAccount(accountId: string) {
    const acc = this.accounts.find(a => a.data.id === accountId);
    if (!acc || acc.data.isDeleted) return false;

    acc.data.isClosed = false;
    acc.setZone('ACTIVE');
    this.selectedAccountId = accountId;

    this.accounts.forEach(account => {
      if (account.data.id !== accountId && !account.data.isClosed && !account.data.isDeleted) {
        account.setZone('COOLING');
      }
    });

    EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
    EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
    EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);

    setTimeout(() => {
      EventBus.emit('action:reload-webview', accountId);
    }, 200);

    return true;
  }

  public getNextAvailableAccountNumber(): number {
    const usedNumbers = new Set(
      this.accounts
        .map(account => {
          const match = account.data.name.match(/账号(\d+)/);
          return match ? parseInt(match[1], 10) : null;
        })
        .filter((num): num is number => num !== null)
    );

    let nextNumber = 1;
    while (usedNumbers.has(nextNumber)) {
      nextNumber++;
    }

    return nextNumber;
  }

  public addCompleteAccount(data: AccountData) {
    const newAccount = new Account(data);
    this.accounts.push(newAccount);
    // Don't auto select when bulk importing, keep current selection
    
    EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
    EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
    EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);
  }

  public removeAccount(accountId: string) {
    this.accounts = this.accounts.filter(a => a.data.id !== accountId);
    if (this.selectedAccountId === accountId) {
      this.selectedAccountId = this.accounts.length > 0 ? this.accounts[0].data.id : null;
    }

    EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
    EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
    EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);
  }

  /**
   * 关闭标签页（进入挂机区）。
   * ⚠️ 不清除 partition 数据！仅从 UI 隐藏，恢复时使用原 partition。
   */
  public closeTab(accountId: string) {
    const acc = this.accounts.find(a => a.data.id === accountId);
    if (acc) {
      acc.data.isClosed = true;
      acc.setZone('IDLE'); // 标记进入挂机区
      
      if (this.selectedAccountId === accountId) {
        const activeAccounts = this.accounts.filter(a => !a.data.isClosed && !a.data.isDeleted);
        this.selectedAccountId = activeAccounts.length > 0 ? activeAccounts[0].data.id : null;
      }
      EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
      EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
      EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);
    }
  }

  /**
   * 软删除账号（移到关闭区，可恢复）。
   * ⚠️ 不清除 partition 数据！保留 Cookie/localStorage/IndexedDB。
   */
  public deleteAccountSoft(accountId: string) {
    const acc = this.accounts.find(a => a.data.id === accountId);
    if (acc && !acc.data.isDeleted) {
      acc.data.isDeleted = true;
      acc.data.isClosed = true;
      acc.setZone('IDLE');
      
      if (!acc.data.name.endsWith('[删除]')) {
        acc.data.name = acc.data.name + '[删除]';
      }
      if (this.selectedAccountId === accountId) {
        const activeAccounts = this.accounts.filter(a => !a.data.isClosed && !a.data.isDeleted);
        this.selectedAccountId = activeAccounts.length > 0 ? activeAccounts[0].data.id : null;
      }
      EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
      EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
      EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);
    }
  }

  /**
   * 硬删除账号（彻底销毁，清空 partition 中的所有数据）。
   * ⚠️ 这是唯一会调用 clear-partition-storage 的路径！
   */
  public async deleteAccountHard(accountId: string) {
    this.accounts = this.accounts.filter(a => a.data.id !== accountId);
    if (this.selectedAccountId === accountId) {
      const activeAccounts = this.accounts.filter(a => !a.data.isClosed && !a.data.isDeleted);
      this.selectedAccountId = activeAccounts.length > 0 ? activeAccounts[0].data.id : null;
    }
    
    // ⚠️ 仅在硬删除时才清除 partition 数据
    await ipcRenderer.invoke(IpcChannels.CLEAR_PARTITION_STORAGE, accountId).catch((err) => {
      console.error(`[AccountController] 清除 partition 失败: ${accountId}`, err);
    });
    
    EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
    EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
    EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);
  }

  /**
   * 恢复账号并重新登录。
   * 
   * ✅ 恢复流程：
   * 1. 清除删除标记（isDeleted → false）
   * 2. 打开标签（isClosed → false）
   * 3. 设置为活跃区（zone → ACTIVE）
   * 4. 触发 webview 重建（使用原 partition = persist:{accountId}）
   * 5. partition 中的 Cookie/localStorage/IndexedDB 自动生效
   * 
   * ⚠️ 不调用 clear-partition-storage！依赖原始 partition 数据恢复登录态。
   */
  public async recoverAccountAndLogin(accountId: string) {
    const acc = this.accounts.find(a => a.data.id === accountId);
    if (acc) {
      // 恢复标记
      acc.data.isDeleted = false;
      acc.data.isClosed = false;
      acc.setZone('ACTIVE');
      
      // 清除删除后缀
      if (acc.data.name.endsWith('[删除]')) {
        acc.data.name = acc.data.name.replace(/\[删除\]$/, '');
      }
      acc.state = 'INIT';
      this.selectedAccountId = accountId;

      // 持久化并重新渲染
      EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
      EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
      EventBus.emit('ui:render-webviews', this.accounts, this.selectedAccountId);

      // 延迟触发 webview 重新加载，确保 DOM 已创建
      // WebviewController 会使用 PartitionRegistry 生成正确的 partition
      setTimeout(() => {
        EventBus.emit('action:reload-webview', accountId);
      }, 500);
      
      console.log(`[AccountController] ✅ 账号恢复: ${accountId} → 使用原 partition 重建 webview`);
    }
  }

  public selectAccount(accountId: string) {
    if (this.selectedAccountId === accountId) return;
    this.selectedAccountId = accountId;

    // 更新分区状态
    this.accounts.forEach(acc => {
      if (acc.data.id === accountId) {
        acc.setZone('ACTIVE');
      } else if (!acc.data.isClosed && !acc.data.isDeleted) {
        acc.setZone('COOLING');
      }
    });

    EventBus.emit('ui:select-tab', this.selectedAccountId);
    EventBus.emit('ui:switch-webview', this.selectedAccountId);
  }

  public updateLoginState(accountId: string, isLoggedIn: boolean) {
    const account = this.accounts.find(a => a.data.id === accountId);
    if (account) {
      if (isLoggedIn) {
        // 如果账号是用户手动锁定的，保持 LOCKED 状态不被覆盖
        // 锁定是用户主动操作，只能由用户手动解锁
        if (account.state !== 'LOCKED') {
          account.updateState('LOGGED_IN');
        }
        account.data.lastLoginAt = Date.now();
        EventBus.emit('ipc:save-accounts', this.accounts.map(a => a.data));
      } else {
        // 离线信号：无论是否锁定都更新（如果锁定中但被检测到离线，说明真的掉线了）
        account.updateState('OFFLINE');
      }
      EventBus.emit('ui:render-tabs', this.accounts, this.selectedAccountId);
    }
  }

  public getAccounts(): Account[] {
    return this.accounts;
  }

  public getSelectedAccountId(): string | null {
    return this.selectedAccountId;
  }
}
