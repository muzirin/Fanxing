/**
 * 会话服务：多账号切换、登录态管理、状态变更事件。
 */
import * as vscode from 'vscode';
import { AuthApi } from '../api/auth';
import { HttpClient } from '../api/client';
import { AccountInfo, LoginResult } from '../api/types';
import { Logger } from './logger';
import { SecretStore } from './secrets';

export class SessionService {
  private current: AccountInfo | undefined;
  private readonly emitter = new vscode.EventEmitter<void>();

  readonly onDidChange = this.emitter.event;

  constructor(
    readonly http: HttpClient,
    readonly auth: AuthApi,
    private readonly store: SecretStore,
    private readonly logger: Logger
  ) {}

  get account(): AccountInfo | undefined {
    return this.current;
  }

  get isLoggedIn(): boolean {
    return !!this.current;
  }

  /** 启动时恢复上次登录态 */
  async restore(): Promise<boolean> {
    const id = this.store.getActiveId();
    if (!id) {
      return false;
    }
    const cookies = await this.store.loadCookies(id);
    if (!cookies) {
      return false;
    }
    this.http.loadCookies(cookies);
    const ok = await this.auth.validateSession();
    if (!ok) {
      this.logger.warn('保存的登录态已过期');
      return false;
    }
    this.current = this.store.listAccounts().find((a) => a.id === id);
    this.emitter.fire();
    return !!this.current;
  }

  /** 保存一次成功登录 */
  async acceptLogin(result: LoginResult, password?: string): Promise<void> {
    if (!result.ok || !result.account) {
      throw new Error(result.message ?? '登录失败');
    }
    await this.store.upsertAccount(result.account, result.cookies ?? this.http.getCookies(), password);
    await this.store.setActive(result.account.id);
    this.current = result.account;
    this.emitter.fire();
    this.logger.info(`已登录：${result.account.name} (${result.account.id})`);
  }

  async switchAccount(id: string): Promise<boolean> {
    const cookies = await this.store.loadCookies(id);
    if (!cookies) {
      return false;
    }
    this.http.loadCookies(cookies);
    if (!(await this.auth.validateSession())) {
      return false;
    }
    await this.store.setActive(id);
    this.current = this.store.listAccounts().find((a) => a.id === id);
    this.emitter.fire();
    return true;
  }

  async logout(): Promise<void> {
    this.auth.logout();
    this.current = undefined;
    await this.store.setActive(undefined);
    this.emitter.fire();
  }
}
