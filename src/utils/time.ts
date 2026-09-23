/**
 * 时间与 DDL 工具（无 vscode 依赖，可单测）。
 */
import { DdlItem } from '../api/types';

export function formatDateTime(ts: number): string {
  if (!ts) {
    return '-';
  }
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function formatRemaining(deadline: number, now: number = Date.now()): string {
  if (!deadline) {
    return '无截止时间';
  }
  const diff = deadline - now;
  if (diff <= 0) {
    return '已截止';
  }
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(hours / 24);
  if (days >= 1) {
    return `${days} 天 ${hours % 24} 小时`;
  }
  if (hours >= 1) {
    return `${hours} 小时 ${Math.floor((diff % 3_600_000) / 60_000)} 分钟`;
  }
  return `${Math.max(1, Math.floor(diff / 60_000))} 分钟`;
}

export function isNearDeadline(deadline: number, warnHours: number, now: number = Date.now()): boolean {
  if (!deadline) {
    return false;
  }
  const diff = deadline - now;
  return diff > 0 && diff <= warnHours * 3_600_000;
}

function escapeIcs(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

function icsDate(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}` +
    `T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
  );
}

/** 导出 DDL 列表为 .ics 日历文件内容 */
export function buildIcs(items: DdlItem[], calendarName = 'Fanxing DDL'): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:-//Fanxing//DDL//CN`,
    `X-WR-CALNAME:${escapeIcs(calendarName)}`,
    'CALSCALE:GREGORIAN'
  ];
  for (const item of items) {
    const start = item.deadline;
    // 提前 24 小时提醒
    const alarmRef = `fanxing-ddl-${item.id}`;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${alarmRef}@fanxing`,
      `DTSTAMP:${icsDate(Date.now())}`,
      `DTSTART:${icsDate(start)}`,
      `DTEND:${icsDate(start + 30 * 60_000)}`,
      `SUMMARY:${escapeIcs(`[${item.courseName}] ${item.title}`)}`,
      `DESCRIPTION:${escapeIcs(`类型: ${item.kind}\\n课程: ${item.courseName}`)}`,
      'BEGIN:VALARM',
      'TRIGGER:-PT24H',
      'ACTION:DISPLAY',
      `DESCRIPTION:${escapeIcs('作业即将截止')}`,
      'END:VALARM',
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}
