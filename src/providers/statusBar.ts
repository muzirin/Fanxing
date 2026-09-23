/**
 * 状态栏：登录状态 / 最近 DDL 倒计时 / 未读通知数。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { BRAND } from '../config/constants';
import { formatRemaining } from '../utils/time';

export class StatusBarController implements vscode.Disposable {
  private readonly loginItem: vscode.StatusBarItem;
  private readonly ddlItem: vscode.StatusBarItem;
  private readonly noticeItem: vscode.StatusBarItem;
  private readonly settingsItem: vscode.StatusBarItem;
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly ctx: FanxingContext) {
    this.loginItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.ddlItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.noticeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);
    this.settingsItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 97);

    this.loginItem.command = 'fanxing.login';
    this.ddlItem.command = 'fanxing.exportDeadlines';
    this.noticeItem.command = 'fanxing.checkNotifications';
    this.settingsItem.command = 'fanxing.openSettings';
    this.settingsItem.text = '$(settings-gear)';
    this.settingsItem.tooltip = 'Fanxing 设置';
    this.show();
  }

  show(): void {
    this.loginItem.show();
    this.ddlItem.show();
    this.noticeItem.show();
    this.settingsItem.show();
    this.update();
  }

  update(): void {
    const account = this.ctx.session.account;
    this.loginItem.text = account ? `$(account) ${BRAND.statusBarPrefix}: ${account.name}` : `$(sign-in) ${BRAND.statusBarPrefix}: 未登录`;
    this.loginItem.tooltip = account ? `已登录（${account.id}）` : '点击登录学习通';

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
    const next = this.ctx.deadline.nextDdl(ddls, warnHours);
    if (next) {
      this.ddlItem.text = `$(clock) ${next.item.title.slice(0, 12)} ${formatRemaining(next.item.deadline)}`;
      this.ddlItem.tooltip = `${next.item.courseName} - ${next.item.title}\n截止倒计时`;
      this.ddlItem.backgroundColor = next.urgent ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
    } else {
      this.ddlItem.text = '$(check) 无待办截止';
      this.ddlItem.tooltip = '暂无未完成的作业/考试截止';
      this.ddlItem.backgroundColor = undefined;
    }

    const unread = this.ctx.state.unreadCount;
    this.noticeItem.text = `$(bell) ${unread}`;
    this.noticeItem.tooltip = `${unread} 条未读通知`;
    this.noticeItem.backgroundColor = unread > 0 ? new vscode.ThemeColor('statusBarItem.prominentBackground') : undefined;
  }

  /** 倒计时每分钟刷新 */
  startAutoRefresh(): void {
    this.timer = setInterval(() => {
      try {
        this.update();
      } catch {
        // 状态栏刷新失败不影响主流程
      }
    }, 60_000);
  }

  dispose(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    this.loginItem.dispose();
    this.ddlItem.dispose();
    this.noticeItem.dispose();
    this.settingsItem.dispose();
  }
}
