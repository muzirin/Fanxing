/**
 * 签到 / 成绩 / 日程 三个辅助树。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { SIGN_TYPE_LABEL, VERDICT_LABEL } from '../config/constants';
import { formatDateTime, formatRemaining, isNearDeadline } from '../utils/time';

/* ------------------------------ 签到 ------------------------------ */

export class SignNode extends vscode.TreeItem {
  constructor(readonly activity: import('../api/types').SignActivity) {
    super(`${activity.courseName || '课程'} - ${SIGN_TYPE_LABEL[activity.nameOtherId] ?? '签到'}`, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(activity.signed ? 'check' : 'bell');
    this.description = activity.signed ? '已签到' : `进行中  ${formatDateTime(activity.startTime)}`;
    this.contextValue = 'signin';
    if (!activity.signed) {
      this.command = {
        command: 'fanxing.signActivity',
        title: '签到',
        arguments: [activity]
      };
    }
  }
}

export class SignInTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly ctx: FanxingContext) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!this.ctx.session.isLoggedIn) {
      return [];
    }
    const acts = this.ctx.state.activities;
    if (!acts.length) {
      const empty = new vscode.TreeItem('当前无进行中的签到', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('check');
      return [empty];
    }
    return acts.map((a) => new SignNode(a));
  }
}

/* ------------------------------ 成绩 ------------------------------ */

export class GradeNode extends vscode.TreeItem {
  constructor(readonly courseId: string, label: string, scoreText: string) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon('graph');
    this.description = scoreText;
    this.contextValue = 'grade';
  }
}

export class GradeItemNode extends vscode.TreeItem {
  constructor(label: string, score: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon('primitive-dot');
    this.description = score;
  }
}

export class GradeTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly ctx: FanxingContext) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.ctx.session.isLoggedIn) {
      return [];
    }
    if (!element) {
      return this.ctx.state.grades.map(
        (g) => new GradeNode(g.courseId, g.courseName, g.total !== undefined ? `总评 ${g.total}` : '')
      );
    }
    if (element instanceof GradeNode) {
      const grade = this.ctx.state.grades.find((g) => g.courseId === element.courseId);
      return (grade?.items ?? []).map((it) => new GradeItemNode(it.name, `${it.score} 分${it.weight !== undefined ? ` (权重 ${it.weight}%)` : ''}`));
    }
    return [];
  }
}

/* ------------------------------ 日程 ------------------------------ */

export class DdlNode extends vscode.TreeItem {
  constructor(readonly item: import('../api/types').DdlItem, warnHours: number) {
    super(item.title, vscode.TreeItemCollapsibleState.None);
    const urgent = isNearDeadline(item.deadline, warnHours);
    this.iconPath = new vscode.ThemeIcon(
      item.kind === 'exam' ? 'watch' : 'calendar',
      urgent ? new vscode.ThemeColor('list.warningForeground') : undefined
    );
    this.description = `[${item.courseName}] 剩余 ${formatRemaining(item.deadline)}`;
    this.tooltip = `截止: ${formatDateTime(item.deadline)}`;
    this.contextValue = 'ddl';
  }
}

export class DdlTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;

  constructor(private readonly ctx: FanxingContext) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(): Promise<vscode.TreeItem[]> {
    if (!this.ctx.session.isLoggedIn) {
      return [];
    }
    const warnHours = this.ctx.settings.deadlineWarnHours;
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
      const empty = new vscode.TreeItem('暂无待办截止', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('check');
      return [empty];
    }
    return ddls.map((d) => new DdlNode(d, warnHours));
  }
}

/** 提交记录展示（命令面板打开的简易信息列表） */
export function showSubmissions(ctx: FanxingContext): void {
  const items = ctx.state.submissions;
  if (!items.length) {
    void vscode.window.showInformationMessage('暂无提交记录');
    return;
  }
  void vscode.window.showQuickPick(
    items.map((s) => ({
      label: `${s.workId} - ${VERDICT_LABEL[s.verdict] ?? s.verdict}`,
      description: formatDateTime(s.submitTime),
      detail: s.message
    })),
    { title: '提交记录' }
  );
}
