/**
 * 成绩面板：分项成绩 + 趋势条形图（纯 CSS，主题自适应）。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { escapeHtml, htmlShell } from '../views/webview';

export class GradesPanel {
  static current: GradesPanel | undefined;
  private readonly panel: vscode.WebviewPanel;

  private constructor(
    private readonly ctx: FanxingContext,
    private readonly courseId: string | undefined
  ) {
    this.panel = vscode.window.createWebviewPanel('fanxing.grades', '成绩', vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true
    });
    this.panel.onDidDispose(() => {
      if (GradesPanel.current === this) {
        GradesPanel.current = undefined;
      }
    });
  }

  static create(ctx: FanxingContext, courseId?: string): GradesPanel {
    GradesPanel.current?.dispose();
    const panel = new GradesPanel(ctx, courseId);
    GradesPanel.current = panel;
    panel.refresh();
    return panel;
  }

  refresh(): void {
    this.panel.webview.html = this.render(this.panel.webview);
  }

  dispose(): void {
    this.panel.dispose();
  }

  private render(webview: vscode.Webview): string {
    const grades = this.courseId
      ? this.ctx.state.grades.filter((g) => g.courseId === this.courseId)
      : this.ctx.state.grades;

    const sections = grades.length
      ? grades
          .map((g) => {
            const maxScore = Math.max(100, ...g.items.map((i) => i.score));
            const bars = g.items
              .map((item) => {
                const pct = Math.max(0, Math.min(100, (item.score / maxScore) * 100));
                return `
            <div>
              <div>${escapeHtml(item.name)} <span class="fx-muted">${item.score} 分${
                item.weight !== undefined ? ` · 权重 ${item.weight}%` : ''
              }</span></div>
              <div class="fx-bar-track"><div class="fx-bar-fill" style="width:${pct}%"></div></div>
            </div>`;
              })
              .join('');
            return `
        <div class="fx-section">
          <h2>${escapeHtml(g.courseName)}</h2>
          ${g.total !== undefined ? `<p>总评 <strong>${g.total}</strong>${g.rank ? ` · 排名 ${escapeHtml(g.rank)}` : ''}</p>` : ''}
          ${bars || '<p class="fx-muted">暂无分项成绩</p>'}
        </div>`;
          })
          .join('')
      : '<p class="fx-muted">暂无成绩数据，请先在命令面板执行「刷新成绩」。</p>';

    const body = `<div class="fx-header"><div class="fx-title">成绩</div></div>${sections}`;
    return htmlShell(webview, { title: '成绩', body });
  }
}
