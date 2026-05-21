import { AccountController } from '../controllers/account-controller';
import { ipcRenderer } from 'electron';
import { EventBus } from '../core/event-bus';
import { IpcChannels } from '../../main/ipc/channels';

export class AccountManagementRenderer {
  private accountController: AccountController;

  constructor(accountController: AccountController) {
    this.accountController = accountController;
  }

  public initialize(triggerBtnId: string) {
    const btn = document.getElementById(triggerBtnId);
    if (btn) {
      btn.addEventListener('click', () => this.openModal());
    }
  }

  private openModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-account-mgt';

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header" style="background: var(--color-bg-secondary);">
          <div class="modal-title">
            <span style="color: var(--color-text-muted);"></span> 账号管理
          </div>
          <span class="modal-close" id="btn-close-account-mgt">&times;</span>
        </div>
        <div class="modal-body" style="background: var(--color-bg-primary);">
          
          <div class="flex items-center justify-between" style="border-bottom: 1px solid var(--color-border); padding-bottom: var(--space-md); margin-bottom: var(--space-md);">
            <div class="text-sm text-muted">
              为每个账号单独设置话术和节能模式
            </div>
            <div class="flex gap-sm">
              <button class="btn btn--primary" id="btn-import-legacy" style="background:#52c41a; border-color:#52c41a;">一键导入旧版账号</button>
              <button class="btn btn--warning" id="btn-unlock-all">一键解锁全部</button>
            </div>
          </div>

          <div id="account-list" style="max-height: 400px; overflow-y: auto;">
            <!-- accounts will render here -->
          </div>
          
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    const renderList = () => {
      const accounts = this.accountController.getAccounts();
      const activeAccounts = accounts.filter(a => !a.data.isClosed && !a.data.isDeleted);
      const closedAccounts = accounts.filter(a => a.data.isClosed || a.data.isDeleted);

      const listEl = document.getElementById('account-list');
      if (listEl) {
        let html = '';
        
        html += `<div style="font-weight:bold; margin-bottom: 10px; color: var(--color-text-muted);">活跃账号</div>`;
        if (activeAccounts.length === 0) {
          html += '<div class="text-muted text-center" style="padding: 10px;">无</div>';
        } else {
          html += activeAccounts.map(acc => `
            <div class="flex items-center justify-between" style="padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-sm); background: var(--color-bg-input);">
              <div class="flex items-center gap-sm">
                <span class="text-primary font-weight-bold">${acc.data.name || acc.data.id.substring(0,8)}</span>
                <span class="badge ${acc.data.isLocked ? 'badge--error' : 'badge--success'}">
                  ${acc.data.isLocked ? '已锁定' : '正常'}
                </span>
              </div>
              <div class="flex items-center gap-sm">
                <button class="btn btn--sm action-btn" data-action="delete" data-id="${acc.data.id}">关闭</button>
                <button class="btn btn--sm btn--primary action-btn" data-action="verify" data-id="${acc.data.id}" style="background-color: #FE2C55; color: white;">验证</button>
                <button class="btn btn--sm btn--danger action-btn" data-action="hard-delete" data-id="${acc.data.id}" style="background-color: var(--color-error);">彻底删除</button>
              </div>
            </div>
          `).join('');
        }

        html += `<div style="font-weight:bold; margin-top: 20px; margin-bottom: 10px; color: var(--color-text-muted);">账号关闭区</div>`;
        if (closedAccounts.length === 0) {
          html += '<div class="text-muted text-center" style="padding: 10px;">无</div>';
        } else {
          html += closedAccounts.map(acc => `
            <div class="flex items-center justify-between" style="padding: var(--space-sm); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-sm); background: var(--color-bg-secondary); opacity: 0.8;">
              <div class="flex items-center gap-sm">
                <span class="text-primary font-weight-bold" style="text-decoration: line-through;">${acc.data.name}</span>
              </div>
              <div class="flex items-center gap-sm">
                <button class="btn btn--sm btn--primary action-btn" data-action="login" data-id="${acc.data.id}">恢复</button>
                <button class="btn btn--sm action-btn" data-action="verify" data-id="${acc.data.id}" style="background-color: #FE2C55; color: white;">验证</button>
                <button class="btn btn--sm btn--danger action-btn" data-action="hard-delete" data-id="${acc.data.id}" style="background-color: var(--color-error);">彻底删除</button>
              </div>
            </div>
          `).join('');
        }
        
        listEl.innerHTML = html;

        // Bind events
        listEl.querySelectorAll('.action-btn').forEach(btn => {
          btn.addEventListener('click', (e) => {
            const target = e.currentTarget as HTMLElement;
            const action = target.getAttribute('data-action');
            const id = target.getAttribute('data-id');
            if (!id) return;
            
            if (action === 'delete') {
              EventBus.emit('action:remove-account', id);
              renderList(); // re-render instead of close
            } else if (action === 'hard-delete') {
              EventBus.emit('action:hard-remove-account', id);
              renderList(); // re-render instead of close
            } else if (action === 'verify') {
              (window as any).electron.ipcRenderer.send('open-verify-window', id);
            } else if (action === 'login') {
              EventBus.emit('action:recover-login', id);
              overlay.remove(); // Keep closing on login since it focuses UI to new tab
            } else if (action === 'restore') {
              this.accountController.restoreClosedAccount(id);
              renderList(); // re-render instead of close
            }
          });
        });
      }
    };
    
