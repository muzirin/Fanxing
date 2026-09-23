/**
 * 纯文本/HTML 处理工具（无 vscode 依赖，可单测）。
 */

/** 解码常见 HTML 实体 */
export function decodeEntities(text: string): string {
  const map: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&nbsp;': ' ',
    '&ldquo;': '“',
    '&rdquo;': '”',
    '&hellip;': '…',
    '&mdash;': '—',
    '&times;': '×'
  };
  return text
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|nbsp|ldquo|rdquo|hellip|mdash|times);/g, (m) => map[m] ?? m);
}

/** 去掉 HTML 标签得到纯文本（保留换行语义） */
export function stripHtml(html: string): string {
  return decodeEntities(
    html
      .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6])\s*\/?>/gi, '\n')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 从 HTML 中提取所有匹配（带属性捕获） */
export function extractAll(
  html: string,
  re: RegExp
): Array<{ full: string; groups: string[] }> {
  const out: Array<{ full: string; groups: string[] }> = [];
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = global.exec(html)) !== null) {
    out.push({ full: m[0], groups: m.slice(1).map((g) => g ?? '') });
  }
  return out;
}

/** 提取 HTML 标签的属性表 */
export function parseAttrs(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(tag)) !== null) {
    attrs[m[1].toLowerCase()] = decodeEntities(m[3] ?? m[4] ?? m[5] ?? '');
  }
  return attrs;
}

/** 提取隐藏表单域（登录页 uuid/enc 等） */
export function extractHiddenInputs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of extractAll(html, /<input[^>]*type=["']?hidden["']?[^>]*>/gi)) {
    const attrs = parseAttrs(item.full);
    if (attrs['id'] || attrs['name']) {
      out[attrs['id'] || attrs['name']] = attrs['value'] ?? '';
    }
  }
  return out;
}

/** 安全解析 JSON（失败返回 null） */
export function tryParseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

/** 解析百分比字符串 "87%" / "87.5" -> 87.5 */
export function parsePercent(text: string | undefined | null): number | undefined {
  if (!text) {
    return undefined;
  }
  const m = /(\d+(?:\.\d+)?)\s*%?/.exec(text);
  return m ? parseFloat(m[1]) : undefined;
}

/** 解析中文日期时间 "2026-09-23 18:00:00" -> 毫秒时间戳 */
export function parseDateTime(text: string | undefined | null): number {
  if (!text) {
    return 0;
  }
  const normalized = text.trim().replace(/年|月/g, '-').replace(/日/g, ' ').replace(/\//g, '-');
  const t = Date.parse(normalized.replace(/-/g, '/'));
  if (!Number.isNaN(t)) {
    return t;
  }
  const d = new Date(normalized);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

/** 判断文本是否形如 LaTeX/数学表达式（用于图片公式还原） */
export function looksLikeLatex(text: string | undefined | null): boolean {
  if (!text) {
    return false;
  }
  const t = text.trim();
  if (!t || t.length > 200) {
    return false;
  }
  if (/\\(frac|sum|sqrt|int|lim|alpha|beta|theta|sigma|cdot|times|leq|geq|neq|infty|log|sin|cos|tan)/.test(t)) {
    return true;
  }
  if (/\$[^$]+\$/.test(t) || /(\^|_)[{A-Za-z0-9]/.test(t)) {
    return true;
  }
  return false;
}

/** 规范化输出用于比对（可选忽略行尾空白/末尾空行） */
export function normalizeOutput(text: string, ignoreTrailingWhitespace = true): string {
  let out = text.replace(/\r\n/g, '\n');
  if (ignoreTrailingWhitespace) {
    out = out
      .split('\n')
      .map((line) => line.replace(/[ \t]+$/, ''))
      .join('\n')
      .replace(/\n+$/, '');
  }
  return out;
}

const SENSITIVE_KEYS = ['password', 'passwd', 'pwd', 'cookie', 'token', 'authorization', 'vc3', 'uf', 'secret', 'apikey', 'api_key'];

/** 对 URL / 文本中的敏感值脱敏（纯函数，可单测） */
export function redact(text: string): string {
  let out = text;
  out = out.replace(/(Cookie\s*[:=]\s*)([^\n\r]+)/gi, (_m, p1) => `${p1}<redacted>`);
  for (const key of SENSITIVE_KEYS) {
    const re = new RegExp(`(${key}\\s*[=:]\\s*)([^&\\s"'\\n]+)`, 'gi');
    out = out.replace(re, (_m, p1: string) => `${p1}<redacted>`);
  }
  out = out.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, (_m, p1: string) => `${p1}<redacted>`);
  return out;
}

/**
 * HTML 转义：转义 &<>"' 五类字符。
 * 这里和 utils/text.ts 共用同一套底层实现，避免视图层与文本层行为漂移。
 */
export function htmlEscape(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 判断 AI 输出是否疑似“完整解题代码”（引导铁律的后置校验） */
export function looksLikeFullSolution(text: string): boolean {
  const codeBlocks = (text.match(/```/g) ?? []).length / 2;
  if (codeBlocks >= 1) {
    return true;
  }
  if (/(int|void|def|class|public)\s+\w+\s*\([^)]*\)\s*\{?/.test(text) && text.split('\n').length > 15) {
    return true;
  }
  return false;
}

/** 逐行 diff（简单对齐比对），返回人类可读差异 */
export function diffOutput(expected: string, actual: string, ignoreTrailingWhitespace = true): string {
  const e = normalizeOutput(expected, ignoreTrailingWhitespace).split('\n');
  const a = normalizeOutput(actual, ignoreTrailingWhitespace).split('\n');
  const lines: string[] = [];
  const max = Math.max(e.length, a.length);
  for (let i = 0; i < max; i++) {
    const exp = e[i];
    const act = a[i];
    if (exp === act) {
      continue;
    }
    if (exp === undefined) {
      lines.push(`line ${i + 1}: unexpected "${act}"`);
    } else if (act === undefined) {
      lines.push(`line ${i + 1}: missing "${exp}"`);
    } else {
      lines.push(`line ${i + 1}: expected "${exp}" but got "${act}"`);
    }
  }
  return lines.join('\n');
}

/** 输出是否相等（按规则比对） */
export function outputEquals(expected: string, actual: string, ignoreTrailingWhitespace = true): boolean {
  return normalizeOutput(expected, ignoreTrailingWhitespace) === normalizeOutput(actual, ignoreTrailingWhitespace);
}
