import { ipcRenderer } from 'electron';
import { ScriptItem } from '../../main/services/script.service';
import { IpcChannels } from '../../main/ipc/channels';

/**
 * @file script-renderer.ts
 * @description 话术设置面板 — 轻量级实现
 * 
 * 架构精简为两个核心面板：
 * 1. 发送设置：当前发送列表（纯文本编辑）+ 发送模式
 * 2. 话术库：多话术包管理 + 一键推送到发送列表 + 自动轮转
 * 
 * 数据流：
 * - 发送列表 → localStorage cfg_global_scripts（直接被全局调度器消费）
 * - 话术库 → IPC scripts.json（磁盘持久化）
 * - 自动轮转 → localStorage cfg_auto_rotate（定时器驱动切换）
 */
export class ScriptRenderer {
  private containerId: string;
  private currentScripts: ScriptItem[] = [];
  private activeScriptId: string | null = null;
  private isNewDraft: boolean = false;
  private rotateTimer: any = null;

  constructor(containerId: string) {
    this.containerId = containerId;
  }

  public async render(triggerBtnId: string) {
    const btn = document.getElementById(triggerBtnId);
    if (btn) {
      btn.addEventListener('click', () => this.openModal());
    }
    // 应用启动时自动恢复轮转
    this.restoreAutoRotate();
  }

