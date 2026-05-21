import { ipcRenderer } from 'electron';

export class RoomManagementRenderer {
  
  public initialize(triggerBtnId: string) {
    const btn = document.getElementById(triggerBtnId);
    if (btn) {
      btn.addEventListener('click', () => this.openModal());
    }
  }

  private openModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-room-mgt';

    // Load from local storage or use mock if empty
    let savedRooms: {name: string, url: string}[] = [];
    try {
      const stored = localStorage.getItem('cfg_saved_rooms');
      if (stored) {
        savedRooms = JSON.parse(stored);
      }
    } catch(e) {
      savedRooms = [];
    }

    let editingIndex: number | null = null;

    const saveToStorage = () => {
      localStorage.setItem('cfg_saved_rooms', JSON.stringify(savedRooms));
    };

    const renderList = () => {
      const listEl = document.getElementById('room-list');
      if (!listEl) return;
      if (savedRooms.length === 0) {
        listEl.innerHTML = '<div class="text-muted text-center" style="padding: 20px;">暂无保存的直播间</div>';
        return;
      }
      listEl.innerHTML = savedRooms.map((r, idx) => `
        <div class="flex items-center justify-between room-list-item" data-url="${r.url}" style="padding: var(--space-md); border: 1px solid var(--color-border); border-radius: var(--radius-md); margin-bottom: var(--space-sm); background: var(--color-bg-input); cursor: pointer; ${editingIndex === idx ? 'border-color: #1890ff; background: #e6f7ff;' : ''}" title="双击同步到直播间链接">
          <div>
            <div style="font-weight: bold; font-size: var(--font-size-lg);">${r.name}</div>
            <div class="text-muted text-sm" style="margin-top: 4px;">${r.url}</div>
          </div>
          <div class="flex gap-sm">
            <button class="btn btn--sm btn--primary btn-edit-room" data-idx="${idx}">编辑</button>
            <button class="btn btn--sm btn--danger btn-del-room" data-idx="${idx}">删除</button>
          </div>
        </div>
      `).join('');

      document.querySelectorAll('.btn-del-room').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLButtonElement;
          const idx = parseInt(target.getAttribute('data-idx') || '0');
          if (editingIndex === idx) {
             editingIndex = null;
             const btnAdd = document.getElementById('btn-add-room');
             if (btnAdd) btnAdd.innerText = '添加';
             (document.getElementById('new-room-name') as HTMLInputElement).value = '';
             (document.getElementById('new-room-url') as HTMLInputElement).value = '';
          } else if (editingIndex !== null && editingIndex > idx) {
             editingIndex--;
          }
          savedRooms.splice(idx, 1);
          saveToStorage();
          renderList();
        });
      });

      document.querySelectorAll('.btn-edit-room').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const target = e.currentTarget as HTMLButtonElement;
          const idx = parseInt(target.getAttribute('data-idx') || '0');
          editingIndex = idx;
          const r = savedRooms[idx];
          
          (document.getElementById('new-room-name') as HTMLInputElement).value = r.name;
          (document.getElementById('new-room-url') as HTMLInputElement).value = r.url;
          
          const btnAdd = document.getElementById('btn-add-room');
          if (btnAdd) {
             btnAdd.innerText = '保存修改';
          }
          renderList();
        });
      });

      // 双击直播间条目，同步 URL 到全局输入框
      document.querySelectorAll('.room-list-item').forEach(item => {
        item.addEventListener('dblclick', (e) => {
          const el = (e.currentTarget as HTMLElement);
          const url = el.dataset.url;
          if (!url) return;
          const globalInput = document.getElementById('global-room-url') as HTMLInputElement;
          if (globalInput) {
            globalInput.value = url;
            // 触发同步按钮的点击事件
            const syncBtn = document.getElementById('btn-sync-room');
            if (syncBtn) syncBtn.click();
          }
          overlay.remove();
        });
      });
    };

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 600px;">
        <div class="modal-header" style="background: var(--color-bg-secondary);">
          <div class="modal-title">
            <span></span> 直播间管理
          </div>
          <span class="modal-close" id="btn-close-room-mgt">&times;</span>
        </div>
        <div class="modal-body" style="background: var(--color-bg-primary);">
          
          <div class="flex gap-sm mb-lg">
            <input type="text" class="input" id="new-room-name" placeholder="备注 (如：主播王哥)" style="flex: 1;" />
            <input type="url" class="input" id="new-room-url" placeholder="https://live.douyin.com/..." style="flex: 2;" />
            <button class="btn btn--primary" id="btn-add-room">添加</button>
          </div>

          <div id="room-list" style="max-height: 400px; overflow-y: auto;">
            <!-- list renders here -->
          </div>
          
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    renderList();

    document.getElementById('btn-close-room-mgt')?.addEventListener('click', () => {
      overlay.remove();
    });

    document.getElementById('btn-add-room')?.addEventListener('click', () => {
      const nameInput = document.getElementById('new-room-name') as HTMLInputElement;
      const urlInput = document.getElementById('new-room-url') as HTMLInputElement;
      if (!nameInput.value || !urlInput.value) {
        return alert('请填写完备注和链接');
      }
      
      if (editingIndex !== null) {
         savedRooms[editingIndex] = { name: nameInput.value, url: urlInput.value };
         editingIndex = null;
         (document.getElementById('btn-add-room') as HTMLElement).innerText = '添加';
      } else {
         savedRooms.push({ name: nameInput.value, url: urlInput.value });
      }
      
      saveToStorage();
      nameInput.value = '';
      urlInput.value = '';
      renderList();
    });
  }
}
