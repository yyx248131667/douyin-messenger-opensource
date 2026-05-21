/**
 * @file auto-reply.usecase.ts
 * @description Coordinate auto-reply phrasing limits and script normalization.
 */

import { StorageService } from '../../infrastructure/storage/storage-service';

export interface ScriptsConfig {
  [categoryName: string]: string[];
}

export class AutoReplyUseCase {
  private scriptsStorage: StorageService<ScriptsConfig>;
  private memoryCache: ScriptsConfig = {};
  
  // 核心风控：全局短期间内不可发送极其相似的语句，防所有账号集体被封
  private globalSentHistory: Map<string, number> = new Map();

  constructor() {
    this.scriptsStorage = new StorageService<ScriptsConfig>('scripts.json', { '默认打招呼': ['你好主播', '刚来，主播好'] });
  }

  public loadScripts(): ScriptsConfig {
    const raw = this.scriptsStorage.read();
    
    // Normalize logic: filter out empty lists and empty strings
    const normalized: ScriptsConfig = {};
    for (const [category, lines] of Object.entries(raw)) {
      if (Array.isArray(lines)) {
        const cleaned = lines.map(l => l.trim()).filter(l => l.length > 0);
        if (cleaned.length > 0) {
          normalized[category] = cleaned;
        }
      }
    }

    this.memoryCache = normalized;
    return this.memoryCache;
  }

  public saveScripts(config: ScriptsConfig): void {
    this.memoryCache = config;
    this.scriptsStorage.write(config);
  }

  /**
   * 按类别抽取话术（附加去重风控与频率限制）
   * @param category 话术包名称
   * @param accountId 发送方
   * @param cooldownMs 同一条风控时间内的冷却期（避免在短时间内多个账号随机选到同一个词导致炸群）
   */
  public extractSafeRandomPhrase(category: string, accountId: string, cooldownMs: number = 20000): string | null {
    if (!this.memoryCache[category]) {
      this.loadScripts(); // Attempt reload if not found
    }

    const phrases = this.memoryCache[category];
    if (!phrases || phrases.length === 0) return null;

    // 清理过期的全平台发送记录
    const now = Date.now();
    for (const [msg, timestamp] of this.globalSentHistory.entries()) {
      if (now - timestamp > cooldownMs) {
        this.globalSentHistory.delete(msg);
      }
    }

    // 筛选出不在冷却期的话术
    const availablePhrases = phrases.filter(p => !this.globalSentHistory.has(p));
    
    // 如果全部都在冷却中（说明脚本太少且账号太多），强行随机挑一个，但在末尾增加不可见字符或随机量
    if (availablePhrases.length === 0) {
      console.warn(`[AutoReply] Phrase exhaustion for category ${category}, bypassing limits for account ${accountId}`);
      const forcedRandom = phrases[Math.floor(Math.random() * phrases.length)];
      return this.saltPhrase(forcedRandom);
    }

    const hit = availablePhrases[Math.floor(Math.random() * availablePhrases.length)];
    this.globalSentHistory.set(hit, now);
    
    return hit;
  }

  /**
   * 若话术耗尽发生冲突，添加随机不可见空白字符或安全噪音破除防沉迷检测。
   */
  private saltPhrase(phrase: string): string {
    const zeroWidthSpaces = ['\u200b', '\u200c', '\u200d'];
    const randomSalt = zeroWidthSpaces[Math.floor(Math.random() * zeroWidthSpaces.length)];
    return `${phrase}${randomSalt}`;
  }
}
