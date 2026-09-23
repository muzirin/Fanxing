/**
 * 课程模块：课程列表、章节树、任务点、进度。
 */
import { ENDPOINTS } from '../config/constants';
import { parsePercent, stripHtml, tryParseJson } from '../utils/text';
import { HttpClient } from './client';
import { getCoursePageContext } from './coursePage';
import { parseChapterHtml, parseStudentCourse, parseTaskCards } from './parsers';
import { Chapter, Course, TaskPoint } from './types';
import { Logger } from '../services/logger';

export { parseChapterHtml, parseStudentCourse, parseTaskCards } from './parsers';

export interface CourseContent {
  chapters: Chapter[];
  progress?: { done: number; total: number };
}

interface RawCourseChannel {
  content?: {
    id?: number | string;
    cpi?: number | string;
    course?: { data?: Array<Record<string, unknown>> };
    isFiled?: number;
    app?: number;
    state?: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export class CourseApi {
  constructor(private readonly http: HttpClient, private readonly logger: Logger) {}

  /** 课程列表（backclazzdata JSON） */
  async listCourses(): Promise<Course[]> {
    const text = await this.http.getHtml(`${ENDPOINTS.courseList}?rss=1`);
    const json = tryParseJson<{ result?: number; channelList?: RawCourseChannel[] }>(text);
    const out: Course[] = [];
    if (!json?.channelList) {
      this.logger.warn('课程接口响应异常（channelList 缺失）');
      return out;
    }
    for (const channel of json.channelList) {
      const content = channel.content;
      if (!content) {
        continue;
      }
      const courseData = content.course?.data?.[0];
      if (!courseData) {
        continue;
      }
      const c = courseData;
      const state = Number(content.state ?? 0);
      out.push({
        courseId: String(c['id'] ?? ''),
        clazzId: String(content.id ?? ''),
        cpi: String(content.cpi ?? ''),
        name: String(c['name'] ?? c['coursename'] ?? '未命名课程'),
        teacher: String(c['teacherfactorname'] ?? c['teachername'] ?? c['names'] ?? ''),
        coverUrl: c['imageurl'] ? String(c['imageurl']) : undefined,
        status: state === 3 ? 'ended' : 'active',
        progress: parsePercent((c['progress'] as string | undefined) ?? undefined),
        term: c['startdate'] ? String(c['startdate']).slice(0, 11) : undefined,
        isFavorite: Number(content.app ?? 0) === 1
      });
    }
    return out;
  }

  /** 章节页内容：章节树 + 任务点进度（studentcourse，旧布局回退 stucoursemiddle） */
  async loadCourseContent(course: Course): Promise<CourseContent> {
    const page = await getCoursePageContext(this.http, this.logger, course);
    const encQs =
      `${page.enc ? `&enc=${encodeURIComponent(page.enc)}` : ''}` +
      `${page.openc ? `&openc=${encodeURIComponent(page.openc)}` : ''}`;
    try {
      const url =
        `${ENDPOINTS.studentCourse}?courseid=${course.courseId}` +
        `&clazzid=${course.clazzId}&cpi=${course.cpi}${encQs}&fromMiddle=1&ut=s`;
      const html = await this.http.getHtml(url);
      const info = parseStudentCourse(html);
      if (info.chapters.length || info.progress) {
        this.logger.debug(`[${course.name}] 章节 ${info.chapters.length} 个，进度 ${info.progress ? `${info.progress.done}/${info.progress.total}` : '-'}`);
        return info;
      }
    } catch (err) {
      this.logger.debug('studentcourse 拉取失败，回退 stucoursemiddle', String(err));
    }
    const html = await this.http.getHtml(this.chapterUrl(course));
    const chapters = parseChapterHtml(html);
    const text = stripHtml(html);
    const m =
      /已完成任务点[^0-9]*(\d+)\s*[\/／]\s*(\d+)/.exec(text) ?? /已完成\s*(\d+)\s*个?任务点?[^0-9]*(\d+)/.exec(text);
    return {
      chapters,
      progress: m ? { done: parseInt(m[1], 10), total: parseInt(m[2], 10) } : undefined
    };
  }

  /** 章节树 + 任务点（HTML 解析，尽力而为） */
  async listChapters(course: Course): Promise<Chapter[]> {
    return (await this.loadCourseContent(course)).chapters;
  }

  /** 课程进度（任务点完成统计） */
  async getProgress(course: Course): Promise<{ done: number; total: number } | undefined> {
    try {
      return (await this.loadCourseContent(course)).progress;
    } catch (err) {
      this.logger.debug('getProgress failed', String(err));
    }
    return undefined;
  }

  /** 小节任务点（knowledge/cards mArg），失败时回退章节页解析结果 */
  async listTasks(course: Course, chapter: Chapter): Promise<TaskPoint[]> {
    try {
      const url =
        `${ENDPOINTS.chapterCards}?clazzid=${course.clazzId}&courseid=${course.courseId}` +
        `&knowledgeid=${chapter.id}&num=0&ut=s&cpi=${course.cpi}`;
      const html = await this.http.getHtml(url);
      const info = parseTaskCards(html);
      if (info.tasks.length) {
        this.logger.debug(`[${course.name}] 章节 ${chapter.name} 任务点 ${info.tasks.length} 个`);
        return info.tasks;
      }
    } catch (err) {
      this.logger.debug('knowledge/cards 拉取失败', String(err));
    }
    return chapter.tasks;
  }

  private chapterUrl(course: Course): string {
    return (
      `${ENDPOINTS.chapterList}?courseid=${course.courseId}` +
      `&clazzid=${course.clazzId}&vc=1&cpi=${course.cpi}&ismooc2=1`
    );
  }
}
