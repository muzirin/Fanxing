/**
 * Fanxing 数据模型：贯穿 API 层 / 服务层 / UI 层。
 */

import { QuestionType, Verdict } from '../config/constants';

/** 登录账号（多账号） */
export interface AccountInfo {
  /** 本地唯一 id */
  id: string;
  phone: string;
  uid: string;
  name: string;
  fid: string;
  school?: string;
  createdAt: number;
  lastActiveAt: number;
}

/** Cookie 集合 */
export type CookieJar = Record<string, string>;

export interface LoginResult {
  ok: boolean;
  message?: string;
  account?: AccountInfo;
  cookies?: CookieJar;
  /** 需要验证码时返回图片地址 */
  validateImage?: string;
}

export interface QrSession {
  uuid: string;
  enc: string;
  /** 二维码 PNG 二进制 */
  image: Buffer;
}

export type QrStatus = 'waiting' | 'scanned' | 'confirmed' | 'expired' | 'cancelled' | 'unknown';

export interface Course {
  courseId: string;
  clazzId: string;
  cpi: string;
  name: string;
  teacher: string;
  coverUrl?: string;
  /** 进行中 / 已结课 */
  status: 'active' | 'ended';
  /** 课程进度百分比 0-100 */
  progress?: number;
  /** 学期，如 2025-2026-1 */
  term?: string;
  isFavorite?: boolean;
}

export interface Chapter {
  id: string;
  name: string;
  parentId?: string;
  order: number;
  unlocked: boolean;
  tasks: TaskPoint[];
  /** 章节声明的任务点总数（任务点未逐个加载时用于展示） */
  jobCount?: number;
  /** 已完成任务点数 */
  doneCount?: number;
  /** 待完成任务点数 */
  pendingCount?: number;
}

export interface TaskPoint {
  id: string;
  jobId: string;
  name: string;
  kind: 'video' | 'document' | 'read' | 'work' | 'discussion' | 'live' | 'unknown';
  done: boolean;
  /** 关联作业 workId（kind=work） */
  workId?: string;
  objectId?: string;
  /** 任务点是否可访问（未开放章节/任务为 false） */
  unlocked?: boolean;
}

export type NoticeCategory = 'system' | 'course' | 'homework' | 'exam' | 'other';

export interface NoticeItem {
  id: string;
  title: string;
  category: NoticeCategory;
  courseId?: string;
  courseName?: string;
  publishTime: number;
  read: boolean;
  /** 详情富文本（懒加载） */
  contentHtml?: string;
  rawType?: string;
}

export type HomeworkKind = 'code' | 'file' | 'written' | 'quiz' | 'group';

export interface Homework {
  workId: string;
  clazzId: string;
  courseId: string;
  cpi: string;
  title: string;
  kind: HomeworkKind;
  /** 截止时间（毫秒时间戳），0 表示无 */
  deadline: number;
  /** 提交状态 */
  submitted: boolean;
  /** 批改状态：未批改 / 已批改 */
  marked: boolean;
  /** 已出成绩时的得分 */
  score?: number;
  totalScore?: number;
  teacherComment?: string;
  /** 题目（懒加载） */
  problems?: Problem[];
  /** 是否支持多次提交 */
  multiSubmit?: boolean;
  /** 未开放（教师未发布）：只展示不可作答 */
  locked?: boolean;
  /** 已截止（开放期结束） */
  expired?: boolean;
  /** 状态展示文案（如：未开放 / 已完成 / 已截止） */
  stateLabel?: string;
  /** 开放时间（未开放作业常见） */
  openTime?: number;
  /** 平台状态原文（未交/待批阅/已批阅…） */
  statusText?: string;
  /** 详情页直链（列表项 data 属性，含独立 enc） */
  url?: string;
  /** 数据来源：作业列表接口 / 章节任务点兑底 */
  source?: 'list' | 'chapter';
}

export interface Problem {
  id: string;
  index: number;
  type: QuestionType;
  /** 题干（已处理公式图片后的富文本） */
  contentHtml: string;
  /** 题干纯文本（用于 AI 提示词） */
  contentText: string;
  options?: { key: string; text: string }[];
  /** 题库编号 / 题目编号 */
  questionBankId?: string;
  score: number;
  /** 编程题：模板代码 */
  templateCode?: string;
  /** 编程题：可用语言 */
  languages?: string[];
  /** 编程题：样例测试用例 */
  sampleTests?: TestCase[];
  /** 编程题：判题限制 */
  limits?: { timeMs?: number; memoryMb?: number };
  /** 原始图片资源（用于本地缓存） */
  images?: { src: string; alt?: string }[];
}

export interface TestCase {
  input: string;
  expectedOutput: string;
  /** 用户自定义用例标记 */
  custom?: boolean;
}

/** 本地判题单用例结果 */
export interface CaseResult {
  index: number;
  verdict: Verdict;
  timeMs: number;
  actualOutput?: string;
  expectedOutput?: string;
  stderr?: string;
  /** 进程退出码（崩溃诊断关键信息，如 3221225477=0xC0000005 访问违例） */
  exitCode?: number;
  diff?: string;
}

export interface JudgeReport {
  verdict: Verdict;
  compileLog?: string;
  cases: CaseResult[];
  totalTimeMs: number;
}

/** 平台判题结果（提交后轮询） */
export interface SubmissionRecord {
  id: string;
  workId: string;
  problemId?: string;
  submitTime: number;
  code?: string;
  language?: string;
  verdict: Verdict;
  score?: number;
  message?: string;
}

export interface SignActivity {
  activeId: string;
  courseId: string;
  clazzId: string;
  courseName: string;
  nameOtherId: number;
  type: number;
  status: number;
  startTime: number;
  endTime?: number;
  signed: boolean;
  /** 位置签到要求的地址文本 */
  address?: string;
}

export interface GradeItem {
  courseId: string;
  courseName: string;
  items: { name: string; score: number; weight?: number }[];
  total?: number;
  rank?: string;
}

export interface DdlItem {
  id: string;
  title: string;
  kind: 'homework' | 'exam' | 'other';
  courseId: string;
  courseName: string;
  deadline: number;
  link?: string;
}
