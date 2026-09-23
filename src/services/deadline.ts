/**
 * DDL / 日程管理：汇总作业与考试截止时间，倒计时、.ics 导出。
 */
import { DdlItem, Homework, NoticeItem } from '../api/types';
import { isNearDeadline } from '../utils/time';

export class DeadlineService {
  /** 从作业列表汇总 DDL */
  collectFromHomework(homeworkByCourse: Array<{ courseName: string; courseId: string; items: Homework[] }>): DdlItem[] {
    const out: DdlItem[] = [];
    for (const group of homeworkByCourse) {
      for (const hw of group.items) {
        if (!hw.deadline || hw.submitted) {
          continue;
        }
        out.push({
          id: `hw-${hw.workId}`,
          title: hw.title,
          kind: 'homework',
          courseId: group.courseId,
          courseName: group.courseName,
          deadline: hw.deadline
        });
      }
    }
    return out;
  }

  /** 从通知中提取考试类 DDL */
  collectFromNotices(notices: NoticeItem[]): DdlItem[] {
    const out: DdlItem[] = [];
    for (const n of notices) {
      if (n.category !== 'exam' || !n.publishTime) {
        continue;
      }
      const text = n.contentHtml ?? n.title;
      const m = /(\d{4}[-/]\d{1,2}[-/]\d{1,2}[ T]\d{1,2}:\d{2}(?::\d{2})?)/.exec(text);
      if (!m) {
        continue;
      }
      const t = Date.parse(m[1].replace(/-/g, '/'));
      if (Number.isNaN(t)) {
        continue;
      }
      out.push({
        id: `exam-${n.id}`,
        title: n.title,
        kind: 'exam',
        courseId: n.courseId ?? '',
        courseName: n.courseName ?? '未知课程',
        deadline: t
      });
    }
    return out;
  }

  /** 合并去重并按时间排序 */
  merge(...groups: DdlItem[][]): DdlItem[] {
    const map = new Map<string, DdlItem>();
    for (const group of groups) {
      for (const item of group) {
        map.set(item.id, item);
      }
    }
    return [...map.values()].sort((a, b) => a.deadline - b.deadline);
  }

  /** 最近一个未完成 DDL 的倒计时描述（状态栏用） */
  nextDdl(items: DdlItem[], warnHours: number): { item: DdlItem; urgent: boolean } | undefined {
    const now = Date.now();
    const upcoming = items.filter((i) => i.deadline > now);
    if (!upcoming.length) {
      return undefined;
    }
    const item = upcoming[0];
    return { item, urgent: isNearDeadline(item.deadline, warnHours, now) };
  }
}
