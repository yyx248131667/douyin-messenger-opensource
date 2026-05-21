/**
 * @file sign-service.ts
 * @description 开源版：抖音签名服务桩。
 * 
 * 原版使用私有的 dy_ab.js / dy_live_sign.js 生成 a_bogus 和 msToken 签名。
 * 开源版不包含这些文件，需要用户自行实现或使用第三方方案。
 * 
 * 如需集成签名服务，请实现以下三个方法的实际逻辑：
 * - generateABogus()
 * - generateWsSignature()
 * - generateMsToken()
 */

export class DouyinSignService {
  private static isInitialized = false;

  /**
   * 初始化签名引擎（开源版空实现）
   */
  public static init(): void {
    if (this.isInitialized) return;
    console.warn('[DouyinSignService] 开源版未集成签名引擎，签名相关功能将返回空值。');
    console.warn('[DouyinSignService] 如需启用签名，请自行实现 sign-service.ts 中的方法。');
    this.isInitialized = true;
  }

  /**
   * 生成 A-Bogus 签名
   * @returns 开源版始终返回 null
   */
  public static generateABogus(query: string, data: string = ""): string | null {
    if (!this.isInitialized) this.init();
    console.warn('[DouyinSignService] generateABogus: 返回空值（需自行实现）');
    return null;
  }

  /**
   * 生成 WebSocket 连接签名 (X-Bogus)
   * @returns 开源版始终返回 null
   */
  public static generateWsSignature(roomId: string, userId: string): string | null {
    if (!this.isInitialized) this.init();
    console.warn('[DouyinSignService] generateWsSignature: 返回空值（需自行实现）');
    return null;
  }

  /**
   * 生成随机 msToken
   * @returns 随机字符串（此功能不依赖外部引擎，可直接使用）
   */
  public static generateMsToken(length: number = 107): string {
    const chars = 'ABCDEFGHIGKLMNOPQRSTUVWXYZabcdefghigklmnopqrstuvwxyz0123456789=';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }
}
