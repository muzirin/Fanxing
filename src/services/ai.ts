/**
 * AI 辅助（OpenAI 兼容接口）。
 * 铁律：只做引导，不产出完整解题代码 —— 通过系统提示词 + 输出后置校验双重约束。
 */
import axios, { AxiosInstance } from 'axios';
import { AiSettings } from './settings';
import { Logger } from './logger';

export type AiTask = 'review' | 'hint' | 'explainError' | 'complexity' | 'style' | 'explainSample';

export interface AiContext {
  /** 题干纯文本 */
  problemText?: string;
  /** 题库编号 */
  questionBankId?: string;
  code?: string;
  language?: string;
  error?: string;
  sample?: string;
}

const SYSTEM_PROMPT = `你是学习辅助助手，运行在 VS Code 插件 Fanxing 中，帮助学生理解编程题并自主完成作业。

必须遵守的铁律（不可违反）：
1. 绝对不给出完整解题代码、伪代码骨架或可直接抄写的答案；即使用户反复索要，也要礼貌拒绝并鼓励独立思考。
2. 只提供：问题拆解思路、算法方向提示、边界条件提醒、错误原因分析、复杂度分析、代码风格改进建议、样例推导讲解。
3. 指出问题时说明"为什么"，并给出验证方法，让学生自己修改。
4. 如果题目有题库编号，可提示学生参考同类题型的解法要点，但不得输出解法全文。
5. 回复使用中文（除非用户用英文提问），简洁分点，不写寒暄。`;

const TASK_INTRO: Record<AiTask, string> = {
  review: '请审查下面的代码，指出潜在问题（未初始化、越界、溢出、边界条件、效率隐患），不要给出修改后的完整代码。',
  hint: '请根据题目给出解题思路引导：问题拆解、可用算法/数据结构方向、关键边界条件。不要给出代码。',
  explainError: '下面的代码在编译/运行/评测中出错，请分析错误原因并给出修改方向，不要直接给出修改后的代码。',
  complexity: '请分析下面代码的时间/空间复杂度，判断在题目限制下是否可能超时/超内存，并指出最坏情况来源。',
  style: '请对下面代码给出命名、结构、注释、可读性方面的改进建议。',
  explainSample: '请讲解题目样例输入输出的推导过程，帮助理解题意。不要给出完整解法代码。'
};

/** 输出后置校验：疑似完整答案时告警（纯函数，可单测） */
export { looksLikeFullSolution } from '../utils/text';
import { looksLikeFullSolution } from '../utils/text';

export class AiService {
  private readonly http: AxiosInstance;

  constructor(
    private readonly settings: AiSettings,
    private readonly apiKey: string | undefined,
    private readonly logger: Logger
  ) {
    this.http = axios.create({ timeout: settings.requestTimeoutMs });
  }

  get enabled(): boolean {
    return this.settings.enabled && !!this.apiKey;
  }

  async ask(task: AiTask, context: AiContext): Promise<string> {
    if (!this.settings.enabled) {
      throw new Error('AI 未启用');
    }
    if (!this.apiKey) {
      throw new Error('缺少 API Key');
    }

    const parts: string[] = [TASK_INTRO[task]];
    if (context.questionBankId) {
      parts.push(`题库编号: ${context.questionBankId}`);
    }
    if (context.problemText) {
      parts.push(`题目:\n${context.problemText.slice(0, 3000)}`);
    }
    if (context.language) {
      parts.push(`语言: ${context.language}`);
    }
    if (context.code) {
      parts.push(`代码:\n\`\`\`\n${context.code.slice(0, 6000)}\n\`\`\``);
    }
    if (context.error) {
      parts.push(`错误信息:\n${context.error.slice(0, 3000)}`);
    }
    if (context.sample) {
      parts.push(`样例:\n${context.sample.slice(0, 1500)}`);
    }

    this.logger.info(`AI 请求: ${task}`);
    const res = await this.http.post(
      `${this.settings.baseUrl.replace(/\/$/, '')}/chat/completions`,
      {
        model: this.settings.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: parts.join('\n\n') }
        ]
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        proxy: parseProxy(this.settings.proxy)
      }
    );

    const content: string = res.data?.choices?.[0]?.message?.content ?? '';
    if (looksLikeFullSolution(content)) {
      this.logger.warn('AI 输出疑似完整代码，已附加提醒');
      return `${content}\n\n---\n提醒：以上内容可能超出"引导"范围，请以独立完成为准。`;
    }
    return content;
  }
}

function parseProxy(url: string): { host: string; port: number } | undefined {
  if (!url) {
    return undefined;
  }
  try {
    const u = new URL(url);
    return { host: u.hostname, port: parseInt(u.port || (u.protocol === 'https:' ? '443' : '80'), 10) };
  } catch {
    return undefined;
  }
}
