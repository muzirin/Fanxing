/**
 * 通知模块：通知列表 / 详情 / 已读状态。
 */
import { ENDPOINTS } from '../config/constants';
import { HttpClient } from './client';
import { extractRawNotices, normalizeNotice, parseNoticeHtml, RawNotice } from './parsers';
import { NoticeItem } from './types';
import { Logger } from '../services/logger';

export { parseNoticeHtml } from './parsers';

export class NotificationApi {
  constructor(private readonly http: HttpClient, private readonly logger: Logger) {}

  /** 通知列表（getNoticeList 游标翻页；旧 getNotices 已 404 废弃） */
  async listNotices(pages = 2, size = 20): Promise<NoticeItem[]> {
    void size;
    const out: NoticeItem[] = [];
    const seen = new Set<string>();
    let lastValue = 0;
    for (let page = 1; page <= pages; page++) {
      let text = '';
      try {
        text = await this.http.postForm(ENDPOINTS.noticeListNew, {
          type: 1,
          notice_type: 1,
          lastValue,
          sort: 1
        });
      } catch (err) {
        this.logger.warn('getNoticeList 请求失败', String(err));
        break;
      }
      const list: RawNotice[] = extractRawNotices(text);
      const parsed = list.length ? list.map((raw) => normalizeNotice(raw)) : parseNoticeHtml(text);
      const fresh = parsed.filter((n) => n.id && !seen.has(n.id));
      if (!fresh.length) {
        if (page === 1 && !parsed.length) {
          this.logger.info(`通知列表为空（getNoticeList 响应 ${text.length} 字符），可运行「抓取作业原始响应」一并取证`);
        }
        break;
      }
      for (const n of fresh) {
        seen.add(n.id);
        out.push(n);
      }
      const ids = fresh.map((n) => parseInt(n.id, 10)).filter((x) => !Number.isNaN(x));
      const next = ids.length ? Math.max(...ids) : 0;
      if (next <= lastValue) {
        break;
      }
      lastValue = next;
    }
    return out;
  }

  /** 通知详情 */
  async getNoticeDetail(noticeId: string): Promise<string> {
    const html = await this.http.getHtml(`${ENDPOINTS.noticeDetail}?noticeId=${encodeURIComponent(noticeId)}`);
    const body = /<div[^>]*class=["'][^"']*(?:notice_content|article|content)[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\//i.exec(html);
    return body ? body[1] : html;
  }

  /** 标记已读（尽力而为，失败仅记录日志） */
  async markRead(noticeId: string): Promise<void> {
    try {
      await this.http.getHtml(`${ENDPOINTS.noticeDetail}?noticeId=${encodeURIComponent(noticeId)}`, { retries: 0 });
    } catch (err) {
      this.logger.debug('markRead failed', String(err));
    }
  }
}
