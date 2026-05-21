/**
 * @file storage-service.ts
 * @description Provides a safe, typed abstraction over JSON config files.
 */

import fs from 'fs';
import path from 'path';

export class StorageService<T> {
  private filePath: string;
  private defaultData: T;

  constructor(filename: string, defaultData: T) {
    // Determine path based on executable location vs dev environment
    const isDev = process.env.NODE_ENV === 'development';
    const basePath = isDev ? process.cwd() : process.resourcesPath;
    this.filePath = path.join(basePath, filename);
    this.defaultData = defaultData;
  }

  public read(): T {
    try {
      if (!fs.existsSync(this.filePath)) {
        this.write(this.defaultData);
        return this.defaultData;
      }
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      
      if (Array.isArray(this.defaultData) && Array.isArray(parsed)) {
        return parsed as unknown as T;
      }
      if (typeof this.defaultData === 'object' && this.defaultData !== null && !Array.isArray(this.defaultData)) {
        return { ...this.defaultData, ...parsed };
      }
      return parsed;
    } catch (e) {
      console.error(`[StorageService] Failed to read ${this.filePath}`, e);
      return this.defaultData;
    }
  }

  public write(data: T): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (e) {
      console.error(`[StorageService] Failed to write ${this.filePath}`, e);
    }
  }
}
