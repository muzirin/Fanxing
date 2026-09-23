/**
 * Fanxing（泛星）扩展入口：装配服务、注册视图/命令、启动轮询与首次环境检查。
 */
import * as vscode from 'vscode';
import { FanxingContext } from './context';
import { Workbench, UiRefresher } from './workbench';
import { CourseTreeProvider } from './providers/courseTree';
import { HomeworkTreeProvider } from './providers/homeworkTree';
import { NotificationTreeProvider } from './providers/notificationTree';
import { SignInTreeProvider, GradeTreeProvider, DdlTreeProvider } from './providers/activityTrees';
import { DashboardViewProvider } from './providers/dashboardView';
import { StatusBarController } from './providers/statusBar';
import { FanxingCodeLensProvider } from './providers/codeLens';
import { BRAND } from './config/constants';

const FLAG_ENV_CHECKED = 'fanxing.envCheckedOnce';

export function activate(context: vscode.ExtensionContext): void {
  const ctx = new FanxingContext(context);

  // 视图
  const courseTree = new CourseTreeProvider(ctx);
  const homeworkTree = new HomeworkTreeProvider(ctx);
  const notificationTree = new NotificationTreeProvider(ctx);
  const signInTree = new SignInTreeProvider(ctx);
  const gradeTree = new GradeTreeProvider(ctx);
  const ddlTree = new DdlTreeProvider(ctx);
  const dashboard = new DashboardViewProvider(ctx);
  const statusBar = new StatusBarController(ctx);
  const codeLens = new FanxingCodeLensProvider(ctx);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('fanxing.courses', courseTree),
    vscode.window.registerTreeDataProvider('fanxing.homework', homeworkTree),
    vscode.window.registerTreeDataProvider('fanxing.notifications', notificationTree),
    vscode.window.registerTreeDataProvider('fanxing.signin', signInTree),
    vscode.window.registerTreeDataProvider('fanxing.grades', gradeTree),
    vscode.window.registerTreeDataProvider('fanxing.ddl', ddlTree),
    vscode.window.registerWebviewViewProvider(DashboardViewProvider.viewType, dashboard),
    vscode.languages.registerCodeLensProvider(
      [{ language: 'c' }, { language: 'cpp' }, { language: 'java' }, { language: 'python' }],
      codeLens
    ),
    statusBar,
    ctx.logger.output
  );

  const ui: UiRefresher = {
    refreshCourses: () => courseTree.refresh(),
    refreshHomework: () => homeworkTree.refresh(),
    refreshNotifications: () => notificationTree.refresh(),
    refreshSignIn: () => signInTree.refresh(),
    refreshGrades: () => gradeTree.refresh(),
    refreshDdl: () => ddlTree.refresh(),
    refreshDashboard: () => dashboard.refresh(),
    updateStatusBar: () => statusBar.update(),
    refreshCodeLens: () => codeLens.refresh()
  };

  const workbench = new Workbench(ctx, ui);
  workbench.registerCommands(context);

  // 会话变化 -> 状态栏
  context.subscriptions.push(ctx.session.onDidChange(() => statusBar.update()));

  // 配置变化 -> 日志级别 / 各视图
  context.subscriptions.push(
    ctx.settings.onChange(() => {
      ctx.logger.setLevel(ctx.settings.logLevel);
      ui.refreshDdl();
      ui.refreshDashboard();
      ui.updateStatusBar();
    })
  );

  statusBar.startAutoRefresh();

  // 恢复登录态
  void ctx.session
    .restore()
    .then(async (ok) => {
      if (ok) {
        ctx.logger.info('已恢复登录态', ctx.session.account?.name);
        await workbench.refreshAll();
        void workbench.refreshSignActivities().catch((err) => ctx.logger.debug('签到检测失败', String(err)));
      } else {
        ctx.logger.info('未登录，可在侧边栏或命令面板执行 Fanxing: 登录');
      }
      ui.updateStatusBar();

      // 首次使用：运行环境检测
      if (!context.globalState.get(FLAG_ENV_CHECKED)) {
        await context.globalState.update(FLAG_ENV_CHECKED, true);
        void workbench.checkEnvironment();
      }
    })
    .catch((err) => {
      ctx.logger.error('启动恢复失败', String(err));
    });

  // 通知轮询
  const notifyTimer = setInterval(() => {
    if (ctx.session.isLoggedIn) {
      void workbench.checkNotifications().catch((err) => ctx.logger.debug('通知轮询失败', String(err)));
    }
  }, ctx.settings.notificationPollMs);

  // 签到检测轮询
  const signInTimer = setInterval(() => {
    void workbench.refreshSignActivities().catch((err) => ctx.logger.debug('签到轮询失败', String(err)));
  }, ctx.settings.signinPollMs);

  context.subscriptions.push({
    dispose: () => {
      clearInterval(notifyTimer);
      clearInterval(signInTimer);
    }
  });

  ctx.logger.info(`${BRAND.name} (${BRAND.nameZh}) 已激活`);
}

export function deactivate(): void {
  // 资源由 subscriptions 统一释放
}
