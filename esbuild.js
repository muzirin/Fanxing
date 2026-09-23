/* Fanxing build script: bundle src/extension.ts -> dist/extension.js */
const esbuild = require('esbuild');

const watch = process.argv.includes('--watch');
const dev = watch || process.argv.includes('--dev');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  outfile: 'dist/extension.js',
  // 与 @vscode/* 系列保持同构：esbuild JS API 不接受 RegExp external，
  // 用等价通配符模式 ['@vscode/*']；'vscode' 为运行时模块，必须保持 external
  external: ['vscode', '@vscode/*'],
  sourcemap: dev,
  minify: !dev,
  logLevel: 'info'
};

async function main() {
  if (watch) {
    const ctx = await esbuild.context(options);
    await ctx.watch();
    console.log('[fanxing] watching for changes...');
  } else {
    await esbuild.build(options);
    console.log('[fanxing] build complete');
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
