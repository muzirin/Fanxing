/**
 * CodeLens：在解题文件顶部提供「本地测试 / 提交到学习通 / AI 审查 / AI 思路引导」。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';

export class FanxingCodeLensProvider implements vscode.CodeLensProvider {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.emitter.event;

  constructor(private readonly ctx: FanxingContext) {}

  refresh(): void {
    this.emitter.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    const ws = this.findWorkspace(document.fileName);
    if (!ws) {
      return [];
    }
    const range = new vscode.Range(0, 0, 0, 0);
    return [
      new vscode.CodeLens(range, {
        title: '$(play) 本地测试',
        command: 'fanxing.runLocalTest',
        arguments: [document.uri]
      }),
      new vscode.CodeLens(range, {
        title: '$(upload) 提交到学习通',
        command: 'fanxing.submitAssignment',
        arguments: [document.uri]
      }),
      new vscode.CodeLens(range, {
        title: '$(inspect) AI 代码审查',
        command: 'fanxing.aiReview',
        arguments: [document.uri]
      }),
      new vscode.CodeLens(range, {
        title: '$(lightbulb) AI 思路引导',
        command: 'fanxing.aiHint',
        arguments: [document.uri]
      })
    ];
  }

  private findWorkspace(fileName: string): import('../context').ProblemWorkspace | undefined {
    for (const ws of this.ctx.state.workspaces.values()) {
      if (fileName.startsWith(ws.dir)) {
        return ws;
      }
    }
    return undefined;
  }
}
