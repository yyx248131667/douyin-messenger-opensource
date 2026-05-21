/**
 * @file license-handler.ts
 * @description 开源版：授权系统已移除，始终返回已激活状态。
 */

export class LicenseHandler {
  public static register(): void {
    // 开源版无需授权验证
  }

  public static checkActivationSync(): { activated: boolean; message: string } {
    return { activated: true, message: '开源版本，无需激活' };
  }

  public static async checkActivationAsync(): Promise<{ activated: boolean; message: string }> {
    return { activated: true, message: '开源版本，无需激活' };
  }
}
