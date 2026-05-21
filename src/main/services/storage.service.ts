import { session, webContents } from 'electron';
import fs from 'fs';
import path from 'path';

export interface PersistedStorage {
  cookies: any[];
  localStorage: Record<string, string>;
  sessionStorage: Record<string, string>;
}

export class StorageService {
  private static getStoragePath(accountId: string) {
    const isDev = process.env.NODE_ENV === 'development';
    const basePath = isDev ? process.cwd() : process.resourcesPath;
    const dir = path.join(basePath, 'data', 'accounts');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, `${accountId}.json`);
  }

  /**
   * Extracs Cookies and Storage directly from a BrowserWindow or WebContents
   */
  public static async extractWebContentsStorage(accountId: string, wc: Electron.WebContents): Promise<PersistedStorage> {
    const ses = session.fromPartition(`persist:${accountId}`);
    const cookies = await ses.cookies.get({});

    const localStorageCode = `
      (function() {
        var items = {};
        for(var i=0; i<localStorage.length; i++) {
          var k = localStorage.key(i);
          items[k] = localStorage.getItem(k);
        }
        return items;
      })();
    `;
    const localStorageData = await wc.executeJavaScript(localStorageCode);

    const sessionStorageCode = `
      (function() {
        var items = {};
        for(var i=0; i<sessionStorage.length; i++) {
          var k = sessionStorage.key(i);
          items[k] = sessionStorage.getItem(k);
        }
        return items;
      })();
    `;
    const sessionStorageData = await wc.executeJavaScript(sessionStorageCode);

    const data: PersistedStorage = {
      cookies,
      localStorage: localStorageData,
      sessionStorage: sessionStorageData
    };

    fs.writeFileSync(this.getStoragePath(accountId), JSON.stringify(data, null, 2));
    console.log(`[StorageService] Account ${accountId} persisted to disk.`);
    return data;
  }

  /**
   * Load JSON storage
   */
  public static loadPersistedStorage(accountId: string): PersistedStorage | null {
    const file = this.getStoragePath(accountId);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf-8'));
    } catch {
      return null;
    }
  }

  /**
   * Apply storage to WebContents/Session
   */
  public static async applyStorageToSession(accountId: string, wc: Electron.WebContents) {
    const data = this.loadPersistedStorage(accountId);
    if (!data) return;

    const ses = session.fromPartition(`persist:${accountId}`);
    for (const c of data.cookies) {
      try {
        const url = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path;
        await ses.cookies.set({
          url,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          expirationDate: c.expirationDate
        });
      } catch (err) {
        // Skip invalid cookies
      }
    }

    // Restore localStorage & sessionStorage
    const script = `
      (function() {
        const ls = ${JSON.stringify(data.localStorage || {})};
        for (let k in ls) { localStorage.setItem(k, ls[k]); }
        const ss = ${JSON.stringify(data.sessionStorage || {})};
        for (let k in ss) { sessionStorage.setItem(k, ss[k]); }
      })();
    `;
    await wc.executeJavaScript(script);
    console.log(`[StorageService] Account ${accountId} storage loaded.`);
  }
}
