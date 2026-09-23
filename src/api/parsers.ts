/**
 * 纯解析函数集合（HTML/JSON -> 模型），无 vscode / 网络依赖，便于单元测试。
 * 由 api/course、api/homework、api/notification 复用。
 */
import { QuestionType } from '../config/constants';
import { Chapter, Homework, HomeworkKind, NoticeCategory, NoticeItem, Problem, TaskPoint, TestCase } from './types';
import { parseDateTime, extractAll, parseAttrs, stripHtml, tryParseJson } from '../utils/text';

/* ------------------------------ 作业 ------------------------------ */

export interface RawWork {
  workId?: number | string;
  id?: number | string;
  title?: string;
  workTitle?: string;
  endTime?: string;
  endtime?: string;
  startTime?: string;
  starttime?: string;
  submitStatus?: number | string;
  status?: number | string;
  score?: number | string;
  totalScore?: number | string;
  isLook?: number | string;
  teacherComment?: string;
  workType?: number | string;
  multiSubmit?: number | boolean;
  /** 状态文本（未开放/已完成/已截止/已批改） */
  stateText?: string;
  /** 平台状态原文（未交/待批阅/已批阅/未提交…） */
  statusText?: string;
  /** 剩余时间原文（剩余2天11小时） */
  remainText?: string;
  /** 详情页直链（li[data] / stu-work data 属性） */
  url?: string;
  /** 条目所属课程名（stu-work 全局列表带课程名） */
  courseName?: string;
  /** 数据来源标记 */
  source?: 'list' | 'chapter';
}

/** 平台状态原文 -> 统一状态关键词（供 normalizeWork 归一） */
export function platformStateText(status: string | undefined): string {
  const text = `${status ?? ''}`;
  if (/未开放|未开始|未发布|即将开放|暂未开放/.test(text)) {
    return '未开放';
  }
  if (/已批阅|已批改|已评分/.test(text)) {
    return '已批改';
  }
  if (/待批阅|待批改|批阅中|待测评|待评分/.test(text)) {
    return '已提交';
  }
  if (/已截止|已过期|已结束|逾期|已关闭/.test(text)) {
    return '已截止';
  }
  if (/已完成|已提交|已作答|已交(?!流)/.test(text)) {
    return '已完成';
  }
  return '';
}

/** "剩余2天11小时30分钟" -> 截止时间戳（基于 now 推算） */
export function deadlineFromRemaining(text: string | undefined | null, now: number = Date.now()): number {
  if (!text) {
    return 0;
  }
  const day = /(\d+)\s*天/.exec(text)?.[1];
  const hour = /(\d+)\s*小时/.exec(text)?.[1];
  const minute = /(\d+)\s*分钟?/.exec(text)?.[1];
  const second = /(\d+)\s*秒/.exec(text)?.[1];
  if (!day && !hour && !minute && !second) {
    return 0;
  }
  const delta =
    (day ? parseInt(day, 10) : 0) * 86400000 +
    (hour ? parseInt(hour, 10) : 0) * 3600000 +
    (minute ? parseInt(minute, 10) : 0) * 60000 +
    (second ? parseInt(second, 10) : 0) * 1000;
  return delta > 0 ? now + delta : 0;
}

export function detectHomeworkKind(title: string, raw: RawWork = {}): HomeworkKind {
  const text = `${title} ${raw.workType ?? ''}`;
  if (/程序|编程|代码|oj|上机|programming/i.test(text)) {
    return 'code';
  }
  if (/小组|团队/.test(text)) {
    return 'group';
  }
  if (/测验|考试|选择|判断/.test(text)) {
    return 'quiz';
  }
  if (/附件|文件|上传/.test(text)) {
    return 'file';
  }
  return 'written';
}

/** 平台判题文案 -> 统一状态 */
export function mapPlatformVerdict(text: string): string {
  if (/编译错误|compile/i.test(text)) {
    return 'CE';
  }
  if (/运行错误|runtime/i.test(text)) {
    return 'RE';
  }
  if (/超时|time limit/i.test(text)) {
    return 'TLE';
  }
  if (/内存/i.test(text)) {
    return 'MLE';
  }
  if (/答案错误|wrong/i.test(text)) {
    return 'WA';
  }
  if (/通过|正确|accepted|已批改/.test(text)) {
    return 'AC';
  }
  return 'Judging';
}

export function normalizeWork(
  raw: RawWork,
  course: { courseId: string; clazzId: string; cpi: string }
): Homework {
  const title = stripHtml(raw.workTitle ?? raw.title ?? '') || '(未命名作业)';
  const stateText = `${raw.stateText ?? ''} ${platformStateText(raw.statusText)}`.trim();
  const locked = /未开放|未开始|未发布/.test(stateText);
  const expired = /已截止|已过期|已结束/.test(stateText);
  const awaitingMark = /待批阅|待批改|批阅中/.test(`${raw.stateText ?? ''} ${raw.statusText ?? ''}`);
  const submitted =
    Number(raw.submitStatus ?? raw.status ?? 0) > 0 || /已完成|已提交|已作答/.test(stateText) || awaitingMark;
  const marked = raw.isLook === 1 || raw.isLook === '1' || /已批改|已批阅/.test(stateText);
  const deadline = parseDateTime(raw.endTime ?? raw.endtime) || deadlineFromRemaining(raw.remainText);
  return {
    workId: String(raw.workId ?? raw.id ?? ''),
    clazzId: course.clazzId,
    courseId: course.courseId,
    cpi: course.cpi,
    title,
    kind: detectHomeworkKind(title, raw),
    deadline,
    submitted,
    marked,
    locked,
    expired,
    stateLabel: stateLabelOf({ locked, expired, submitted, marked, awaitingMark }),
    openTime: parseDateTime(raw.startTime ?? raw.starttime) || undefined,
    score: raw.score !== undefined && raw.score !== '' ? Number(raw.score) : undefined,
    totalScore: raw.totalScore !== undefined ? Number(raw.totalScore) : undefined,
    teacherComment: raw.teacherComment,
    multiSubmit: raw.multiSubmit === 1 || raw.multiSubmit === true,
    statusText: raw.statusText,
    url: raw.url
  };
}

