import assert from 'assert';
import { DdlItem } from '../src/api/types';
import { buildIcs, formatRemaining, isNearDeadline } from '../src/utils/time';

describe('utils/time', () => {
  const now = Date.parse('2026/09/23 10:00:00');

  it('formatRemaining 计算倒计时', () => {
    assert.strictEqual(formatRemaining(now + 3600_000, now), '1 小时 0 分钟');
    assert.strictEqual(formatRemaining(now + 86400_000, now), '1 天 0 小时');
    assert.strictEqual(formatRemaining(now - 1, now), '已截止');
    assert.strictEqual(formatRemaining(0, now), '无截止时间');
  });

  it('isNearDeadline 预警阈值', () => {
    assert.ok(isNearDeadline(now + 12 * 3600_000, 24, now));
    assert.ok(!isNearDeadline(now + 48 * 3600_000, 24, now));
    assert.ok(!isNearDeadline(0, 24, now));
  });

  it('buildIcs 生成合法日历', () => {
    const items: DdlItem[] = [
      {
        id: 'hw-1',
        title: '程序设计作业, 第3章',
        kind: 'homework',
        courseId: 'c1',
        courseName: '数据结构',
        deadline: now + 86400_000
      }
    ];
    const ics = buildIcs(items);
    assert.ok(ics.startsWith('BEGIN:VCALENDAR'));
    assert.ok(ics.includes('BEGIN:VEVENT'));
    assert.ok(ics.includes('DTSTART:'));
    assert.ok(ics.includes('BEGIN:VALARM'));
    assert.ok(ics.includes('\\,')); // 逗号转义
    assert.ok(ics.trimEnd().endsWith('END:VCALENDAR'));
  });
});
