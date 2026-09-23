import assert from 'assert';
import { encryptLoginField } from '../src/utils/crypto';
import { LANGUAGES, Verdict } from '../src/config/constants';
import { LocalJudge, describeExitCode } from '../src/services/judge';
import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

describe('utils/crypto', () => {
  it('encryptLoginField 输出 Base64 且确定性', () => {
    const a = encryptLoginField('13800000000');
    const b = encryptLoginField('13800000000');
    assert.strictEqual(a, b);
    assert.ok(/^[A-Za-z0-9+/=]+$/.test(a));
    assert.notStrictEqual(a, encryptLoginField('13800000001'));
  });
});

describe('services/judge (本地判题)', function () {
  this.timeout(30000);

  it('Python: AC / WA / RE 判定', async function () {
    const hasPython = await LocalJudge.detect('python3');
    if (!hasPython) {
      this.skip();
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanxing-test-'));
    const judge = new LocalJudge({ timeoutMs: 3000, compileArgs: {}, normalizeWhitespace: true });

    fs.writeFileSync(path.join(dir, 'main.py'), 'a, b = map(int, input().split())\nprint(a + b)\n');
    const okReport = await judge.judge(LANGUAGES.python, dir, 'main.py', [
      { input: '1 2\n', expectedOutput: '3' },
      { input: '10 20\n', expectedOutput: '30' }
    ]);
    assert.strictEqual(okReport.verdict, Verdict.Accepted);
    assert.strictEqual(okReport.cases.length, 2);

    const wrongReport = await judge.judge(LANGUAGES.python, dir, 'main.py', [
      { input: '1 2\n', expectedOutput: '4' }
    ]);
    assert.strictEqual(wrongReport.verdict, Verdict.WrongAnswer);
    assert.ok(wrongReport.cases[0].diff);

    fs.writeFileSync(path.join(dir, 'bad.py'), 'raise ValueError("boom")\n');
    const reReport = await judge.judge(LANGUAGES.python, dir, 'bad.py', [{ input: '', expectedOutput: '' }]);
    assert.strictEqual(reReport.verdict, Verdict.RuntimeError);

    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('编译错误返回 CE 与日志', async function () {
    const hasGpp = await LocalJudge.detect('g++');
    if (!hasGpp) {
      this.skip();
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanxing-test-'));
    const judge = new LocalJudge({
      timeoutMs: 3000,
      compileArgs: { cpp: ['-O2', '-std=c++17'] },
      normalizeWhitespace: true
    });
    fs.writeFileSync(path.join(dir, 'main.cpp'), 'int main() { return 0 '); // 语法错误
    const report = await judge.judge(LANGUAGES.cpp, dir, 'main.cpp', [{ input: '', expectedOutput: '' }]);
    assert.strictEqual(report.verdict, Verdict.CompileError);
    assert.ok(report.compileLog && report.compileLog.length > 0);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('超时判定 TLE', async function () {
    const hasPython = await LocalJudge.detect('python3');
    if (!hasPython) {
      this.skip();
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanxing-test-'));
    const judge = new LocalJudge({ timeoutMs: 500, compileArgs: {}, normalizeWhitespace: true });
    fs.writeFileSync(path.join(dir, 'slow.py'), 'import time\ntime.sleep(5)\n');
    const report = await judge.judge(LANGUAGES.python, dir, 'slow.py', [{ input: '', expectedOutput: '' }]);
    assert.strictEqual(report.verdict, Verdict.TimeLimitExceeded);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('目标进程提前退出时不因 stdin EPIPE 崩溃', async function () {
    const hasGpp = await LocalJudge.detect('g++');
    if (!hasGpp) {
      this.skip();
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fanxing-test-'));
    const judge = new LocalJudge({
      timeoutMs: 3000,
      compileArgs: { cpp: ['-O2', '-std=c++17'] },
      normalizeWhitespace: true
    });
    fs.writeFileSync(path.join(dir, 'main.cpp'), '#include <cstdio>\nint main(){ std::printf("ok\\n"); return 0; }\n');
    const compiled = await judge.compile(LANGUAGES.cpp, dir, 'main.cpp');
    assert.strictEqual(compiled.ok, true);
    for (let i = 0; i < 5; i++) {
      const res = await judge.runCase(LANGUAGES.cpp, dir, 'main.cpp', 'x'.repeat(2 * 1024 * 1024));
      assert.strictEqual(res.exitCode, 0);
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('describeExitCode 解析崩溃退出码（含缺 & 访问违例）', () => {
    assert.strictEqual(describeExitCode(0), '');
    assert.strictEqual(describeExitCode(undefined), '');
    assert.ok(describeExitCode(3221225477).includes('scanf'));
    assert.ok(describeExitCode(-1073741819).includes('scanf'));
    assert.ok(describeExitCode(139).includes('SIGSEGV'));
    assert.strictEqual(describeExitCode(1), '');
  });
});
