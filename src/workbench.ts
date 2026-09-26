/**
 * 业务编排层：命令注册与核心流程（登录 / 刷新 / 答题 / 本地测试 / 提交 / AI 引导 / 环境检测）。
 */
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { FanxingContext, ProblemWorkspace } from './context';
import { LANGUAGES, LanguageSpec, QUESTION_TYPE_LABEL, Verdict, VERDICT_LABEL, SIGN_TYPE_LABEL, ENDPOINTS } from './config/constants';
import { Homework, Problem, TestCase } from './api/types';
import { extractRawNotices, extractRawWorks, homeworkFromTaskPoint, mergeHomeworkLists, parseCoursePage, parseProblems } from './api/parsers';
import { HomeworkNode, HomeworkCourseNode } from './providers/homeworkTree';
import { NoticeNode } from './providers/notificationTree';
import { ProblemPanel } from './providers/problemPanel';
import { SettingsPanel } from './providers/settingsPanel';
import { GradesPanel } from './providers/gradesPanel';
import { showSubmissions } from './providers/activityTrees';
import { AiTask } from './services/ai';
import { escapeHtml, htmlShell } from './views/webview';
import { buildIcs, formatDateTime } from './utils/time';
import { describeExitCode } from './services/judge';

export interface UiRefresher {
  refreshCourses(): void;
  refreshHomework(): void;
  refreshNotifications(): void;
  refreshSignIn(): void;
  refreshGrades(): void;
  refreshDdl(): void;
  refreshDashboard(): void;
  updateStatusBar(): void;
  refreshCodeLens(): void;
}

export class Workbench {
  constructor(
    private readonly ctx: FanxingContext,
    private readonly ui: UiRefresher
  ) {}

  registerCommands(context: vscode.ExtensionContext): void {
    const regs: Array<[string, (...args: never[]) => unknown]> = [
      ['fanxing.login', () => this.loginFlow()],
      ['fanxing.loginByCookie', () => this.loginByCookie()],
      ['fanxing.logout', () => this.logout()],
      ['fanxing.switchAccount', () => this.switchAccount()],
      ['fanxing.refreshCourses', () => this.refreshAll()],
      ['fanxing.checkNotifications', () => this.checkNotifications()],
      ['fanxing.openHomework', (node: unknown) => this.openHomework(node)],
      ['fanxing.openNotice', (node: unknown) => this.openNotice(node)],
      ['fanxing.signActivity', (activity: unknown) => this.signActivity(activity)],
      ['fanxing.openSourceFile', (ws?: ProblemWorkspace) => this.openSourceFile(ws)],
      ['fanxing.runLocalTest', (target?: unknown) => this.runLocalTest(target)],
      ['fanxing.submitAssignment', (target?: unknown) => this.submitAssignment(target)],
      ['fanxing.addTestCase', (target?: unknown) => this.addTestCase(target)],
      ['fanxing.aiReview', (target?: unknown) => this.runAi('review', target)],
      ['fanxing.aiHint', (target?: unknown) => this.runAi('hint', target)],
      ['fanxing.aiComplexity', (target?: unknown) => this.runAi('complexity', target)],
      ['fanxing.aiExplainError', (target?: unknown) => this.runAi('explainError', target)],
      ['fanxing.configureAi', () => this.configureAi()],
      ['fanxing.checkEnvironment', () => this.checkEnvironment()],
      ['fanxing.openDashboard', () => void vscode.commands.executeCommand('fanxing.dashboard.focus')],
      ['fanxing.viewGrades', () => this.viewGrades()],
      ['fanxing.refreshGrades', () => this.refreshGrades()],
      ['fanxing.viewSubmissions', () => showSubmissions(this.ctx)],
      ['fanxing.dumpWorkList', (node?: unknown) => this.dumpWorkList(node)],
      ['fanxing.openSettings', () => SettingsPanel.create(this.ctx)],
      ['fanxing.toggleHomeworkFilter', () => this.toggleHomeworkFilter()],
      ['fanxing.exportDeadlines', () => this.exportDeadlines()],
      ['fanxing.showOutput', () => this.ctx.logger.show()]
    ];
    for (const [id, handler] of regs) {
      context.subscriptions.push(
        vscode.commands.registerCommand(id, (...args: unknown[]) => {
          try {
            const result = (handler as (...a: unknown[]) => unknown)(...args);
            if (result instanceof Promise) {
              return result.catch((err) => {
                this.ctx.logger.error(`命令执行失败: ${id}`, String(err));
                void vscode.window.showErrorMessage(`Fanxing: ${String(err)}`);
              });
            }
            return result;
          } catch (err) {
            this.ctx.logger.error(`命令执行失败: ${id}`, String(err));
            void vscode.window.showErrorMessage(`Fanxing: ${String(err)}`);
            return undefined;
          }
        })
      );
    }
  }

  /* ------------------------------ 登录 ------------------------------ */

  private async loginFlow(): Promise<void> {
    const pick = await vscode.window.showQuickPick(
      [
        { label: '扫码登录', description: '使用学习通 APP 扫码（推荐）', id: 'qr' },
        { label: '手机号 + 密码', description: 'AES 加密传输', id: 'password' },
        { label: '短信验证码', description: '手机验证码登录', id: 'sms' },
        { label: '手动粘贴 Cookie', description: '兜底方案', id: 'cookie' }
      ],
      { title: '选择登录方式' }
    );
    if (!pick) {
      return;
    }
    switch (pick.id) {
      case 'qr':
        await this.loginByQr();
        break;
      case 'password':
        await this.loginByPassword();
        break;
      case 'sms':
        await this.loginBySms();
        break;
      case 'cookie':
        await this.loginByCookie();
        break;
    }
  }