    // Initial render
    renderList();

    document.getElementById('btn-close-account-mgt')?.addEventListener('click', () => {
      overlay.remove();
    });

    document.getElementById('btn-unlock-all')?.addEventListener('click', () => {
      const accounts = this.accountController.getAccounts();
      accounts.forEach(acc => {
        acc.updateState('LOGGED_IN');
        acc.data.isLocked = false;
      });
      EventBus.emit('ui:render-tabs', accounts, this.accountController.getSelectedAccountId());
      EventBus.emit('ipc:save-accounts', accounts.map(a => a.data));
      alert('所有账号的熔断锁定已解除。');
      overlay.remove();
    });

    document.getElementById('btn-import-legacy')?.addEventListener('click', async () => {
      try {
        const legacyIds: string[] = await ipcRenderer.invoke(IpcChannels.GET_LEGACY_ACCOUNTS);
        const legacyMetadata: any[] = await ipcRenderer.invoke(IpcChannels.GET_LEGACY_METADATA);

        if (!legacyIds || legacyIds.length === 0) {
           alert('未在项目中发现有效的 ExportedCookies.json 资产 或 无可用账号 Cookie。');
           return;
        }

        const currentAccounts = this.accountController.getAccounts();
        let importedCount = 0;

        for (const accountId of legacyIds) {
          // Skip if already in current accounts (by ID)
          if (currentAccounts.some(a => a.data.id === accountId)) continue;
          
          let oldDataMatch = null;
          if (Array.isArray(legacyMetadata)) {
            oldDataMatch = legacyMetadata.find(a => a.id === accountId);
          }

          if (oldDataMatch) {
            // Import structurally 1:1 directly from previous original project accounts.json schema
            const newAccData = {
              ...oldDataMatch,
              id: accountId, // force ID consistency
              isDeleted: false, // Ensure they are active!
              isClosed: false
            };
            this.accountController.addCompleteAccount(newAccData);
          } else {
            // Fallback if legacy cookie exists but no accounts.json layout exists
            let name = accountId;
            const match = accountId.match(/account_(\d+)/);
            if (match) {
               name = `账号${match[1]}`;
            }
            this.accountController.addAccount(name, 'https://live.douyin.com', accountId);
          }
          
          importedCount++;
        }
        
        if (importedCount > 0) {
           alert(`成功无损热导入 ${importedCount} 个旧版账号矩阵配置及直播间映射！底层 Cookie 指纹环境将在自动加载时完成沙盒注入还原。`);
           overlay.remove(); // Close modal to show the massive tab rebuild.
        } else {
           alert('没有新增导入。所有旧项目中的账号环境可能已经全部映射完毕。');
        }
      } catch (err) {
        alert('导入失败: ' + err);
      }
    });
  }
}
