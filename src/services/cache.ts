/**
 * 本地缓存：globalStorage 下 JSON 文件 + TTL，支持离线查看已缓存数据。
 */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Logger } from './logger';

interface CacheEnvelope<T> {
  savedAt: number;
  ttlMs: number;
  data: T;
}

export class FileCache {
  constructor(
    private readonly baseDir: string,
    private readonly logger: Logger
  ) {}

  static create(context: vscode.ExtensionContext, logger: Logger): FileCache {
    return new FileCache(context.globalStorageUri.fsPath, logger);
  }

  private fileOf(namespace: string, key: string): string {
    const safeKey = key.replace(/[^\w.-]/g, '_');
    return path.join(this.baseDir, 'cache', namespace, `${safeKey}.json`);
  }

  async get<T>(namespace: string, key: string, ttlMs: number): Promise<T | undefined> {
    const file = this.fileOf(namespace, key);
    try {
      const raw = await fs.readFile(file, 'utf8');
      const envelope = JSON.parse(raw) as CacheEnvelope<T>;
      if (Date.now() - envelope.savedAt > ttlMs) {
        this.logger.debug(`cache expired: ${namespace}/${key}`);
        return undefined;
      }
      return envelope.data;
    } catch {
      return undefined;
    }
  }

  /** 无视 TTL 读取（离线兜底） */
  async getStale<T>(namespace: string, key: string): Promise<T | undefined> {
    const file = this.fileOf(namespace, key);
    try {
      const raw = await fs.readFile(file, 'utf8');
      return (JSON.parse(raw) as CacheEnvelope<T>).data;
    } catch {
      return undefined;
    }
  }

  async set<T>(namespace: string, key: string, data: T, ttlMs: number): Promise<void> {
    const file = this.fileOf(namespace, key);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      const envelope: CacheEnvelope<T> = { savedAt: Date.now(), ttlMs, data };
      await fs.writeFile(file, JSON.stringify(envelope), 'utf8');
    } catch (err) {
      this.logger.debug('cache write failed', String(err));
    }
  }

  async clear(namespace: string): Promise<void> {
    try {
      await fs.rm(path.join(this.baseDir, 'cache', namespace), { recursive: true, force: true });
    } catch (err) {
      this.logger.debug('cache clear failed', String(err));
    }
  }
}
