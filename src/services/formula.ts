/**
 * 题目公式处理：
 * 1. <img> 公式图 -> 优先用 alt/标题文本还原 LaTeX（KaTeX 渲染）；
 * 2. 无法还原 -> 下载到本地缓存（带 Referer 破防盗链），经 webview URI 展示；
 * 3. 可选外部 OCR 还原服务。
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { HttpClient } from '../api/client';
import { decodeEntities, looksLikeLatex, parseAttrs, tryParseJson } from '../utils/text';
import { Logger } from './logger';

export interface FormulaOptions {
  preferLatexFromAlt: boolean;
  ocrEndpoint: string;
  cacheDir: string;
}

export interface ProcessedHtml {
  html: string;
  /** 本地缓存的图片绝对路径 */
  localImages: string[];
  /** 原始远程地址 -> 本地文件名 */
  imageMap: Record<string, string>;
}

export class FormulaService {
  constructor(
    private readonly http: HttpClient,
    private readonly options: FormulaOptions,
    private readonly logger: Logger
  ) {}

  /** 处理题干 HTML 中的图片/公式 */
  async process(html: string): Promise<ProcessedHtml> {
    const localImages: string[] = [];
    const imageMap: Record<string, string> = {};
    const tasks: Promise<void>[] = [];

    const out = html.replace(/<img[^>]*>/gi, (tag) => {
      const attrs = parseAttrs(tag);
      const src = attrs['src'];
      if (!src) {
        return '';
      }
      const alt = decodeEntities(attrs['alt'] ?? attrs['title'] ?? '');

      // 1) alt 文本可还原为 LaTeX
      if (this.options.preferLatexFromAlt && looksLikeLatex(alt)) {
        const latex = alt.trim().replace(/^\$|\$$/g, '');
        return `<span class="fx-formula" data-latex="${encodeURIComponent(latex)}"></span>`;
      }

      // 2) 下载到本地缓存
      const ext = guessExt(src);
      const name = `${crypto.createHash('md5').update(src).digest('hex').slice(0, 16)}${ext}`;
      const target = path.join(this.options.cacheDir, name);
      imageMap[src] = name;
      tasks.push(
        (async () => {
          try {
            await fs.mkdir(this.options.cacheDir, { recursive: true });
            await fs.writeFile(target, await this.http.getBuffer(src));
            localImages.push(target);
            // 3) 可选 OCR 还原
            const latex = await this.ocrLatex(target);
            if (latex) {
              imageMap[src] = `latex:${latex}`;
            }
          } catch (err) {
            this.logger.debug(`图片缓存失败: ${src}`, String(err));
          }
        })()
      );
      return `<img class="fx-image" data-src="${src}" alt="${alt}" />`;
    });

    await Promise.all(tasks);
    return { html: out, localImages, imageMap };
  }

  /** 调用可选 OCR 服务还原 LaTeX */
  private async ocrLatex(imagePath: string): Promise<string | undefined> {
    if (!this.options.ocrEndpoint) {
      return undefined;
    }
    try {
      const buf = await fs.readFile(imagePath);
      const res = await this.http.postForm(
        this.options.ocrEndpoint,
        { image: buf.toString('base64') },
        { retries: 0, timeoutMs: 15000 }
      );
      const json = tryParseJson<{ latex?: string }>(res);
      return json?.latex && looksLikeLatex(json.latex) ? json.latex : undefined;
    } catch (err) {
      this.logger.debug('ocrLatex failed', String(err));
      return undefined;
    }
  }
}

function guessExt(src: string): string {
  const m = /\.(png|jpe?g|gif|webp|svg)(?:[?#]|$)/i.exec(src);
  return m ? `.${m[1].toLowerCase()}` : '.png';
}
