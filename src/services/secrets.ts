/**
 * 敏感信息存储：密码 / Cookie / API Key 全部进入 SecretStorage，
 * 账号索引存 globalState，绝不写入明文配置。
 */
import * as vscode from 'vscode';
import { AccountInfo, CookieJar } from '../api/types';

const KEY_ACCOUNTS = 'fanxing.accounts';
const KEY_ACTIVE = 'fanxing.activeAccount';

export class SecretStore {
  constructor(
    private readonly secrets: vscode.SecretStorage,
    private readonly globalState: vscode.Memento
  ) {}

  private cookieKey(id: string): string {
    return `fanxing.account.${id}.cookies`;
  }

  private passwordKey(id: string): string {
    return `fanxing.account.${id}.password`;
  }

  listAccounts(): AccountInfo[] {
    return this.globalState.get<AccountInfo[]>(KEY_ACCOUNTS, []);
  }

  async upsertAccount(account: AccountInfo, cookies: CookieJar, password?: string): Promise<void> {
    const list = this.listAccounts().filter((a) => a.id !== account.id);
    list.push(account);
    await this.globalState.update(KEY_ACCOUNTS, list);
    await this.secrets.store(this.cookieKey(account.id), JSON.stringify(cookies));
    if (password) {
      await this.secrets.store(this.passwordKey(account.id), password);
    }
  }

  async setActive(id: string | undefined): Promise<void> {
    await this.globalState.update(KEY_ACTIVE, id);
  }

  getActiveId(): string | undefined {
    return this.globalState.get<string>(KEY_ACTIVE);
  }

  async loadCookies(id: string): Promise<CookieJar | undefined> {
    const raw = await this.secrets.get(this.cookieKey(id));
    if (!raw) {
      return undefined;
    }
    try {
      return JSON.parse(raw) as CookieJar;
    } catch {
      return undefined;
    }
  }

  async loadPassword(id: string): Promise<string | undefined> {
    return this.secrets.get(this.passwordKey(id));
  }

  async removeAccount(id: string): Promise<void> {
    await this.globalState.update(
      KEY_ACCOUNTS,
      this.listAccounts().filter((a) => a.id !== id)
    );
    await this.secrets.delete(this.cookieKey(id));
    await this.secrets.delete(this.passwordKey(id));
  }

  // ---------------- AI 凭据 ----------------

  async getAiApiKey(): Promise<string | undefined> {
    return this.secrets.get('fanxing.ai.apikey');
  }

  async setAiApiKey(key: string): Promise<void> {
    await this.secrets.store('fanxing.ai.apikey', key);
  }

  async clearAiApiKey(): Promise<void> {
    await this.secrets.delete('fanxing.ai.apikey');
  }
}
