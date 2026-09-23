/**
 * 认证模块：密码(AES) / 短信 / 扫码 / Cookie 登录。
 * 协议细节见 docs/API-RESEARCH.md 第 2.3 节。
 */
import { AES_KEY, DOMAINS, ENDPOINTS } from '../config/constants';
import { encryptLoginField } from '../utils/crypto';
import { extractHiddenInputs, tryParseJson } from '../utils/text';
import { HttpClient } from './client';
import { AccountInfo, LoginResult, QrSession, QrStatus } from './types';
import { Logger } from '../services/logger';

interface RawLoginResponse {
  status?: boolean;
  mes?: string;
  msg?: string;
  uid?: number | string;
  name?: string;
  fid?: number | string;
  url?: string;
  validate?: string;
}

export class AuthApi {
  constructor(private readonly http: HttpClient, private readonly logger: Logger) {}

  private buildAccount(raw: RawLoginResponse, phone: string, cookies: Record<string, string>): AccountInfo {
    const now = Date.now();
    return {
      id: String(raw.uid ?? cookies['_uid'] ?? phone),
      phone,
      uid: String(raw.uid ?? cookies['_uid'] ?? ''),
      name: String(raw.name ?? phone),
      fid: String(raw.fid ?? cookies['fid'] ?? '-1'),
      createdAt: now,
      lastActiveAt: now
    };
  }

  /** 手机号 + 密码登录（AES-CBC 加密） */
  async loginByPassword(phone: string, password: string): Promise<LoginResult> {
    // 先建立会话 Cookie（浏览器流程会先访问登录页）
    try {
      await this.http.getHtml(`${DOMAINS.passport}/login?refer=${encodeURIComponent(`${DOMAINS.portal}/`)}`, {
        retries: 0,
        timeoutMs: 8000
      });
    } catch (err) {
      this.logger.debug('预热登录页失败（忽略）', String(err));
    }

    const form = {
      uname: encryptLoginField(phone, AES_KEY),
      password: encryptLoginField(password, AES_KEY),
      fid: '-1',
      refer: encodeURIComponent(`${DOMAINS.portal}/`),
      t: 'true',
      forbidotherlogin: '0',
      validate: '',
      doubleFactorLogin: '0',
      independentId: '0'
    };
    const text = await this.http.postForm(ENDPOINTS.login, form);
    const json = tryParseJson<RawLoginResponse>(text);
    if (!json) {
      this.logger.warn('登录响应不是 JSON', text.slice(0, 200));
      return { ok: false, message: '登录响应异常（可能需要验证码或接口变更）' };
    }
    if (json.status) {
      // 回跳门户补全 Cookie
      await this.http.getHtml(json.url ?? `${DOMAINS.portal}/`);
      return {
        ok: true,
        account: this.buildAccount(json, phone, this.http.getCookies()),
        cookies: this.http.getCookies()
      };
    }
    if (json.validate) {
      return {
        ok: false,
        message: `需要验证码：${json.mes ?? ''}`,
        validateImage: `${DOMAINS.passport}/validate?code=${json.validate}`
      };
    }
    return { ok: false, message: json.mes ?? json.msg ?? '登录失败' };
  }

  /** 短信验证码登录 */
  async loginBySms(phone: string, code: string): Promise<LoginResult> {
    const form = {
      uname: phone,
      verCode: encodeURIComponent(encryptLoginField(code, AES_KEY)),
      fid: '-1',
      refer: encodeURIComponent(`${DOMAINS.portal}/`)
    };
    const text = await this.http.postForm(ENDPOINTS.loginByCode, form);
    const json = tryParseJson<RawLoginResponse>(text);
    if (json?.status) {
      await this.http.getHtml(json.url ?? `${DOMAINS.portal}/`);
      return {
        ok: true,
        account: this.buildAccount(json, phone, this.http.getCookies()),
        cookies: this.http.getCookies()
      };
    }
    return { ok: false, message: json?.mes ?? json?.msg ?? '验证码登录失败' };
  }

