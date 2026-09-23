/**
 * Webview 通用外壳：VS Code 原生视觉（--vscode-* 变量、codicon 风格按钮），
 * 公式渲染使用 KaTeX（CDN + 降级展示），禁止 emoji 作为图标。
 */
import * as vscode from 'vscode';
import { htmlEscape } from '../utils/text';

/** 视图层转义：与 utils/text.ts 的 htmlEscape 共用底层实现 */
export function escapeHtml(text: string): string {
  return htmlEscape(text);
}

export interface WebviewShellOptions {
  title: string;
  body: string;
  /** 追加脚本（会被 nonce 包裹） */
  script?: string;
  /** 图片资源根（本地缓存目录） */
  localResourceRoots?: vscode.Uri[];
}

export function htmlShell(webview: vscode.Webview, options: WebviewShellOptions): string {
  const nonce = getNonce();
  const csp = [
    "default-src 'none'",
    `img-src ${webview.cspSource} data: https:`,
    `style-src ${webview.cspSource} 'unsafe-inline' https://cdn.jsdelivr.net`,
    `script-src 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    `font-src ${webview.cspSource} https://cdn.jsdelivr.net`
  ].join('; ');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(options.title)}</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css" />
  <style>${STYLES}</style>
</head>
<body>
${options.body}
<script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.js"></script>
<script nonce="${nonce}">
${MATH_BOOTSTRAP}
${options.script ?? ''}
</script>
</body>
</html>`;
}

/** VS Code 原生风格样式（全部基于 --vscode-* 主题变量） */
const STYLES = `
:root {
  color-scheme: light dark;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 12px 16px 24px;
  color: var(--vscode-foreground);
  background: var(--vscode-editor-background);
  font-family: var(--vscode-font-family);
  font-size: var(--vscode-font-size);
  line-height: 1.6;
}
a { color: var(--vscode-textLink-foreground); }
a:hover { color: var(--vscode-textLink-activeForeground); }
h1, h2, h3 { font-weight: 600; margin: 12px 0 6px; }
h1 { font-size: 1.25em; }
h2 { font-size: 1.1em; }
h3 { font-size: 1em; }
p { margin: 6px 0; }
code, pre {
  font-family: var(--vscode-editor-font-family);
  background: var(--vscode-textCodeBlock-background);
  border: 1px solid var(--vscode-widget-border, transparent);
  border-radius: 3px;
}
code { padding: 1px 4px; }
pre { padding: 8px 10px; overflow: auto; }
pre code { border: none; background: none; padding: 0; }
.fx-header {
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  padding-bottom: 8px;
  margin-bottom: 10px;
}
.fx-title { font-size: 1.15em; font-weight: 600; }
.fx-meta { color: var(--vscode-descriptionForeground); font-size: 0.9em; margin-top: 4px; }
.fx-tag {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 6px;
  border: 1px solid var(--vscode-chrome-active-border);
  border-radius: 10px;
  font-size: 0.85em;
  color: var(--vscode-foreground);
  background: var(--vscode-badge-background);
}
.fx-tag.warn { border-color: var(--vscode-inputValidation-warningBorder); color: var(--vscode-inputValidation-warningForeground); }
.fx-tag.ok { border-color: var(--vscode-testing-iconPassed, var(--vscode-chrome-active-border)); }
.fx-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  margin: 4px 8px 4px 0;
  border: none;
  border-radius: 2px;
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  font-family: var(--vscode-font-family);
  font-size: 1em;
  cursor: pointer;
}
.fx-btn:hover { background: var(--vscode-button-hoverBackground); }
.fx-btn:active { background: var(--vscode-button-secondaryHoverBackground); }
.fx-btn:disabled {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
  cursor: not-allowed;
}
.fx-btn.secondary {
  background: var(--vscode-button-secondaryBackground);
  color: var(--vscode-button-secondaryForeground);
}
.fx-btn.secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }
.fx-toolbar { margin: 10px 0; display: flex; flex-wrap: wrap; align-items: center; }
.fx-section {
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  border-radius: 4px;
  padding: 10px 12px;
  margin: 10px 0;
  background: var(--vscode-editor-background);
}
.fx-section > h2 { margin-top: 0; }
.fx-table { width: 100%; border-collapse: collapse; margin: 8px 0; }
.fx-table th, .fx-table td {
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  padding: 6px 8px;
  text-align: left;
  vertical-align: top;
}
.fx-table th { background: var(--vscode-editor-lineHighlightBackground); font-weight: 600; }
.fx-cards { display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0; }
.fx-card {
  flex: 1 1 140px;
  min-width: 140px;
  border: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  border-radius: 4px;
  padding: 10px 12px;
  background: var(--vscode-editor-lineHighlightBackground);
}
.fx-card .num { font-size: 1.6em; font-weight: 600; }
.fx-card .label { color: var(--vscode-descriptionForeground); font-size: 0.9em; }
.fx-muted { color: var(--vscode-descriptionForeground); }
.fx-warn { color: var(--vscode-errorForeground); }
.fx-ok { color: var(--vscode-testing-iconPassed, var(--vscode-chrome-active-border)); }
.fx-bar-track {
  height: 10px;
  border-radius: 5px;
  background: var(--vscode-progressBar-background);
  overflow: hidden;
  margin: 4px 0 10px;
}
.fx-bar-fill { height: 100%; background: var(--vscode-button-background); }
.fx-formula { padding: 0 2px; }
.fx-image { max-width: 100%; }
.fx-list { list-style: none; padding: 0; margin: 0; }
.fx-list li {
  padding: 6px 4px;
  border-bottom: 1px solid var(--vscode-widget-border, var(--vscode-panel-border));
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
.fx-answer {
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.fx-answer label {
  display: flex;
  align-items: baseline;
  gap: 6px;
  cursor: pointer;
}
.fx-answer input[type="text"], .fx-answer textarea, .fx-answer input[type="number"],
.fx-section input, .fx-section textarea, .fx-section select {
  background: var(--vscode-input-background);
  color: var(--vscode-input-foreground);
  border: 1px solid var(--vscode-input-border, var(--vscode-widget-border, transparent));
  border-radius: 2px;
  padding: 3px 6px;
  font-family: var(--vscode-font-family);
}
.fx-section table input[type="checkbox"] { transform: none; }
.fx-kbd {
  border: 1px solid var(--vscode-widget-border);
  border-bottom-width: 2px;
  border-radius: 3px;
  padding: 0 4px;
  font-family: var(--vscode-editor-font-family);
}
`;

/** KaTeX 渲染引导：[data-latex] 元素渲染为公式，失败降级为原始 LaTeX */
const MATH_BOOTSTRAP = `
(function () {
  function render() {
    var nodes = document.querySelectorAll('.fx-formula[data-latex]');
    nodes.forEach(function (node) {
      var latex = decodeURIComponent(node.getAttribute('data-latex') || '');
      try {
        if (window.katex) {
          window.katex.render(latex, node, { throwOnError: false, displayMode: false });
        } else {
          node.textContent = latex;
        }
      } catch (e) {
        node.textContent = latex;
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', render);
  } else {
    render();
  }
  window.fxRenderMath = render;
})();
`;

export function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 32; i++) {
    out += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return out;
}

/** 图片路径转 webview URI */
export function toWebviewUri(webview: vscode.Webview, ...segments: string[]): vscode.Uri {
  return webview.asWebviewUri(vscode.Uri.file(segments.join('/')));
}
