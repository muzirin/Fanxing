/**
 * Fanxing 依赖容器：集中装配 API / 服务 / 状态，供命令与 UI 层使用。
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { AuthApi } from './api/auth';
import { HttpClient } from './api/client';
import { CourseApi } from './api/course';
import { GradeApi } from './api/grade';
import { HomeworkApi } from './api/homework';
import { NotificationApi } from './api/notification';
import { OjApi } from './api/oj';
import { SignInApi } from './api/signin';
import { Course, Homework, NoticeItem, Problem, SignActivity, SubmissionRecord, GradeItem } from './api/types';
import { AiService } from './services/ai';
import { FileCache } from './services/cache';
import { DeadlineService } from './services/deadline';
import { EnvChecker } from './services/envCheck';
import { FormulaService } from './services/formula';
import { I18n } from './services/i18n';
import { JudgeOptions, LocalJudge } from './services/judge';
import { Logger } from './services/logger';
import { SecretStore } from './services/secrets';
import { SessionService } from './services/session';
import { Settings } from './services/settings';
import { BRAND } from './config/constants';

/** 编程题工作区：一次答题会话（每道编程题独立源文件与用例目录） */
export interface ProblemWorkspace {
  workId: string;
  homework: Homework;
  problems: Problem[];
  /** 本地解题根目录 */
  dir: string;
  /** 每道编程题的源文件 problemId -> 绝对路径 */
  sourceFiles: Map<string, string>;
  language: string;
  /** 每道编程题的自定义测试用例目录 problemId -> 绝对路径 */
  casesDirs: Map<string, string>;
  /** 每题最近一次本地测试结果 */
  lastReports: Map<string, import('./api/types').JudgeReport>;
  /** 汇总结果（多题取最差） */
  lastReport?: import('./api/types').JudgeReport;
  /** code=编程题（编辑器）；quiz=客观/主观题（面板内作答） */
  mode: 'code' | 'quiz';
  /** 非编程题作答缓存：problemId -> 答案原文 */
  answers: Map<string, string>;
}

export class AppState {
  courses: Course[] = [];
  chapters = new Map<string, import('./api/types').Chapter[]>();
  homeworkByCourse = new Map<string, Homework[]>();
  problemsByWork = new Map<string, Problem[]>();
  notices: NoticeItem[] = [];
  activities: SignActivity[] = [];
  grades: GradeItem[] = [];
  submissions: SubmissionRecord[] = [];
  workspaces = new Map<string, ProblemWorkspace>();
  /** 未读通知数 */
  unreadCount = 0;
  /** 作业显示筛选：all=全部（含未开放/已完成），pending=仅待完成（用户可选，默认全显示） */
  homeworkFilter: 'all' | 'pending' = 'all';
}

export class FanxingContext {
  readonly settings = new Settings();
  readonly logger = new Logger(BRAND.outputChannel);
  readonly i18n = new I18n(this.settings);
  readonly http = new HttpClient(this.logger);
  readonly auth = new AuthApi(this.http, this.logger);
  readonly store: SecretStore;
  readonly session: SessionService;
  readonly cache: FileCache;
  readonly courses = new CourseApi(this.http, this.logger);
  readonly homeworkApi = new HomeworkApi(this.http, this.logger);
  readonly notificationApi = new NotificationApi(this.http, this.logger);
  readonly signInApi = new SignInApi(this.http, this.logger);
  readonly gradeApi = new GradeApi(this.http, this.logger);
  readonly oj = new OjApi(this.homeworkApi, this.logger);
  readonly env = new EnvChecker();
  readonly deadline = new DeadlineService();
  readonly formula: FormulaService;
  readonly state = new AppState();
  readonly extensionPath: string;

  private readonly filterEmitter = new vscode.EventEmitter<void>();
  /** 作业显示筛选变化事件 */
  readonly onDidChangeHomeworkFilter = this.filterEmitter.event;

  fireHomeworkFilterChanged(): void {
    this.filterEmitter.fire();
  }

  constructor(readonly context: vscode.ExtensionContext) {
    this.extensionPath = context.extensionPath;
    this.store = new SecretStore(context.secrets, context.globalState);
    this.session = new SessionService(this.http, this.auth, this.store, this.logger);
    this.cache = FileCache.create(context, this.logger);
    this.formula = new FormulaService(
      this.http,
      {
        preferLatexFromAlt: this.settings.preferLatexFromAlt,
        ocrEndpoint: this.settings.formulaOcrEndpoint,
        cacheDir: path.join(context.globalStorageUri.fsPath, 'images')
      },
      this.logger
    );
    this.logger.setLevel(this.settings.logLevel);
    this.state.homeworkFilter = context.globalState.get<'all' | 'pending'>('fanxing.homeworkFilter', 'all');
  }

  /** 构造本地判题器（每次取最新配置） */
  makeJudge(): LocalJudge {
    const options: JudgeOptions = {
      timeoutMs: this.settings.judgeTimeoutMs,
      compileArgs: this.settings.judgeCompileArgs,
      normalizeWhitespace: this.settings.normalizeWhitespace
    };
    return new LocalJudge(options, this.logger);
  }

  /** 构造 AI 服务（API Key 取自 SecretStorage） */
  async makeAi(): Promise<AiService> {
    const key = await this.store.getAiApiKey();
    return new AiService(this.settings.ai, key, this.logger);
  }

  /** 编程题工作区根目录 */
  get problemsRoot(): string {
    return path.join(this.context.globalStorageUri.fsPath, 'problems');
  }
}
