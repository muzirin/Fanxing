/**
 * 成绩模块：分项成绩与总评。
 */
import { ENDPOINTS } from '../config/constants';
import { stripHtml, tryParseJson } from '../utils/text';
import { HttpClient } from './client';
import { GradeItem } from './types';
import { Logger } from '../services/logger';

export class GradeApi {
  constructor(private readonly http: HttpClient, private readonly logger: Logger) {}

  async getGrades(course: { courseId: string; clazzId: string; cpi: string; name: string }): Promise<GradeItem | undefined> {
    const url = `${ENDPOINTS.gradeList}?courseId=${course.courseId}&classId=${course.clazzId}&cpi=${course.cpi}&ut=s`;
    let text: string;
    try {
      text = await this.http.getHtml(url);
    } catch (err) {
      this.logger.warn('成绩接口请求失败', String(err));
      return undefined;
    }

    const json = tryParseJson<{ data?: Array<{ name?: string; score?: number | string; weight?: number | string }>; total?: number | string; rank?: string }>(
      text
    );
    const items: GradeItem['items'] = [];
    if (json?.data && Array.isArray(json.data)) {
      for (const raw of json.data) {
        items.push({
          name: raw.name ?? '',
          score: Number(raw.score ?? 0),
          weight: raw.weight !== undefined ? Number(raw.weight) : undefined
        });
      }
      return {
        courseId: course.courseId,
        courseName: course.name,
        items,
        total: json.total !== undefined ? Number(json.total) : undefined,
        rank: json.rank
      };
    }

    // HTML 兜底解析
    const plain = stripHtml(text);
    const re = /([^\d\n]{2,20})\s*[::]?\s*(\d+(?:\.\d+)?)\s*分?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(plain)) !== null) {
      const name = m[1].trim();
      if (/成绩|得分|平时|作业|考试|总评|考勤|测验/.test(name)) {
        items.push({ name, score: parseFloat(m[2]) });
      }
    }
    if (!items.length) {
      return undefined;
    }
    return { courseId: course.courseId, courseName: course.name, items };
  }
}
