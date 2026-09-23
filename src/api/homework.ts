/**
 * 作业模块：作业列表、详情、暂存与提交（题目解析见 parsers.ts）。
 */
import { ENDPOINTS } from '../config/constants';
import { stripHtml, tryParseJson } from '../utils/text';
import { HttpClient } from './client';
import { getCoursePageContext } from './coursePage';
import { CoursePageContext, extractRawWorks, mapPlatformVerdict, normalizeWork, parseProblems, RawWork } from './parsers';
import { Homework, Problem } from './types';
import { Logger } from '../services/logger';

export {
  detectQuestionType,
  extractTemplateCode,
  extractTestCases,
  homeworkFromTaskPoint,
  mapPlatformVerdict,
  mergeHomeworkLists,
  parseProblems,
  parseWorkHtml,
  stateLabelOf
} from './parsers';

interface CourseRef {
  courseId: string;
  clazzId: string;
  cpi: string;
  name?: string;
}

const STU_WORK_TTL_MS = 5 * 60 * 1000;
let stuWorkCache: { at: number; works: RawWork[] } | undefined;

interface WorkListAttempt {
  label: string;
  url: string;
}

export class HomeworkApi {
  constructor(private readonly http: HttpClient, private readonly logger: Logger) {}

  private workQuery(course: CourseRef): string {
    return `courseId=${course.courseId}&classId=${course.clazzId}&cpi=${course.cpi}&ut=s`;
  }

  /** work/list 请求变体：完整签名参数优先，其次精简参数、默认端点（enc 缺失时服务端会回"无权限"空页） */
  private workListAttempts(course: CourseRef, page: CoursePageContext): WorkListAttempt[] {
    const base = absoluteUrl(page.workListUrl ?? ENDPOINTS.workList);
    const enc = page.workEnc ?? '';
    const stuenc = page.enc ?? '';
    const attempts: WorkListAttempt[] = [];
    const push = (label: string, url: string) => {
      if (!attempts.some((a) => a.url === url)) {
        attempts.push({ label, url });
      }
    };
    push(
      'full',
      withQuery(base, {
        courseId: course.courseId,
        classId: course.clazzId,
        cpi: course.cpi,
        ut: 's',
        openc: page.openc ?? '',
        enc,
        t: Date.now(),
        stuenc,
        isdisplaytable: '2'
      })
    );
    if (enc) {
      push(
        'minimal',
        withQuery(base, {
          courseId: course.courseId,
          classId: course.clazzId,
          cpi: course.cpi,
          ut: 's',
          enc,
          t: Date.now(),
          stuenc
        })
      );
    }
    if (base !== ENDPOINTS.workList) {
      push('default-endpoint', withQuery(ENDPOINTS.workList, {
        courseId: course.courseId,
        classId: course.clazzId,
        cpi: course.cpi,
        ut: 's',
        openc: page.openc ?? '',
        enc,
        t: Date.now(),
        stuenc,
        isdisplaytable: '2'
      }));
    }
    return attempts;
  }

  /** 作业列表（返回主链路原始响应便于调试取证） */
  async listHomeworkRaw(course: CourseRef): Promise<string> {
    const page = await getCoursePageContext(this.http, this.logger, course);
    const attempt = this.workListAttempts(course, page)[0];
    return await this.fetchWorkPages(attempt.url);
  }

  /** 逐页拉取（pageNum 追加/替换到同一请求上） */
  private async fetchWorkPages(firstUrl: string): Promise<string> {
    const first = await this.http.getHtml(firstUrl);
    const pages = parseInt(/pageNum\s*:\s*(\d+)/.exec(first)?.[1] ?? '1', 10);
    if (!(pages > 1)) {
      return first;
    }
    const chunks = [first];
    for (let p = 2; p <= Math.min(pages, 20); p++) {
      chunks.push(await this.http.getHtml(withPage(firstUrl, p)));
    }
    return chunks.join('\n');
  }

  /** 作业列表（保留全部状态：待做/已完成/未开放/已截止；多级兜底） */
  async listHomework(course: CourseRef): Promise<Homework[]> {
    const page = await getCoursePageContext(this.http, this.logger, course);
    let list: RawWork[] = [];
    let hint = '';
    for (const attempt of this.workListAttempts(course, page)) {
      try {
        const text = await this.fetchWorkPages(attempt.url);
        const found = extractRawWorks(text);
        hint = `${attempt.label} 响应 ${text.length} 字符 -> ${found.length} 条`;
        this.logger.debug(`work/list [${course.name}/${attempt.label}] ${hint}`);
        if (found.length) {
          list = found;
          break;
        }
      } catch (err) {
        hint = `${attempt.label} 请求失败`;
        this.logger.debug(`work/list [${course.name}/${attempt.label}] 失败`, String(err));
      }
    }
    if (!list.length) {
      const global = await this.stuWorks();
      const name = course.name ?? '';
      const named = global.filter((w) => w.courseName);
      list = named.length
        ? named.filter((w) => !!name && (name.includes(w.courseName ?? '') || (w.courseName ?? '').includes(name)))
        : global;
      hint += `；stu-work 兜底 ${list.length} 条`;
    }
    if (!list.length) {
      this.logger.info(
        `作业列表为空: ${course.name}（enc=${page.workEnc ? 'workEnc' : page.enc ? 'pageEnc' : '缺失'}；${hint}）。可右键课程节点「抓取作业原始响应」取证`
      );
    }
    return list.map((raw) => normalizeWork(raw, course));
  }

