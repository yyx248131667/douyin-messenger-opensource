/**
 * @file script.service.ts
 * @description 商业级话术资产管理服务
 * 负责与磁盘的 scripts.json 进行高性能的双向同步，兼容旧格式。
 */

import { StorageService } from '../../infrastructure/storage/storage-service';
import { ipcMain } from 'electron';

export interface ScriptItem {
  id: string;
  createTime: number;
  updateTime: number;
  title: string;
  content: string;
}

export class ScriptService {
  private static storage = new StorageService<ScriptItem[]>('scripts.json', []);

  public static init() {
    console.log('[ScriptService] 初始化话术持久化服务...');
    
    // 获取列表
    ipcMain.handle('get-scripts', () => {
      let data = this.storage.read();
      // 容错：如果是一个对象而不是数组（极罕见），重置它
      if (!Array.isArray(data)) data = [];
      return data;
    });

    // 保存单页话术（新增或修改）
    ipcMain.handle('save-script', (event, script: ScriptItem) => {
      let scripts = this.storage.read();
      if (!Array.isArray(scripts)) scripts = [];

      script.updateTime = Date.now();
      const existingIdx = scripts.findIndex(s => s.id === script.id);
      
      if (existingIdx !== -1) {
        scripts[existingIdx] = script;
      } else {
        if (!script.createTime) script.createTime = Date.now();
        scripts.unshift(script); // 新增在最前面
      }
      
      this.storage.write(scripts);
      return scripts;
    });

    // 删除单页话术
    ipcMain.handle('delete-script', (event, id: string) => {
      let scripts = this.storage.read();
      if (!Array.isArray(scripts)) return [];
      
      scripts = scripts.filter(s => s.id !== id);
      this.storage.write(scripts);
      return scripts;
    });
  }
}