/** 状态展示文案（未开放/已完成等全部保留展示，不隐藏） */
export function stateLabelOf(state: {
  locked?: boolean;
  expired?: boolean;
  submitted?: boolean;
  marked?: boolean;
  awaitingMark?: boolean;
}): string {
  if (state.locked) {
    return '未开放';
  }
  if (state.marked) {
    return '已批改';
  }
  if (state.awaitingMark) {
    return '待批改';
  }
  if (state.submitted) {
    return '已完成';
  }
  if (state.expired) {
    return '已截止';
  }
  return '待完成';
}

/** 列表项状态关键词（区块标题或项内文本） */
function stateFromText(text: string): Partial<{ locked: boolean; expired: boolean; submitted: boolean; marked: boolean }> | undefined {
  if (/未开放|未开始|未发布|即将开放/.test(text)) {
    return { locked: true };
  }
  if (/已批改/.test(text)) {
    return { marked: true, submitted: true };
  }
  if (/已完成|已提交|已作答/.test(text)) {
    return { submitted: true };
  }
  if (/已截止|已过期|已结束/.test(text)) {
    return { expired: true };
  }
  return undefined;
}

/**
 * 作业列表 HTML 解析（状态感知）：
 * 新版列表项 `<li onclick="goTask(this)" data="详情直链">`（p 标题 + span.status 状态 + 剩余/截止时间），
 * 兼容旧版区块标题（待做/已完成/未开放/已截止）继承与链接式条目；li 扫不到时回退 data/href 数据块。
 */
export function parseWorkHtml(html: string): RawWork[] {
  const out: RawWork[] = [];
  const tokenRe = /<h[1-6][^>]*>[\s\S]*?<\/h[1-6]>|<li[^>]*>[\s\S]*?<\/li>/gi;
  let sectionState: ReturnType<typeof stateFromText> = undefined;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(html)) !== null) {
    const token = m[0];
    if (/^<h[1-6]/i.test(token)) {
      sectionState = stateFromText(stripHtml(token)) ?? sectionState;
      continue;
    }
    const raw = rawWorkFromBlock(token, sectionState);
    if (raw) {
      out.push(raw);
    }
  }
  if (!out.length) {
    out.push(...parseWorkDataBlocks(html));
  }
  return out;
}

/** 无 li 结构时按携带作业链接的 div/tr 数据块兜底切分 */
function parseWorkDataBlocks(html: string): RawWork[] {
  const anchorRe = /<(?:li|div|tr|dd)[^>]*(?:data|href|onclick)=["'][^"']*(?:workid=|taskrefid=|work\/task|doHomeWork|dowork|work\/list)[^"']*["'][^>]*>/gi;
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    if (!positions.length || m.index > positions[positions.length - 1]) {
      positions.push(m.index);
    }
  }
  const out: RawWork[] = [];
  for (let i = 0; i < positions.length; i++) {
    const end = i + 1 < positions.length ? positions[i + 1] : Math.min(html.length, positions[i] + 4000);
    const raw = rawWorkFromBlock(html.slice(positions[i], end), undefined);
    if (raw) {
      out.push(raw);
    }
  }
  return out;
}

