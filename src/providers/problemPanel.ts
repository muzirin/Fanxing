/**
 * 作业面板（GUI 答题主界面）：
 * - 全部题型可视化：单选/多选/判断/填空/简答在面板内作答，程序设计走编辑器
 * - 全部状态可打开：未开放/已截止/已提交仅提示，不阻止浏览与预作答（选择权交给用户）
 * - KaTeX 公式 + 图片公式本地缓存 + 样例/限制/题库编号展示
 */
import * as vscode from 'vscode';
import * as path from 'path';
import { FanxingContext, ProblemWorkspace } from '../context';
import { QUESTION_TYPE_LABEL, QuestionType } from '../config/constants';
import { Problem } from '../api/types';
import { escapeHtml, htmlShell } from '../views/webview';

type UriMapper = (file: string) => string;

export class ProblemPanel {
  static current: ProblemPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly processedBodies = new Map<string, string>();

  private constructor(
    private readonly ctx: FanxingContext,
    private readonly ws: ProblemWorkspace
  ) {
    this.panel = vscode.window.createWebviewPanel('fanxing.problem', `作业: ${ws.homework.title}`, vscode.ViewColumn.Active, {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.file(ctx.problemsRoot),
        vscode.Uri.file(path.join(ctx.context.globalStorageUri.fsPath, 'images'))
      ]
    });
    this.panel.onDidDispose(() => {
      if (ProblemPanel.current === this) {
        ProblemPanel.current = undefined;
      }
    });
    this.panel.webview.onDidReceiveMessage((msg: { type: string; id?: string; value?: string }) => {
      void this.onMessage(msg).catch((err) => {
        this.ctx.logger.error('作业面板操作失败', String(err));
        void vscode.window.showErrorMessage(`Fanxing: ${String(err)}`);
      });
    });
  }

  static async create(ctx: FanxingContext, ws: ProblemWorkspace): Promise<ProblemPanel> {
    ProblemPanel.current?.dispose();
    const panel = new ProblemPanel(ctx, ws);
    ProblemPanel.current = panel;
    const mapper: UriMapper = (file) => panel.panel.webview.asWebviewUri(vscode.Uri.file(file)).toString();
    for (const problem of ws.problems) {
      panel.processedBodies.set(problem.id, await renderProblemBody(ctx, problem, mapper));
    }
    panel.refresh();
    return panel;
  }

  refresh(): void {
    this.panel.webview.html = this.render();
  }

  /** 测试/提交流程推送结果到面板（带 problemId 写入该题结果区，不带则广播到全部题目） */
  postResult(text: string, problemId?: string): void {
    try {
      void Promise.resolve(this.panel.webview.postMessage({ type: 'result', text, id: problemId })).catch(() => {});
    } catch {
      // 面板已销毁
    }
  }

  dispose(): void {
    this.panel.dispose();
  }

  private async onMessage(msg: { type: string; id?: string; value?: string }): Promise<void> {
    if (msg.type === 'answer' && msg.id !== undefined) {
      this.ws.answers.set(msg.id, msg.value ?? '');
      return;
    }
    const commandMap: Record<string, string> = {
      runTest: 'fanxing.runLocalTest',
      submit: 'fanxing.submitAssignment',
      addCase: 'fanxing.addTestCase',
      aiHint: 'fanxing.aiHint',
      aiReview: 'fanxing.aiReview',
      aiComplexity: 'fanxing.aiComplexity',
      aiExplainError: 'fanxing.aiExplainError',
      openFile: 'fanxing.openSourceFile'
    };
    const command = commandMap[msg.type];
    if (command) {
      const ref = msg.id ? { workId: this.ws.workId, problemId: msg.id } : this.ws;
      await vscode.commands.executeCommand(command, ref);
    }
  }

  private render(): string {
    const ws = this.ws;
    const isCode = ws.mode === 'code';
    const hw = ws.homework;

    const banner = hw.locked
      ? '<div class="fx-section"><span class="fx-tag warn">未开放</span> 教师尚未开放该作业。仍可浏览题目与预作答，是否提交由你决定。</div>'
      : hw.expired && !hw.submitted
        ? '<div class="fx-section"><span class="fx-tag warn">已截止</span> 该作业已过截止时间。仍可查看与练习，是否提交由你决定。</div>'
        : hw.submitted
          ? `<div class="fx-section"><span class="fx-tag ok">已提交${hw.marked ? ' / 已批改' : ''}</span> 你可以重新作答并再次提交${hw.multiSubmit ? '（允许多次提交）' : '（注意：可能覆盖原提交）'}。</div>`
          : '';

    const problemsHtml = ws.problems
      .map((p) => {
        const body = this.processedBodies.get(p.id) ?? p.contentHtml;
        const samples = (p.sampleTests ?? [])
          .map(
            (t, i) => `
        <tr>
          <td>样例 ${i + 1}</td>
          <td><pre><code>${escapeHtml(t.input)}</code></pre></td>
          <td><pre><code>${escapeHtml(t.expectedOutput)}</code></pre></td>
        </tr>`
          )
          .join('');
        const limits =
          p.limits && (p.limits.timeMs || p.limits.memoryMb)
            ? `时间限制 ${p.limits.timeMs ?? '-'} ms / 内存限制 ${p.limits.memoryMb ?? '-'} MB`
            : '';
        return `
      <div class="fx-section" id="problem-${escapeHtml(p.id)}">
        <h2>第 ${p.index} 题 · ${escapeHtml(QUESTION_TYPE_LABEL[p.type] ?? p.type)}${p.score ? ` · ${p.score} 分` : ''}</h2>
        <div class="fx-meta">
          ${p.questionBankId ? `<span class="fx-tag">题库编号 ${escapeHtml(p.questionBankId)}</span>` : ''}
          ${limits ? `<span class="fx-tag warn">${escapeHtml(limits)}</span>` : ''}
        </div>
        <div class="fx-stem">${body}</div>
        ${this.renderAnswerWidget(p)}
        ${samples ? `<table class="fx-table"><tr><th>用例</th><th>输入</th><th>期望输出</th></tr>${samples}</table>` : ''}
        ${p.templateCode ? `<h3>起始代码</h3><pre><code>${escapeHtml(p.templateCode)}</code></pre>` : ''}
        <h3>测试 / 提交结果</h3>
        <pre id="result-${escapeHtml(p.id)}" class="fx-muted">${
          p.type === QuestionType.Programming ? '点击「本地测试本题」运行样例，结果与控制台输出显示在此。' : '作答后点击「提交到学习通」，结果显示在此。'
        }</pre>
      </div>`;
      })
      .join('\n');

    const body = `
<div class="fx-header">
  <div class="fx-title">${escapeHtml(hw.title)}</div>
  <div class="fx-meta">
    <span class="fx-tag">${escapeHtml(hw.stateLabel ?? '')}</span>
    <span class="fx-tag">${isCode ? `${escapeHtml(ws.language)} 程序设计` : '面板作答'}</span>
    <span class="fx-tag">${ws.problems.length} 题</span>
    ${hw.deadline ? `<span class="fx-tag warn">截止 ${new Date(hw.deadline).toLocaleString()}</span>` : ''}
  </div>
</div>
${banner}
<div class="fx-toolbar">
  ${isCode ? '<button class="fx-btn" data-action="runTest">本地测试</button>' : ''}
  <button class="fx-btn" data-action="submit">提交到学习通</button>
  ${isCode ? '<button class="fx-btn secondary" data-action="addCase">添加测试用例</button>' : ''}
  ${isCode ? '<button class="fx-btn secondary" data-action="openFile">打开代码文件</button>' : ''}
</div>
<div class="fx-toolbar">
  <button class="fx-btn secondary" data-action="aiHint">AI 思路引导</button>
  <button class="fx-btn secondary" data-action="aiReview">AI 代码审查</button>
  <button class="fx-btn secondary" data-action="aiComplexity">AI 复杂度分析</button>
  <button class="fx-btn secondary" data-action="aiExplainError">AI 错误分析</button>
</div>
${problemsHtml}`;

    const script = `
const vscode = acquireVsCodeApi();
document.querySelectorAll('button[data-action]').forEach(function (btn) {
  btn.addEventListener('click', function () {
    vscode.postMessage({ type: btn.getAttribute('data-action'), id: btn.getAttribute('data-id') || undefined });
  });
});
// 作答控件 -> 实时回传答案
function sendAnswer(id) {
  return function () {
    var group = document.querySelectorAll('[data-qid="' + id + '"] input, [data-qid="' + id + '"] textarea');
    var value = '';
    var type = document.querySelector('[data-qid="' + id + '"]').getAttribute('data-qtype');
    if (type === 'multiple') {
      value = Array.prototype.filter.call(group, function (el) { return el.checked; })
        .map(function (el) { return el.value; }).join(',');
    } else if (type === 'single' || type === 'judge') {
      var checked = Array.prototype.find.call(group, function (el) { return el.checked; });
      value = checked ? checked.value : '';
    } else {
      value = group.length ? group[0].value : '';
    }
    vscode.postMessage({ type: 'answer', id: id, value: value });
  };
}
document.querySelectorAll('[data-qid]').forEach(function (block) {
  var id = block.getAttribute('data-qid');
  var handler = sendAnswer(id);
  block.querySelectorAll('input, textarea').forEach(function (el) {
    el.addEventListener('change', handler);
    el.addEventListener('input', handler);
  });
});
window.addEventListener('message', function (event) {
  var msg = event.data;
  if (msg && msg.type === 'result') {
    var targets = msg.id
      ? [document.getElementById('result-' + msg.id)]
      : Array.prototype.slice.call(document.querySelectorAll('pre[id^="result-"]'));
    targets.forEach(function (el) {
      if (!el) { return; }
      el.textContent = msg.text;
      el.classList.remove('fx-muted');
    });
    if (window.fxRenderMath) { window.fxRenderMath(); }
  }
});
`;
    return htmlShell(this.panel.webview, { title: hw.title, body, script });
  }

  /** 各题型作答控件（单选/多选/判断/填空/简答），预填已保存答案 */
  private renderAnswerWidget(p: Problem): string {
    const saved = this.ws.answers.get(p.id) ?? '';
    const attrs = `data-qid="${escapeHtml(p.id)}" data-qtype="${p.type}"`;
    switch (p.type) {
      case QuestionType.Single: {
        const options = (p.options ?? [])
          .map(
            (o) =>
              `<label><input type="radio" name="q-${escapeHtml(p.id)}" value="${escapeHtml(o.key)}" ${
                saved === o.key ? 'checked' : ''
              }> <strong>${escapeHtml(o.key)}</strong>. ${escapeHtml(o.text)}</label>`
          )
          .join('');
        return `<div class="fx-answer" ${attrs}>${options || '<span class="fx-muted">（未解析到选项，请对照网页端）</span>'}</div>`;
      }
      case QuestionType.Multiple: {
        const chosen = new Set(saved.split(',').filter(Boolean));
        const options = (p.options ?? [])
          .map(
            (o) =>
              `<label><input type="checkbox" name="q-${escapeHtml(p.id)}" value="${escapeHtml(o.key)}" ${
                chosen.has(o.key) ? 'checked' : ''
              }> <strong>${escapeHtml(o.key)}</strong>. ${escapeHtml(o.text)}</label>`
          )
          .join('');
        return `<div class="fx-answer" ${attrs}>${options || '<span class="fx-muted">（未解析到选项）</span>'}</div>`;
      }
      case QuestionType.Judge:
        return `<div class="fx-answer" ${attrs}>
          <label><input type="radio" name="q-${escapeHtml(p.id)}" value="true" ${saved === 'true' ? 'checked' : ''}> 正确</label>
          <label><input type="radio" name="q-${escapeHtml(p.id)}" value="false" ${saved === 'false' ? 'checked' : ''}> 错误</label>
        </div>`;
      case QuestionType.Blank:
        return `<div class="fx-answer" ${attrs}>
          <textarea rows="2" style="width:95%" placeholder="填空作答（多空请分多行）">${escapeHtml(saved)}</textarea>
        </div>`;
      case QuestionType.ShortAnswer:
        return `<div class="fx-answer" ${attrs}>
          <textarea rows="5" style="width:95%" placeholder="简答作答">${escapeHtml(saved)}</textarea>
        </div>`;
      case QuestionType.Programming: {
        const file = this.ws.sourceFiles.get(p.id);
        const label = file ? `${path.basename(path.dirname(file))}/${path.basename(file)}` : '代码文件';
        return `<div class="fx-answer" ${attrs}>
          <span class="fx-muted">程序设计题：代码写在 <code>${escapeHtml(label)}</code>，提交时自动附带本题代码。</span>
          <div>
            <button class="fx-btn secondary" data-action="openFile" data-id="${escapeHtml(p.id)}">打开代码文件</button>
            <button class="fx-btn secondary" data-action="runTest" data-id="${escapeHtml(p.id)}">本地测试本题</button>
            <button class="fx-btn secondary" data-action="addCase" data-id="${escapeHtml(p.id)}">添加本题用例</button>
          </div>
        </div>`;
      }
      default:
        return saved
          ? `<div class="fx-answer" ${attrs}><textarea rows="3" style="width:95%">${escapeHtml(saved)}</textarea></div>`
          : `<div class="fx-answer" ${attrs}><textarea rows="3" style="width:95%" placeholder="作答"></textarea></div>`;
    }
  }
}

/** 题干渲染：公式图 -> KaTeX 节点或本地缓存图片（webview URI） */
export async function renderProblemBody(ctx: FanxingContext, problem: Problem, toUri: UriMapper): Promise<string> {
  const processed = await ctx.formula.process(problem.contentHtml);
  return processed.html.replace(/<img[^>]*data-src="([^"]+)"[^>]*>/gi, (tag, src: string) => {
    const mapped = processed.imageMap[src];
    if (!mapped) {
      return tag;
    }
    if (mapped.startsWith('latex:')) {
      return `<span class="fx-formula" data-latex="${encodeURIComponent(mapped.slice(6))}"></span>`;
    }
    const file = path.join(ctx.context.globalStorageUri.fsPath, 'images', mapped);
    return `<img class="fx-image" src="${escapeHtml(toUri(file))}" alt="" />`;
  });
}