  private async loginByPassword(): Promise<void> {
    const phone = await vscode.window.showInputBox({ title: this.ctx.i18n.t('login.prompt'), ignoreFocusOut: true });
    if (!phone) {
      return;
    }
    const password = await vscode.window.showInputBox({
      title: this.ctx.i18n.t('login.password'),
      password: true,
      ignoreFocusOut: true
    });
    if (!password) {
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '登录中...' },
      async () => {
        const result = await this.ctx.auth.loginByPassword(phone, password);
        if (result.ok) {
          await this.ctx.session.acceptLogin(result, password);
          void vscode.window.showInformationMessage(this.ctx.i18n.t('login.success'));
          await this.refreshAll();
        } else {
          this.ctx.logger.error(this.ctx.i18n.t('login.failed'), result.message);
          if (result.validateImage) {
            this.ctx.logger.info(`验证码图片: ${result.validateImage}`);
          }
          void vscode.window.showErrorMessage(`${this.ctx.i18n.t('login.failed')}: ${result.message ?? ''}`);
        }
      }
    );
  }

  private async loginBySms(): Promise<void> {
    const phone = await vscode.window.showInputBox({ title: this.ctx.i18n.t('login.prompt'), ignoreFocusOut: true });
    if (!phone) {
      return;
    }
    const code = await vscode.window.showInputBox({ title: '短信验证码', ignoreFocusOut: true });
    if (!code) {
      return;
    }
    const result = await this.ctx.auth.loginBySms(phone, code);
    if (result.ok) {
      await this.ctx.session.acceptLogin(result);
      void vscode.window.showInformationMessage(this.ctx.i18n.t('login.success'));
      await this.refreshAll();
    } else {
      void vscode.window.showErrorMessage(`${this.ctx.i18n.t('login.failed')}: ${result.message ?? ''}`);
    }
  }

  private async loginByQr(): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: this.ctx.i18n.t('login.qr.title') },
      async () => {
        const session = await this.ctx.auth.beginQrLogin();
        const file = path.join(this.ctx.context.globalStorageUri.fsPath, 'qr.png');
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, session.image);
        await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));

        for (let i = 0; i < 55; i++) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          const status = await this.ctx.auth.pollQrStatus(session);
          if (status.status === 'confirmed' && status.login) {
            await this.ctx.session.acceptLogin(status.login);
            void vscode.window.showInformationMessage(this.ctx.i18n.t('login.qr.confirmed'));
            await this.refreshAll();
            return;
          }
          if (status.status === 'expired') {
            void vscode.window.showWarningMessage(this.ctx.i18n.t('login.qr.expired'));
            return;
          }
          if (status.status === 'cancelled') {
            void vscode.window.showWarningMessage(this.ctx.i18n.t('login.qr.cancelled'));
            return;
          }
        }
      }
    );
  }

  private async loginByCookie(): Promise<void> {
    const text = await vscode.window.showInputBox({
      title: this.ctx.i18n.t('login.cookie.prompt'),
      placeHolder: '_uid=...; _d=...; vc3=...; fid=...',
      ignoreFocusOut: true
    });
    if (!text) {
      return;
    }
    const result = await this.ctx.auth.loginByCookie(text);
    if (result.ok) {
      await this.ctx.session.acceptLogin(result);
      void vscode.window.showInformationMessage(this.ctx.i18n.t('login.success'));
      await this.refreshAll();
    } else {
      void vscode.window.showErrorMessage(`${this.ctx.i18n.t('login.failed')}: ${result.message ?? ''}`);
    }
  }

  private async logout(): Promise<void> {
    await this.ctx.session.logout();
    this.ctx.state.courses = [];
    this.ctx.state.homeworkByCourse.clear();
    this.ctx.state.notices = [];
    this.ui.refreshCourses();
    this.ui.refreshHomework();
    this.ui.refreshNotifications();
    this.ui.updateStatusBar();
    this.ui.refreshDashboard();
    void vscode.window.showInformationMessage(this.ctx.i18n.t('logout.done'));
  }

  private async switchAccount(): Promise<void> {
    const accounts = this.ctx.store.listAccounts();
    if (!accounts.length) {
      void vscode.window.showInformationMessage(this.ctx.i18n.t('account.none'));
      return;
    }
    const pick = await vscode.window.showQuickPick(
      accounts.map((a) => ({ label: a.name, description: `${a.phone} (${a.id})`, id: a.id })),
      { title: this.ctx.i18n.t('account.switch') }
    );
    if (!pick) {
      return;
    }
    const ok = await this.ctx.session.switchAccount(pick.id);
    if (ok) {
      await this.refreshAll();
    } else {
      void vscode.window.showErrorMessage('账号登录态已过期，请重新登录');
    }
  }

  /* ------------------------------ 数据刷新 ------------------------------ */

  async refreshAll(): Promise<void> {
    if (!this.ctx.session.isLoggedIn) {
      void vscode.window.showInformationMessage('请先登录（Fanxing: 登录）');
      return;
    }
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '刷新课程与作业中...' },
      async () => {
        try {
          const courses = await this.ctx.courses.listCourses();
          this.ctx.state.courses = courses;
          await this.ctx.cache.set('courses', 'all', courses, this.ctx.settings.cacheTtlMs);
        } catch (err) {
          this.ctx.logger.warn('课程拉取失败，使用缓存', String(err));
          this.ctx.state.courses = (await this.ctx.cache.getStale('courses', 'all')) ?? [];
        }

        // 逐门拉取作业（限并发 3）；列表接口只回部分状态时用章节任务点兑底，
        // 保证“已完成/未开放”等状态的作业也可见
        const queue = [...this.ctx.state.courses];
        const workers = Array.from({ length: 3 }, async () => {
          while (queue.length) {
            const course = queue.shift();
            if (!course) {
              break;
            }
            try {
              const list = await this.ctx.homeworkApi.listHomework(course);
              const merged = await this.mergeChapterHomework(course, list);
              this.ctx.state.homeworkByCourse.set(course.courseId, merged);
              await this.ctx.cache.set('homework', course.courseId, merged, this.ctx.settings.cacheTtlMs);
            } catch (err) {
              this.ctx.logger.warn(`作业拉取失败: ${course.name}`, String(err));
              const stale = await this.ctx.cache.getStale<Homework[]>('homework', course.courseId);
              if (stale) {
                this.ctx.state.homeworkByCourse.set(course.courseId, stale);
              }
            }
          }
        });
        await Promise.all(workers);

        await this.fetchNotices();
        this.ui.refreshCourses();
        this.ui.refreshHomework();
        this.ui.refreshNotifications();
        this.ui.refreshDdl();
        this.ui.refreshDashboard();
        this.ui.updateStatusBar();
        void vscode.window.showInformationMessage(this.ctx.i18n.t('course.refresh.done'));
      }
    );
  }

  private async fetchNotices(): Promise<void> {
    try {
      const notices = await this.ctx.notificationApi.listNotices();
      this.ctx.state.notices = notices;
      this.ctx.state.unreadCount = notices.filter((n) => !n.read).length;
      await this.ctx.cache.set('notices', 'all', notices, this.ctx.settings.cacheTtlMs);
    } catch (err) {
      this.ctx.logger.warn('通知拉取失败，使用缓存', String(err));
      const stale = await this.ctx.cache.getStale<import('./api/types').NoticeItem[]>('notices', 'all');
      if (stale) {
        this.ctx.state.notices = stale;
        this.ctx.state.unreadCount = stale.filter((n) => !n.read).length;
      }
    }
  }

  async checkNotifications(): Promise<void> {
    await this.fetchNotices();
    this.ui.refreshNotifications();
    this.ui.refreshDashboard();
    this.ui.updateStatusBar();
    const unread = this.ctx.state.unreadCount;
    void vscode.window.showInformationMessage(
      `${this.ctx.i18n.t('notify.check.done')}${unread ? `：${unread} ${this.ctx.i18n.t('notify.unread')}` : ''}`
    );
  }

  /**
   * 章节任务点兑底补齐作业列表（含未开放/已完成）。
   * 列表接口有数据时直接采用；为空时按章节任务点合成，不覆盖完整条目。
   */
  private async mergeChapterHomework(course: import('./api/types').Course, list: Homework[]): Promise<Homework[]> {
    try {
      let chapters = this.ctx.state.chapters.get(course.courseId);
      if (!chapters) {
        const content = await this.ctx.courses.loadCourseContent(course);
        chapters = content.chapters;
        this.ctx.state.chapters.set(course.courseId, chapters);
        if (content.progress && content.progress.total > 0) {
          course.progress = Math.round((content.progress.done / content.progress.total) * 100);
        }
      }
      if (list.length) {
        return list;
      }
      const fromChapters: Homework[] = [];
      for (const chapter of chapters.slice(0, 30)) {
        const tasks = await this.ctx.courses.listTasks(course, chapter);
        chapter.tasks = tasks;
        for (const task of tasks) {
          const item = homeworkFromTaskPoint(task, chapter, course);
          if (item) {
            fromChapters.push(item);
          }
        }
      }
      const merged = mergeHomeworkLists(list, fromChapters);
      this.ctx.logger.debug(`[${course.name}] 列表 ${list.length} 条 + 章节任务点 ${fromChapters.length} 条 -> 合并 ${merged.length} 条`);
      return merged;
    } catch (err) {
      this.ctx.logger.debug(`章节任务点兑底失败: ${course.name}`, String(err));
      return list;
    }
  }

  /** 调试：抓取作业/通知/签到全链路原始响应，存到工作区 fanxing-debug/ 便于适配接口 */
  private async dumpWorkList(node?: unknown): Promise<void> {
    if (!this.ctx.session.isLoggedIn) {
      void vscode.window.showInformationMessage('请先登录');
      return;
    }
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.ctx.context.globalStorageUri.fsPath;
    const outDir = path.join(workspaceDir, 'fanxing-debug');
    await fs.mkdir(outDir, { recursive: true });

    const courses =
      node instanceof HomeworkCourseNode
        ? this.ctx.state.courses.filter((c) => c.courseId === node.courseId)
        : this.ctx.state.courses.slice(0, 3);
    const written: string[] = [];
    const summary: string[] = [];
    for (const course of courses) {
      try {
        const middleUrl =
          `${ENDPOINTS.courseMiddle}?courseid=${course.courseId}` +
          `&clazzid=${course.clazzId}&vc=1&cpi=${course.cpi}&ismooc2=1&v=2`;
        const middle = await this.ctx.http.getHtml(middleUrl);
        const middleFile = path.join(outDir, `course-middle-${course.courseId}.html`);
        await fs.writeFile(middleFile, middle, 'utf8');
        written.push(middleFile);
        const page = parseCoursePage(middle);
        summary.push(
          `[${course.name}] enc=${page.enc ?? '-'} workEnc=${page.workEnc ?? '-'} openc=${page.openc ?? '-'} workListUrl=${page.workListUrl ?? '-'}`
        );

        const raw = await this.ctx.homeworkApi.listHomeworkRaw(course);
        const file = path.join(outDir, `work-list-${course.courseId}.html`);
        await fs.writeFile(file, raw, 'utf8');
        written.push(file);
        summary.push(`  work/list 主响应 ${raw.length} 字符 -> 解析 ${extractRawWorks(raw).length} 条`);

        // 逐条解析结果（核对状态判定是否与网页一致）
        const items = this.ctx.state.homeworkByCourse.get(course.courseId) ?? [];
        for (const item of items) {
          summary.push(
            `  - ${item.workId} kind=${item.kind} state=${item.stateLabel} status=${item.statusText ?? '-'}` +
              ` submitted=${item.submitted} locked=${item.locked} url=${item.url ? 'yes' : 'no'} :: ${item.title}`
          );
        }

        // 非编程题：额外导出详情页原始响应，用于适配题型/选项结构
        for (const item of items.filter((h) => h.kind !== 'code').slice(0, 3)) {
          const detailUrl =
            item.url ??
            `${ENDPOINTS.workDetailMobile}?workId=${item.workId}&courseId=${item.courseId}&classId=${item.clazzId}&cpi=${item.cpi}&ut=s`;
          try {
            const detail = await this.ctx.http.getHtml(detailUrl);
            const detailFile = path.join(outDir, `detail-${item.workId}.html`);
            await fs.writeFile(detailFile, detail, 'utf8');
            written.push(detailFile);
            summary.push(`    detail(${item.kind}) ${detailUrl.slice(0, 130)} -> ${detail.length} 字符，解析 ${parseProblems(detail).length} 题`);
          } catch (err) {
            summary.push(`    detail(${item.kind}) 失败: ${String(err)}`);
          }
        }
      } catch (err) {
        this.ctx.logger.warn(`dump 失败: ${course.name}`, String(err));
        summary.push(`[${course.name}] dump 失败: ${String(err)}`);
      }
    }

    try {
      const stu = await this.ctx.http.getHtml(ENDPOINTS.stuWork);
      const file = path.join(outDir, 'stu-work.html');
      await fs.writeFile(file, stu, 'utf8');
      written.push(file);
      summary.push(`stu-work ${stu.length} 字符 -> 解析 ${extractRawWorks(stu).length} 条`);
    } catch (err) {
      summary.push(`stu-work 失败: ${String(err)}`);
    }

    try {
      const notice = await this.ctx.http.postForm(ENDPOINTS.noticeListNew, { type: 1, notice_type: 1, lastValue: 0, sort: 1 });
      const file = path.join(outDir, 'notice-getNoticeList.json');
      await fs.writeFile(file, notice, 'utf8');
      written.push(file);
      summary.push(`getNoticeList ${notice.length} 字符 -> 解析 ${extractRawNotices(notice).length} 条`);
    } catch (err) {
      summary.push(`getNoticeList 失败: ${String(err)}`);
    }

    const first = courses[0];
    if (first) {
      try {
        const uid = '' + (this.ctx.session.account?.uid ?? '');
        const act = await this.ctx.http.getHtml(
          `${ENDPOINTS.activeList}?fid=${this.ctx.session.account?.fid ?? '-1'}&uid=${uid}&courseId=${first.courseId}&classId=${first.clazzId}`,
          { retries: 0 }
        );
        const file = path.join(outDir, 'activelist.json');
        await fs.writeFile(file, act, 'utf8');
        written.push(file);
        summary.push(`activelist [${first.name}] ${act.length} 字符`);
      } catch (err) {
        summary.push(`activelist 失败: ${String(err)}`);
      }
    }

    await fs.writeFile(path.join(outDir, 'summary.txt'), summary.join('\n'), 'utf8');
    this.ctx.logger.info(`取证摘要:\n${summary.join('\n')}`);
    void vscode.window.showInformationMessage(
      written.length ? `已导出 ${written.length} 份原始响应: ${outDir}（可发回用于适配接口）` : '抓取失败，请查看日志'
    );
  }

  private async openNotice(node: unknown): Promise<void> {
    const notice = node instanceof NoticeNode ? node.notice : undefined;
    if (!notice) {
      return;
    }
    const detail = notice.contentHtml ?? (await this.ctx.notificationApi.getNoticeDetail(notice.id).catch(() => notice.title));
    notice.contentHtml = detail;
    void this.showHtmlPanel(`通知: ${notice.title}`, `<div class="fx-section">${detail}</div>`);
    void this.ctx.notificationApi.markRead(notice.id);
    notice.read = true;
    this.ctx.state.unreadCount = Math.max(0, this.ctx.state.unreadCount - 1);
    this.ui.refreshNotifications();
    this.ui.updateStatusBar();
  }

  /* ------------------------------ 签到 ------------------------------ */

  async refreshSignActivities(): Promise<void> {
    if (!this.ctx.session.isLoggedIn) {
      return;
    }
    try {
      const before = new Set(this.ctx.state.activities.map((a) => a.activeId));
      const acts = await this.ctx.signInApi.listActivities(
        this.ctx.state.courses.map((c) => ({ courseId: c.courseId, clazzId: c.clazzId }))
      );
      this.ctx.state.activities = acts;
      this.ui.refreshSignIn();
      const fresh = acts.filter((a) => !a.signed && !before.has(a.activeId));
      if (fresh.length && this.ctx.settings.signinNotify) {
        const names = fresh.map((a) => `${a.courseName || '课程'}（${SIGN_TYPE_LABEL[a.nameOtherId] ?? '签到'}）`).join('、');
        void vscode.window
          .showInformationMessage(`${this.ctx.i18n.t('signin.detected')}: ${names}`, '立即签到')
          .then((choice) => {
            if (choice === '立即签到') {
              void this.signActivity(fresh[0]);
            }
          });
      }
    } catch (err) {
      this.ctx.logger.debug('签到检测失败', String(err));
    }
  }

  async signActivity(input: unknown): Promise<void> {
    const activity = (input as { activity?: import('./api/types').SignActivity })?.activity ?? input;
    const act = activity as import('./api/types').SignActivity;
    if (!act?.activeId) {
      return;
    }
    const params: import('./api/signin').SignSubmitParams = {};
    switch (act.nameOtherId) {
      case 3:
      case 5: {
        const code = await vscode.window.showInputBox({
          title: act.nameOtherId === 3 ? '手势轨迹编码（3x3 九宫格，如 1235789）' : '教师公布的签到码',
          ignoreFocusOut: true
        });
        if (!code) {
          return;
        }
        params.signCode = code.trim();
        break;
      }
      case 2: {
        const enc = await vscode.window.showInputBox({
          title: '二维码链接中的 enc 参数',
          placeHolder: '形如 1D0A628CK317F44CCC378M5KD92',
          ignoreFocusOut: true
        });
        if (!enc) {
          return;
        }
        params.enc = enc.trim();
        break;
      }
      case 4: {
        const confirm = await vscode.window.showWarningMessage(
          `位置签到要求: ${act.address ?? '教师指定位置'}。请确认你本人在该位置，插件不会模拟位置。`,
          { modal: true },
          '我在这里'
        );
        if (confirm !== '我在这里') {
          return;
        }
        const inputLine = await vscode.window.showInputBox({
          title: '输入真实位置（纬度,经度,地址）',
          ignoreFocusOut: true
        });
        if (!inputLine) {
          return;
        }
        const [lat, lng, ...addr] = inputLine.split(',');
        params.latitude = parseFloat(lat);
        params.longitude = parseFloat(lng);
        params.address = addr.join(',').trim();
        break;
      }
      default:
        break;
    }

    const pre = await this.ctx.signInApi.preSign(act);
    if (!pre.ok) {
      void vscode.window.showInformationMessage(pre.message ?? '签到不可用');
      return;
    }
    const name = this.ctx.session.account?.name ?? '';
    const result = await this.ctx.signInApi.submitSign(act, params, name);
    if (result.ok) {
      act.signed = true;
      void vscode.window.showInformationMessage(result.message);
    } else {
      void vscode.window.showErrorMessage(result.message);
    }
    this.ui.refreshSignIn();
  }

  /* ------------------------------ 作业与答题 ------------------------------ */

  /** 作业显示筛选切换（GUI 按钮）：全部 ↔ 仅待完成，选择权交给用户 */
  private async toggleHomeworkFilter(): Promise<void> {
    this.ctx.state.homeworkFilter = this.ctx.state.homeworkFilter === 'all' ? 'pending' : 'all';
    await this.ctx.context.globalState.update('fanxing.homeworkFilter', this.ctx.state.homeworkFilter);
    this.ctx.fireHomeworkFilterChanged();
    void vscode.window.showInformationMessage(
      this.ctx.state.homeworkFilter === 'all' ? '作业显示：全部（含未开放/已完成）' : '作业显示：仅待完成'
    );
  }

  private async openHomework(node: unknown): Promise<void> {
    const homework = node instanceof HomeworkNode ? node.homework : (node as Homework | undefined);
    if (!homework) {
      return;
    }
    // 原则：能显示就显示，未开放/已截止/已提交均允许打开（面板内提示，选择权交给用户）
    await this.openProblemWorkspace(homework);
  }

  /** 作业工作区：编程题按题建独立源文件，客观/主观题面板作答（全部状态均可打开） */
  async openProblemWorkspace(homework: Homework): Promise<ProblemWorkspace | undefined> {
    const existing = this.ctx.state.workspaces.get(homework.workId);
    if (existing) {
      await this.closeOtherWorkspaces(existing.workId);
      await ProblemPanel.create(this.ctx, existing);
      const first = [...existing.sourceFiles.keys()][0];
      if (first) {
        await this.openSourceFile({ workId: existing.workId, problemId: first });
      }
      return existing;
    }

    let problems = this.ctx.state.problemsByWork.get(homework.workId);
    if (!problems) {
      problems = await this.ctx.homeworkApi.getHomeworkDetail(homework);
      this.ctx.state.problemsByWork.set(homework.workId, problems);
    }
    if (!problems.length) {
      const offline = homework.kind === 'written' || homework.kind === 'file';
      const hint = offline
        ? '该作业为书面/附件类（无在线题目），请在学习通网页端查看或上传附件。'
        : '未能解析到题目内容（可能未开放或题型结构尚未适配）。可运行「Fanxing: 抓取作业原始响应」把 raw 样本发回适配。';
      void this.showHtmlPanel(
        `作业: ${homework.title}`,
        `<div class="fx-section">
           <p><span class="fx-tag warn">${escapeHtml(homework.stateLabel ?? '未知状态')}</span> ${escapeHtml(homework.title)}</p>
           <p class="fx-muted">${hint}</p>
         </div>`
      );
      return;
    }

    await this.closeOtherWorkspaces(homework.workId);

    const hasCode = problems.some((p) => p.type === 'programming');
    const mode: 'code' | 'quiz' = hasCode || homework.kind === 'code' ? 'code' : 'quiz';

    const lang = await this.pickLanguage(problems);
    const dir = path.join(this.ctx.problemsRoot, homework.workId);
    await fs.mkdir(dir, { recursive: true });

    const sourceFiles = new Map<string, string>();
    const casesDirs = new Map<string, string>();
    if (mode === 'code') {
      const codeProblems = hasCode ? problems.filter((p) => p.type === 'programming') : problems;
      const rootLegacy = path.join(dir, genericSourceName(lang));
      for (const p of codeProblems) {
        const problemDir = path.join(dir, `q${p.index}`);
        const casesDir = path.join(problemDir, 'cases');
        await fs.mkdir(casesDir, { recursive: true });
        const file = path.join(problemDir, problemSourceName(lang, p.index));
        const legacyInDir = path.join(problemDir, genericSourceName(lang));
        let ready = false;
        try {
          await fs.access(file);
          ready = true;
        } catch {
          for (const legacy of [legacyInDir, ...(p === codeProblems[0] ? [rootLegacy] : [])]) {
            try {
              await fs.rename(legacy, file);
              ready = true;
              break;
            } catch {
              // 无旧文件可迁移
            }
          }
        }
        if (!ready) {
          const template = p.templateCode ?? defaultTemplate(lang, `${homework.title} 第${p.index}题`);
          await fs.writeFile(file, template, 'utf8');
        }
        sourceFiles.set(p.id, file);
        casesDirs.set(p.id, casesDir);
      }
    }

    const ws: ProblemWorkspace = {
      workId: homework.workId,
      homework,
      problems,
      dir,
      sourceFiles,
      language: lang.id,
      casesDirs,
      lastReports: new Map(),
      mode,
      answers: new Map<string, string>()
    };
    this.ctx.state.workspaces.set(homework.workId, ws);

    await ProblemPanel.create(this.ctx, ws);
    const first = [...sourceFiles.keys()][0];
    if (first) {
      await this.openSourceFile({ workId: ws.workId, problemId: first });
    }
    return ws;
  }

  /** code 模式下参与编辑器作答的题目（存在编程题时仅编程题，否则全部） */
  private codeProblemsOf(ws: ProblemWorkspace): Problem[] {
    const fromFiles = ws.problems.filter((p) => ws.sourceFiles.has(p.id));
    return fromFiles;
  }

  /** 切换作业时：自动保存并关闭其他作业的编辑器标签，避免多作业文件混杂 */
  private async closeOtherWorkspaces(keepWorkId: string): Promise<void> {
    for (const [workId, ws] of this.ctx.state.workspaces) {
      if (workId !== keepWorkId) {
        await this.closeWorkspaceFiles(ws);
      }
    }
  }

  /** 保存并关闭某作业工作区的全部编辑器标签 */
  private async closeWorkspaceFiles(ws: ProblemWorkspace): Promise<void> {
    const docs = vscode.workspace.textDocuments.filter((d) => !!d.fileName && d.fileName.startsWith(ws.dir));
    for (const doc of docs) {
      if (doc.isDirty) {
        await Promise.resolve(doc.save()).catch(() => false);
      }
    }
    const tabs = vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .filter((tab) => {
        const input = tab.input as { uri?: vscode.Uri } | undefined;
        return !!input?.uri?.fsPath && input.uri.fsPath.startsWith(ws.dir);
      });
    if (tabs.length) {
      await Promise.resolve(vscode.window.tabGroups.close(tabs, true)).catch(() => undefined);
    }
  }

  private async pickLanguage(problems: Problem[]): Promise<LanguageSpec> {
    const allowed = problems.find((p) => p.languages?.length)?.languages;
    const candidates = Object.values(LANGUAGES).filter((l) => !allowed || allowed.includes(l.id));
    const preferred = this.ctx.settings.defaultLanguage.id;
    if (candidates.some((l) => l.id === preferred)) {
      return LANGUAGES[preferred];
    }
    const pick = await vscode.window.showQuickPick(
      candidates.map((l) => ({ label: l.label, description: l.ojEnvironment, id: l.id })),
      { title: '选择答题语言' }
    );
    return LANGUAGES[pick?.id ?? candidates[0]?.id ?? 'cpp'];
  }

  async openSourceFile(input?: unknown): Promise<void> {
    const resolved = this.resolveTarget(input);
    if (!resolved) {
      void vscode.window.showInformationMessage('当前文件不属于任何 Fanxing 答题工作区');
      return;
    }
    const { ws, problemId } = resolved;
    if (ws.mode !== 'code') {
      void vscode.window.showInformationMessage('该作业为面板作答模式，直接在作业面板中填写答案');
      return;
    }
    const file = await this.pickSourceFile(ws, problemId);
    if (!file) {
      void vscode.window.showInformationMessage('该作业没有可编辑的代码文件');
      return;
    }
    const doc = await vscode.workspace.openTextDocument(file);
    await vscode.window.showTextDocument(doc, { viewColumn: this.editorColumnFor(ws), preview: false });
    this.ui.refreshCodeLens();
  }

  /** 同一作业的代码文件复用同一编辑器组（以标签页形式并存），不再每次左右分屏新建 */
  private editorColumnFor(ws: ProblemWorkspace): vscode.ViewColumn {
    for (const editor of vscode.window.visibleTextEditors) {
      const name = editor.document.fileName;
      if (name && name.startsWith(ws.dir)) {
        return editor.viewColumn ?? vscode.ViewColumn.Active;
      }
    }
    return vscode.ViewColumn.Beside;
  }

  /** 选定目标题目的源文件：带 problemId 直取，多题且未指定时让用户选择 */
  private async pickSourceFile(ws: ProblemWorkspace, problemId?: string): Promise<string | undefined> {
    const direct = problemId ? ws.sourceFiles.get(problemId) : undefined;
    if (direct) {
      return direct;
    }
    const entries = [...ws.sourceFiles.entries()];
    if (!entries.length) {
      return undefined;
    }
    if (entries.length === 1) {
      return entries[0][1];
    }
    const pick = await vscode.window.showQuickPick(
      entries.map(([id, file]) => {
        const problem = ws.problems.find((p) => p.id === id);
        return { label: `第 ${problem?.index ?? '?'} 题`, description: `${problem ? problemLabel(problem) : ''}（${path.basename(file)}）`, id };
      }),
      { title: '选择要打开的题目' }
    );
    return pick ? ws.sourceFiles.get(pick.id) : undefined;
  }

  /** 解析目标答题工作区 + 目标题目（uri / 面板消息 / 活动编辑器） */
  private resolveTarget(input?: unknown): { ws: ProblemWorkspace; problemId?: string } | undefined {
    if (input && typeof input === 'object' && 'workId' in (input as Record<string, unknown>)) {
      const ref = input as { workId: string; problemId?: string };
      const ws = this.ctx.state.workspaces.get(ref.workId);
      return ws ? { ws, problemId: ref.problemId } : undefined;
    }
    const uri = input instanceof vscode.Uri ? input : (input as { uri?: vscode.Uri } | undefined)?.uri;
    const fileName = uri?.fsPath ?? vscode.window.activeTextEditor?.document.fileName;
    if (fileName) {
      for (const ws of this.ctx.state.workspaces.values()) {
        if (fileName.startsWith(ws.dir)) {
          return { ws, problemId: this.problemIdByFile(ws, fileName) };
        }
      }
    }
    if (this.ctx.state.workspaces.size === 1) {
      const ws = [...this.ctx.state.workspaces.values()][0];
      return { ws, problemId: this.problemIdByFile(ws, vscode.window.activeTextEditor?.document.fileName) };
    }
    return undefined;
  }

  private problemIdByFile(ws: ProblemWorkspace, fileName?: string): string | undefined {
    if (!fileName) {
      return undefined;
    }
    for (const [id, file] of ws.sourceFiles) {
      if (file === fileName) {
        return id;
      }
    }
    return undefined;
  }

  /* ------------------------------ 本地测试 / 提交 ------------------------------ */

  async runLocalTest(target?: unknown): Promise<void> {
    const resolved = this.resolveTarget(target);
    if (!resolved) {
      void vscode.window.showInformationMessage('请先打开一个作业（作业视图）');
      return;
    }
    const { ws, problemId } = resolved;
    if (ws.mode !== 'code') {
      void vscode.window.showInformationMessage('该作业为面板作答模式，无需本地测试，填写答案后直接提交');
      return;
    }
    await this.ensureEnvironment(ws.language);

    const judge = this.ctx.makeJudge();
    const lang = LANGUAGES[ws.language];
    const targets = this.codeProblemsOf(ws).filter((p) => !problemId || p.id === problemId);
    if (!targets.length) {
      void vscode.window.showInformationMessage('没有可测试的编程题');
      return;
    }

    const parts = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: this.ctx.i18n.t('judge.running') },
      async () => {
        const out: Array<{ problem: Problem; report: import('./api/types').JudgeReport; cases: TestCase[] }> = [];
        for (const p of targets) {
          const cases = await this.collectCases(ws, p);
          const file = ws.sourceFiles.get(p.id);
          if (!file) {
            continue;
          }
          if (!cases.length) {
            out.push({ problem: p, report: { verdict: Verdict.Skipped, cases: [], totalTimeMs: 0 }, cases: [] });
            continue;
          }
          const report = await judge.judge(lang, path.dirname(file), path.basename(file), cases, p.limits);
          ws.lastReports.set(p.id, report);
          out.push({ problem: p, report, cases });
        }
        return out;
      }
    );

    const aggregate = aggregateReports(parts.map((x) => x.report));
    ws.lastReport = aggregate;

    const text = parts
      .map(({ problem, report, cases }) =>
        `第 ${problem.index} 题 · ${problemLabel(problem)}\n` +
        (report.verdict === Verdict.Skipped && !cases.length ? '（无样例，已跳过）' : this.formatReport(report, cases))
      )
      .join('\n\n');
    for (const { problem, report, cases } of parts) {
      const body = report.verdict === Verdict.Skipped && !cases.length ? '（无样例，已跳过）' : this.formatReport(report, cases);
      ProblemPanel.current?.postResult(`第 ${problem.index} 题 · ${problemLabel(problem)}\n${body}`, problem.id);
    }
    const summary = `总评: ${VERDICT_LABEL[aggregate.verdict] ?? aggregate.verdict}  耗时 ${aggregate.totalTimeMs} ms`;
    this.ctx.logger.info(`本地测试: ${aggregate.verdict}`);
    if (ProblemPanel.current) {
      this.ctx.logger.output.appendLine(summary);
      this.ctx.logger.output.appendLine(text);
    } else {
      this.showTextPanel('本地测试结果（含控制台输出）', `${summary}\n\n${text}`);
    }
    if (aggregate.verdict === Verdict.Accepted) {
      void vscode.window.showInformationMessage(this.ctx.i18n.t('judge.pass'));
    } else if (aggregate.verdict !== Verdict.Skipped) {
      void vscode.window.showWarningMessage(`${this.ctx.i18n.t('judge.fail')}: ${VERDICT_LABEL[aggregate.verdict] ?? aggregate.verdict}`);
    }
  }

  private formatReport(report: import('./api/types').JudgeReport, cases: TestCase[]): string {
    const lines: string[] = [];
    lines.push(`总评: ${VERDICT_LABEL[report.verdict] ?? report.verdict}  耗时 ${report.totalTimeMs} ms`);
    if (report.verdict === Verdict.CompileError && report.compileLog) {
      lines.push('编译日志:', report.compileLog);
      return lines.join('\n');
    }
    if (report.compileLog && report.compileLog.trim() && report.compileLog.trim() !== '(无编译输出)') {
      lines.push('编译输出:', indent(report.compileLog));
    }
    for (const c of report.cases) {
      const custom = cases[c.index - 1]?.custom ? '（自定义）' : '';
      lines.push(
        `用例 ${c.index}${custom}: ${VERDICT_LABEL[c.verdict] ?? c.verdict}  ${c.timeMs} ms`
      );
      lines.push('  控制台输出:', indent(c.actualOutput || '(无输出)'));
      if (c.verdict !== Verdict.Accepted) {
        lines.push('  标准错误:', indent(c.stderr && c.stderr.trim() ? c.stderr : '(无)'));
        if (c.exitCode !== undefined) {
          const hint = describeExitCode(c.exitCode);
          lines.push(`  进程退出码: ${c.exitCode}${hint ? ` ${hint}` : ''}`);
        }
        if (c.diff) {
          lines.push('  差异:', indent(c.diff));
        }
      } else if (c.stderr && c.stderr.trim()) {
        lines.push('  标准错误:', indent(c.stderr));
      }
    }
    return lines.join('\n');
  }

  private async collectCases(ws: ProblemWorkspace, problem: Problem): Promise<TestCase[]> {
    const samples: TestCase[] = problem.sampleTests ?? [];
    const custom: TestCase[] = [];
    const casesDir = ws.casesDirs.get(problem.id);
    if (casesDir) {
      try {
        const files = await fs.readdir(casesDir);
        const ins = files.filter((f) => f.endsWith('.in')).sort();
        for (const inFile of ins) {
          const outFile = inFile.replace(/\.in$/, '.out');
          if (!files.includes(outFile)) {
            continue;
          }
          custom.push({
            input: await fs.readFile(path.join(casesDir, inFile), 'utf8'),
            expectedOutput: await fs.readFile(path.join(casesDir, outFile), 'utf8'),
            custom: true
          });
        }
      } catch {
        // 目录为空
      }
    }
    return [...samples, ...custom];
  }

  async addTestCase(target?: unknown): Promise<void> {
    const resolved = this.resolveTarget(target);
    if (!resolved) {
      void vscode.window.showInformationMessage('请先打开一个编程作业');
      return;
    }
    const { ws } = resolved;
    const problems = this.codeProblemsOf(ws);
    if (!problems.length) {
      void vscode.window.showInformationMessage('该作业没有编程题');
      return;
    }
    let problem = problems.find((p) => p.id === resolved.problemId);
    if (!problem && problems.length > 1) {
      const pick = await vscode.window.showQuickPick(
        problems.map((p) => ({ label: `第 ${p.index} 题`, description: problemLabel(p), id: p.id })),
        { title: '为哪道题添加测试用例' }
      );
      problem = problems.find((p) => p.id === pick?.id);
    }
    problem = problem ?? problems[0];
    const input = await vscode.window.showInputBox({ title: `第 ${problem.index} 题 · 测试输入（可为空）`, ignoreFocusOut: true });
    if (input === undefined) {
      return;
    }
    const expected = await vscode.window.showInputBox({ title: `第 ${problem.index} 题 · 期望输出`, ignoreFocusOut: true });
    if (expected === undefined) {
      return;
    }
    const casesDir = ws.casesDirs.get(problem.id);
    if (!casesDir) {
      return;
    }
    const files = await fs.readdir(casesDir).catch(() => [] as string[]);
    const index = files.filter((f) => f.endsWith('.in')).length + 1;
    const base = `custom${String(index).padStart(2, '0')}`;
    await fs.writeFile(path.join(casesDir, `${base}.in`), input, 'utf8');
    await fs.writeFile(path.join(casesDir, `${base}.out`), expected, 'utf8');
    void vscode.window.showInformationMessage(`已为第 ${problem.index} 题添加自定义测试用例 ${base}`);
  }

  async submitAssignment(target?: unknown): Promise<void> {
    const resolved = this.resolveTarget(target);
    const ws = resolved?.ws;
    if (!ws) {
      void vscode.window.showInformationMessage('请先打开一个作业');
      return;
    }
    const isCode = ws.mode === 'code';

    if (isCode && this.ctx.settings.forceLocalTest) {
      const needTest = this.codeProblemsOf(ws).filter(
        (p) => (p.sampleTests?.length ?? 0) > 0 && ws.lastReports.get(p.id)?.verdict !== Verdict.Accepted
      );
      if (needTest.length) {
        await this.runLocalTest({ workId: ws.workId });
        const stillBad = needTest.filter((p) => ws.lastReports.get(p.id)?.verdict !== Verdict.Accepted);
        if (stillBad.length) {
          void vscode.window.showErrorMessage(
            `${this.ctx.i18n.t('submit.blocked')}（第 ${stillBad.map((p) => p.index).join('、')} 题样例未全部通过）`
          );
          return;
        }
      }
    }

    const answers = new Map<string, string>();
    for (const problem of ws.problems) {
      const file = ws.sourceFiles.get(problem.id);
      if (file) {
        answers.set(problem.id, await fs.readFile(file, 'utf8').catch(() => ''));
      } else {
        answers.set(problem.id, ws.answers.get(problem.id) ?? '');
      }
    }

    // 提交前确认：展示作答预览 + 未作答提醒（不阻止，选择权交给用户）
    const unanswered = ws.problems.filter((p) => !(answers.get(p.id) ?? '').trim());
    const preview = isCode
      ? (
          await Promise.all(
            this.codeProblemsOf(ws).map(async (p) => {
              const code = await fs.readFile(ws.sourceFiles.get(p.id) ?? '', 'utf8').catch(() => '');
              return `第${p.index}题: ${truncateForPreview(code)}`;
            })
          )
        ).join('\n\n')
      : ws.problems
          .map((p) => `第${p.index}题[${QUESTION_TYPE_LABEL[p.type] ?? p.type}]: ${truncateForPreview(answers.get(p.id) ?? '(未作答)')}`)
          .join('\n');
    const detail = unanswered.length
      ? `注意：还有 ${unanswered.length} 题未作答（第 ${unanswered.map((p) => p.index).join('、')} 题）\n\n${preview}`
      : preview;

    const choice = await vscode.window.showWarningMessage(
      this.ctx.i18n.t('submit.confirm'),
      { modal: true, detail },
      '确认提交'
    );
    if (choice !== '确认提交') {
      return;
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: '提交中...' },
      async () => {
        const result = await this.ctx.oj.submitCode(ws.homework, ws.problems, answers);
        if (!result.ok) {
          void vscode.window.showErrorMessage(`提交失败: ${result.message}`);
          return;
        }
        void vscode.window.showInformationMessage(this.ctx.i18n.t('submit.done'));
        const polled = await this.ctx.oj.pollResult(ws.homework, 8, 4000);
        this.ctx.state.submissions.push({
          id: `${ws.workId}-${Date.now()}`,
          workId: ws.workId,
          submitTime: Date.now(),
          code: isCode ? [...answers.values()].join('\n\n') : undefined,
          language: isCode ? ws.language : undefined,
          verdict: (polled.verdict as Verdict) ?? Verdict.Judging,
          score: polled.score,
          message: polled.message
        });
        const label = VERDICT_LABEL[polled.verdict] ?? polled.verdict;
        this.ctx.logger.info(`判题结果: ${label}${polled.score !== undefined ? ` 得分 ${polled.score}` : ''}`);
        ProblemPanel.current?.postResult(`平台判题: ${label}${polled.score !== undefined ? `  得分 ${polled.score}` : ''}\n${polled.message ?? ''}`);
        void vscode.window.showInformationMessage(`平台判题: ${label}`);
        this.ui.refreshHomework();
        this.ui.refreshDashboard();
      }
    );
  }

  /* ------------------------------ AI ------------------------------ */

  private async runAi(task: AiTask, target?: unknown): Promise<void> {
    const resolved = this.resolveTarget(target);
    const ws = resolved?.ws;
    const ai = await this.ctx.makeAi();
    if (!this.ctx.settings.ai.enabled) {
      void vscode.window.showInformationMessage(this.ctx.i18n.t('ai.disabled'));
      return;
    }
    if (!ai.enabled) {
      void vscode.window.showInformationMessage(this.ctx.i18n.t('ai.nokey'));
      return;
    }

    const problemId = resolved?.problemId ?? (ws ? this.problemIdByFile(ws, vscode.window.activeTextEditor?.document.fileName) : undefined);
    const problem = ws
      ? ws.problems.find((p) => p.id === problemId) ?? ws.problems.find((p) => ws.sourceFiles.has(p.id)) ?? ws.problems[0]
      : undefined;
    const file = ws && problem ? ws.sourceFiles.get(problem.id) : undefined;
    const editor = vscode.window.activeTextEditor;
    const code = editor?.document.getText() ?? (file ? await fs.readFile(file, 'utf8').catch(() => '') : '');
    const report = ws && problem ? ws.lastReports.get(problem.id) ?? ws.lastReport : undefined;
    let error: string | undefined;
    if (task === 'explainError') {
      error = await vscode.window.showInputBox({
        title: '粘贴编译/运行/评测错误信息',
        ignoreFocusOut: true
      });
      if (!error && report?.compileLog) {
        error = report.compileLog;
      }
      if (!error && report?.cases.some((c) => c.stderr)) {
        error = report.cases.map((c) => c.stderr ?? '').join('\n');
      }
      if (!error && report) {
        const crashed = report.cases.filter((c) => c.exitCode);
        if (crashed.length) {
          error = crashed
            .map((c) => `用例 ${c.index} 退出码 ${c.exitCode} ${describeExitCode(c.exitCode)}`.trim())
            .join('\n');
        }
      }
    }

    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: this.ctx.i18n.t('ai.working') },
      async () => {
        try {
          const answer = await ai.ask(task, {
            problemText: problem?.contentText,
            questionBankId: problem?.questionBankId,
            code,
            language: ws ? LANGUAGES[ws.language]?.label : undefined,
            error,
            sample: problem?.sampleTests?.map((t) => `输入:\n${t.input}\n输出:\n${t.expectedOutput}`).join('\n---\n')
          });
          this.showTextPanel('AI 辅助建议（仅引导，不提供完整答案）', answer);
        } catch (err) {
          void vscode.window.showErrorMessage(`AI 请求失败: ${String(err)}`);
        }
      }
    );
  }

  private async configureAi(): Promise<void> {
    const baseUrl = await vscode.window.showInputBox({
      title: 'API 地址（OpenAI 兼容）',
      value: this.ctx.settings.ai.baseUrl,
      ignoreFocusOut: true
    });
    if (baseUrl === undefined) {
      return;
    }
    await vscode.workspace.getConfiguration('fanxing').update('ai.baseUrl', baseUrl, vscode.ConfigurationTarget.Global);

    const model = await vscode.window.showInputBox({
      title: '模型名称',
      value: this.ctx.settings.ai.model,
      ignoreFocusOut: true
    });
    if (model !== undefined) {
      await vscode.workspace.getConfiguration('fanxing').update('ai.model', model, vscode.ConfigurationTarget.Global);
    }

    const key = await vscode.window.showInputBox({
      title: 'API Key（保存到 SecretStorage，不写入配置文件）',
      password: true,
      ignoreFocusOut: true
    });
    if (key) {
      await this.ctx.store.setAiApiKey(key);
    }
    await vscode.workspace.getConfiguration('fanxing').update('ai.enabled', true, vscode.ConfigurationTarget.Global);
    void vscode.window.showInformationMessage('AI 提供商配置完成');
  }

  /* ------------------------------ 环境 / 成绩 / 日程 ------------------------------ */

  async checkEnvironment(): Promise<void> {
    const languages = Object.values(LANGUAGES);
    const tools = await this.ctx.env.checkTools(languages);
    const extensions = this.ctx.env.checkExtensions(languages);
    const rows = tools
      .map((t) => {
        const status = t.ok ? '已安装' : '未安装';
        const fix = t.ok ? '' : `\n安装建议: ${this.ctx.env.suggestInstallCommand(t.command)}`;
        return `<tr>
          <td>${escapeHtml(t.label)}</td>
          <td>${status}</td>
          <td>${escapeHtml(t.version ?? '-')}</td>
          <td>${escapeHtml(t.ojEnvironment)}${escapeHtml(fix)}</td>
        </tr>`;
      })
      .join('');
    const extRows = extensions
      .map((e) => `<tr><td>${escapeHtml(e.label)}</td><td>${e.ok ? '已安装' : '未安装'}</td><td colspan="2">${e.ok ? '-' : `扩展市场安装 ${escapeHtml(e.id)}`}</td></tr>`)
      .join('');

    const allOk = tools.every((t) => t.ok);
    this.ctx.logger.info(this.ctx.i18n.t('env.title'), tools.map((t) => `${t.label}:${t.ok ? 'ok' : 'missing'}`).join(' '));
    this.showHtmlPanel(
      this.ctx.i18n.t('env.title'),
      `<div class="fx-section">
        <p class="${allOk ? 'fx-ok' : 'fx-warn'}">${allOk ? this.ctx.i18n.t('env.ok') : this.ctx.i18n.t('env.missing')}</p>
        <table class="fx-table">
          <tr><th>工具</th><th>状态</th><th>版本</th><th>学习通 OJ 环境 / 安装建议</th></tr>
          ${rows}
          ${extRows}
        </table>
      </div>`
    );
    if (!allOk) {
      const guide = this.ctx.env.buildGuide(tools);
      this.ctx.logger.output.appendLine('安装引导:');
      this.ctx.logger.output.appendLine(guide);
    }
  }

  async viewGrades(courseId?: string): Promise<void> {
    await this.refreshGrades();
    GradesPanel.create(this.ctx, courseId);
  }

  async refreshGrades(): Promise<void> {
    if (!this.ctx.session.isLoggedIn) {
      return;
    }
    const grades: import('./api/types').GradeItem[] = [];
    for (const course of this.ctx.state.courses) {
      const item = await this.ctx.gradeApi.getGrades(course).catch(() => undefined);
      if (item) {
        grades.push(item);
      }
    }
    this.ctx.state.grades = grades;
    this.ui.refreshGrades();
    GradesPanel.current?.refresh();
  }

  async exportDeadlines(): Promise<void> {
    const ddls = this.ctx.deadline.merge(
      this.ctx.deadline.collectFromHomework(
        this.ctx.state.courses.map((c) => ({
          courseName: c.name,
          courseId: c.courseId,
          items: this.ctx.state.homeworkByCourse.get(c.courseId) ?? []
        }))
      ),
      this.ctx.deadline.collectFromNotices(this.ctx.state.notices)
    );
    if (!ddls.length) {
      void vscode.window.showInformationMessage('暂无待导出的截止时间');
      return;
    }
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? this.ctx.context.globalStorageUri.fsPath;
    const file = path.join(workspaceDir, 'fanxing-deadlines.ics');
    await fs.writeFile(file, buildIcs(ddls), 'utf8');
    void vscode.window.showInformationMessage(`${this.ctx.i18n.t('ddl.exported')}: ${file}`);
    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(file));
  }

  /* ------------------------------ 工具 ------------------------------ */

  private async ensureEnvironment(language: string): Promise<void> {
    const lang = LANGUAGES[language];
    const tools = await this.ctx.env.checkTools([lang]);
    const missing = tools.filter((t) => !t.ok);
    if (missing.length) {
      const fix = this.ctx.env.suggestInstallCommand(missing[0].command);
      const choice = await vscode.window.showWarningMessage(
        `缺少 ${missing[0].label}，请先安装以运行本地测试`,
        '查看安装建议',
        '忽略'
      );
      if (choice === '查看安装建议') {
        this.ctx.logger.output.appendLine(`${missing[0].label} 安装建议: ${fix}`);
        this.ctx.logger.show();
      }
    }
  }

  private showHtmlPanel(title: string, body: string): void {
    const panel = vscode.window.createWebviewPanel('fanxing.page', title, vscode.ViewColumn.Active, {
      enableScripts: false
    });
    panel.webview.html = htmlShell(panel.webview, { title, body });
  }

  private showTextPanel(title: string, text: string): void {
    this.showHtmlPanel(title, `<div class="fx-section"><pre>${escapeHtml(text)}</pre></div>`);
    this.ctx.logger.output.appendLine(text);
    this.ctx.logger.show();
  }
}

