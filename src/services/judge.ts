/**
 * 本地判题：编译、运行、样例比对。尽量对齐学习通 OJ 环境（参数见 LANGUAGES.ojEnvironment）。
 * 核心逻辑与 vscode 解耦，便于单测。
 */
import { spawn } from 'child_process';
import * as path from 'path';
import { CaseResult, JudgeReport, TestCase } from '../api/types';
import { LanguageSpec, Verdict } from '../config/constants';
import { diffOutput, outputEquals } from '../utils/text';

export interface LogLike {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export interface JudgeOptions {
  /** 单用例运行超时 */
  timeoutMs: number;
  /** 各语言编译/运行参数 */
  compileArgs: Record<string, string[]>;
  /** 忽略行尾空白差异 */
  normalizeWhitespace: boolean;
  /** 单用例输出上限（字节），超出判 OLE */
  outputLimitBytes?: number;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  timeMs: number;
  timedOut: boolean;
  outputExceeded: boolean;
}

const DEFAULT_OUTPUT_LIMIT = 64 * 1024 * 1024;

export class LocalJudge {
  constructor(
    private readonly options: JudgeOptions,
    private readonly logger?: LogLike
  ) {}

  /** 检测工具是否安装，返回版本首行 */
  static async detect(command: string, args: string[] = ['--version']): Promise<string | undefined> {
    const res = await exec(command, args, { timeoutMs: 5000 }).catch(() => undefined);
    if (!res || res.exitCode !== 0) {
      return undefined;
    }
    return (res.stdout || res.stderr).split('\n')[0].trim();
  }

  /** 编译（解释型语言直接返回成功） */
  async compile(lang: LanguageSpec, workDir: string, fileName: string): Promise<{ ok: boolean; log: string }> {
    if (!lang.compile) {
      return { ok: true, log: `${lang.label} 无需编译` };
    }
    const args = this.options.compileArgs[lang.id] ?? lang.defaultArgs;
    const full =
      lang.id === 'java'
        ? [...args, fileName]
        : [fileName, '-o', 'fanxing_bin', ...args];
    this.logger?.debug(`compile: ${lang.compile} ${full.join(' ')}`);
    const res = await exec(lang.compile, full, { cwd: workDir, timeoutMs: 30000 });
    const log = `${res.stdout}\n${res.stderr}`.trim();
    return { ok: res.exitCode === 0 && !res.timedOut, log: log || '(无编译输出)' };
  }

  /** 运行单个测试用例 */
  async runCase(
    lang: LanguageSpec,
    workDir: string,
    fileName: string,
    input: string,
    limits?: { timeMs?: number; memoryMb?: number }
  ): Promise<ExecResult> {
    const timeoutMs = limits?.timeMs ?? this.options.timeoutMs;
    let command: string;
    let args: string[];
    if (lang.id === 'java') {
      command = 'java';
      args = ['-Xss64m', '-cp', workDir, 'Main'];
    } else if (lang.id === 'python') {
      // Windows 无 python3 命令名，回退 python
      command = process.platform === 'win32' ? 'python' : 'python3';
      args = [fileName];
    } else {
      command = path.join(workDir, 'fanxing_bin');
      args = [];
    }
    // 内存限制：posix 下用 bash ulimit 包装
    if (limits?.memoryMb && process.platform !== 'win32') {
      return await exec(
        'bash',
        ['-c', `ulimit -v ${limits.memoryMb * 1024}; exec "$@"`, '_', command, ...args],
        { cwd: workDir, timeoutMs, input, outputLimit: this.options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT }
      );
    }
    return await exec(command, args, {
      cwd: workDir,
      timeoutMs,
      input,
      outputLimit: this.options.outputLimitBytes ?? DEFAULT_OUTPUT_LIMIT
    });
  }

