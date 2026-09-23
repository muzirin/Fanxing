/**
 * 配置读取：统一从 workspace configuration 获取，带类型与默认值。
 */
import * as vscode from 'vscode';
import { CONFIG_SECTION, LANGUAGES, LanguageSpec } from '../config/constants';
import { LogLevel } from './logger';

export interface AiSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  proxy: string;
  requestTimeoutMs: number;
}

export class Settings {
  private get cfg(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration(CONFIG_SECTION);
  }

  get<T>(key: string, fallback: T): T {
    const value = this.cfg.get<T>(key);
    return value === undefined ? fallback : value;
  }

  get locale(): 'auto' | 'zh' | 'en' {
    return this.get('locale', 'auto');
  }

  get notificationPollMs(): number {
    return Math.max(1, this.get('notification.pollIntervalMinutes', 5)) * 60_000;
  }

  get signinPollMs(): number {
    return Math.max(15, this.get('signin.pollIntervalSeconds', 60)) * 1000;
  }

  get signinNotify(): boolean {
    return this.get('signin.notifyOnNew', true);
  }

  get defaultLanguage(): LanguageSpec {
    const id = this.get('homework.defaultLanguage', 'cpp');
    return LANGUAGES[id] ?? LANGUAGES.cpp;
  }

  get forceLocalTest(): boolean {
    return this.get('homework.forceLocalTestBeforeSubmit', true);
  }

  get deadlineWarnHours(): number {
    return Math.max(1, this.get('homework.deadlineWarnHours', 24));
  }

  get judgeTimeoutMs(): number {
    return Math.max(200, this.get('judge.timeoutMs', 3000));
  }

  get judgeCompileArgs(): Record<string, string[]> {
    return this.get('judge.compileArgs', {
      c: LANGUAGES.c.defaultArgs,
      cpp: LANGUAGES.cpp.defaultArgs,
      java: LANGUAGES.java.defaultArgs,
      python: []
    });
  }

  get normalizeWhitespace(): boolean {
    return this.get('judge.normalizeTrailingWhitespace', true);
  }

  get ai(): AiSettings {
    return {
      enabled: this.get('ai.enabled', false),
      baseUrl: this.get('ai.baseUrl', 'https://api.openai.com/v1'),
      model: this.get('ai.model', 'gpt-4o-mini'),
      proxy: this.get('ai.proxy', ''),
      requestTimeoutMs: this.get('ai.requestTimeoutMs', 60000)
    };
  }

  get preferLatexFromAlt(): boolean {
    return this.get('formula.preferLatexFromAlt', true);
  }

  get formulaOcrEndpoint(): string {
    return this.get('formula.ocrEndpoint', '');
  }

  get cacheTtlMs(): number {
    return Math.max(1, this.get('cache.ttlMinutes', 30)) * 60_000;
  }

  get downloadTargetDir(): string {
    return this.get('download.targetDir', 'fanxing-resources');
  }

  get logLevel(): LogLevel {
    return this.get('log.level', 'info');
  }

  onChange(listener: () => void): vscode.Disposable {
    return vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        listener();
      }
    });
  }
}
