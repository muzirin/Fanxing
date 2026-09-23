/**
 * 通知树：未读/已读分类展示，未读角标由状态栏负责。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { NoticeItem } from '../api/types';
import { formatDateTime } from '../utils/time';

const CATEGORY_LABEL: Record<string, string> = {
  system: '系统通知',
  course: '课程通知',
  homework: '作业通知',
  exam: '考试通知',
  other: '其他通知'
};

export class NoticeNode extends vscode.TreeItem {
  constructor(readonly notice: NoticeItem) {
    super(notice.title, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(notice.read ? 'mail' : 'mail-unread');
    this.description = `${CATEGORY_LABEL[notice.category] ?? ''}  ${formatDateTime(notice.publishTime)}`;
    this.tooltip = `${notice.title}\n${notice.courseName ?? ''}`;
    this.contextValue = 'notice';
    this.command = {
      command: 'fanxing.openNotice',
      title: '打开通知',
      arguments: [this]
    };
  }
}

export class NotificationTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
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
    const notices = this.ctx.state.notices;
    if (!notices.length) {
      const empty = new vscode.TreeItem('暂无通知', vscode.TreeItemCollapsibleState.None);
      empty.iconPath = new vscode.ThemeIcon('info');
      return [empty];
    }
    return notices.map((n) => new NoticeNode(n));
  }
}