  /** 生成扫码登录二维码 */
  async beginQrLogin(): Promise<QrSession> {
    const refer = encodeURIComponent(`${DOMAINS.portal}/`);
    const page = await this.http.getHtml(`${DOMAINS.passport}/login?fid=&newversion=true&refer=${refer}`);
    const hidden = extractHiddenInputs(page);
    const uuid = hidden['uuid'] ?? '';
    const enc = hidden['enc'] ?? '';
    if (!uuid || !enc) {
      throw new Error('未能获取扫码参数（uuid/enc），接口可能变更');
    }
    const image = await this.http.getBuffer(`${ENDPOINTS.createQr}?uuid=${encodeURIComponent(uuid)}&fid=-1`);
    return { uuid, enc, image };
  }

  /** 轮询扫码状态；confirmed 时返回登录结果 */
  async pollQrStatus(session: QrSession): Promise<{ status: QrStatus; login?: LoginResult }> {
    const text = await this.http.postForm(ENDPOINTS.qrAuthStatus, { enc: session.enc, uuid: session.uuid });
    const json = tryParseJson<{ status?: boolean; type?: number; mes?: string }>(text);
    if (!json) {
      return { status: 'unknown' };
    }
    if (json.status === true) {
      await this.http.getHtml(`${DOMAINS.portal}/`);
      const account = this.buildAccount({ uid: this.http.getCookies()['_uid'] }, this.http.getCookies()['_uid'] ?? '', this.http.getCookies());
      return {
        status: 'confirmed',
        login: { ok: true, account, cookies: this.http.getCookies() }
      };
    }
    switch (json.type) {
      case 4:
        return { status: 'scanned' };
      case 2:
        return { status: 'expired' };
      case 6:
        return { status: 'cancelled' };
      default:
        return { status: 'waiting' };
    }
  }

  /** 手动粘贴 Cookie 登录（兜底） */
  async loginByCookie(cookieText: string): Promise<LoginResult> {
    const jar: Record<string, string> = {};
    for (const part of cookieText.split(/[;\n]/)) {
      const eq = part.indexOf('=');
      if (eq <= 0) {
        continue;
      }
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      if (name && value) {
        jar[name] = value;
      }
    }
    for (const required of ['_uid', '_d', 'vc3']) {
      if (!jar[required]) {
        return { ok: false, message: `Cookie 缺少必需字段: ${required}` };
      }
    }
    this.http.loadCookies(jar);
    const ok = await this.validateSession();
    if (!ok) {
      return { ok: false, message: 'Cookie 无效或已过期' };
    }
    return {
      ok: true,
      account: this.buildAccount({ uid: jar['_uid'] }, jar['_uid'], jar),
      cookies: jar
    };
  }

  /** 会话有效性校验 */
  async validateSession(): Promise<boolean> {
    const cookies = this.http.getCookies();
    if (!cookies['_uid'] || !cookies['vc3']) {
      return false;
    }
    try {
      const html = await this.http.getHtml(`${DOMAINS.portal}/homepage`, { retries: 0, timeoutMs: 8000 });
      return !/用户登录|请登录|login/i.test(html.slice(0, 2000));
    } catch {
      return false;
    }
  }

  /** 拉取昵称/学校（尽力而为） */
  async fetchProfile(): Promise<{ name?: string; school?: string }> {
    try {
      const html = await this.http.getHtml(`${DOMAINS.portal}/accountManage`, { retries: 1 });
      const name = /<span[^>]*class="[^"]*name[^"]*"[^>]*>([^<]{1,40})<\/span>/.exec(html)?.[1]?.trim();
      const school = /所属院校[^<]*<[^>]*>([^<]{1,60})</.exec(html)?.[1]?.trim();
      return { name, school };
    } catch (err) {
      this.logger.debug('fetchProfile failed', String(err));
      return {};
    }
  }

  logout(): void {
    this.http.clearCookies();
  }
}
