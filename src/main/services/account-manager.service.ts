export class AccountManagerService {
  // Set of accounts running in WebView mode
  private static webviewAccounts: Set<string> = new Set(); 

  public static markAsWebview(accountId: string) {
    this.webviewAccounts.add(accountId);
  }

  public static isHeadless(accountId: string): boolean {
    // API mode has been disabled and saved separately. 
    // Sending messages strictly via DOM in WebView to avoid shadow bans.
    return false; 
  }

  public static async executeAction(accountId: string, roomId: string, payload: any): Promise<boolean> {
    // Defer to RetryScheduler's IPC injection fallback.
    return false; 
  }

  public static getAccountStatus(accountId: string): string {
    return 'healthy'; // Status management simplified for webview
  }
}