function problemLabel(p: Problem): string {
  const text = (p.contentText || '').split('\n')[0].trim();
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || `第${p.index}题`;
}

/** 每题源文件名：q{index}.* 便于标签区分（Java 受类名约束固定 Main.java） */
function problemSourceName(lang: LanguageSpec, index: number): string {
  if (lang.id === 'java') {
    return 'Main.java';
  }
  const ext = lang.id === 'python' ? 'py' : lang.id === 'c' ? 'c' : 'cpp';
  return `q${index}.${ext}`;
}

/** 旧版通用源文件名（用于历史文件迁移） */
function genericSourceName(lang: LanguageSpec): string {
  if (lang.id === 'java') {
    return 'Main.java';
  }
  if (lang.id === 'python') {
    return 'main.py';
  }
  if (lang.id === 'c') {
    return 'main.c';
  }
  return 'main.cpp';
}

function aggregateReports(reports: import('./api/types').JudgeReport[]): import('./api/types').JudgeReport {
  const cases: import('./api/types').CaseResult[] = [];
  let verdict: Verdict | undefined;
  let totalTimeMs = 0;
  let compileLog: string | undefined;
  for (const report of reports) {
    totalTimeMs += report.totalTimeMs;
    if (report.compileLog) {
      compileLog = compileLog ? `${compileLog}\n${report.compileLog}` : report.compileLog;
    }
    for (const c of report.cases) {
      cases.push({ ...c, index: cases.length + 1 });
    }
    if (report.verdict !== Verdict.Skipped && report.verdict !== Verdict.Accepted && !verdict) {
      verdict = report.verdict;
    }
  }
  const finalVerdict = verdict ?? (reports.some((r) => r.verdict === Verdict.Accepted) ? Verdict.Accepted : Verdict.Skipped);
  return { verdict: finalVerdict, cases, totalTimeMs, compileLog };
}

function defaultTemplate(lang: LanguageSpec, title: string): string {
  switch (lang.id) {
    case 'cpp':
      return `#include <bits/stdc++.h>\nusing namespace std;\n\n// ${title}\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n\n    return 0;\n}\n`;
    case 'c':
      return `#include <stdio.h>\n\n/* ${title} */\nint main(void) {\n\n    return 0;\n}\n`;
    case 'java':
      return `import java.util.*;\nimport java.io.*;\n\n// ${title}\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));\n\n    }\n}\n`;
    default:
      return `# ${title}\nimport sys\n\ndef main():\n    data = sys.stdin.read().split()\n\nif __name__ == '__main__':\n    main()\n`;
  }
}

function indent(text: string): string {
  return text
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

function truncateForPreview(text: string, max = 2000): string {
  return text.length > max ? `${text.slice(0, max)}\n...` : text;
}
