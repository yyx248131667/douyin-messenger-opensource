/**
 * @file partition-registry.ts
 * @description 全局 Partition 注册表。
 * 所有涉及 webview partition / session 的代码必须通过此模块获取 partition 名称，
 * 杜绝因命名不一致导致的账号丢失（如双前缀 persist:account_account_1）。
 */

export class PartitionRegistry {
  /**
   * 根据账号 ID 生成标准化的 partition 名称。
   * 规则：partition = persist:{accountId}
   * 
   * 举例：
   *   - accountId = 'account_1' → 'persist:account_1'
   *   - accountId = 'acc_1713000000' → 'persist:acc_1713000000'
   * 
   * ⚠️ 绝对禁止在此处添加额外前缀！accountId 本身就是唯一标识。
   */
  public static getPartitionName(accountId: string): string {
    return `persist:${accountId}`;
  }

  /**
   * 从 partition 名称中反向提取 accountId。
   * 用于崩溃恢复、日志溯源等场景。
   */
  public static extractAccountId(partitionName: string): string | null {
    const match = partitionName.match(/^persist:(.+)$/);
    return match ? match[1] : null;
  }

  /**
   * 验证 accountId 是否符合规范（不包含 persist: 前缀）。
   * 防止错误地把 partition 名当成 accountId 使用。
   */
  public static isValidAccountId(accountId: string): boolean {
    if (!accountId || accountId.includes('persist:')) {
      console.error(`[PartitionRegistry] ❌ 非法 accountId: "${accountId}"，不允许包含 "persist:" 前缀`);
      return false;
    }
    return true;
  }
}