  private async openModal() {
    // 防止重复打开
    const existing = document.getElementById('modal-script-mgt');
    if (existing) { existing.style.display = 'flex'; return; }

    // 预加载数据，避免渲染后才请求
    this.currentScripts = await ipcRenderer.invoke('get-scripts');

    const savedMode = localStorage.getItem('cfg_send_mode') || 'sequential';
    const savedScripts = localStorage.getItem('cfg_global_scripts') || '';
    const savedLoopCount = localStorage.getItem('cfg_loop_count') || '0';

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-script-mgt';

    overlay.innerHTML = `
      <div class="modal-content" style="max-width: 780px; width: 780px; background: #fff; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border-radius: 8px;">
        <div class="modal-header" style="border-bottom: 1px solid #eaeaea; padding: 15px 20px; display: flex; justify-content: space-between; align-items: center;">
          <div style="font-size: 16px; font-weight: bold; color: #333;">话术设置</div>
          <span class="modal-close" id="btn-close-script" style="font-size: 20px; color: #999; cursor: pointer;">&times;</span>
        </div>
        <div style="padding: 0 20px 20px 20px;">
          
          <!-- 标签切换 -->
          <div id="script-tabs" style="display: flex; gap: 20px; border-bottom: 2px solid #eaeaea; margin-top: 10px; margin-bottom: 15px;">
            <div class="s-tab active" data-pane="pane-send" style="padding: 10px 5px; cursor: pointer; font-size: 15px; border-bottom: 2px solid #1890ff; color: #1890ff; margin-bottom: -2px;">发送设置</div>
            <div class="s-tab" data-pane="pane-lib" style="padding: 10px 5px; cursor: pointer; font-size: 15px; border-bottom: 2px solid transparent; color: #666; margin-bottom: -2px;">话术库</div>
            <div class="s-tab" data-pane="pane-rotate" style="padding: 10px 5px; cursor: pointer; font-size: 15px; border-bottom: 2px solid transparent; color: #666; margin-bottom: -2px;">自动轮转</div>
          </div>

          <!-- 面板1: 发送设置 -->
          <div class="s-pane" id="pane-send">
            <div style="display: flex; align-items: center; gap: 10px; margin-bottom: 10px;">
              <span style="font-weight: bold; font-size: 14px;">发送模式:</span>
              <select id="sel-send-mode" style="padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px;">
                <option value="sequential" ${savedMode === 'sequential' ? 'selected' : ''}>顺序发送</option>
                <option value="random" ${savedMode === 'random' ? 'selected' : ''}>随机发送</option>
              </select>
              <span style="font-weight: bold; font-size: 14px; margin-left: 20px;">循环次数:</span>
              <input type="number" id="inp-loop-count" value="${savedLoopCount}" style="padding: 6px 10px; border: 1px solid #ccc; border-radius: 4px; font-size: 14px; width: 80px;" min="0" placeholder="0 = 无限" title="默认0代表无限循环">
            </div>
            <div style="font-weight: bold; margin-bottom: 5px; font-size: 14px;">当前发送列表:</div>
            <div style="font-size: 12px; color: #888; margin-bottom: 8px;">每行一条话术，点击"保存"后全局生效</div>
            <textarea id="txt-current-script" style="width: 100%; height: 220px; border: 2px solid #faad14; border-radius: 4px; padding: 10px; resize: vertical; outline: none; box-sizing: border-box; font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 14px; line-height: 1.6;">${savedScripts}</textarea>
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 10px;">
              <button id="btn-reset-send" style="background: #faad14; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">重置</button>
              <button id="btn-save-send" style="background: #1890ff; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">保存设置</button>
            </div>
          </div>

          <!-- 面板2: 话术库 -->
          <div class="s-pane" id="pane-lib" style="display: none;">
            <div style="display: flex; border: 1px solid #eee; border-radius: 6px; height: 370px; overflow: hidden;">
              <!-- 左侧列表 -->
              <div style="width: 220px; border-right: 1px solid #eee; background: #fafafa; display: flex; flex-direction: column;">
                <div style="padding: 10px; border-bottom: 1px solid #eee;">
                  <button id="btn-add-script" style="width: 100%; background: #1890ff; color: white; border: none; padding: 6px; border-radius: 4px; cursor: pointer; font-size: 13px;">+ 新建话术</button>
                </div>
                <div id="script-list-container" style="flex: 1; overflow-y: auto; padding: 8px;"></div>
              </div>
              <!-- 右侧编辑器 -->
              <div style="flex: 1; display: flex; flex-direction: column; background: #fff;">
                <div id="script-empty-hint" style="flex: 1; display: flex; align-items: center; justify-content: center; color: #bbb; font-size: 14px;">
                  选择左侧话术或新建
                </div>
                <div id="script-editor" style="display: none; flex: 1; flex-direction: column;">
                  <div style="padding: 12px 15px; border-bottom: 1px solid #f0f0f0;">
                    <input type="text" id="edit-script-title" placeholder="话术标题" value="" style="width: 100%; border: none; font-size: 16px; font-weight: bold; outline: none; box-sizing: border-box;" />
                  </div>
                  <div style="flex: 1; padding: 12px 15px;">
                    <textarea id="edit-script-content" placeholder="每行一条话术..." style="width: 100%; height: 100%; border: none; outline: none; resize: none; font-size: 14px; line-height: 1.6; box-sizing: border-box; font-family: -apple-system, 'Segoe UI', sans-serif;"></textarea>
                  </div>
                  <div style="padding: 8px 15px; border-top: 1px solid #f0f0f0; display: flex; justify-content: flex-end; gap: 8px; background: #fafafa;">
                    <button id="btn-push-script" style="background: #52c41a; color: white; border: none; padding: 6px 15px; border-radius: 4px; cursor: pointer; font-size: 13px;">推送至发送列表</button>
                    <button id="btn-save-script" style="background: #1890ff; color: white; border: none; padding: 6px 15px; border-radius: 4px; cursor: pointer; font-size: 13px;">保存</button>
                    <button id="btn-delete-script" style="background: #fff; color: #ff4d4f; border: 1px solid #ff4d4f; padding: 6px 15px; border-radius: 4px; cursor: pointer; font-size: 13px;">删除</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 面板3: 自动轮转 -->
          <div class="s-pane" id="pane-rotate" style="display: none;">
            <div style="margin-bottom: 15px;">
              <label style="display: flex; align-items: center; gap: 8px; font-weight: bold; cursor: pointer;">
                <input type="checkbox" id="chk-auto-rotate" style="width: 16px; height: 16px;" />
                启用多话术自动轮转
              </label>
              <div style="font-size: 12px; color: #888; margin-left: 24px; margin-top: 4px;">
                启用后，系统将按设定的时间间隔自动切换全局发送话术列表
              </div>
            </div>
            <div style="border: 1px solid #eaeaea; border-radius: 6px; padding: 15px;">
              <div style="font-size: 13px; color: #666; margin-bottom: 10px; font-weight: bold;">
                轮转列表 (从话术库中选择，留空跳过)
              </div>
              <div id="rotate-rows" style="display: flex; flex-direction: column; gap: 8px;"></div>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 10px; margin-top: 15px;">
              <span id="rotate-status" style="font-size: 12px; color: #888; line-height: 32px;"></span>
              <button id="btn-save-rotate" style="background: #1890ff; color: white; border: none; padding: 8px 15px; border-radius: 4px; cursor: pointer;">保存轮转设置</button>
            </div>
          </div>

        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 绑定关闭
    document.getElementById('btn-close-script')!.addEventListener('click', () => overlay.remove());

    // 绑定标签切换
    this.bindTabSwitch();

    // 绑定发送设置面板
    this.bindSendPane();

    // 绑定话术库面板
    this.renderScriptList();
    this.bindLibPane();

    // 绑定轮转面板
    this.renderRotateRows();
    this.bindRotatePane();
    this.loadRotateConfig();
  }

  // ============ 标签切换 ============
  private bindTabSwitch() {
    const tabs = document.querySelectorAll('#script-tabs .s-tab');
    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        // 切换激活状态
        tabs.forEach(t => {
          (t as HTMLElement).style.borderBottom = '2px solid transparent';
          (t as HTMLElement).style.color = '#666';
          t.classList.remove('active');
        });
        (tab as HTMLElement).style.borderBottom = '2px solid #1890ff';
        (tab as HTMLElement).style.color = '#1890ff';
        tab.classList.add('active');

        // 切换面板可见性
        const paneId = tab.getAttribute('data-pane')!;
        document.querySelectorAll('.s-pane').forEach(p => (p as HTMLElement).style.display = 'none');
        document.getElementById(paneId)!.style.display = 'block';
      });
    });
  }

  // ============ 发送设置 ============
  private bindSendPane() {
    const txtArea = document.getElementById('txt-current-script') as HTMLTextAreaElement;
    const selMode = document.getElementById('sel-send-mode') as HTMLSelectElement;
    const inpLoopCount = document.getElementById('inp-loop-count') as HTMLInputElement;
    const btnSave = document.getElementById('btn-save-send')!;
    const btnReset = document.getElementById('btn-reset-send')!;

    btnSave.addEventListener('click', () => {
      localStorage.setItem('cfg_send_mode', selMode.value);
      localStorage.setItem('cfg_global_scripts', txtArea.value);
      localStorage.setItem('cfg_loop_count', inpLoopCount.value || '0');
      btnSave.innerText = '已保存';
      setTimeout(() => btnSave.innerText = '保存设置', 1000);
    });

    btnReset.addEventListener('click', () => {
      if (confirm('确定要清空当前发送列表吗？')) {
        txtArea.value = '';
        localStorage.setItem('cfg_global_scripts', '');
      }
    });
  }

  // ============ 话术库 ============
  private renderScriptList() {
    const container = document.getElementById('script-list-container')!;
    container.innerHTML = '';

    this.currentScripts.forEach(script => {
      const firstLine = script.content.split('\n').map(l => l.trim()).filter(l => l)[0] || '空话术包';
      const preview = firstLine.length > 16 ? firstLine.substring(0, 16) + '...' : firstLine;
      const isActive = script.id === this.activeScriptId;

      const item = document.createElement('div');
      item.className = 'script-list-item';
      item.setAttribute('data-id', script.id);
      item.style.cssText = `padding: 8px 10px; border-radius: 4px; cursor: pointer; margin-bottom: 4px; border-left: 3px solid ${isActive ? '#1890ff' : 'transparent'}; background: ${isActive ? '#e6f7ff' : '#fff'};`;
      item.innerHTML = `
        <div style="font-weight: bold; font-size: 13px; color: ${isActive ? '#1890ff' : '#333'}; margin-bottom: 2px;">${script.title}</div>
        <div style="font-size: 11px; color: #999; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${preview}</div>
      `;
      container.appendChild(item);
    });
  }

  private showEditor() {
    const hint = document.getElementById('script-empty-hint');
    const editor = document.getElementById('script-editor');
    const titleInput = document.getElementById('edit-script-title') as HTMLInputElement;
    const contentArea = document.getElementById('edit-script-content') as HTMLTextAreaElement;

    if (!hint || !editor || !titleInput || !contentArea) return;

    if (!this.activeScriptId) {
      hint.style.display = 'flex';
      editor.style.cssText = 'display: none; flex: 1; flex-direction: column;';
      return;
    }

    hint.style.display = 'none';
    editor.style.cssText = 'display: flex; flex: 1; flex-direction: column;';

    if (this.activeScriptId === '__NEW__') {
      // 强制清空所有字段
      titleInput.value = '';
      contentArea.value = '';
      setTimeout(() => titleInput.focus(), 50);
    } else {
      const target = this.currentScripts.find(s => s.id === this.activeScriptId);
      if (target) {
        titleInput.value = target.title;
        contentArea.value = target.content;
      }
    }
  }

  private bindLibPane() {
    const container = document.getElementById('script-list-container')!;
    const btnAdd = document.getElementById('btn-add-script')!;
    const btnSave = document.getElementById('btn-save-script')!;
    const btnDelete = document.getElementById('btn-delete-script')!;
    const btnPush = document.getElementById('btn-push-script')!;

    // 列表点击（事件委托）
    container.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest('.script-list-item') as HTMLElement;
      if (!item) return;
      this.activeScriptId = item.getAttribute('data-id');
      this.renderScriptList();
      this.showEditor();
    });

    // 新建
    btnAdd.addEventListener('click', () => {
      this.activeScriptId = '__NEW__';
      this.renderScriptList();
      this.showEditor();
    });

    // 保存
    btnSave.addEventListener('click', async () => {
      const titleInput = document.getElementById('edit-script-title') as HTMLInputElement;
      const contentArea = document.getElementById('edit-script-content') as HTMLTextAreaElement;
      if (!titleInput || !contentArea) return;

      const title = titleInput.value.trim();
      if (!title) return alert('请填写话术标题');

      const isNew = this.activeScriptId === '__NEW__';
      const newId = 'S' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
      
      const draft: ScriptItem = {
        id: isNew ? newId.toUpperCase() : this.activeScriptId!,
        createTime: isNew ? Date.now() : (this.currentScripts.find(s => s.id === this.activeScriptId)?.createTime || Date.now()),
        updateTime: Date.now(),
        title,
        content: contentArea.value
      };

      console.log(`[ScriptRenderer] ${isNew ? '新建' : '更新'}话术: ${draft.id} - ${draft.title}`);
      this.currentScripts = await ipcRenderer.invoke('save-script', draft);
      
      // 保存成功后，将 activeScriptId 设为刚保存的话术，变回编辑模式
      this.activeScriptId = draft.id;
      this.renderScriptList();
      this.renderRotateRows();

      btnSave.innerText = '已保存';
      setTimeout(() => btnSave.innerText = '保存', 1000);
    });

    // 删除
    btnDelete.addEventListener('click', async () => {
      if (this.activeScriptId === '__NEW__') {
        // 草稿直接丢弃
        this.activeScriptId = null;
        this.showEditor();
        return;
      }
      
      if (!this.activeScriptId) return;
      if (!confirm('确认删除该话术包？')) return;

      this.currentScripts = await ipcRenderer.invoke('delete-script', this.activeScriptId);
      this.activeScriptId = null;
      this.renderScriptList();
      this.renderRotateRows();
      this.showEditor();
    });

    // 推送到发送列表
    btnPush.addEventListener('click', () => {
      const contentArea = document.getElementById('edit-script-content') as HTMLTextAreaElement;
      const content = contentArea.value.trim();
      if (!content) return alert('话术内容为空');

      const txtCurrent = document.getElementById('txt-current-script') as HTMLTextAreaElement;
      if (txtCurrent) {
        txtCurrent.value = content;
        localStorage.setItem('cfg_global_scripts', content);
      }

      // 切换到发送设置标签
      const tabSend = document.querySelector('.s-tab[data-pane="pane-send"]') as HTMLElement;
      if (tabSend) tabSend.click();
    });
  }

  // ============ 自动轮转 ============
  private renderRotateRows() {
    const container = document.getElementById('rotate-rows');
    if (!container) return;

    container.innerHTML = '';
    const ROW_COUNT = 5;

    for (let i = 0; i < ROW_COUNT; i++) {
      const options = this.currentScripts.map(s =>
        `<option value="${s.id}">${s.title}</option>`
      ).join('');

      const row = document.createElement('div');
      row.style.cssText = 'display: flex; align-items: center; gap: 8px;';
      row.innerHTML = `
        <span style="font-weight: bold; width: 50px; font-size: 13px;">列表${i + 1}:</span>
        <select class="rotate-sel" data-idx="${i}" style="flex: 1; padding: 5px; border: 1px solid #ccc; border-radius: 4px; font-size: 13px;">
          <option value="">(留空跳过)</option>
          ${options}
        </select>
        <span style="font-size: 12px; color: #666;">间隔(秒):</span>
        <input type="number" class="rotate-min" value="60" min="1" style="width: 50px; padding: 5px; border: 1px solid #ccc; border-radius: 4px; text-align: center;" />
        <span style="color: #999;">~</span>
        <input type="number" class="rotate-max" value="120" min="1" style="width: 50px; padding: 5px; border: 1px solid #ccc; border-radius: 4px; text-align: center;" />
      `;
      container.appendChild(row);
    }
  }

  private loadRotateConfig() {
    const raw = localStorage.getItem('cfg_auto_rotate');
    if (!raw) return;
    try {
      const cfg = JSON.parse(raw);
      const chk = document.getElementById('chk-auto-rotate') as HTMLInputElement;
      if (chk) chk.checked = cfg.enabled;

      const selects = document.querySelectorAll('.rotate-sel') as NodeListOf<HTMLSelectElement>;
      const mins = document.querySelectorAll('.rotate-min') as NodeListOf<HTMLInputElement>;
      const maxs = document.querySelectorAll('.rotate-max') as NodeListOf<HTMLInputElement>;

      if (cfg.rows && Array.isArray(cfg.rows)) {
        cfg.rows.forEach((row: any, i: number) => {
          if (i < selects.length) {
            selects[i].value = row.scriptId || '';
            if (mins[i]) mins[i].value = String(row.min || 60);
            if (maxs[i]) maxs[i].value = String(row.max || 120);
          }
        });
      }

      this.updateRotateStatus(cfg.enabled);
    } catch (e) { /* 容错 */ }
  }

  private bindRotatePane() {
    const btnSave = document.getElementById('btn-save-rotate');
    if (!btnSave) return;

    btnSave.addEventListener('click', () => {
      const chk = document.getElementById('chk-auto-rotate') as HTMLInputElement;
      const enabled = chk?.checked || false;

      const selects = document.querySelectorAll('.rotate-sel') as NodeListOf<HTMLSelectElement>;
      const mins = document.querySelectorAll('.rotate-min') as NodeListOf<HTMLInputElement>;
      const maxs = document.querySelectorAll('.rotate-max') as NodeListOf<HTMLInputElement>;

      const rows: any[] = [];
      selects.forEach((sel, i) => {
        if (sel.value) {
          rows.push({
            scriptId: sel.value,
            min: parseInt(mins[i]?.value || '60'),
            max: parseInt(maxs[i]?.value || '120')
          });
        }
      });

      const cfg = { enabled, rows };
      localStorage.setItem('cfg_auto_rotate', JSON.stringify(cfg));

      // 启用且有配置时：立即将第一条话术推送到发送设置
      if (enabled && rows.length > 0) {
        const firstRow = rows[0];
        const firstScript = this.currentScripts.find(s => s.id === firstRow.scriptId);
        if (firstScript) {
          // 更新话术 localStorage
          localStorage.setItem('cfg_global_scripts', firstScript.content);
          // 更新发送设置 textarea（如果面板存在）
          const txtCurrent = document.getElementById('txt-current-script') as HTMLTextAreaElement;
          if (txtCurrent) {
            txtCurrent.value = firstScript.content;
          }

          // 同步间隔时间到全局设置
          localStorage.setItem('cfg_global_interval_min', String(firstRow.min));
          localStorage.setItem('cfg_global_interval_max', String(firstRow.max));
          const inputMin = document.getElementById('global-interval-min') as HTMLInputElement;
          const inputMax = document.getElementById('global-interval-max') as HTMLInputElement;
          if (inputMin) inputMin.value = String(firstRow.min);
          if (inputMax) inputMax.value = String(firstRow.max);

          // 同步到 Main 进程正在运行的调度器（话术 + 间隔）
          const newScripts = firstScript.content.split('\n').map(s => s.trim()).filter(s => s.length > 0);
          if (newScripts.length > 0) {
            ipcRenderer.send(IpcChannels.UPDATE_GLOBAL_SCRIPTS, {
              scripts: newScripts,
              minInterval: firstRow.min,
              maxInterval: firstRow.max
            });
          }
          console.log(`[AutoRotate] 保存并立即推送第一条话术: ${firstScript.title}，间隔 ${firstRow.min}-${firstRow.max}s`);
        }
        // 设置当前轮转索引为 0（第一条已推送，ROTATE_ADVANCE 将推进到下一条）
        localStorage.setItem('cfg_rotate_current_idx', '0');
        // 停止旧的定时器方式轮转（轮转现在由 ROTATE_ADVANCE 事件驱动）
        this.stopAutoRotate();
      } else {
        this.stopAutoRotate();
        localStorage.removeItem('cfg_rotate_current_idx');
      }

      this.updateRotateStatus(enabled);
      btnSave.innerText = '已保存';
      setTimeout(() => btnSave.innerText = '保存轮转设置', 1000);
    });
  }

  private updateRotateStatus(enabled: boolean) {
    const el = document.getElementById('rotate-status');
    if (!el) return;
    el.innerText = enabled ? '轮转已启用' : '轮转未启用';
    el.style.color = enabled ? '#52c41a' : '#888';
  }

  /**
   * 启动自动轮转定时器
   * 逻辑：按顺序循环选取配置的话术包，每隔指定时间自动切换全局发送列表
   */
  private startAutoRotate(rows: { scriptId: string; min: number; max: number }[]) {
    this.stopAutoRotate();
    if (rows.length === 0) return;

    let currentIdx = 0;

    const doRotate = async () => {
      const row = rows[currentIdx % rows.length];
      // 从话术库获取最新内容
      let scripts: ScriptItem[] = [];
      try {
        scripts = await ipcRenderer.invoke('get-scripts');
      } catch (e) {
        scripts = this.currentScripts;
      }

      const target = scripts.find(s => s.id === row.scriptId);
      if (target) {
        // 1. 更新 localStorage，供下次"开始"按钮读取
        localStorage.setItem('cfg_global_scripts', target.content);

        // 2. 更新发送设置 textarea（如果面板打开中）
        const txtCurrent = document.getElementById('txt-current-script') as HTMLTextAreaElement;
        if (txtCurrent) {
          txtCurrent.value = target.content;
        }

        // 3. 同步间隔时间到全局设置
        localStorage.setItem('cfg_global_interval_min', String(row.min));
        localStorage.setItem('cfg_global_interval_max', String(row.max));
        const inputMin = document.getElementById('global-interval-min') as HTMLInputElement;
        const inputMax = document.getElementById('global-interval-max') as HTMLInputElement;
        if (inputMin) inputMin.value = String(row.min);
        if (inputMax) inputMax.value = String(row.max);

        // 4. 通知 Main 进程更新正在运行的调度器（话术 + 间隔）
        const newScripts = target.content.split('\n').map(s => s.trim()).filter(s => s.length > 0);
        if (newScripts.length > 0) {
          ipcRenderer.send(IpcChannels.UPDATE_GLOBAL_SCRIPTS, {
            scripts: newScripts,
            minInterval: row.min,
            maxInterval: row.max
          });
        }

        console.log(`[AutoRotate] 🔄 切换至话术: ${target.title} (${newScripts.length} 条)，间隔 ${row.min}-${row.max}s`);
      }

      currentIdx++;

      // 计算下次轮转的随机延迟（取当前行的间隔配置）
      const delaySec = row.min + Math.floor(Math.random() * (row.max - row.min + 1));
      console.log(`[AutoRotate] ⏱️ 下次轮转: ${delaySec} 秒后`);
      this.rotateTimer = setTimeout(doRotate, delaySec * 1000);
    };

    // 立即执行第一次轮转
    doRotate();
  }

  private stopAutoRotate() {
    if (this.rotateTimer) {
      clearTimeout(this.rotateTimer);
      this.rotateTimer = null;
    }
  }

  /**
   * 应用启动时恢复自动轮转状态
   * 轮转现在由 ROTATE_ADVANCE 事件驱动（Main 进程发送），这里只恢复索引
   */
  private restoreAutoRotate() {
    const raw = localStorage.getItem('cfg_auto_rotate');
    if (!raw) return;
    try {
      const cfg = JSON.parse(raw);
      if (cfg.enabled && cfg.rows && cfg.rows.length > 0) {
        // 确保索引存在，但不启动定时器
        if (!localStorage.getItem('cfg_rotate_current_idx')) {
          localStorage.setItem('cfg_rotate_current_idx', '0');
        }
        console.log(`[AutoRotate] 轮转已启用 (${cfg.rows.length} 个话术包)，等待全局发送启动后自动推进`);
      }
    } catch (e) { /* 容错 */ }
  }
}