  /** 跑完整套样例 */
  async judge(
    lang: LanguageSpec,
    workDir: string,
    fileName: string,
    cases: TestCase[],
    limits?: { timeMs?: number; memoryMb?: number }
  ): Promise<JudgeReport> {
    const started = Date.now();
    const compiled = await this.compile(lang, workDir, fileName);
    if (!compiled.ok) {
      return { verdict: Verdict.CompileError, compileLog: compiled.log, cases: [], totalTimeMs: Date.now() - started };
    }

    const results: CaseResult[] = [];
    let overall: Verdict = Verdict.Accepted;
    for (let i = 0; i < cases.length; i++) {
      const testCase = cases[i];
      const res = await this.runCase(lang, workDir, fileName, testCase.input, limits);
      let verdict: Verdict;
      if (res.timedOut) {
        verdict = Verdict.TimeLimitExceeded;
      } else if (res.outputExceeded) {
        verdict = Verdict.OutputLimitExceeded;
      } else if (res.exitCode !== 0) {
        verdict = Verdict.RuntimeError;
      } else if (outputEquals(testCase.expectedOutput, res.stdout, this.options.normalizeWhitespace)) {
        verdict = Verdict.Accepted;
      } else {
        verdict = Verdict.WrongAnswer;
      }

      results.push({
        index: i + 1,
        verdict,
        timeMs: res.timeMs,
        actualOutput: truncate(res.stdout),
        expectedOutput: truncate(testCase.expectedOutput),
        stderr: truncate(res.stderr),
        exitCode: res.exitCode,
        diff: verdict === Verdict.WrongAnswer ? diffOutput(testCase.expectedOutput, res.stdout, this.options.normalizeWhitespace) : undefined
      });

      if (verdict !== Verdict.Accepted && overall === Verdict.Accepted) {
        overall = verdict;
      }
    }

    return { verdict: cases.length ? overall : Verdict.Skipped, compileLog: compiled.log, cases: results, totalTimeMs: Date.now() - started };
  }
}

function truncate(text: string, max = 4000): string {
  return text.length > max ? `${text.slice(0, max)}\n... (截断)` : text;
}

/** 进程退出码 -> 崩溃原因提示（Windows 崩溃不写 stderr，错误只在退出码里） */
export function describeExitCode(code: number | undefined): string {
  if (code === undefined || code === 0) {
    return '';
  }
  const unsigned = code >>> 0;
  const hints: Record<number, string> = {
    3221225477: '访问违例 0xC0000005：常见于 scanf/printf 缺少 &、空指针、数组越界',
    3221225725: '栈溢出 0xC00000FD：递归过深或大数组',
    3221225786: '进程被中断 0xC000013A',
    3221226505: '快速失败 0xC0000409：abort / 断言失败',
    139: '段错误 SIGSEGV：常见于缺少 &、空指针、越界',
    134: '异常终止 SIGABRT：断言失败 / stack smashing / abort',
    136: '算术异常 SIGFPE：如除零'
  };
  const hint = hints[unsigned] ?? hints[code];
  return hint ? `（${hint}）` : '';
}

interface ExecOptions {
  cwd?: string;
  timeoutMs?: number;
  input?: string;
  outputLimit?: number;
}

function exec(command: string, args: string[], options: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve) => {
    const started = Date.now();
    let child;
    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe']
      });
    } catch (err) {
      resolve({ stdout: '', stderr: String(err), exitCode: -1, timeMs: 0, timedOut: false, outputExceeded: false });
      return;
    }
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputExceeded = false;
    const limit = options.outputLimit ?? DEFAULT_OUTPUT_LIMIT;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs ?? 10000);

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > limit) {
        outputExceeded = true;
        child.kill('SIGKILL');
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${String(err)}`, exitCode: -1, timeMs: Date.now() - started, timedOut, outputExceeded });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        timeMs: Date.now() - started,
        timedOut,
        outputExceeded
      });
    });

    // 目标进程提前退出时 stdin 写入会触发 EPIPE/ERR_STREAM_DESTROYED 流错误，
    // 必须吞掉，否则未处理 'error' 事件会成为未捕获异常导致扩展宿主崩溃
    child.stdin.on('error', () => {});
    try {
      if (options.input !== undefined) {
        child.stdin.write(options.input);
      }
      child.stdin.end();
    } catch {
      // 进程已退出，忽略
    }
  });
}
