/**
 * HTTP 客户端：Cookie 管理 + 浏览器指纹模拟 + 重试 + 日志脱敏。
 */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import { APP_UA, BROWSER_UA, IMAGE_REFERER } from '../config/constants';
import { CookieJar } from './types';
import { Logger } from '../services/logger';

export interface RequestOptions {
  method?: 'GET' | 'POST';
  params?: Record<string, string | number | undefined>;
  /** 表单体 */
  form?: Record<string, string | number | undefined>;
  /** 原始体 */
  body?: string;
  headers?: Record<string, string>;
  /** 返回二进制（图片） */
  responseType?: 'text' | 'arraybuffer';
  /** 重试次数（默认 3） */
  retries?: number;
  timeoutMs?: number;
  /** 图片防盗链 */
  asImage?: boolean;
  /** 内部：302 跟随跳数（上限 5） */
  _hops?: number;
}

export class HttpClient {
  private cookies: CookieJar = {};
  private readonly http: AxiosInstance;
  private userAgent: string;
  /** 风控 UA 自愈：命中 passport403 后切换 App UA，只切一次 */
  private uaFallbackTried = false;

  constructor(private readonly logger: Logger, userAgent: string = BROWSER_UA) {
    this.userAgent = userAgent;
    this.http = axios.create({
      // 不自动跟随跳转，便于捕获 Set-Cookie
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
      timeout: 20000
    });
  }

  /** 载入持久化 Cookie */
  loadCookies(jar: CookieJar): void {
    this.cookies = { ...jar };
  }

  getCookies(): CookieJar {
    return { ...this.cookies };
  }

  setCookie(name: string, value: string): void {
    this.cookies[name] = value;
  }

  clearCookies(): void {
    this.cookies = {};
  }

  /** 手动设置 UA（可用于配置项覆盖） */
  setUserAgent(ua: string): void {
    this.userAgent = ua;
  }

  private cookieHeader(): string {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private absorbSetCookie(headers: Record<string, unknown>): void {
    const raw = headers['set-cookie'];
    if (!raw) {
      return;
    }
    const list = Array.isArray(raw) ? raw : [String(raw)];
    for (const item of list) {
      const first = item.split(';')[0];
      const eq = first.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const name = first.slice(0, eq).trim();
      const value = first.slice(eq + 1).trim();
      if (!value || value === 'deleted') {
        delete this.cookies[name];
      } else {
        this.cookies[name] = value;
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 发起请求，自动带 Cookie，网络错误指数退避重试 */
  async request(url: string, options: RequestOptions = {}): Promise<string | Buffer> {
    const retries = options.retries ?? 3;
    const method = options.method ?? 'GET';
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const urlOrigin = new URL(url).origin;
        const headers: Record<string, string> = {
          'User-Agent': this.userAgent,
          Accept: 'application/json, text/plain, */*',
          'Accept-Language': 'zh-CN,zh;q=0.9',
          // 浏览器同源语义：POST 带 Origin，全部请求带 Referer（风控校验）
          Origin: urlOrigin,
          Referer: options.asImage ? IMAGE_REFERER : `${urlOrigin}/`,
          ...(this.cookieHeader() ? { Cookie: this.cookieHeader() } : {}),
          ...(options.headers ?? {})
        };

        let data: string | undefined;
        if (options.form) {
          headers['Content-Type'] = 'application/x-www-form-urlencoded';
          data = Object.entries(options.form)
            .filter(([, v]) => v !== undefined && v !== null)
            .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
            .join('&');
        } else if (options.body !== undefined) {
          data = options.body;
        }

        const config: AxiosRequestConfig = {
          url,
          method,
          params: options.params,
          headers,
          data,
          responseType: options.responseType === 'arraybuffer' ? 'arraybuffer' : 'text',
          timeout: options.timeoutMs ?? 20000
        };

        const res: AxiosResponse = await this.http.request(config);
        this.absorbSetCookie(res.headers as Record<string, unknown>);
        this.logger.debug(`${method} ${url} -> ${res.status}`);

        // 手动跟随 302，捕获后续 Set-Cookie（最多 5 跳，防止重定向环）
        if (res.status >= 300 && res.status < 400) {
          const loc = res.headers['location'] as string | undefined;

          // 风控自愈：被重定向到 passport403 时丢弃风控页下发的 route 钉选 Cookie，
          // 切换 App UA 重试原请求（保留已登录 Cookie）
          if (loc && /passport403|\/views\/error\//.test(loc) && !this.uaFallbackTried && this.userAgent !== APP_UA) {
            this.uaFallbackTried = true;
            this.userAgent = APP_UA;
            delete this.cookies['route'];
            this.logger.warn('命中风控 302(passport403)，切换 App UA 重试');
            return await this.request(url, { ...options, retries: Math.min(options.retries ?? 3, 1) });
          }

          const hops = options._hops ?? 0;
          if (loc && hops < 5) {
            const next = new URL(loc, url).toString();
            return await this.request(next, {
              ...options,
              method: 'GET',
              form: undefined,
              body: undefined,
              retries: 0,
              _hops: hops + 1
            });
          }
          this.logger.debug(`302 终止（${loc ? '跳数超限' : '无 location'}）: ${url}`);
          return options.responseType === 'arraybuffer' ? Buffer.alloc(0) : '';
        }

        if (options.responseType === 'arraybuffer') {
          return Buffer.from(res.data as ArrayBuffer);
        }
        return String(res.data ?? '');
      } catch (err) {
        lastError = err;
        const status = (err as { response?: { status?: number } })?.response?.status;
        this.logger.warn(`${method} ${url} attempt ${attempt + 1} failed`, status ?? String(err));
        // 4xx 不重试
        if (status && status >= 400 && status < 500) {
          break;
        }
        if (attempt < retries) {
          await this.sleep(500 * Math.pow(2, attempt));
        }
      }
    }
    throw new Error(`请求失败: ${url} (${String(lastError)})`);
  }

  async getHtml(url: string, options: RequestOptions = {}): Promise<string> {
    return (await this.request(url, { ...options, method: 'GET', responseType: 'text' })) as string;
  }

  async postForm(url: string, form: Record<string, string | number | undefined>, options: RequestOptions = {}): Promise<string> {
    return (await this.request(url, { ...options, method: 'POST', form, responseType: 'text' })) as string;
  }

  async getBuffer(url: string, options: RequestOptions = {}): Promise<Buffer> {
    return (await this.request(url, { ...options, method: 'GET', responseType: 'arraybuffer', asImage: true })) as Buffer;
  }
}
