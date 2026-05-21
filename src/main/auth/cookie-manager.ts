/**
 * @file cookie-manager.ts
 * @description Cookie 管理器。
 * 
 * 完全依赖 Chromium 内置的 Partition 原生 Session 管理。
 */

import { session } from 'electron';
import { PartitionRegistry } from '../../shared/partition-registry';

export class CookieManager {

  /**
   * 返回旧版资产库中的账号 Key（已废弃，保留空实现以兼容 IPC 接口）
   */
  public static getLegacyAccountIds(): string[] {
    return [];
  }

  /**
   * 从 Chromium Partition 原生 Session 中获取 Cookie 字符串
   */
  public static async getCookieStringForAccount(accountId: string): Promise<string> {
    const partitionName = PartitionRegistry.getPartitionName(accountId);
    const accountSession = session.fromPartition(partitionName);
    
    const nativeCookies = await accountSession.cookies.get({ domain: '.douyin.com' });

    if (nativeCookies.length === 0) {
       console.warn(`[CookieManager] 警告：分区 ${accountId} 中无凭证，请扫码登录。`);
    }

    return nativeCookies.map(c => `${c.name}=${c.value}`).join('; ');
  }
}