function rawWorkFromBlock(block: string, sectionState: ReturnType<typeof stateFromText>): RawWork | undefined {
  const text = stripHtml(block);
  const openTag = /^<[a-z]+[^>]*>/i.exec(block)?.[0] ?? '';
  const attrs = parseAttrs(openTag);
  const rawLink =
    looksLikeWorkUrl(attrs['data']) ? attrs['data'] :
    looksLikeWorkUrl(attrs['href']) ? attrs['href'] :
    looksLikeWorkUrl(attrs['onclick']) ? /(https?:\/\/[^\s"'<>]+|\/\/[^\s"'<>]+|\/[^\s"'<>]+)/.exec(attrs['onclick'])?.[1] :
    undefined;
  const url = rawLink;
  const id =
    paramOf(url, 'workid') ??
    paramOf(url, 'taskrefid') ??
    /workid\s*=\s*["']?(\w+)/i.exec(block)?.[1] ??
    /taskrefid\s*=\s*["']?(\w+)/i.exec(block)?.[1];
  const titleMatch =
    /<p[^>]*class=["'][^"']*(?:title|overHidden)[^"']*["'][^>]*>([\s\S]*?)<\/p>/i.exec(block) ??
    /<p[^>]*>([\s\S]*?)<\/p>/i.exec(block) ??
    /<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
  const title = stripHtml(titleMatch?.[1] ?? '');
  if (!title && !id) {
    return undefined;
  }
  const dates = /([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/g;
  const end = /截止[^0-9]*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/.exec(text)?.[1]
    ?? dates.exec(block)?.[1];
  const start = /开放[^0-9]*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}[ T][0-9]{1,2}:[0-9]{2}(?::[0-9]{2})?)/.exec(text)?.[1];
  const score = /(?:得分|score|成绩)\s*[:：]?\s*(\d+(?:\.\d+)?)/i.exec(text)?.[1]
    ?? /(\d+(?:\.\d+)?)\s*分(?![钟时])/.exec(text)?.[1];
  const remainText = /剩余[\d天小时分钟秒]+/.exec(text)?.[0];
  const statusSpan = /<span[^>]*class=["'][^"']*status[^"']*["'][^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1];
  const statusText = stripHtml(statusSpan ?? '') || /(未开放|未开始|即将开放|待批阅|待批改|已批阅|已批改|已完成|已提交|已作答|未提交|未交|已截止|已过期)/.exec(text)?.[1] || '';
  const courseName = courseNameFromSpans(block, title);
  const itemState = stateFromText(block) ?? (statusText ? stateFromText(platformStateText(statusText) || statusText) : undefined);
  const state = itemState ?? sectionState;
  return {
    workId: id ?? '',
    title,
    endTime: end,
    startTime: start,
    score,
    submitStatus: state?.submitted ? 1 : 0,
    isLook: state?.marked ? 1 : 0,
    stateText: [state?.locked ? '未开放' : '', state?.expired ? '已截止' : '', state?.submitted ? '已完成' : '', state?.marked ? '已批改' : '']
      .filter(Boolean)
      .join(' '),
    statusText,
    remainText,
    url,
    courseName
  };
}

function looksLikeWorkUrl(value: string | undefined): value is string {
  return !!value && /workid|taskrefid|dowork|work\/task|doHomeWork/i.test(value);
}

function paramOf(url: string | undefined, key: string): string | undefined {
  if (!url) {
    return undefined;
  }
  const re = new RegExp(`[?&]${key}=([\\w-]+)`, 'i');
  return re.exec(url)?.[1];
}

function courseNameFromSpans(block: string, title: string): string | undefined {
  const spans = [...block.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/gi)].map((x) => ({
    text: stripHtml(x[1]),
    cls: /class=["']([^"']*)["']/i.exec(x[0])?.[1] ?? ''
  }));
  for (const span of spans) {
    const t = span.text.trim();
    if (!t || t === title) {
      continue;
    }
    if (/status|fr\b|time|score|tip/.test(span.cls)) {
      continue;
    }
    if (/(未开放|未开始|即将开放|待批阅|待批改|已批阅|已批改|已完成|已提交|已作答|未提交|未交|已截止|已过期|剩余|截止|开放|得分)/.test(t)) {
      continue;
    }
    if (/[0-9]{4}[-/][0-9]{1,2}|\d+:\d+|^\d+(\.\d+)?\s*分$|^[0-9]+$/.test(t)) {
      continue;
    }
    return t;
  }
  return undefined;
}

/** 从章节任务点合成作业条目（列表接口漏掉时的兜底，含未开放） */
export function homeworkFromTaskPoint(
  task: TaskPoint,
  chapter: { unlocked: boolean },
  course: { courseId: string; clazzId: string; cpi: string }
): Homework | undefined {
  if (task.kind !== 'work' || !task.workId) {
    return undefined;
  }
  const locked = task.unlocked === false || !chapter.unlocked;
  const state = { locked, submitted: task.done, marked: false, expired: false };
  return {
    workId: task.workId,
    clazzId: course.clazzId,
    courseId: course.courseId,
    cpi: course.cpi,
    title: task.name || `作业 ${task.workId}`,
    kind: detectHomeworkKind(task.name),
    deadline: 0,
    submitted: task.done,
    marked: false,
    locked,
    expired: false,
    stateLabel: stateLabelOf(state),
    source: 'chapter'
  };
}

/** 合并两个作业列表（按 workId 去重，保留字段更全的一条） */
export function mergeHomeworkLists(...lists: Homework[][]): Homework[] {
  const map = new Map<string, Homework>();
  for (const list of lists) {
    for (const item of list) {
      if (!item.workId) {
        continue;
      }
      const prev = map.get(item.workId);
      map.set(item.workId, prev ? mergeHomework(prev, item) : item);
    }
  }
  return [...map.values()];
}

function mergeHomework(a: Homework, b: Homework): Homework {
  const pick = <K extends keyof Homework>(key: K): Homework[K] => {
    const va = a[key];
    const vb = b[key];
    const score = (v: unknown) => (v === undefined || v === null || v === '' || v === 0 || v === false ? 0 : 1);
    return score(vb) > score(va) ? vb : va;
  };
  return {
    workId: a.workId,
    clazzId: pick('clazzId'),
    courseId: pick('courseId'),
    cpi: pick('cpi'),
    title: pick('title'),
    kind: pick('kind'),
    deadline: pick('deadline'),
    submitted: a.submitted || b.submitted,
    marked: a.marked || b.marked,
    locked: a.locked && b.locked,
    expired: a.expired || b.expired,
    stateLabel: pick('stateLabel'),
    openTime: pick('openTime'),
    score: pick('score'),
    totalScore: pick('totalScore'),
    teacherComment: pick('teacherComment'),
    multiSubmit: pick('multiSubmit'),
    problems: pick('problems'),
    source: pick('source')
  };
}

/** 从作业接口响应（JSON 或 HTML）提取作业原始项 */
export function extractRawWorks(text: string): RawWork[] {
  const json = tryParseJson<unknown>(text);
  const list = unwrapWorkList(json);
  return list ?? parseWorkHtml(text);
}

function unwrapWorkList(json: unknown): RawWork[] | undefined {
  if (Array.isArray(json)) {
    return json as RawWork[];
  }
  if (!json || typeof json !== 'object') {
    return undefined;
  }
  const obj = json as Record<string, unknown>;
  for (const key of ['data', 'workList', 'list', 'works', 'msg', 'result', 'noticeList']) {
    const value = obj[key];
    if (Array.isArray(value)) {
      return value as RawWork[];
    }
    if (value && typeof value === 'object') {
      const nested = unwrapWorkList(value);
      if (nested) {
        return nested;
      }
    }
  }
  return undefined;
}

const TYPE_PATTERNS: Array<[RegExp, QuestionType]> = [
  [/程序填空|程序设计|编程题|程序题|上机题|programming/i, QuestionType.Programming],
  [/多项选择|多选题|multiple/i, QuestionType.Multiple],
  [/单项选择|单选题|选择题|single/i, QuestionType.Single],
  [/判断题|true\s*[\/or]*\s*false/i, QuestionType.Judge],
  [/填空题|fill/i, QuestionType.Blank],
  [/简答题|问答题|论述题|short/i, QuestionType.ShortAnswer]
];

export function detectQuestionType(text: string): QuestionType {
  for (const [re, type] of TYPE_PATTERNS) {
    if (re.test(text)) {
      return type;
    }
  }
  return QuestionType.Unknown;
}

/** 解析样例测试用例：优先按"样例N："分段配对（避免把输入/输出说明误当样例），无样例标记时回退全文扫描 */
export function extractTestCases(html: string): TestCase[] {
  const text = stripHtml(html);
  const cases = extractLabeledCases(text);
  if (cases.length) {
    return cases;
  }

  const fallback: TestCase[] = [];
  const cnRe = /输入\s*[:：]\s*([\s\S]*?)输出\s*[:：]\s*([\s\S]*?)(?=(?:输入\s*[:：])|(?:样例|提示|说明|注意|限制|输入格式|输出格式)|$)/g;
  let m: RegExpExecArray | null;
  while ((m = cnRe.exec(text)) !== null) {
    fallback.push({ input: m[1].trim(), expectedOutput: m[2].trim() });
  }

  if (!fallback.length) {
    const enRe = /sample\s*input\s*[:：]?\s*([\s\S]*?)sample\s*output\s*[:：]?\s*([\s\S]*?)(?=(?:sample\s*input)|$)/gi;
    while ((m = enRe.exec(text)) !== null) {
      fallback.push({ input: m[1].trim(), expectedOutput: m[2].trim() });
    }
  }

  if (!fallback.length) {
    const pres = [...html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)].map((x) => stripHtml(x[1]));
    for (let i = 0; i + 1 < pres.length; i += 2) {
      if (pres[i].length < 2000 && pres[i + 1].length < 2000) {
        fallback.push({ input: pres[i].trim(), expectedOutput: pres[i + 1].trim() });
      }
    }
  }
  return fallback;
}

/** 按"样例/示例/Sample N："标记分段，逐段提取 输入/输出 对 */
function extractLabeledCases(text: string): TestCase[] {
  const markerRe = /(样例|示例|sample)\s*\d*\s*[:：]/gi;
  const marks: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = markerRe.exec(text)) !== null) {
    marks.push(m.index);
  }
  if (!marks.length) {
    return [];
  }
  const cases: TestCase[] = [];
  for (let i = 0; i < marks.length; i++) {
    const chunk = text.slice(marks[i], i + 1 < marks.length ? marks[i + 1] : text.length);
    const pair = samplePairOf(chunk);
    if (pair) {
      cases.push(pair);
    }
  }
  return cases;
}

