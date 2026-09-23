/**
 * 图形化设置面板：所有配置项以表单呈现，免命令面板操作。
 * 写入 workspace configuration（fanxing.*），API Key 写 SecretStorage。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { escapeHtml, htmlShell } from '../views/webview';

export class SettingsPanel {
  static current: SettingsPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(private readonly ctx: FanxingContext) {
    this.panel = vscode.window.createWebviewPanel('fanxing.settings', 'Fanxing 设置', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    this.panel.onDidDispose(() => {
      if (SettingsPanel.current === this) {
        SettingsPanel.current = undefined;
      }
    });
    this.panel.webview.onDidReceiveMessage((msg: { type: string; payload?: Record<string, unknown> }) => {
      void this.onMessage(msg).catch((err) => {
        this.ctx.logger.error('设置面板操作失败', String(err));
        void vscode.window.showErrorMessage(`Fanxing: ${String(err)}`);
      });
    });
  }

  static create(ctx: FanxingContext): SettingsPanel {
    SettingsPanel.current?.dispose();
    const panel = new SettingsPanel(ctx);
    SettingsPanel.current = panel;
    void panel.render();
    return panel;
  }

  dispose(): void {
    this.panel.dispose();
  }

  private async render(): Promise<void> {
    const s = this.ctx.settings;
    const account = this.ctx.session.account;
    const hasKey = !!(await this.ctx.store.getAiApiKey());

    const body = `
<div class="fx-header">
  <div class="fx-title">Fanxing 设置</div>
  <div class="fx-meta">${account ? `已登录：${escapeHtml(account.name)}（${escapeHtml(account.id)}）` : '未登录'}</div>
</div>

<div class="fx-toolbar">
  <button class="fx-btn" data-cmd="login">${account ? '切换账号' : '登录'}</button>
  <button class="fx-btn secondary" data-cmd="refresh">刷新数据</button>
  <button class="fx-btn secondary" data-cmd="env">检查运行环境</button>
  <button class="fx-btn secondary" data-cmd="exportIcs">导出日历(.ics)</button>
  ${account ? '<button class="fx-btn secondary" data-cmd="logout">退出登录</button>' : ''}
</div>

<div class="fx-section">
  <h2>账号</h2>
  <p class="fx-muted">登录状态、Cookie、密码全部保存在 VS Code SecretStorage，不写入配置文件。</p>
</div>

<div class="fx-section">
  <h2>AI 辅助（引导式，不代写答案）</h2>
  <table class="fx-table">
    <tr><td style="width:180px">启用 AI</td><td><input type="checkbox" id="ai.enabled" ${s.ai.enabled ? 'checked' : ''}></td></tr>
    <tr><td>API 地址</td><td><input id="ai.baseUrl" value="${escapeHtml(s.ai.baseUrl)}" style="width:95%"></td></tr>
    <tr><td>模型</td><td><input id="ai.model" value="${escapeHtml(s.ai.model)}" style="width:60%"></td></tr>
    <tr><td>API Key</td><td>
      <input id="ai.apikey" type="password" placeholder="${hasKey ? '已保存（留空保持不变）' : '未配置'}" style="width:60%">
      <button class="fx-btn secondary" data-cmd="clearKey">清除已存 Key</button>
    </td></tr>
    <tr><td>代理</td><td><input id="ai.proxy" value="${escapeHtml(s.ai.proxy)}" style="width:60%" placeholder="留空不使用"></td></tr>
    <tr><td>请求超时(ms)</td><td><input id="ai.requestTimeoutMs" type="number" value="${s.ai.requestTimeoutMs}"></td></tr>
  </table>
</div>

<div class="fx-section">
  <h2>作业与本地判题</h2>
  <table class="fx-table">
    <tr><td style="width:180px">默认语言</td><td>
      <select id="homework.defaultLanguage">
        ${['cpp', 'c', 'java', 'python']
          .map((l) => `<option value="${l}" ${s.defaultLanguage.id === l ? 'selected' : ''}>${l}</option>`)
          .join('')}
      </select>
    </td></tr>
    <tr><td>提交前强制本地测试</td><td><input type="checkbox" id="homework.forceLocalTestBeforeSubmit" ${s.forceLocalTest ? 'checked' : ''}></td></tr>
    <tr><td>截止预警(小时)</td><td><input id="homework.deadlineWarnHours" type="number" value="${s.deadlineWarnHours}"></td></tr>
    <tr><td>单用例超时(ms)</td><td><input id="judge.timeoutMs" type="number" value="${s.judgeTimeoutMs}"></td></tr>
    <tr><td>忽略行尾空白差异</td><td><input type="checkbox" id="judge.normalizeTrailingWhitespace" ${s.normalizeWhitespace ? 'checked' : ''}></td></tr>
    <tr><td>作业显示筛选</td><td>
      <select id="homework.showFilter">
        <option value="all" ${this.ctx.state.homeworkFilter === 'all' ? 'selected' : ''}>全部（含未开放/已完成）</option>
        <option value="pending" ${this.ctx.state.homeworkFilter === 'pending' ? 'selected' : ''}>仅待完成</option>
      </select>
    </td></tr>
  </table>
</div>

<div class="fx-section">
  <h2>通知 / 签到 / 公式 / 其他</h2>
  <table class="fx-table">
    <tr><td style="width:180px">通知轮询(分钟)</td><td><input id="notification.pollIntervalMinutes" type="number" value="${s.get('notification.pollIntervalMinutes', 5)}"></td></tr>
    <tr><td>签到检测(秒)</td><td><input id="signin.pollIntervalSeconds" type="number" value="${s.get('signin.pollIntervalSeconds', 60)}"></td></tr>
    <tr><td>签到提醒</td><td><input type="checkbox" id="signin.notifyOnNew" ${s.signinNotify ? 'checked' : ''}></td></tr>
    <tr><td>图片公式优先用 alt 还原</td><td><input type="checkbox" id="formula.preferLatexFromAlt" ${s.preferLatexFromAlt ? 'checked' : ''}></td></tr>
    <tr><td>公式 OCR 服务(可选)</td><td><input id="formula.ocrEndpoint" value="${escapeHtml(s.formulaOcrEndpoint)}" style="width:95%" placeholder="留空不启用"></td></tr>
    <tr><td>缓存有效期(分钟)</td><td><input id="cache.ttlMinutes" type="number" value="${s.get('cache.ttlMinutes', 30)}"></td></tr>
    <tr><td>资源下载目录</td><td><input id="download.targetDir" value="${escapeHtml(s.downloadTargetDir)}" style="width:60%"></td></tr>
    <tr><td>界面语言</td><td>
      <select id="locale">
        <option value="auto" ${s.locale === 'auto' ? 'selected' : ''}>跟随 VS Code</option>
        <option value="zh" ${s.locale === 'zh' ? 'selected' : ''}>中文</option>
        <option value="en" ${s.locale === 'en' ? 'selected' : ''}>English</option>
      </select>
    </td></tr>
    <tr><td>日志级别</td><td>
      <select id="log.level">
        ${['debug', 'info', 'warn', 'error'].map((l) => `<option value="${l}" ${s.logLevel === l ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </td></tr>
  </table>
</div>

<div class="fx-toolbar">
  <button class="fx-btn" data-cmd="save">保存设置</button>
  <button class="fx-btn secondary" data-cmd="openJson">打开 settings.json</button>
</div>`;

    const script = `
const vscode = acquireVsCodeApi();
document.body.addEventListener('click', function (e) {
  var btn = e.target.closest('button[data-cmd]');
  if (!btn) return;
  var cmd = btn.getAttribute('data-cmd');
  if (cmd === 'save') {
    var val = function (id) { var el = document.getElementById(id); return el ? el.value : undefined; };
    var chk = function (id) { var el = document.getElementById(id); return el ? el.checked : undefined; };
    vscode.postMessage({
      type: 'save',
      payload: {
        'ai.enabled': chk('ai.enabled'),
        'ai.baseUrl': val('ai.baseUrl'),
        'ai.model': val('ai.model'),
        'ai.proxy': val('ai.proxy'),
        'ai.requestTimeoutMs': Number(val('ai.requestTimeoutMs')),
        'ai.apikey': val('ai.apikey'),
        'homework.defaultLanguage': val('homework.defaultLanguage'),
        'homework.forceLocalTestBeforeSubmit': chk('homework.forceLocalTestBeforeSubmit'),
        'homework.deadlineWarnHours': Number(val('homework.deadlineWarnHours')),
        'homework.showFilter': val('homework.showFilter'),
        'judge.timeoutMs': Number(val('judge.timeoutMs')),
        'judge.normalizeTrailingWhitespace': chk('judge.normalizeTrailingWhitespace'),
        'notification.pollIntervalMinutes': Number(val('notification.pollIntervalMinutes')),
        'signin.pollIntervalSeconds': Number(val('signin.pollIntervalSeconds')),
        'signin.notifyOnNew': chk('signin.notifyOnNew'),
        'formula.preferLatexFromAlt': chk('formula.preferLatexFromAlt'),
        'formula.ocrEndpoint': val('formula.ocrEndpoint'),
        'cache.ttlMinutes': Number(val('cache.ttlMinutes')),
        'download.targetDir': val('download.targetDir'),
        'locale': val('locale'),
        'log.level': val('log.level')
      }
    });
  } else {
    vscode.postMessage({ type: cmd });
  }
});
`;
    this.panel.webview.html = htmlShell(this.panel.webview, { title: 'Fanxing 设置', body, script });
  }

  private async onMessage(msg: { type: string; payload?: Record<string, unknown> }): Promise<void> {
    const cfg = vscode.workspace.getConfiguration('fanxing');
    const global = vscode.ConfigurationTarget.Global;

    switch (msg.type) {
      case 'save': {
        const payload = msg.payload ?? {};
        const apiKey = payload['ai.apikey'];
        delete payload['ai.apikey'];
        // 作业显示筛选是会话级偏好（非配置项）
        const filter = payload['homework.showFilter'];
        delete payload['homework.showFilter'];

        for (const [key, value] of Object.entries(payload)) {
          if (value === undefined) {
            continue;
          }
          await cfg.update(key, value, global);
        }
        if (typeof apiKey === 'string' && apiKey.trim()) {
          await this.ctx.store.setAiApiKey(apiKey.trim());
        }
        if (filter === 'all' || filter === 'pending') {
          this.ctx.state.homeworkFilter = filter;
          await this.ctx.context.globalState.update('fanxing.homeworkFilter', filter);
          this.ctx.fireHomeworkFilterChanged();
        }
        void vscode.window.showInformationMessage('Fanxing 设置已保存');
        await this.render();
        break;
      }
      case 'clearKey':
        await this.ctx.store.clearAiApiKey();
        void vscode.window.showInformationMessage('已清除保存的 API Key');
        await this.render();
        break;
      case 'login':
        await vscode.commands.executeCommand('fanxing.login');
        break;
      case 'logout':
        await vscode.commands.executeCommand('fanxing.logout');
        await this.render();
        break;
      case 'refresh':
        await vscode.commands.executeCommand('fanxing.refreshCourses');
        break;
      case 'env':
        await vscode.commands.executeCommand('fanxing.checkEnvironment');
        break;
      case 'exportIcs':
        await vscode.commands.executeCommand('fanxing.exportDeadlines');
        break;
      case 'openJson':
        await vscode.commands.executeCommand('workbench.action.openSettingsJson');
        break;
    }
  }
}
