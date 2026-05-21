import { ipcRenderer } from 'electron';
import { IpcChannels } from '../../main/ipc/channels';

interface ScheduledTask {
  roomUrl: string;
  scriptContent: string;
  startTime: number;
  shutdownAfterMs: number;
}

export class TimerRenderer {
  private shutdownTime: number | null = null;
  private barrageTime: number | null = null;
  private scheduledTask: ScheduledTask | null = null;
  private checkInterval: any;
  private countdownInterval: any = null;

  constructor() {
    this.checkInterval = setInterval(() => this.checkTimers(), 1000);
  }

  public render(triggerBtnId: string) {
    const btn = document.getElementById(triggerBtnId);
    if (btn) {
      btn.addEventListener('click', () => this.openModal());
    }
  }

  private checkTimers() {
    const now = Date.now();

    if (this.shutdownTime && now >= this.shutdownTime) {
      this.shutdownTime = null;
      ipcRenderer.send(IpcChannels.APP_QUIT);
    }

    if (this.barrageTime && now >= this.barrageTime) {
      this.barrageTime = null;

      // 如果有关联的定时任务配置，先应用直播间和话术
      if (this.scheduledTask) {
        // 设置直播间 URL
        if (this.scheduledTask.roomUrl) {
          const urlInput = document.getElementById('global-room-url') as HTMLInputElement;
          if (urlInput) {
            urlInput.value = this.scheduledTask.roomUrl;
            localStorage.setItem('global-room-url', this.scheduledTask.roomUrl);
          }
          // 触发同步直播间按钮，将 URL 同步到所有 webview
          const syncBtn = document.getElementById('btn-sync-room') as HTMLButtonElement;
          if (syncBtn) {
            syncBtn.click();
          }
        }
        // 设置话术内容
        if (this.scheduledTask.scriptContent) {
          localStorage.setItem('cfg_global_scripts', this.scheduledTask.scriptContent);
        }
        // 设置自动关闭时间
        if (this.scheduledTask.shutdownAfterMs > 0) {
          this.shutdownTime = Date.now() + this.scheduledTask.shutdownAfterMs;
        }
        this.scheduledTask = null;

        // 等待同步完成后启动（5秒让 webview 导航到新直播间）
        setTimeout(() => {
          const btnStart = document.getElementById('btn-global-toggle');
          if (btnStart) btnStart.click();

          const logs = document.getElementById('timer-logs');
          if (logs) {
            logs.innerHTML = `<div style="color:#52c41a; font-size:13px;">弹幕发送已于 ${new Date().toLocaleTimeString()} 自动启动（同步直播间后）</div>`;
          }
        }, 5000);
      } else {
        // 没有关联任务，直接启动
        const btnStart = document.getElementById('btn-global-toggle');
        if (btnStart) btnStart.click();

        const logs = document.getElementById('timer-logs');
        if (logs) {
          logs.innerHTML = `<div style="color:#52c41a; font-size:13px;">弹幕发送已于 ${new Date().toLocaleTimeString()} 自动启动</div>`;
        }
      }
    }
  }

  private formatCountdown(ms: number): string {
    if (ms <= 0) return '已到期';
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const parts: string[] = [];
    if (h > 0) parts.push(`${h}小时`);
    if (m > 0) parts.push(`${m}分钟`);
    parts.push(`${s}秒`);
    return parts.join(' ');
  }

  /**
   * 获取本地时间的 datetime-local 格式字符串
   */
  private getLocalDateTimeString(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  }

  /**
   * 获取已保存的话术列表（从 IPC 获取话术库）
   */
  private async getScriptList(): Promise<{ id: string; name: string; content: string }[]> {
    try {
      const scripts = await ipcRenderer.invoke('get-scripts');
      return scripts.map((s: any) => ({
        id: s.id,
        name: s.title || s.name || '未命名话术',
        content: s.content
      }));
    } catch {
      return [];
    }
  }

