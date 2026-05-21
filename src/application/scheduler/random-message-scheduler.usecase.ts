/**
 * @file random-message-scheduler.usecase.ts
 * @description Coordinate randomly distributed messages across ALL logged-in accounts.
 * This ensures audience sees scattered real-looking chats instead of uniform bursts.
 */

import { AccountStateMachine } from '../../domain/account/AccountStateMachine';
import { AutoReplyUseCase } from '../usecases/auto-reply.usecase';
import { IpcChannels } from '../../main/ipc/channels';
import { ipcMain } from 'electron';

export class RandomMessageScheduler {
  private machine: AccountStateMachine;
  private autoReply: AutoReplyUseCase;
  private isRunning: boolean = false;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(machine: AccountStateMachine) {
    this.machine = machine;
    this.autoReply = new AutoReplyUseCase();
  }

  /**
   * Starts the global randomized dispatcher.
   * @param minDelayMs Minimum time to wait before next global message
   * @param maxDelayMs Maximum time to wait before next global message
   */
  public start(minDelayMs: number = 3000, maxDelayMs: number = 8000) {
    if (this.isRunning) return;
    this.isRunning = true;
    
    console.log(`[RandomScheduler] Started Global Random Execution Plan`);
    this.scheduleNext(minDelayMs, maxDelayMs);
  }

  public stop() {
    this.isRunning = false;
    if (this.intervalTimer) {
      clearTimeout(this.intervalTimer);
      this.intervalTimer = null;
    }
    console.log(`[RandomScheduler] Stopped execution.`);
  }

  private scheduleNext(minDelayMs: number, maxDelayMs: number) {
    if (!this.isRunning) return;

    // Pick random delay
    const delay = Math.floor(Math.random() * (maxDelayMs - minDelayMs + 1)) + minDelayMs;
    
    this.intervalTimer = setTimeout(() => {
      this.executeRandomFire();
      // Recurse for the next shot
      this.scheduleNext(minDelayMs, maxDelayMs);
    }, delay);
  }

  private executeRandomFire() {
    // 1. Gather all ELIGIBLE machines (must be Logged In, not locked, not closed)
    const eligibleAccounts = this.machine.getAll().filter(account => {
      return account.state === 'LOGGED_IN';
    });

    if (eligibleAccounts.length === 0) {
      console.log(`[RandomScheduler] Skipped: No accounts currently logged in and ready.`);
      return;
    }

    // 2. Select a completely random account
    const luckyAccount = eligibleAccounts[Math.floor(Math.random() * eligibleAccounts.length)];
    const accountId = luckyAccount.data.id;

    // 3. Extract safe, collision-free phrase
    const phrase = this.autoReply.extractSafeRandomPhrase('默认打招呼', accountId, 25000);
    
    if (!phrase) {
      console.warn(`[RandomScheduler] Empty phrase database, skipping.`);
      return;
    }

    console.log(`=====> [RandomScheduler] Randomly picked [${accountId}] to send: ${phrase}`);

    // 4. Request the Webview Controller (through IPC Event or Main handler) to execute
    // Inside the Main process, we broadcast an internal IPC down to the specific Webview wrapper.
    // Wait, the main process cannot broadcast directly to a webview inside HTML unless it sends over the renderer
    // OR we lookup the WebContents of the webview directly.
    
    // the safest Electron pattern: send it to Renderer to dispatch to Webview
    const mainWindow = require('electron').BrowserWindow.getAllWindows()[0];
    if (mainWindow) {
      mainWindow.webContents.send(IpcChannels.PAGE_ACTION, {
        accountId: accountId,
        action: 'send-message',
        message: phrase,
        mode: 'api' // 默认优先走接口发信，失败退级走界面发
      });
    }

    // Notice: RandomMessageScheduler only dispatches, tracking state is optional.
  }
}
