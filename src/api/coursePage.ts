/**
 * 课程中间页上下文：enc / workEnc / 作业与考试 tab 直链（作业列表与章节页均依赖），进程内缓存。
 */
import { ENDPOINTS } from '../config/constants';
import { HttpClient } from './client';
import { CoursePageContext, parseCoursePage } from './parsers';
import { Logger } from '../services/logger';

interface CacheEntry {
  at: number;
  ctx: CoursePageContext;
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, CacheEntry>();

export async function getCoursePageContext(
  http: HttpClient,
  logger: Logger,
  course: { courseId: string; clazzId: string; cpi: string }
): Promise<CoursePageContext> {
  const key = `${course.courseId}-${course.clazzId}-${course.cpi}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.ctx;
  }
  const url =
    `${ENDPOINTS.courseMiddle}?courseid=${course.courseId}` +
    `&clazzid=${course.clazzId}&vc=1&cpi=${course.cpi}&ismooc2=1&v=2`;
  try {
    const html = await http.getHtml(url);
    const ctx = parseCoursePage(html);
    cache.set(key, { at: Date.now(), ctx });
    logger.debug(`课程中间页 ${course.courseId}: enc=${ctx.enc ? 'ok' : '-'} workEnc=${ctx.workEnc ? 'ok' : '-'} workTab=${ctx.workListUrl ? 'ok' : '-'}`);
    return ctx;
  } catch (err) {
    logger.debug('课程中间页获取失败', String(err));
    return {};
  }
}

export function clearCoursePageCache(): void {
  cache.clear();
}