  /** 全局学生作业列表（stu-work，跨课程聚合；带短缓存） */
  private async stuWorks(): Promise<RawWork[]> {
    if (stuWorkCache && Date.now() - stuWorkCache.at < STU_WORK_TTL_MS) {
      return stuWorkCache.works;
    }
    try {
      const html = await this.http.getHtml(ENDPOINTS.stuWork);
      const works = extractRawWorks(html);
      stuWorkCache = { at: Date.now(), works };
      return works;
    } catch (err) {
      this.logger.debug('stu-work 拉取失败', String(err));
      return [];
    }
  }

  /** 作业详情 + 题目解析（优先详情页直链 -> doHomeWork） */
  async getHomeworkDetail(work: Homework): Promise<Problem[]> {
    const problems = await this.detailViaUrl(work);
    if (problems.length) {
      this.logger.debug(`作业 ${work.workId} 解析到 ${problems.length} 道题目`);
      return problems;
    }
    const url = `${ENDPOINTS.workDetailMobile}?workId=${work.workId}&${this.workQuery(work)}`;
    const html = await this.http.getHtml(url);
    const fallback = parseProblems(html);
    this.logger.debug(`作业 ${work.workId} 解析到 ${fallback.length} 道题目`);
    return fallback;
  }

  private async detailViaUrl(work: Homework): Promise<Problem[]> {
    if (!work.url) {
      return [];
    }
    try {
      const pageHtml = await this.http.getHtml(work.url);
      const direct = parseProblems(pageHtml);
      if (direct.length) {
        return direct;
      }
      const detailUrl = resolveDoHomeWork(pageHtml);
      if (!detailUrl) {
        return [];
      }
      const html = await this.http.getHtml(detailUrl);
      return parseProblems(html);
    } catch (err) {
      this.logger.debug('作业详情直链解析失败', String(err));
      return [];
    }
  }

  /** 提交作业答案（answerList 结构见 docs/API-RESEARCH.md 3.4） */
  async submitWork(work: Homework, answerListJson: string, totalScore: number): Promise<{ ok: boolean; message: string }> {
    const form = {
      courseId: work.courseId,
      classId: work.clazzId,
      cpi: work.cpi,
      workId: work.workId,
      answer: answerListJson,
      totalScore: String(totalScore),
      status: '0',
      enc: '',
      pyAnswer: ''
    };
    try {
      const text = await this.http.postForm(ENDPOINTS.workSubmit, form);
      return this.parseSubmitResult(text);
    } catch (err) {
      this.logger.warn('addStudentWorkNew 失败，尝试新版接口', String(err));
      const text = await this.http.postForm(ENDPOINTS.workSubmitNew, form);
      return this.parseSubmitResult(text);
    }
  }

  private parseSubmitResult(text: string): { ok: boolean; message: string } {
    const json = tryParseJson<{ result?: number; status?: boolean; msg?: string; mes?: string }>(text);
    const ok = json?.status === true || json?.result === 1;
    return { ok, message: json?.msg ?? json?.mes ?? (ok ? '提交成功' : '提交失败') };
  }

  /** 暂存答案 */
  async saveDraft(work: Homework, answerListJson: string): Promise<void> {
    try {
      await this.http.postForm(ENDPOINTS.workSave, {
        courseId: work.courseId,
        classId: work.clazzId,
        cpi: work.cpi,
        workId: work.workId,
        answer: answerListJson
      });
    } catch (err) {
      this.logger.debug('saveDraft failed', String(err));
    }
  }

  /** 提交后拉取判题/批改结果 */
  async fetchResult(work: Homework): Promise<{ verdict: string; score?: number; message?: string }> {
    const url = `${ENDPOINTS.workDetailMobile}?workId=${work.workId}&${this.workQuery(work)}&result=1`;
    const html = await this.http.getHtml(url);
    const text = stripHtml(html);
    const score = /(?:得分|score)[:：]?\s*(\d+(?:\.\d+)?)/i.exec(text)?.[1];
    const verdictText = /待测评|测评中|通过|答案错误|超时|内存超限|运行错误|编译错误|已批改|未批改/.exec(text)?.[0] ?? 'Judging';
    return {
      verdict: mapPlatformVerdict(verdictText),
      score: score ? parseFloat(score) : undefined,
      message: verdictText
    };
  }

  /** 作业详情原始响应（调试取证） */
  async getHomeworkDetailRaw(work: Homework): Promise<string> {
    return await this.http.getHtml(`${ENDPOINTS.workDetailMobile}?workId=${work.workId}&${this.workQuery(work)}`);
  }
}

function absoluteUrl(url: string): string {
  if (url.startsWith('//')) {
    return `https:${url}`;
  }
  return url.startsWith('/') ? `https://mooc1.chaoxing.com${url}` : url;
}

function withPage(url: string, page: number): string {
  const re = /([?&])pageNum=\d+/;
  if (re.test(url)) {
    return url.replace(re, `$1pageNum=${page}`);
  }
  return `${url}${url.includes('?') ? '&' : '?'}pageNum=${page}`;
}

function withQuery(url: string, params: Record<string, string | number | undefined>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `${url}${url.includes('?') ? '&' : '?'}${qs}`;
}

function resolveDoHomeWork(pageHtml: string): string | undefined {
  const m = /["'(](\/(?:mooc-ans\/)?work\/phone\/doHomeWork\?[^"')]+)/i.exec(pageHtml);
  const path = m?.[1];
  if (!path) {
    return undefined;
  }
  const origin = 'https://mooc1-api.chaoxing.com';
  return path.startsWith('/mooc-ans/') ? `${origin}${path}` : `${origin}/mooc-ans${path}`;
}
