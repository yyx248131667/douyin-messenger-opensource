import { Message } from '../../domain/message/Message';

export interface SendMessageConfig {
  minInterval: number;
  maxInterval: number;
  scripts: string[]; // List of available phrases
  sendMode?: 'random' | 'sequential'; // Option to send sequentially
  loopCount?: number; // 0 for infinite, >0 for specific iterations
}

type DeliveryFunction = (accountId: string, content: string) => Promise<boolean>;

export class MessageScheduler {
  private activeTimers: Map<string, NodeJS.Timeout> = new Map();
  private configs: Map<string, SendMessageConfig> = new Map();
  private sequentialCursors: Map<string, number> = new Map();

  constructor(private readonly deliveryFn: DeliveryFunction) {}

  public startSchedule(accountId: string, config: SendMessageConfig) {
    this.stopSchedule(accountId); // Ensure clear state
    this.configs.set(accountId, config);
    if (config.sendMode === 'sequential') {
      this.sequentialCursors.set(accountId, 0); // Reset cursor on start
    }
    console.log(`[Scheduler] Started for ${accountId}`);
    this.scheduleNext(accountId);
  }

  public stopSchedule(accountId: string) {
    if (this.activeTimers.has(accountId)) {
      clearTimeout(this.activeTimers.get(accountId)!);
      this.activeTimers.delete(accountId);
      this.sequentialCursors.delete(accountId);
    }
  }

  private scheduleNext(accountId: string) {
    const config = this.configs.get(accountId);
    if (!config) return;

    if (!config.scripts || config.scripts.length === 0) {
      console.warn(`[Scheduler] No scripts configured for ${accountId}, stopping.`);
      return;
    }

    // Calculate delay with a minimum of 1s floor
    const rawDelay = Math.floor(Math.random() * (config.maxInterval - config.minInterval + 1)) + config.minInterval;
    const delay = Math.max(1, isNaN(rawDelay) ? 2 : rawDelay);
    
    const timer = setTimeout(async () => {
      let scriptToSend = '';
      
      if (config.sendMode === 'sequential') {
        const cursor = this.sequentialCursors.get(accountId) || 0;
        scriptToSend = config.scripts[cursor];
        this.sequentialCursors.set(accountId, (cursor + 1) % config.scripts.length);
      } else {
        // default to random
        scriptToSend = config.scripts[Math.floor(Math.random() * config.scripts.length)];
      }
      
      console.log(`[Scheduler] Preparing to send via DeliveryFn for ${accountId}: ${scriptToSend}`);
      const success = await this.deliveryFn(accountId, scriptToSend);
      
      if (success) {
        console.log(`[Scheduler] Message successfully dispatched to Queue Worker for ${accountId}`);
      } else {
        console.error(`[Scheduler] Failed to dispatch to Queue for ${accountId}`);
      }

      // Re-schedule
      this.scheduleNext(accountId);
    }, delay * 1000);

    this.activeTimers.set(accountId, timer);
  }
}
