/**
 * 日志：OutputChannel 分级输出，敏感信息脱敏。
 */
import * as vscode from 'vscode';
import { redact } from '../utils/text';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export { redact };

export class Logger {
  private channel: vscode.OutputChannel;
  private level: LogLevel = 'info';
  /** 环形缓冲：最多保留 32K 字符，按批刷出，避免逐条写入阻塞主线程 */
  private buffer: string[] = [];
  private bufferChars = 0;
  private flushTimer: NodeJS.Immediate | undefined;

  /** 每批日志刷出时回调（可用于接入远端日志）；在后台任务中执行 */
  onFlush?: (batch: string[]) => void;

  private static readonly MAX_BUFFER_CHARS = 32 * 1024;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  get output(): vscode.OutputChannel {
    return this.channel;
  }

  private write(level: LogLevel, msg: string, extra?: unknown): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const time = new Date().toISOString().slice(11, 19);
    let line = `[${time}] [${level.toUpperCase()}] ${redact(msg)}`;
    if (extra !== undefined) {
      let detail: string;
      try {
        detail = typeof extra === 'string' ? extra : JSON.stringify(extra);
      } catch {
        detail = String(extra);
      }
      line += ` ${redact(detail)}`;
    }
    this.enqueue(line);
  }

  /** 入环形缓冲，超过 32K 丢弃最旧行，并异步批量刷出 */
  private enqueue(line: string): void {
    this.buffer.push(line);
    this.bufferChars += line.length + 1;
    while (this.bufferChars > Logger.MAX_BUFFER_CHARS && this.buffer.length > 1) {
      const dropped = this.buffer.shift() as string;
      this.bufferChars -= dropped.length + 1;
    }
    if (!this.flushTimer) {
      this.flushTimer = setImmediate(() => {
        this.flushTimer = undefined;
        this.flush();
      });
    }
  }

  /** 批量刷出（在后台任务中执行，不阻塞主调用） */
  flush(): void {
    if (!this.buffer.length) {
      return;
    }
    const batch = this.buffer;
    this.buffer = [];
    this.bufferChars = 0;
    setImmediate(() => {
      this.channel.appendLine(batch.join('\n'));
      this.onFlush?.(batch);
    });
  }

  debug(msg: string, extra?: unknown): void {
    this.write('debug', msg, extra);
  }

  info(msg: string, extra?: unknown): void {
    this.write('info', msg, extra);
  }

  warn(msg: string, extra?: unknown): void {
    this.write('warn', msg, extra);
  }

  error(msg: string, extra?: unknown): void {
    this.write('error', msg, extra);
  }

  show(): void {
    this.flush();
    this.channel.show(true);
  }

  dispose(): void {
    if (this.flushTimer) {
      clearImmediate(this.flushTimer);
    }
    this.flush();
    this.channel.dispose();
  }
}
