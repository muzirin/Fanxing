/**
 * OJ 模块：编程题作答结构、提交与判题结果轮询。
 */
import { QuestionType } from '../config/constants';
import { Problem } from './types';
import { HomeworkApi } from './homework';
import { Homework } from './types';
import { Logger } from '../services/logger';

export interface AnswerEntry {
  answer: string;
  answertype: number;
  questionId: number;
  questionScore: number;
  answerid: string;
  isRight: string;
  ownScore: number | null;
}

const ANSWER_TYPE_CODE: Record<QuestionType, number> = {
  [QuestionType.Single]: 0,
  [QuestionType.Multiple]: 1,
  [QuestionType.Judge]: 2,
  [QuestionType.Blank]: 3,
  [QuestionType.ShortAnswer]: 4,
  [QuestionType.Programming]: 5,
  [QuestionType.Unknown]: 0
};

/**
 * 按题型格式化作答内容（平台 answer 字段约定）。
 * - 单选: "A"；多选: "A,B"；判断: "true"/"false"；
 * - 填空: 多空以 "##" 分隔；简答: 纯文本。
 */
export function formatAnswer(type: QuestionType, value: string): string {
  const v = (value ?? '').trim();
  switch (type) {
    case QuestionType.Single:
      return v.toUpperCase();
    case QuestionType.Multiple:
      return v
        .split(/[,，\s]+/)
        .filter(Boolean)
        .map((k) => k.toUpperCase())
        .sort()
        .join(',');
    case QuestionType.Judge:
      return /^(true|t|对|正确|是|yes|y|1)$/i.test(v) ? 'true' : /^(false|f|错|错误|否|no|n|0)$/i.test(v) ? 'false' : v.toLowerCase();
    case QuestionType.Blank:
      return v.split(/\n|##/).map((x) => x.trim()).filter(Boolean).join('##');
    default:
      return v;
  }
}

export class OjApi {
  constructor(private readonly homeworkApi: HomeworkApi, private readonly logger: Logger) {}

  /** 组装 answerList JSON（提交格式见 docs/API-RESEARCH.md 3.4） */
  buildAnswerList(problems: Problem[], answers: Map<string, string>): string {
    const entries: AnswerEntry[] = problems.map((p) => ({
      answer: formatAnswer(p.type, answers.get(p.id) ?? ''),
      answertype: ANSWER_TYPE_CODE[p.type] ?? 0,
      questionId: Number(p.id.replace(/\D/g, '')) || 0,
      questionScore: p.score,
      answerid: '',
      isRight: '',
      ownScore: null
    }));
    return JSON.stringify(entries);
  }

  /** 提交单题编程作业（整份作业只有一个编程题时） */
  async submitCode(work: Homework, problems: Problem[], answers: Map<string, string>): Promise<{ ok: boolean; message: string }> {
    const totalScore = problems.reduce((sum, p) => sum + (p.score || 0), 0);
    const payload = this.buildAnswerList(problems, answers);
    this.logger.info(`提交作业 ${work.workId}（${problems.length} 题，合计 ${totalScore} 分）`);
    return await this.homeworkApi.submitWork(work, payload, totalScore);
  }

  /** 轮询平台判题结果 */
  async pollResult(work: Homework, attempts = 10, intervalMs = 5000): Promise<{ verdict: string; score?: number; message?: string }> {
    for (let i = 0; i < attempts; i++) {
      const result = await this.homeworkApi.fetchResult(work);
      if (result.verdict !== 'Judging') {
        return result;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    return { verdict: 'Judging', message: '判题仍在进行中，可稍后在作业列表刷新查看' };
  }
}
