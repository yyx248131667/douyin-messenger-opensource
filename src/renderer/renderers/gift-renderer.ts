import { AccountController } from '../controllers/account-controller';
import { ipcRenderer } from 'electron';
import { IpcChannels } from '../../main/ipc/channels';

export class GiftRenderer {
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

  private async openModal() {
    let overlay = document.getElementById('modal-gift');
    if (overlay) {
      overlay.style.display = 'flex';
      return;
    }

    overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-gift';

    const accounts = this.accountController.getAccounts().filter(acc => !acc.data.isClosed && !acc.data.isDeleted);
    const accountCheckboxes = accounts.map(acc => `
      <label class="account-item flex items-center gap-sm" style="padding: 6px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); cursor: pointer;">
        <input type="checkbox" value="${acc.data.id}" class="gift-account-chk" checked />
        <span>${acc.data.name || acc.data.id.substring(0,6)}</span>
      </label>
    `).join('');

    const giftOptionsHTML = `
      <option value="小心心">小心心 (1抖币)</option>
      <option value="玫瑰">玫瑰 (1抖币)</option>
      <option value="抖音">抖音 (1抖币)</option>
      <option value="人气票">人气票 (1抖币)</option>
    `;

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 800px;">
        <div class="modal-header">
          <div class="modal-title">
            <span></span> 自动化送礼配置
          </div>
          <div class="flex items-center gap-md">
            <button id="btn-bg-gift" class="btn btn--sm" style="background: var(--color-bg-secondary); border: 1px solid var(--color-border); cursor: pointer; padding: 4px 10px; border-radius: 4px;">切到后台</button>
            <label class="switch" style="transform: scale(1.1);">
              <input type="checkbox" id="gift-toggle" />
              <span class="switch__slider"></span>
            </label>
            <span class="modal-close" id="btn-close-gift" title="彻底关闭并销毁">&times;</span>
          </div>
        </div>

        <div style="background: var(--color-bg-secondary); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: var(--space-md); margin-top: var(--space-md); margin-bottom: var(--space-xl); display: flex; align-items: center; gap: var(--space-md); font-size: var(--font-size-base);">
          <span></span>
          <span>运行状态: <span id="gift-run-status" style="font-weight: bold; color: var(--color-error);">已停止</span></span>
        </div>

        <div class="modal-body">
          <div class="card__header">
            送礼设置
          </div>
          
          <div class="mb-lg" style="margin-bottom: 25px;">
            <div class="flex items-center gap-md mb-md">
              <label class="label" style="margin: 0;">选择送礼账号 (可多选)</label>
              <button class="btn btn--sm btn--primary" id="btn-gift-all">全选</button>
              <button class="btn btn--sm btn--danger" id="btn-gift-none">清空</button>
            </div>
            <div class="flex" style="flex-wrap: wrap; gap: 10px;">
              ${accountCheckboxes || '<div class="text-muted text-sm">暂无在线账号</div>'}
            </div>
          </div>

          <div class="mb-lg" style="margin-bottom: 25px;">
            <label class="label">选择/搜索常规礼物名称 (精确匹配)</label>
            <input type="text" class="input" id="gift-name" placeholder="输入关键字搜索或选择内置礼物..." value="小心心" list="gift-builtin-list" />
            <datalist id="gift-builtin-list">
              ${giftOptionsHTML}
            </datalist>
          </div>

          <div class="flex gap-2xl mb-lg">
            <div style="flex: 1;">
              <label class="label">发送间隔时间 (秒)</label>
              <div class="flex items-center gap-sm">
                <input type="number" class="input input-number" id="gift-min-time" value="60" />
                <span class="text-muted">~</span>
                <input type="number" class="input input-number" id="gift-max-time" value="120" />
              </div>
            </div>
            <div style="flex: 1;">
              <label class="label">自动循环次数 (0为一直循环)</label>
              <div class="flex items-center gap-sm">
                <input type="number" class="input input-number" id="gift-loop-count" value="0" />
                <span class="text-muted">次</span>
              </div>
            </div>
          </div>

          <div class="mb-md">
            <button class="btn btn--success" id="btn-gift-test">立即测试送礼</button>
          </div>
          
          <div id="gift-logs"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Bind logic
    document.getElementById('btn-close-gift')?.addEventListener('click', () => {
      // 停止逻辑
      const toggle = document.getElementById('gift-toggle') as HTMLInputElement;
      if (toggle && toggle.checked) toggle.click(); // stop if running
      overlay!.remove();
    });

    document.getElementById('btn-bg-gift')?.addEventListener('click', () => {
      overlay!.style.display = 'none'; // 仅隐藏，在后台保留
    });
    
    document.getElementById('btn-gift-all')?.addEventListener('click', () => {
      document.querySelectorAll('.gift-account-chk').forEach(el => (el as HTMLInputElement).checked = true);
    });
    document.getElementById('btn-gift-none')?.addEventListener('click', () => {
      document.querySelectorAll('.gift-account-chk').forEach(el => (el as HTMLInputElement).checked = false);
    });

    const toggle = document.getElementById('gift-toggle') as HTMLInputElement;
    const statusTxt = document.getElementById('gift-run-status') as HTMLElement;
    toggle.addEventListener('change', () => {
       if (toggle.checked) {
         statusTxt.innerText = '运行中';
         // could dispatch ipc events to loop
       } else {
         statusTxt.innerText = '已停止';
       }
    });

    document.getElementById('btn-gift-test')?.addEventListener('click', () => {
       const selected = Array.from(document.querySelectorAll('.gift-account-chk:checked')).map(el => (el as HTMLInputElement).value);
       if (selected.length === 0) return alert('请至少选择一个账号！');
       const giftName = (document.getElementById('gift-name') as HTMLInputElement).value;
       
       selected.forEach(accId => {
         ipcRenderer.send(IpcChannels.PAGE_ACTION, {
           accountId: accId,
           action: 'send-gift',
           payload: {
             giftName: giftName,
             comboCount: 1
           }
         });
       });
       
       const logs = document.getElementById('gift-logs');
       if(logs) logs.innerHTML = `<div style="font-size: 14px; color: #52c41a; margin-top: 15px;">✓ 直推 API 测试令已下发到 ${selected.length} 个账号 (${giftName})</div>`;
    });
  }
}
