/**
 * 学习数据仪表盘（侧边栏 WebviewView）：待办 / 未读 / 进度 / 通过率统计。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { VERDICT_LABEL } from '../config/constants';
import { formatDateTime, formatRemaining, isNearDeadline } from '../utils/time';
import { escapeHtml, htmlShell } from '../views/webview';

export class DashboardViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = 'fanxing.dashboard';
  private view?: vscode.WebviewView;

  constructor(private readonly ctx: FanxingContext) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(this.ctx.context.globalStorageUri.fsPath)]
    };
    webviewView.webview.onDidReceiveMessage((msg: { type?: string }) => {
      const map: Record<string, string> = {
        login: 'fanxing.login',
        settings: 'fanxing.openSettings',
        refresh: 'fanxing.refreshCourses',
        env: 'fanxing.checkEnvironment',
        exportIcs: 'fanxing.exportDeadlines',
        grades: 'fanxing.viewGrades',
        filter: 'fanxing.toggleHomeworkFilter'
      };
      const command = map[msg.type ?? ''];
      if (command) {
        void Promise.resolve(vscode.commands.executeCommand(command)).catch((err: unknown) => {
          this.ctx.logger.error('概览操作失败', String(err));
        });
      }
    });
    this.refresh();
  }

  refresh(): void {
    if (this.view) {
      this.view.webview.html = this.render(this.view.webview);
    }
  }

  private render(webview: vscode.Webview): string {
    const state = this.ctx.state;
    const warnHours = this.ctx.settings.deadlineWarnHours;

    const pendingHomework = [...state.homeworkByCourse.values()].flat().filter((h) => !h.submitted);
    const soon = pendingHomework.filter((h) => isNearDeadline(h.deadline, warnHours));
    const codeSubs = state.submissions;
    const passed = codeSubs.filter((s) => s.verdict === 'AC').length;
    const rate = codeSubs.length ? Math.round((passed / codeSubs.length) * 100) : 0;
    const progressAvg =
      state.courses.length > 0
        ? Math.round(state.courses.reduce((sum, c) => sum + (c.progress ?? 0), 0) / state.courses.length)
        : 0;

    const cards = `
<div class="fx-cards">
  <div class="fx-card"><div class="num">${pendingHomework.length}</div><div class="label">待完成作业</div></div>
  <div class="fx-card"><div class="num">${soon.length}</div><div class="label">即将到期</div></div>
  <div class="fx-card"><div class="num">${state.unreadCount}</div><div class="label">未读通知</div></div>
  <div class="fx-card"><div class="num">${progressAvg}%</div><div class="label">课程平均进度</div></div>
  <div class="fx-card"><div class="num">${rate}%</div><div class="label">编程作业通过率</div></div>
</div>`;

    const homeworkList = pendingHomework.length
      ? `<ul class="fx-list">${pendingHomework
          .sort((a, b) => a.deadline - b.deadline)
          .slice(0, 8)
          .map(
            (h) =>
              `<li><span>${escapeHtml(h.title)}</span><span class="fx-muted">${
                h.deadline ? `剩余 ${formatRemaining(h.deadline)}` : '无截止时间'
              }</span></li>`
          )
          .join('')}</ul>`
      : '<p class="fx-muted">暂无待完成作业</p>';

    const courseList = state.courses.length
      ? state.courses
          .map((c) => {
            const progress = c.progress ?? 0;
            return `
        <div>
          <div>${escapeHtml(c.name)} <span class="fx-muted">${progress}%</span></div>
          <div class="fx-bar-track"><div class="fx-bar-fill" style="width:${progress}%"></div></div>
        </div>`;
          })
          .join('')
      : '<p class="fx-muted">暂无课程，请先登录并刷新</p>';

    const recentSubs = codeSubs.length
      ? `<table class="fx-table"><tr><th>时间</th><th>作业</th><th>结果</th></tr>${codeSubs
          .slice(-5)
          .reverse()
          .map(
            (s) =>
              `<tr><td>${formatDateTime(s.submitTime)}</td><td>${escapeHtml(s.workId)}</td><td>${
                VERDICT_LABEL[s.verdict] ?? s.verdict
              }</td></tr>`
          )
          .join('')}</table>`
      : '<p class="fx-muted">暂无提交记录</p>';

    const body = `
<div class="fx-header"><div class="fx-title">学习概览</div>
<div class="fx-meta">${this.ctx.session.account ? escapeHtml(this.ctx.session.account.name) : '未登录'}</div></div>
<div class="fx-toolbar">
  <button class="fx-btn" data-cmd="login">${this.ctx.session.account ? '切换账号' : '登录'}</button>
  <button class="fx-btn secondary" data-cmd="refresh">刷新</button>
  <button class="fx-btn secondary" data-cmd="settings">设置</button>
  <button class="fx-btn secondary" data-cmd="env">环境检测</button>
</div>
<div class="fx-toolbar">
  <button class="fx-btn secondary" data-cmd="grades">查看成绩</button>
  <button class="fx-btn secondary" data-cmd="filter">作业筛选: ${this.ctx.state.homeworkFilter === 'all' ? '全部' : '仅待完成'}</button>
  <button class="fx-btn secondary" data-cmd="exportIcs">导出日历</button>
</div>
${cards}
<div class="fx-section"><h2>待完成作业（按截止时间）</h2>${homeworkList}</div>
<div class="fx-section"><h2>课程进度</h2>${courseList}</div>
<div class="fx-section"><h2>最近提交</h2>${recentSubs}</div>`;

    const script = `
const vscode = acquireVsCodeApi();
document.body.addEventListener('click', function (e) {
  var t = e.target.closest('[data-cmd]');
  if (t) { vscode.postMessage({ type: t.getAttribute('data-cmd') }); }
});
`;
    return htmlShell(webview, { title: 'Fanxing 概览', body, script });
  }
}