  private startCountdownRefresh() {
    if (this.countdownInterval) clearInterval(this.countdownInterval);
    this.countdownInterval = setInterval(() => {
      const barS = document.getElementById('status-barrage');
      const shutS = document.getElementById('status-shutdown');
      if (barS) {
        if (this.barrageTime) {
          const remaining = this.barrageTime - Date.now();
          barS.innerHTML = `当前状态: <span style="color:#1890ff; font-weight:bold;">倒计时 ${this.formatCountdown(remaining)}</span>`;
        } else {
          barS.innerText = '当前状态: 未设置';
        }
      }
      if (shutS) {
        if (this.shutdownTime) {
          const remaining = this.shutdownTime - Date.now();
          shutS.innerHTML = `当前状态: <span style="color:#ff4d4f; font-weight:bold;">倒计时 ${this.formatCountdown(remaining)}</span>`;
        } else {
          shutS.innerText = '当前状态: 未设置';
        }
      }
    }, 1000);
  }

  private async openModal() {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.id = 'modal-timer';

    const barrageStatusText = this.barrageTime
      ? `倒计时 ${this.formatCountdown(this.barrageTime - Date.now())}`
      : '未设置';
    const shutdownStatusText = this.shutdownTime
      ? `倒计时 ${this.formatCountdown(this.shutdownTime - Date.now())}`
      : '未设置';

    // 获取已保存的直播间列表
    let savedRooms: { name: string; url: string }[] = [];
    try {
      const stored = localStorage.getItem('cfg_saved_rooms');
      if (stored) savedRooms = JSON.parse(stored);
    } catch { /* ignore */ }
    const roomOptions = savedRooms.map(r =>
      `<option value="${r.url}">${r.name} (${r.url.replace('https://live.douyin.com/', '')})</option>`
    ).join('');

    // 获取话术库列表
    const scriptList = await this.getScriptList();
    const scriptOptions = scriptList.map(s =>
      `<option value="${s.id}">${s.name}</option>`
    ).join('');

    // 默认时间：当前时间 + 5 分钟
    const defaultTime = new Date(Date.now() + 5 * 60 * 1000);
    const defaultTimeStr = this.getLocalDateTimeString(defaultTime);

    // 当前直播间 URL
    const currentRoomUrl = (document.getElementById('global-room-url') as HTMLInputElement)?.value || '';

    const inputStyle = 'width:100%; border:1px solid #d9d9d9; border-radius:4px; padding:8px 10px; font-size:14px; outline:none; box-sizing:border-box;';
    const selectStyle = 'width:100%; border:1px solid #d9d9d9; border-radius:4px; padding:8px 10px; font-size:14px; outline:none; box-sizing:border-box; background:#fff;';
    const labelStyle = 'font-size:13px; color:#666; margin-bottom:6px; display:block;';
    const btnStyle = 'border:none; padding:6px 16px; border-radius:4px; cursor:pointer; font-size:13px; font-weight:600;';
    const quickBtnStyle = `${btnStyle} background:#f0f0f0; color:#333; margin-right:6px;`;
    const quickBtnActiveStyle = `${btnStyle} background:#1890ff; color:#fff; margin-right:6px;`;
    const sectionStyle = 'margin-bottom:20px; padding-bottom:18px; border-bottom:1px dashed #e8e8e8;';

    overlay.innerHTML = `
      <div class="modal-content" style="max-width:620px; padding:22px 28px; background:#fff; border-radius:10px; border:1px solid #e8e8e8; box-shadow:0 6px 30px rgba(0,0,0,0.18);">
        <div class="modal-header" style="border-bottom:1px solid #eee; padding:0 0 12px 0; display:flex; align-items:center; justify-content:space-between;">
          <div style="color:#333; font-size:17px; font-weight:bold;">⏰ 定时任务管理</div>
          <span id="btn-close-timer" style="color:#999; font-size:22px; cursor:pointer;" title="关闭">&times;</span>
        </div>

        <div style="padding:16px 0 0 0; color:#333;">
          
          <!-- 定时启动发弹幕 -->
          <div style="${sectionStyle}">
            <div style="font-size:15px; font-weight:bold; margin-bottom:14px; color:#1890ff;">
              📡 定时启动发弹幕 (启动群控)
            </div>

            <div style="margin-bottom:12px;">
              <label style="${labelStyle}">直播间链接</label>
              <select id="timer-room-select" style="width:100%; border:1px solid #d9d9d9; border-radius:4px; padding:8px 10px; font-size:14px; outline:none; box-sizing:border-box; background:#fff; margin-bottom:6px; cursor:pointer;">
                <option value="">-- 手动输入 --</option>
                ${roomOptions}
              </select>
              <input type="text" id="timer-room-url" value="${currentRoomUrl}" placeholder="https://live.douyin.com/..." style="${inputStyle}" />
            </div>

            <div style="display:grid; grid-template-columns:1fr; gap:12px; margin-bottom:12px;">
              <div>
                <label style="${labelStyle}">关联话术</label>
                <select id="timer-script-select" style="${selectStyle}">
                  <option value="">-- 使用当前话术 --</option>
                  ${scriptOptions}
                </select>
              </div>
            </div>

            <div style="margin-bottom:12px;">
              <label style="${labelStyle}">启动时间</label>
              <input type="datetime-local" id="timer-start-time" value="${defaultTimeStr}" style="${inputStyle} width:280px;" />
            </div>

            <div style="margin-bottom:12px;">
              <label style="${labelStyle}">运行时长（自动关闭）</label>
              <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                <button class="timer-duration-btn" data-duration="0" style="${quickBtnActiveStyle}">不限</button>
                <button class="timer-duration-btn" data-duration="3600000" style="${quickBtnStyle}">1小时</button>
                <button class="timer-duration-btn" data-duration="7200000" style="${quickBtnStyle}">2小时</button>
                <button class="timer-duration-btn" data-duration="10800000" style="${quickBtnStyle}">3小时</button>
                <button class="timer-duration-btn" data-duration="14400000" style="${quickBtnStyle}">4小时</button>
                <button class="timer-duration-btn" data-duration="21600000" style="${quickBtnStyle}">6小时</button>
              </div>
              <input type="hidden" id="timer-duration-value" value="0" />
            </div>

            <div style="display:flex; gap:8px;">
              <button id="btn-set-barrage" style="${btnStyle} background:#1890ff; color:#fff;">设置定时</button>
              <button id="btn-cancel-barrage" style="${btnStyle} background:#ff4d4f; color:#fff;">取消</button>
            </div>

            <div id="status-barrage" style="margin-top:10px; font-size:13px; color:#888;">
              当前状态: ${barrageStatusText}
            </div>
          </div>

          <!-- 定时关闭软件 -->
          <div style="margin-bottom:10px;">
            <div style="font-size:15px; font-weight:bold; margin-bottom:14px; color:#ff4d4f;">
              🔌 定时关闭软件
            </div>

            <div style="display:flex; align-items:center; gap:6px; margin-bottom:12px; flex-wrap:wrap;">
              <div style="display:flex; align-items:center; gap:4px;">
                <input type="number" id="shutdown-hour" min="0" max="23" value="0" style="width:55px; text-align:center; border:1px solid #d9d9d9; border-radius:4px; padding:6px 4px; font-size:14px; outline:none;" />
                <span style="font-size:13px; color:#666;">时</span>
                <input type="number" id="shutdown-min" min="0" max="59" value="0" style="width:55px; text-align:center; border:1px solid #d9d9d9; border-radius:4px; padding:6px 4px; font-size:14px; outline:none;" />
                <span style="font-size:13px; color:#666;">分</span>
              </div>
              <div style="display:flex; gap:4px; margin-left:6px;">
                <button class="shutdown-quick-btn" data-ms="3600000" style="${quickBtnStyle}">1小时</button>
                <button class="shutdown-quick-btn" data-ms="7200000" style="${quickBtnStyle}">2小时</button>
                <button class="shutdown-quick-btn" data-ms="10800000" style="${quickBtnStyle}">3小时</button>
              </div>
            </div>

            <div style="display:flex; gap:8px;">
              <button id="btn-set-shutdown" style="${btnStyle} background:#1890ff; color:#fff;">设置</button>
              <button id="btn-cancel-shutdown" style="${btnStyle} background:#ff4d4f; color:#fff;">取消</button>
            </div>

            <div id="status-shutdown" style="margin-top:10px; font-size:13px; color:#888;">
              当前状态: ${shutdownStatusText}
            </div>
          </div>

          <div id="timer-logs" style="margin-top:15px; font-size:13px;"></div>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // 关闭按钮
    document.getElementById('btn-close-timer')?.addEventListener('click', () => {
      if (this.countdownInterval) clearInterval(this.countdownInterval);
      this.countdownInterval = null;
      overlay.remove();
    });

    // 启动实时倒计时
    this.startCountdownRefresh();

    // 直播间下拉选择 → 自动填充 URL 输入框
    const roomSelect = document.getElementById('timer-room-select') as HTMLSelectElement;
    const roomUrlInput = document.getElementById('timer-room-url') as HTMLInputElement;
    if (roomSelect && roomUrlInput) {
      roomSelect.addEventListener('change', () => {
        if (roomSelect.value) {
          roomUrlInput.value = roomSelect.value;
        }
      });
    }

    // 运行时长快捷按钮
    const durationBtns = overlay.querySelectorAll('.timer-duration-btn');
    durationBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        durationBtns.forEach(b => {
          (b as HTMLElement).style.background = '#f0f0f0';
          (b as HTMLElement).style.color = '#333';
        });
        (btn as HTMLElement).style.background = '#1890ff';
        (btn as HTMLElement).style.color = '#fff';
        const hiddenInput = document.getElementById('timer-duration-value') as HTMLInputElement;
        if (hiddenInput) hiddenInput.value = btn.getAttribute('data-duration') || '0';
      });
    });

    // 关闭软件快捷按钮
    const shutdownQuickBtns = overlay.querySelectorAll('.shutdown-quick-btn');
    shutdownQuickBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const ms = parseInt(btn.getAttribute('data-ms') || '0');
        const hours = Math.floor(ms / 3600000);
        const mins = Math.floor((ms % 3600000) / 60000);
        const hourInput = document.getElementById('shutdown-hour') as HTMLInputElement;
        const minInput = document.getElementById('shutdown-min') as HTMLInputElement;
        if (hourInput) hourInput.value = String(hours);
        if (minInput) minInput.value = String(mins);

        // 高亮当前选中
        shutdownQuickBtns.forEach(b => {
          (b as HTMLElement).style.background = '#f0f0f0';
          (b as HTMLElement).style.color = '#333';
        });
        (btn as HTMLElement).style.background = '#1890ff';
        (btn as HTMLElement).style.color = '#fff';
      });
    });

    // 设置弹幕定时
    document.getElementById('btn-set-barrage')?.addEventListener('click', async () => {
      const timeInput = document.getElementById('timer-start-time') as HTMLInputElement;
      if (!timeInput || !timeInput.value) {
        alert('请选择启动时间！');
        return;
      }

      const startTime = new Date(timeInput.value).getTime();
      if (startTime <= Date.now()) {
        alert('启动时间必须在当前时间之后！');
        return;
      }

      // 获取直播间 URL
      const roomUrl = (document.getElementById('timer-room-url') as HTMLInputElement)?.value || '';

      // 获取关联话术内容
      let scriptContent = '';
      const scriptSelect = document.getElementById('timer-script-select') as HTMLSelectElement;
      if (scriptSelect && scriptSelect.value) {
        const selectedScript = scriptList.find(s => s.id === scriptSelect.value);
        if (selectedScript) {
          scriptContent = selectedScript.content;
        }
      }

      // 获取运行时长
      const durationMs = parseInt((document.getElementById('timer-duration-value') as HTMLInputElement)?.value || '0');

      this.barrageTime = startTime;
      this.scheduledTask = {
        roomUrl,
        scriptContent,
        startTime,
        shutdownAfterMs: durationMs
      };

      // 更新状态显示
      const statusEl = document.getElementById('status-barrage');
      if (statusEl) {
        const startStr = new Date(startTime).toLocaleString();
        const durationStr = durationMs > 0 ? `，运行 ${durationMs / 3600000} 小时后自动关闭` : '';
        statusEl.innerHTML = `当前状态: <span style="color:#1890ff; font-weight:bold;">已设置 ${startStr} 启动${durationStr}</span>`;
      }
    });

    // 取消弹幕定时
    document.getElementById('btn-cancel-barrage')?.addEventListener('click', () => {
      this.barrageTime = null;
      this.scheduledTask = null;
    });

    // 设置关机定时
    document.getElementById('btn-set-shutdown')?.addEventListener('click', () => {
      const h = parseInt((document.getElementById('shutdown-hour') as HTMLInputElement)?.value || '0');
      const m = parseInt((document.getElementById('shutdown-min') as HTMLInputElement)?.value || '0');
      const offsetMs = ((h * 3600) + (m * 60)) * 1000;
      if (offsetMs <= 0) {
        alert('请设置大于 0 的时间！');
        return;
      }
      this.shutdownTime = Date.now() + offsetMs;
    });

    // 取消关机定时
    document.getElementById('btn-cancel-shutdown')?.addEventListener('click', () => {
      this.shutdownTime = null;
    });
  }
}
