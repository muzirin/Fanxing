/**
 * 最小登录探针：仅验证 fanyalogin 链路（凭据走环境变量，不落文件）。
 */
const Module = require('module');
const path = require('path');
const FANXING = path.resolve(__dirname, '../../Fanxing');

const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') {
    return 'stub:vscode';
  }
  return origResolve.call(this, request, ...args);
};
require.cache['stub:vscode'] = {
  id: 'stub:vscode',
  loaded: true,
  exports: { window: { createOutputChannel: () => ({ appendLine() {}, show() {}, dispose() {} }) } }
};

const logger = {
  debug: (m) => console.log('  [debug]', m),
  info: (m) => console.log('  [info]', m),
  warn: (m) => console.log('  [warn]', m),
  error: (m) => console.log('  [error]', m)
};

async function main() {
  const { HttpClient } = require(path.join(FANXING, 'src/api/client'));
  const { AuthApi } = require(path.join(FANXING, 'src/api/auth'));
  const http = new HttpClient(logger);
  const auth = new AuthApi(http, logger);

  console.log('[1] 调用 loginByPassword ...');
  const started = Date.now();
  const result = await auth.loginByPassword(process.env.FANXING_PHONE, process.env.FANXING_PASS);
  console.log(`[1] 用时 ${Date.now() - started} ms`);
  console.log('[1] 结果:', JSON.stringify({
    ok: result.ok,
    message: result.message ?? '',
    validateImage: result.validateImage ?? '',
    account: result.account ? { id: result.account.id, name: result.account.name, fid: result.account.fid } : null,
    cookieKeys: Object.keys(result.cookies ?? {}).sort()
  }, null, 2));

  if (result.ok) {
    console.log('[2] validateSession ...');
    const ok = await auth.validateSession();
    console.log('[2] ->', ok);
    console.log('[3] fetchProfile ...');
    console.log('[3] ->', JSON.stringify(await auth.fetchProfile()));
  }
}

main().catch((e) => {
  console.error('探针失败:', e && e.message ? e.message : e);
  process.exit(1);
});
