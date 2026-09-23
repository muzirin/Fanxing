/**
 * 作业树：课程 -> 作业（区分编程题/书面/测验/小组，DDL 临近高亮）。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { Homework } from '../api/types';
import { formatDateTime, formatRemaining, isNearDeadline } from '../utils/time';

function homeworkIcon(homework: Homework): string {
  if (homework.locked) {
    return 'lock';
  }
  if (homework.expired && !homework.submitted) {
    return 'circle-slash';
  }
  if (homework.marked) {
    return 'check';
  }
  if (homework.submitted) {
    return 'pass';
  }
  return homework.kind === 'code' ? 'file-code' : 'note';
}

export class HomeworkCourseNode extends vscode.TreeItem {
  constructor(
    readonly courseId: string,
    label: string,
    readonly count: number
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.iconPath = new vscode.ThemeIcon('folder-library');
    this.description = `${count} 个作业`;
    this.contextValue = 'homework-course';
  }
}

export class HomeworkNode extends vscode.TreeItem {
  constructor(readonly homework: Homework, warnHours: number) {
    super(homework.title, vscode.TreeItemCollapsibleState.None);
    const urgent = !homework.submitted && !homework.locked && isNearDeadline(homework.deadline, warnHours);
    this.iconPath = new vscode.ThemeIcon(
      homeworkIcon(homework),
      urgent
        ? new vscode.ThemeColor('list.warningForeground')
        : homework.locked || homework.expired
          ? new vscode.ThemeColor('list.inactiveForeground')
          : homework.submitted
            ? undefined
            : new vscode.ThemeColor('list.errorForeground')
    );
    const parts: string[] = [homework.stateLabel ?? '待完成'];
    if (homework.marked && homework.score !== undefined) {
      parts.push(`${homework.score} 分`);
    } else if (!homework.submitted && homework.deadline) {
      parts.push(`剩余 ${formatRemaining(homework.deadline)}`);
    }
    this.description = parts.join('  ');
    this.tooltip = new vscode.MarkdownString(
      `**${homework.title}**\n\n截止: ${formatDateTime(homework.deadline)}\n\n状态: ${
        homework.marked ? `已批改${homework.score !== undefined ? `（${homework.score} 分）` : ''}` : homework.submitted ? '已提交待批改' : '未提交'
      }${homework.teacherComment ? `\n\n教师评语: ${homework.teacherComment}` : ''}`
    );
    this.contextValue = homework.kind === 'code' ? 'homework-code' : 'homework-other';
    this.command = {
      command: 'fanxing.openHomework',
      title: '打开作业',
      arguments: [this]
    };
  }
}

export class HomeworkTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
    const warnHours = this.ctx.settings.deadlineWarnHours;
    const filter = this.ctx.state.homeworkFilter;
    const visible = (items: Homework[]) => (filter === 'pending' ? items.filter((h) => !h.submitted && !h.locked) : items);
    if (!element) {
      const nodes: HomeworkCourseNode[] = [];
      for (const course of this.ctx.state.courses) {
        const items = visible(this.ctx.state.homeworkByCourse.get(course.courseId) ?? []);
        const pending = items.filter((h) => !h.submitted).length;
        nodes.push(new HomeworkCourseNode(course.courseId, course.name, pending ? pending : items.length));
      }
      return nodes;
    }
    if (element instanceof HomeworkCourseNode) {
      const items = visible(this.ctx.state.homeworkByCourse.get(element.courseId) ?? []);
      return items.map((h) => new HomeworkNode(h, warnHours));
    }
    return [];
  }
}