function samplePairOf(chunk: string): TestCase | undefined {
  const cn = /输入\s*[:：]\s*([\s\S]*?)输出\s*[:：]\s*([\s\S]*)/.exec(chunk);
  if (cn) {
    return { input: cn[1].trim(), expectedOutput: cn[2].trim() };
  }
  const en = /input\s*[:：]?\s*([\s\S]*?)output\s*[:：]?\s*([\s\S]*)/i.exec(chunk);
  if (en) {
    return { input: en[1].trim(), expectedOutput: en[2].trim() };
  }
  return undefined;
}

/** 提取模板代码（pre 代码块中含代码特征的第一块） */
export function extractTemplateCode(html: string): string | undefined {
  for (const m of html.matchAll(/<pre[^>]*>([\s\S]*?)<\/pre>/gi)) {
    const code = stripHtml(m[1]);
    if (/(#include|using\s+namespace|public\s+class|def\s+\w+\s*\(|import\s+|int\s+main\s*\()/m.test(code)) {
      return code;
    }
  }
  return undefined;
}

/** 解析题目块（questionLi/pad30 容器优先，其次 questionId 标记、titType 题型头） */
export function parseProblems(html: string): Problem[] {
  const normalized = html.replace(/\r\n/g, '\n');
  const blocks = splitProblemBlocks(normalized);

  const problems: Problem[] = [];
  for (const { id, block } of blocks) {
    const text = stripHtml(block);
    const type = detectQuestionType(text);

    let stemHtml = extractQuestionStem(block);
    const optionAnchor = /<li[^>]*>\s*(?:<[^>]*>\s*)*[A-Da-d][.、．]/i.exec(stemHtml);
    if (optionAnchor) {
      stemHtml = stemHtml.slice(0, optionAnchor.index);
    }
    stemHtml = decodeFormulaImgs(stemHtml);
    stemHtml = stemHtml.replace(/^[\s\S]{0,80}?(单选题|多选题|判断题|填空题|简答题|程序设计|程序填空|编程题|程序题)/, '$1');
    const contentText = stripHtml(stemHtml);

    const options: { key: string; text: string }[] = [];
    const optRe = /<li[^>]*>\s*(?:<[^>]*>\s*)*([A-Da-d])[.、．]([\s\S]*?)<\/li>/gi;
    let om: RegExpExecArray | null;
    while ((om = optRe.exec(block)) !== null) {
      options.push({ key: om[1].toUpperCase(), text: stripHtml(om[2]) });
    }

    const bankId = /(题库编号|题号|编号)\s*[:：]?\s*([A-Za-z0-9\-]{3,})/.exec(text)?.[2];
    const timeMs = /时间限制\s*[:：]\s*(\d+)\s*(ms|毫秒|s|秒)/i.exec(text);
    const memMb = /内存限制\s*[:：]\s*(\d+)\s*(M|MB|兆)/i.exec(text);
    const score =
      parseFloat(/totalScore[\s\S]{0,160}?(\d+(?:\.\d+)?)/i.exec(block)?.[1] ?? 'NaN') ||
      parseFloat(/(\d+(?:\.\d+)?)\s*分(?![钟时])/.exec(text)?.[1] ?? '0') ||
      0;

    const images = [...stemHtml.matchAll(/<img[^>]*>/gi)].map((img) => {
      const src = /src=["']([^"']+)["']/i.exec(img[0])?.[1] ?? '';
      const alt = /alt=["']([^"']*)["']/i.exec(img[0])?.[1];
      return { src, alt };
    });

    problems.push({
      id,
      index: problems.length + 1,
      type,
      contentHtml: stemHtml,
      contentText: contentText.slice(0, 4000),
      options: options.length ? options : undefined,
      questionBankId: bankId,
      score,
      templateCode: type === QuestionType.Programming ? extractStudentAnswer(block) ?? extractTemplateCode(stemHtml) : undefined,
      languages: type === QuestionType.Programming ? ['c', 'cpp', 'java', 'python'] : undefined,
      sampleTests: type === QuestionType.Programming ? extractTestCases(stemHtml) : undefined,
      limits:
        type === QuestionType.Programming
          ? {
              timeMs: timeMs
                ? timeMs[2].toLowerCase().startsWith('m')
                  ? parseInt(timeMs[1], 10)
                  : parseInt(timeMs[1], 10) * 1000
                : undefined,
              memoryMb: memMb ? parseInt(memMb[1], 10) : undefined
            }
          : undefined,
      images: images.length ? images : undefined
    });
  }
  return problems;
}

/** 题干提取：新版批改页取 .qtContent 富文本，其余剔除作答/评分区后取整块 */
function extractQuestionStem(block: string): string {
  const qt =
    /<span[^>]*class=["'][^"']*qtContent[^"']*["'][^>]*>([\s\S]*?)<\/span>\s*<\/h3>/i.exec(block)?.[1] ??
    innerOfElement(block, /<span[^>]*class=["'][^"']*qtContent[^"']*["'][^>]*>/i, 'span');
  if (qt) {
    return qt.trim();
  }
  return block
    .replace(/<div[^>]*class=["'][^"']*(?:mark_answer|mark_score|aiArea|stuAnswerContent)[^"']*["'][^>]*>[\s\S]*$/i, '')
    .trim();
}

/** 取元素内部 HTML（按开闭标签配对，容忍嵌套同名标签） */
function innerOfElement(html: string, openRe: RegExp, tag: string): string | undefined {
  const m = openRe.exec(html);
  if (!m) {
    return undefined;
  }
  const start = m.index + m[0].length;
  const closeRe = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'gi');
  closeRe.lastIndex = start;
  let depth = 1;
  let cm: RegExpExecArray | null;
  while ((cm = closeRe.exec(html)) !== null) {
    if (/^<\//i.test(cm[0])) {
      depth--;
      if (depth === 0) {
        return html.slice(start, cm.index);
      }
    } else if (!/\/>$/.test(cm[0])) {
      depth++;
    }
  }
  return undefined;
}

/** 我的答案/参考作答（stuAnswerContent） -> 起始模板代码 */
function extractStudentAnswer(block: string): string | undefined {
  const region =
    /<[^>]*class=["'][^"']*stuAnswerContent[^"']*["'][^>]*>([\s\S]*?)(?:<\/dd>|<div[^>]*class=["'][^"']*(?:mark_score|mark_answer)|$)/i.exec(block)?.[1];
  if (!region) {
    return undefined;
  }
  const code = extractTemplateCode(region) ?? stripHtml(region).trim();
  return code || undefined;
}

/** 公式图（ans-formula-moudle，data 属性为 URL 编码的 {"formula":"LaTeX"}） -> KaTeX 节点 */
export function decodeFormulaImgs(html: string): string {
  return html.replace(/<img[^>]*class=["'][^"']*ans-formula-moudle[^"']*["'][^>]*>/gi, (tag) => {
    const data = /data=["']([^"']+)["']/i.exec(tag)?.[1];
    const src = /src=["']([^"']+)["']/i.exec(tag)?.[1] ?? '';
    try {
      const parsed = tryParseJson<{ formula?: string }>(decodeURIComponent(data ?? ''));
      const latex = parsed?.formula?.trim();
      if (latex) {
        return `<span class="fx-formula" data-latex="${encodeURIComponent(latex)}"></span>`;
      }
    } catch {
      // 保留原图降级
    }
    return tag.replace(/data=["'][^"']*["']/i, `data-src="${src}"`);
  });
}

/** 题目块切分：questionLi 容器 > pad30/mark_item 容器 > questionId 标记 > titType 题型头 */
function splitProblemBlocks(normalized: string): Array<{ id: string; block: string }> {
  const container = containerBlocks(normalized, /<div[^>]*class=["'][^"']*questionLi[^"']*["'][^>]*>/gi);
  if (container.length) {
    return container;
  }
  const pad = containerBlocks(normalized, /<div[^>]*class=["'][^"']*(?:pad30|mark_item)[^"']*["'][^>]*>/gi);
  if (pad.length) {
    return pad;
  }
  const marked = markerBlocks(normalized);
  if (marked.length) {
    return marked;
  }
  return containerBlocks(normalized, /<h2[^>]*class=["'][^"']*titType[^"']*["'][^>]*>/gi);
}

function containerBlocks(normalized: string, anchorRe: RegExp): Array<{ id: string; block: string }> {
  const positions: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(normalized)) !== null) {
    if (!positions.length || m.index > positions[positions.length - 1]) {
      positions.push(m.index);
    }
  }
  return positions.map((index, i) => {
    const block = normalized.slice(index, i + 1 < positions.length ? positions[i + 1] : normalized.length);
    return { id: questionIdOf(block, i + 1), block };
  });
}

function markerBlocks(normalized: string): Array<{ id: string; block: string }> {
  const marker = /(?:[\s"'<=]|^)((?:data-)?questionid|quesid|data-qid)["'\s]*[=:]["'\s]*([A-Za-z0-9_-]+)|id=["']question_?([A-Za-z0-9_-]+)/gi;
  const marks: Array<{ id: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(normalized)) !== null) {
    const id = m[2] ?? m[3];
    if (id) {
      marks.push({ id, index: m.index });
    }
  }
  return marks.map((mark, i) => ({
    id: mark.id,
    block: normalized.slice(mark.index, i + 1 < marks.length ? marks[i + 1].index : normalized.length)
  }));
}

function questionIdOf(block: string, fallbackIndex: number): string {
  return (
    /id=["']question_?([A-Za-z0-9_-]+)/i.exec(block)?.[1] ??
    /(?:^|[\s"'<=])data=["']([A-Za-z0-9_-]{3,})["']/i.exec(block)?.[1] ??
    /((?:data-)?questionid|quesid|data-qid)["'\s]*[=:]["'\s]*([A-Za-z0-9_-]+)/i.exec(block)?.[2] ??
    `q${fallbackIndex}`
  );
}

/* ------------------------------ 课程 ------------------------------ */

const TASK_KIND_BY_JOB: Record<string, TaskPoint['kind']> = {
  videoid: 'video',
  audioid: 'video',
  documentid: 'document',
  bookid: 'read',
  read: 'read',
  workid: 'work',
  discussionid: 'discussion',
  liveid: 'live'
};

export function detectTaskKind(jobId: string, name: string): TaskPoint['kind'] {
  const key = jobId.replace(/\d+/g, '').toLowerCase();
  if (TASK_KIND_BY_JOB[key]) {
    return TASK_KIND_BY_JOB[key];
  }
  if (/视频|audio|video/i.test(name)) {
    return 'video';
  }
  if (/文档|ppt|pdf|word/i.test(name)) {
    return 'document';
  }
  if (/作业|测验|测试/i.test(name)) {
    return 'work';
  }
  if (/讨论/i.test(name)) {
    return 'discussion';
  }
  return 'unknown';
}

/** 章节 HTML 解析（新版 stucoursemiddle 结构：章节带 chapterid/knowledgeid，任务点带 jobid） */
export function parseChapterHtml(html: string): Chapter[] {
  const marker = /(?:chapterid|knowledgeid)=["']?(\d+)["']?/gi;
  const marks: Array<{ id: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(html)) !== null) {
    marks.push({ id: m[1], index: m.index });
  }

  const chapters: Chapter[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < marks.length; i++) {
    const id = marks[i].id;
    if (seen.has(id)) {
      continue;
    }
    seen.add(id);
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    const block = html.slice(marks[i].index, end);
    const nameMatch = /<[^>]*class=["'][^"']*(?:catalog_name|chapter_name|title)[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(block);
    const name = stripHtml(nameMatch?.[1] ?? block.slice(0, 120)).slice(0, 80);
    if (!name) {
      continue;
    }
    const tasks: TaskPoint[] = [];
    const jobRe = /jobid=["']?([A-Za-z_]+\d+)["']?[^>]*>/gi;
    let jm: RegExpExecArray | null;
    const seenJobs = new Set<string>();
    while ((jm = jobRe.exec(block)) !== null) {
      const jobId = jm[1];
      if (seenJobs.has(jobId)) {
        continue;
      }
      seenJobs.add(jobId);
      const around = block.slice(Math.max(0, jm.index - 200), jm.index + 400);
      const done = /class=["'][^"']*(?:answertype|complete|done|finish)[^"']*["']|已完成/.test(around);
      const taskName = stripHtml(/<[^>]*class=["'][^"']*catalog_name["'][^>]*>([\s\S]*?)<\//i.exec(around)?.[1] ?? jobId);
      const workId = jobId.startsWith('workid') ? jobId.replace(/\D/g, '') : undefined;
      tasks.push({
        id: jobId,
        jobId,
        name: taskName || jobId,
        kind: detectTaskKind(jobId, taskName),
        done,
        workId
      });
    }
    chapters.push({
      id,
      name,
      order: chapters.length,
      unlocked: !/未开放|锁定/.test(block.slice(0, 500)),
      tasks
    });
  }
  return chapters;
}

/* ------------------------------ 课程中间页 / 章节页 / 任务点卡片 ------------------------------ */

export interface CoursePageContext {
  enc?: string;
  openc?: string;
  oldenc?: string;
  workEnc?: string;
  examEnc?: string;
  courseId?: string;
  clazzId?: string;
  workListUrl?: string;
  examListUrl?: string;
}

/** 课程中间页（stucoursemiddle）：隐藏域 enc/workEnc + 作业/考试 tab 直链 */
export function parseCoursePage(html: string): CoursePageContext {
  const ctx: CoursePageContext = {};
  for (const item of extractAll(html, /<input[^>]*>/gi)) {
    const attrs = parseAttrs(item.full);
    const key = (attrs['id'] || attrs['name'] || '').toLowerCase();
    const value = attrs['value'] ?? '';
    if (!value) {
      continue;
    }
    switch (key) {
      case 'enc':
        ctx.enc = value;
        break;
      case 'openc':
        ctx.openc = value;
        break;
      case 'oldenc':
        ctx.oldenc = value;
        break;
      case 'workenc':
        ctx.workEnc = value;
        break;
      case 'examenc':
        ctx.examEnc = value;
        break;
      case 'courseid':
        ctx.courseId = value;
        break;
      case 'clazzid':
        ctx.clazzId = value;
        break;
      default:
        break;
    }
  }
  const tabRe = /<[^>]*data-url=["']([^"']+)["'][^>]*>([^<]{0,80})/gi;
  let m: RegExpExecArray | null;
  while ((m = tabRe.exec(html)) !== null) {
    const tag = /^<[^>]*>/i.exec(m[0])?.[0] ?? '';
    const label = stripHtml(`${parseAttrs(tag)['title'] ?? ''} ${m[2]}`);
    if (!ctx.workListUrl && /作业/.test(label)) {
      ctx.workListUrl = m[1];
    } else if (!ctx.examListUrl && /考试/.test(label)) {
      ctx.examListUrl = m[1];
    }
  }
  if (!ctx.workEnc) {
    ctx.workEnc = /["']?workEnc["']?\s*[:=]\s*["']([^"']{6,})["']/i.exec(html)?.[1];
  }
  if (!ctx.openc) {
    ctx.openc = /["']?openc["']?\s*[:=]\s*["']([^"']{6,})["']/i.exec(html)?.[1];
  }
  if (!ctx.enc) {
    ctx.enc = /["']?\benc["']?\s*[:=]\s*["']([0-9a-f]{16,})["']/i.exec(html)?.[1];
  }
  return ctx;
}

export interface StudentCourseInfo {
  progress?: { done: number; total: number };
  chapters: Chapter[];
  enc?: string;
}

/** 章节页（mycourse/studentcourse）：总进度 + 章/节结构（cur<knowledgeId> / catalog_* / chapter_item） */
export function parseStudentCourse(html: string): StudentCourseInfo {
  const text = stripHtml(html);
  const progress =
    (/已完成任务点[^0-9]*(\d+)\s*[\/／]\s*(\d+)/.exec(text) ?? /已完成\s*(\d+)\s*[\/／]\s*(\d+)/.exec(text)) ?? undefined;
  const enc = /id=["']enc["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1]
    ?? /name=["']enc["'][^>]*value=["']([^"']+)["']/i.exec(html)?.[1];

  const chapters = parseStudentChapters(html);
  return {
    progress: progress ? { done: parseInt(progress[1], 10), total: parseInt(progress[2], 10) } : undefined,
    chapters,
    enc
  };
}

function parseStudentChapters(html: string): Chapter[] {
  const marker = /id=["']cur(\d{3,})["']|chapterid=["']?(\d{3,})["']?|knowledgeid=["']?(\d{3,})["']?/gi;
  const marks: Array<{ id: string; index: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = marker.exec(html)) !== null) {
    const id = m[1] ?? m[2] ?? m[3];
    if (marks.some((x) => x.id === id)) {
      continue;
    }
    marks.push({ id, index: m.index });
  }

  const chapters: Chapter[] = [];
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? marks[i + 1].index : html.length;
    const block = html.slice(marks[i].index, end);
    const name = chapterNameOf(block);
    if (!name) {
      continue;
    }
    const jobCount =
      parseCount(/knowledgeJobCount[^>]*value=["']?(\d+)/i.exec(block)?.[1]) ??
      parseCount(/共\s*(\d+)\s*个?任务点/.exec(stripHtml(block))?.[1]);
    const pending =
      parseCount(/catalog_points_yi[^>]*>\s*(\d+)/i.exec(block)?.[1]) ??
      parseCount(/(\d+)\s*个?(?:任务点)?未完成/.exec(stripHtml(block))?.[1]);
    const finished = /icon_yiwanc|bntHoverTips[^>]*>\s*已完成|已完成所有任务点/.test(block);
    const needUnlock = /bntHoverTips[^>]*>[^<]*解锁|未开放|章节未开放|锁定/.test(block.slice(0, 800));
    let doneCount: number | undefined;
    if (finished) {
      doneCount = jobCount;
    } else if (pending !== undefined && jobCount !== undefined) {
      doneCount = Math.max(0, jobCount - pending);
    }
    chapters.push({
      id: marks[i].id,
      name,
      order: chapters.length,
      unlocked: !needUnlock,
      tasks: [],
      jobCount,
      doneCount,
      pendingCount: finished ? 0 : pending
    });
  }
  return chapters;
}

function chapterNameOf(block: string): string | undefined {
  const candidates = [
    /<a[^>]*class=["'][^"']*clicktitle[^"']*["'][^>]*>([\s\S]*?)<\/a>/i.exec(block)?.[1],
    /<[^>]*class=["'][^"']*catalog_name[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(block)?.[1],
    /<[^>]*class=["'][^"']*catalog_name[^"']*["'][^>]*title=["']([^"']+)["']/i.exec(block)?.[1],
    /<[^>]*class=["'][^"']*articlename[^"']*["'][^>]*>([\s\S]*?)<\//i.exec(block)?.[1],
    /<span[^>]*title=["']([^"']{2,})["'][^>]*>/i.exec(block)?.[1]
  ];
  for (const candidate of candidates) {
    const name = stripHtml(candidate ?? '').trim().slice(0, 80);
    if (name && !/^\d+$/.test(name)) {
      return name;
    }
  }
  return undefined;
}

function parseCount(value: string | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const n = parseInt(value, 10);
  return Number.isNaN(n) ? undefined : n;
}

export interface TaskCardsInfo {
  notOpen: boolean;
  tasks: TaskPoint[];
}

/** 任务点卡片（knowledge/cards 的 mArg JSON）：attachments -> 任务点 */
export function parseTaskCards(html: string): TaskCardsInfo {
  const notOpen = /章节未开放|未开放章节/.test(html);
  const arg = extractMArg(html);
  const attachments = Array.isArray(arg?.attachments) ? (arg.attachments as Array<Record<string, unknown>>) : [];
  const tasks: TaskPoint[] = [];
  for (const card of attachments) {
    const property = (card['property'] ?? {}) as Record<string, unknown>;
    const jobId = String(card['jobid'] ?? property['_jobid'] ?? property['jobid'] ?? '');
    const name = stripHtml(String(property['title'] ?? property['name'] ?? card['name'] ?? jobId));
    const typeText = `${card['type'] ?? ''} ${property['type'] ?? ''} ${property['module'] ?? ''}`;
    const kind = detectTaskKind(jobId || typeText, name);
    const done = card['isPassed'] === true || card['isPassed'] === 'true';
    const workId = /work/i.test(`${jobId} ${typeText}`) ? jobId.replace(/\D/g, '') || String(card['mid'] ?? '') : undefined;
    if (!jobId && !name) {
      continue;
    }
    tasks.push({
      id: jobId || `task-${tasks.length}`,
      jobId,
      name: name || jobId,
      kind,
      done,
      workId: workId || undefined,
      objectId: String(card['objectId'] ?? property['objectid'] ?? '') || undefined
    });
  }
  return { notOpen, tasks };
}

function extractMArg(html: string): Record<string, unknown> | undefined {
  const idx = html.indexOf('mArg');
  if (idx < 0) {
    return undefined;
  }
  const start = html.indexOf('{', idx);
  if (start < 0) {
    return undefined;
  }
  let depth = 0;
  let inString = false;
  let quote = '';
  for (let i = start; i < html.length; i++) {
    const ch = html[i];
    if (inString) {
      if (ch === '\\') {
        i++;
      } else if (ch === quote) {
        inString = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return tryParseJson<Record<string, unknown>>(html.slice(start, i + 1)) ?? undefined;
      }
    }
  }
  return undefined;
}

/* ------------------------------ 通知 ------------------------------ */

export interface RawNotice {
  id?: number | string;
  noticeId?: number | string;
  title?: string;
  noticeTitle?: string;
  content?: string;
  time?: string;
  createDate?: string;
  publishTime?: string;
  completeTime?: string;
  isRead?: number | boolean;
  isread?: number | boolean | string;
  noticeType?: string | number;
  type?: string | number;
  courseId?: number | string;
  courseName?: string;
}

export function noticeCategoryOf(raw: RawNotice): NoticeCategory {
  const text = `${raw.noticeType ?? ''} ${raw.type ?? ''} ${raw.title ?? ''}`;
  if (/作业|work/i.test(text)) {
    return 'homework';
  }
  if (/考试|exam|测验/i.test(text)) {
    return 'exam';
  }
  if (/系统|system/i.test(text)) {
    return 'system';
  }
  if (/课程|course/i.test(text)) {
    return 'course';
  }
  return 'other';
}

export function normalizeNotice(raw: RawNotice): NoticeItem {
  const readFlag = raw.isRead ?? raw.isread;
  return {
    id: String(raw.id ?? raw.noticeId ?? ''),
    title: stripHtml(raw.noticeTitle ?? raw.title ?? '(无标题)'),
    category: noticeCategoryOf(raw),
    courseId: raw.courseId ? String(raw.courseId) : undefined,
    courseName: raw.courseName,
    publishTime: parseDateTime(raw.time ?? raw.completeTime ?? raw.createDate ?? raw.publishTime),
    read: readFlag === 1 || readFlag === true || readFlag === '1',
    rawType: raw.noticeType !== undefined ? String(raw.noticeType) : undefined
  };
}

/** 通知 HTML 兜底解析 */
export function parseNoticeHtml(html: string): NoticeItem[] {
  const out: NoticeItem[] = [];
  const re = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const block = m[1];
    const titleMatch = /<a[^>]*>([\s\S]*?)<\/a>/i.exec(block);
    const timeMatch = /(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)/.exec(block);
    const idMatch = /noticeId=(\w+)/i.exec(block);
    const title = stripHtml(titleMatch?.[1] ?? '');
    if (!title) {
      continue;
    }
    out.push({
      id: idMatch?.[1] ?? `html-${out.length}`,
      title,
      category: noticeCategoryOf({ title }),
      publishTime: parseDateTime(timeMatch?.[1]),
      read: /已读/.test(block)
    });
  }
  return out;
}

/** 从通知接口响应提取原始项（兼容数组、noticeList、按 id 键控的 map 等嵌套形态） */
export function extractRawNotices(text: string): RawNotice[] {
  const json = tryParseJson<unknown>(text);
  const out: RawNotice[] = [];
  collectNotices(json, '', out, 0);
  return out;
}

function collectNotices(node: unknown, keyHint: string, out: RawNotice[], depth: number): void {
  if (depth > 6 || out.length > 500) {
    return;
  }
  if (Array.isArray(node)) {
    const noticeLike = node.filter(looksLikeNotice);
    if (noticeLike.length || /notice|list|data|msg|rows|items/i.test(keyHint)) {
      for (const item of node) {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          out.push(item as RawNotice);
        }
      }
      return;
    }
    for (const item of node) {
      collectNotices(item, keyHint, out, depth + 1);
    }
    return;
  }
  if (node && typeof node === 'object') {
    if (looksLikeNotice(node)) {
      out.push(node as RawNotice);
      return;
    }
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      collectNotices(value, key, out, depth + 1);
    }
  }
}

function looksLikeNotice(node: unknown): boolean {
  if (!node || typeof node !== 'object' || Array.isArray(node)) {
    return false;
  }
  const o = node as Record<string, unknown>;
  const hasTitle = typeof o.title === 'string' || typeof o.noticeTitle === 'string';
  const hasMeta =
    'isread' in o || 'isRead' in o || 'completeTime' in o || 'noticeType' in o || 'noticeId' in o || 'createTime' in o || 'publishTime' in o;
  return hasTitle && hasMeta;
}
