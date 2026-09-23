import assert from 'assert';
import { QuestionType } from '../src/config/constants';
import {
  deadlineFromRemaining,
  detectHomeworkKind,
  detectQuestionType,
  extractRawNotices,
  extractTestCases,
  extractTemplateCode,
  homeworkFromTaskPoint,
  mapPlatformVerdict,
  mergeHomeworkLists,
  normalizeNotice,
  normalizeWork,
  parseChapterHtml,
  parseCoursePage,
  parseProblems,
  parseStudentCourse,
  parseTaskCards,
  parseWorkHtml,
  platformStateText,
  stateLabelOf
} from '../src/api/parsers';

describe('api/parsers', () => {
  it('detectQuestionType 识别题型', () => {
    assert.strictEqual(detectQuestionType('1. 编程题：两数之和'), QuestionType.Programming);
    assert.strictEqual(detectQuestionType('单选题：下列正确的是'), QuestionType.Single);
    assert.strictEqual(detectQuestionType('多选题'), QuestionType.Multiple);
    assert.strictEqual(detectQuestionType('判断题'), QuestionType.Judge);
    assert.strictEqual(detectQuestionType('填空题'), QuestionType.Blank);
  });

  it('extractTestCases 解析中文样例', () => {
    const html = '<p>输入：1 2</p><p>输出：3</p><p>输入：3 4</p><p>输出：7</p>';
    const cases = extractTestCases(html);
    assert.strictEqual(cases.length, 2);
    assert.strictEqual(cases[0].input, '1 2');
    assert.strictEqual(cases[0].expectedOutput, '3');
    assert.strictEqual(cases[1].expectedOutput, '7');
  });

  it('extractTestCases 解析英文样例', () => {
    const html = 'Sample Input: 5\nSample Output: 120';
    const cases = extractTestCases(html);
    assert.strictEqual(cases.length, 1);
    assert.ok(cases[0].expectedOutput.includes('120'));
  });

  it('extractTemplateCode 提取模板代码', () => {
    const html = '<pre>#include &lt;stdio.h&gt;\nint main(){ }</pre>';
    const code = extractTemplateCode(html);
    assert.ok(code && code.includes('#include'));
  });

  it('parseProblems 解析编程题（含限制/题库编号/模板）', () => {
    const html = `
      <div data-questionid="10086">
        <span>编程题</span>
        <div>计算两数之和。题号: ABC123</div>
        <div>时间限制: 1000 ms  内存限制: 64 MB</div>
        <pre>int main(){ }</pre>
        <div>输入：1 2</div>
        <div>输出：3</div>
      </div>
      <div data-questionid="10087">
        <span>单选题</span>
        <div>下列正确的是</div>
        <ul><li>A. 选项一</li><li>B. 选项二</li></ul>
      </div>`;
    const problems = parseProblems(html);
    assert.strictEqual(problems.length, 2);
    const coding = problems[0];
    assert.strictEqual(coding.type, QuestionType.Programming);
    assert.strictEqual(coding.questionBankId, 'ABC123');
    assert.strictEqual(coding.limits?.timeMs, 1000);
    assert.strictEqual(coding.limits?.memoryMb, 64);
    assert.ok(coding.templateCode?.includes('int main'));
    assert.strictEqual(coding.sampleTests?.length, 1);

    const choice = problems[1];
    assert.strictEqual(choice.type, QuestionType.Single);
    assert.strictEqual(choice.options?.length, 2);
    assert.strictEqual(choice.options?.[0].key, 'A');
  });

  it('mapPlatformVerdict 映射平台判题文案', () => {
    assert.strictEqual(mapPlatformVerdict('编译错误'), 'CE');
    assert.strictEqual(mapPlatformVerdict('运行超时'), 'TLE');
    assert.strictEqual(mapPlatformVerdict('答案错误'), 'WA');
    assert.strictEqual(mapPlatformVerdict('通过'), 'AC');
    assert.strictEqual(mapPlatformVerdict('待测评'), 'Judging');
  });

  it('detectHomeworkKind 识别作业类型', () => {
    assert.strictEqual(detectHomeworkKind('第三章程序设计作业'), 'code');
    assert.strictEqual(detectHomeworkKind('小组项目汇报'), 'group');
    assert.strictEqual(detectHomeworkKind('章节测验'), 'quiz');
  });

  it('parseWorkHtml 兜底解析作业列表', () => {
    const html = '<ul><li><a href="workId=2001">程序作业</a> 2026-10-01 18:00</li></ul>';
    const works = parseWorkHtml(html);
    assert.strictEqual(works.length, 1);
    assert.strictEqual(works[0].workId, '2001');
  });

  it('normalizeNotice 归一化通知', () => {
    const n = normalizeNotice({ noticeId: 7, noticeTitle: '<b>作业</b>提醒', noticeType: 'homework', isRead: 0, time: '2026-09-23 10:00:00' });
    assert.strictEqual(n.id, '7');
    assert.strictEqual(n.title, '作业提醒');
    assert.strictEqual(n.category, 'homework');
    assert.strictEqual(n.read, false);
  });

  it('parseWorkHtml 解析带状态区块的列表（已完成/未开放均保留）', () => {
    const html = `
      <h3>待做作业</h3>
      <ul><li><a href="javascript:open('/work/dowork?workId=2001')">程序作业一</a> 截止时间：2026-10-01 18:00</li></ul>
      <h3>已完成</h3>
      <ul><li><a href="?workId=2002">程序作业二</a> 2026-09-20 18:00 得分：95</li></ul>
      <h3>未开放</h3>
      <ul><li><p class="title">实验作业三</p> 开放时间：2026-11-01 00:00</li></ul>`;
    const works = parseWorkHtml(html);
    assert.strictEqual(works.length, 3);

    assert.strictEqual(works[0].workId, '2001');
    assert.ok(!works[0].stateText);

    assert.strictEqual(works[1].workId, '2002');
    assert.ok(works[1].stateText?.includes('已完成'));
    assert.strictEqual(works[1].score, '95');

    // 未开放项没有 workId 链接也要保留
    assert.strictEqual(works[2].workId, '');
    assert.strictEqual(works[2].title, '实验作业三');
    assert.ok(works[2].stateText?.includes('未开放'));
  });

  it('normalizeWork 映射状态标签（未开放/已完成）', () => {
    const course = { courseId: 'c1', clazzId: 'k1', cpi: '1' };
    const locked = normalizeWork({ workId: 3, title: '实验三', stateText: '未开放' }, course);
    assert.strictEqual(locked.locked, true);
    assert.strictEqual(locked.stateLabel, '未开放');

    const done = normalizeWork({ workId: 4, title: '实验四', stateText: '已完成 已批改', score: 88 }, course);
    assert.strictEqual(done.submitted, true);
    assert.strictEqual(done.marked, true);
    assert.strictEqual(done.stateLabel, '已批改');
    assert.strictEqual(done.score, 88);
  });

  it('homeworkFromTaskPoint 从章节任务点合成（含未开放）', () => {
    const course = { courseId: 'c1', clazzId: 'k1', cpi: '1' };
    const open = homeworkFromTaskPoint(
      { id: 'workid222', jobId: 'workid222', name: '第三章作业', kind: 'work', done: false, workId: '222' },
      { unlocked: true },
      course
    );
    assert.ok(open);
    assert.strictEqual(open.workId, '222');
    assert.strictEqual(open.stateLabel, '待完成');

    const locked = homeworkFromTaskPoint(
      { id: 'workid333', jobId: 'workid333', name: '未开放作业', kind: 'work', done: false, workId: '333', unlocked: false },
      { unlocked: false },
      course
    );
    assert.ok(locked);
    assert.strictEqual(locked.locked, true);
    assert.strictEqual(locked.stateLabel, '未开放');
  });

  it('mergeHomeworkLists 去重合并保留更全字段', () => {
    const course = { courseId: 'c1', clazzId: 'k1', cpi: '1' };
    const fromList = normalizeWork({ workId: 222, title: '第三章作业', endTime: '2026-10-01 18:00' }, course);
    const fromChapter = homeworkFromTaskPoint(
      { id: 'workid222', jobId: 'workid222', name: '第三章作业', kind: 'work', done: true, workId: '222' },
      { unlocked: true },
      course
    );
    const merged = mergeHomeworkLists([fromList], [fromChapter!]);
    assert.strictEqual(merged.length, 1);
    assert.strictEqual(merged[0].deadline, fromList.deadline); // 列表提供截止时间
    assert.strictEqual(merged[0].submitted, true); // 章节提供完成状态
    assert.strictEqual(merged[0].locked, false);
  });

  it('stateLabelOf 状态优先级', () => {
    assert.strictEqual(stateLabelOf({ locked: true, submitted: true }), '未开放');
    assert.strictEqual(stateLabelOf({ submitted: true, marked: true }), '已批改');
    assert.strictEqual(stateLabelOf({ submitted: true }), '已完成');
    assert.strictEqual(stateLabelOf({ expired: true }), '已截止');
    assert.strictEqual(stateLabelOf({}), '待完成');
  });

  it('parseChapterHtml 解析章节与任务点', () => {
    const html = `
      <li chapterid="123">
        <span class="catalog_name">第一章 绪论</span>
        <div jobid="videoid111"><span class="catalog_name">视频：介绍</span></div>
        <div jobid="workid222"><span class="catalog_name">作业：练习</span></div>
      </li>`;
    const chapters = parseChapterHtml(html);
    assert.strictEqual(chapters.length, 1);
    assert.strictEqual(chapters[0].id, '123');
    assert.strictEqual(chapters[0].tasks.length, 2);
    assert.strictEqual(chapters[0].tasks[1].kind, 'work');
    assert.strictEqual(chapters[0].tasks[1].workId, '222');
  });

  it('parseWorkHtml 解析新版 li[data] 列表（p 标题 + span.status + 详情直链）', () => {
    const html = `
      <ul class="ulDiv">
        <li onclick="goTask(this);" data="https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?courseId=1&classId=2&cpi=3&workId=88001&answerId=-1&enc=abc">
          <p class="overHidden2 fl">实验一：顺序表</p>
          <span class="status">未交</span>
          <span class="fr time notOver">截止时间：2026-10-01 18:00</span>
        </li>
        <li onclick="goTask(this);" data="https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?courseId=1&classId=2&cpi=3&workId=88002&answerId=1&enc=def">
          <p class="overHidden2 fl">实验二：链表</p>
          <span class="status">已批阅</span>
          <span class="score">90 分</span>
          <span class="fr time">2026-09-20 18:00</span>
        </li>
      </ul>`;
    const works = parseWorkHtml(html);
    assert.strictEqual(works.length, 2);

    assert.strictEqual(works[0].workId, '88001');
    assert.strictEqual(works[0].title, '实验一：顺序表');
    assert.strictEqual(works[0].statusText, '未交');
    assert.ok(works[0].url?.includes('workId=88001'));
    assert.strictEqual(works[0].endTime, '2026-10-01 18:00');

    assert.strictEqual(works[1].workId, '88002');
    assert.strictEqual(works[1].score, '90');
    assert.strictEqual(works[1].statusText, '已批阅');

    const course = { courseId: 'c1', clazzId: 'k1', cpi: '1' };
    const pending = normalizeWork(works[0], course);
    assert.strictEqual(pending.stateLabel, '待完成');
    assert.ok(pending.deadline > 0);
    assert.ok(pending.url?.includes('workId=88001'));

    const marked = normalizeWork(works[1], course);
    assert.strictEqual(marked.marked, true);
    assert.strictEqual(marked.stateLabel, '已批改');
    assert.strictEqual(marked.score, 90);
  });

  it('parseWorkHtml 解析 stu-work 全局列表（课程名 + 剩余时间）', () => {
    const html = `
      <ul>
        <li data="https://mooc1.chaoxing.com/mycourse/stuwork?taskrefId=555&courseId=1">
          <p>第三次作业</p>
          <span class="status">未提交</span>
          <span>高等数学</span>
          <span class="fr">剩余2天11小时</span>
        </li>
      </ul>`;
    const works = parseWorkHtml(html);
    assert.strictEqual(works.length, 1);
    assert.strictEqual(works[0].workId, '555');
    assert.strictEqual(works[0].title, '第三次作业');
    assert.strictEqual(works[0].courseName, '高等数学');
    assert.strictEqual(works[0].remainText, '剩余2天11小时');

    const hw = normalizeWork(works[0], { courseId: 'c1', clazzId: 'k1', cpi: '1' });
    assert.strictEqual(hw.submitted, false);
    assert.strictEqual(hw.stateLabel, '待完成');
  });

  it('platformStateText / deadlineFromRemaining 归一平台状态与剩余时间', () => {
    assert.strictEqual(platformStateText('未交'), '');
    assert.strictEqual(platformStateText('未提交'), '');
    assert.strictEqual(platformStateText('待批阅'), '已提交');
    assert.strictEqual(platformStateText('已批阅'), '已批改');
    assert.strictEqual(platformStateText('已完成'), '已完成');
    assert.strictEqual(platformStateText('未开放'), '未开放');

    assert.strictEqual(deadlineFromRemaining('剩余2天11小时', 1000), 1000 + 2 * 86400000 + 11 * 3600000);
    assert.strictEqual(deadlineFromRemaining('剩余30分钟', 0), 30 * 60000);
    assert.strictEqual(deadlineFromRemaining('没有时间', 0), 0);
  });

  it('parseCoursePage 提取 enc/workEnc 与作业 tab 直链', () => {
    const html = `
      <input type="hidden" id="enc" value="pageEnc"/>
      <input type="hidden" id="openc" value="openEnc"/>
      <input type="hidden" id="workEnc" value="workEncVal"/>
      <a data-url="https://mooc1.chaoxing.com/mooc2/work/list" title="作业">作业</a>
      <a data-url="https://mooc1.chaoxing.com/exam/list" title="考试">考试</a>`;
    const ctx = parseCoursePage(html);
    assert.strictEqual(ctx.enc, 'pageEnc');
    assert.strictEqual(ctx.openc, 'openEnc');
    assert.strictEqual(ctx.workEnc, 'workEncVal');
    assert.strictEqual(ctx.workListUrl, 'https://mooc1.chaoxing.com/mooc2/work/list');
    assert.strictEqual(ctx.examListUrl, 'https://mooc1.chaoxing.com/exam/list');
  });

  it('parseStudentCourse 解析总进度与章节（cur/knowledgeJobCount/bntHoverTips）', () => {
    const html = `
      <input type="hidden" id="enc" value="enc-abc"/>
      <div id="fanyaChapter">
        <div class="chapter_head clearfix"><h2>已完成任务点: <span>3</span>/12</h2></div>
        <div class="chapter_unit">
          <div class="catalog_level">
            <ul>
              <li>
                <div id="cur444007896">
                  <a class="clicktitle">1.1 绪论</a>
                  <input class="knowledgeJobCount" value="3"/>
                  <span class="bntHoverTips">已完成</span>
                </div>
              </li>
              <li>
                <div id="cur444007897">
                  <a class="clicktitle">1.2 发展</a>
                  <input class="knowledgeJobCount" value="2"/>
                  <span class="bntHoverTips">有1个任务点未完成</span>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>`;
    const info = parseStudentCourse(html);
    assert.deepStrictEqual(info.progress, { done: 3, total: 12 });
    assert.strictEqual(info.enc, 'enc-abc');
    assert.strictEqual(info.chapters.length, 2);
    assert.strictEqual(info.chapters[0].id, '444007896');
    assert.strictEqual(info.chapters[0].name, '1.1 绪论');
    assert.strictEqual(info.chapters[0].jobCount, 3);
    assert.strictEqual(info.chapters[0].doneCount, 3);
    assert.strictEqual(info.chapters[1].doneCount, 1);
    assert.strictEqual(info.chapters[1].pendingCount, 1);
    assert.strictEqual(info.chapters[1].unlocked, true);
  });

  it('parseTaskCards 解析 knowledge/cards mArg 任务点', () => {
    const html = `<script>var mArg = {"attachments":[
      {"jobid":"videoid1001","type":"video","isPassed":true,"property":{"title":"绪论视频","objectid":"obj1"}},
      {"jobid":"workid2002","type":"workid","isPassed":false,"property":{"title":"第一章作业"}}
    ],"defaults":{"knowledgeid":444}};</script>`;
    const info = parseTaskCards(html);
    assert.strictEqual(info.notOpen, false);
    assert.strictEqual(info.tasks.length, 2);
    assert.strictEqual(info.tasks[0].kind, 'video');
    assert.strictEqual(info.tasks[0].done, true);
    assert.strictEqual(info.tasks[1].kind, 'work');
    assert.strictEqual(info.tasks[1].workId, '2002');
  });

  it('parseProblems 无 questionId 标记时按题目容器切块', () => {
    const html = `
      <div class="pad30"><h2 class="titType">单选题</h2><p>1. 下列正确的是</p><ul><li>A. 选项一</li><li>B. 选项二</li></ul></div>
      <div class="pad30"><h2 class="titType">编程题</h2><p>计算两数之和</p></div>`;
    const problems = parseProblems(html);
    assert.strictEqual(problems.length, 2);
    assert.strictEqual(problems[0].type, QuestionType.Single);
    assert.strictEqual(problems[0].options?.length, 2);
    assert.strictEqual(problems[1].type, QuestionType.Programming);
  });

  it('parseProblems 解析真实批改页 questionLi（qtContent 题干 / 公式图 / 样例配对）', () => {
    const html = `
      <h2 class="type_tit">一. 程序题（共6题，100分）</h2>
      <div class="marBom60 questionLi singleQuesId" style="word-wrap: break-word;" id="question405964585" data="405964585" tabindex="0" aria-label="题目详情">
        <div class="aiArea"><div class="aiAreaContent">
          <h3 class="mark_name colorDeep">1. <span class="colorShallow">(程序题)</span><span class="qtContent workTextWrap"><p>表达式计算。</p>
<p>y=<img class="ans-formula-moudle" data="%7B%22formula%22%3A%22%5C%5Cfrac%7Bsinx%7D%7Bax%7D%22%2C%22id%22%3A779579%7D" src="/ananas/latex/p/779579"></p>
<p>输入：依次输入a和x</p>
<p>输出:&nbsp; y的值</p>
<p>样例1：</p>
<p>输入：3.1 40</p>
<p>输出：1.006</p>
<p>样例2：</p>
<p>输入：1.6 21</p>
<p>输出：0.025</p></span></h3>
          <div class="mark_answer">
            <dl class="mark_fill"><dt>我的答案：</dt><dd class="stuAnswerContent"><pre class="line-numbers"><code class="language-plain">#include &lt;stdio.h&gt;
int main(){}</code></pre></dd></dl>
            <div class="mark_score"><div class="totalScore fr"><i>16.6</i>分</div></div>
          </div>
        </div></div>
      </div>
      <div class="marBom60 questionLi singleQuesId" style="word-wrap: break-word;" id="question405964586" data="405964586" tabindex="0">
        <div class="aiAreaContent">
          <h3 class="mark_name">2. <span class="colorShallow">(程序题)</span><span class="qtContent workTextWrap"><p>题目编号：Exp01-Basic01</p>
<p>样例1：</p><pre><code>输入：<br>B<br></code></pre><pre><code>输出：<br>ABC<br></code></pre>
<p>样例2：</p><pre><code>输入：<br>W<br></code></pre><pre><code>输出：<br>VWX<br></code></pre></span></h3>
          <div class="mark_answer"><div class="mark_score"><div class="totalScore fr"><i>16.6</i>分</div></div></div>
        </div>
      </div>`;
    const problems = parseProblems(html);
    assert.strictEqual(problems.length, 2);

    const first = problems[0];
    assert.strictEqual(first.id, '405964585');
    assert.strictEqual(first.type, QuestionType.Programming);
    assert.strictEqual(first.score, 16.6);
    assert.ok(first.contentText.includes('表达式计算'));
    assert.ok(!first.contentText.includes('我的答案'));
    assert.ok(!first.contentText.includes('word-wrap'));
    assert.ok(!first.contentText.includes('question405964585'));
    assert.ok(first.contentHtml.includes('fx-formula'));
    assert.ok(!first.contentHtml.includes('ans-formula-moudle'));
    assert.ok((first.templateCode ?? '').includes('#include'));
    assert.strictEqual(first.sampleTests?.length, 2);
    assert.strictEqual(first.sampleTests?.[0].input, '3.1 40');
    assert.strictEqual(first.sampleTests?.[0].expectedOutput, '1.006');

    const second = problems[1];
    assert.strictEqual(second.id, '405964586');
    assert.strictEqual(second.questionBankId, 'Exp01-Basic01');
    assert.strictEqual(second.sampleTests?.length, 2);
    assert.strictEqual(second.sampleTests?.[0].input, 'B');
    assert.strictEqual(second.sampleTests?.[0].expectedOutput, 'ABC');
    assert.strictEqual(second.sampleTests?.[1].expectedOutput, 'VWX');
  });

  it('extractTestCases 按样例标记配对（不把输入/输出说明当样例）', () => {
    const html = `<p>输入：依次输入a和x</p><p>输出: y的值</p>
      <p>样例1：</p><p>输入：3.1 40</p><p>输出：1.006</p>
      <p>样例2：</p><p>输入：1.6 21</p><p>输出：0.025</p>`;
    const cases = extractTestCases(html);
    assert.strictEqual(cases.length, 2);
    assert.strictEqual(cases[0].input, '3.1 40');
    assert.strictEqual(cases[0].expectedOutput, '1.006');
    assert.strictEqual(cases[1].expectedOutput, '0.025');
  });

  it('parseWorkHtml 无 li 时按 data 数据块兜底', () => {
    const html = `
      <div class="work-list-item" data="https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?workId=77001&enc=x">
        <p class="overHidden2">实验零：环境准备</p>
        <span class="status">未交</span>
        <span class="fr time">截止时间：2026-10-10 18:00</span>
      </div>`;
    const works = parseWorkHtml(html);
    assert.strictEqual(works.length, 1);
    assert.strictEqual(works[0].workId, '77001');
    assert.strictEqual(works[0].title, '实验零：环境准备');
    assert.strictEqual(works[0].statusText, '未交');
  });

  it('extractRawNotices 解包按 id 键控的 map 形态', () => {
    const text = JSON.stringify({
      result: 1,
      notices: {
        lastGetId: 9,
        '123': { noticeId: '123', title: '考试安排', isread: 0, completeTime: '2026-09-23 10:00:00' },
        '124': { noticeId: '124', title: '作业提醒', isread: 1, completeTime: '2026-09-22 08:00:00' }
      }
    });
    const items = extractRawNotices(text);
    assert.strictEqual(items.length, 2);
    const normalized = items.map(normalizeNotice);
    assert.strictEqual(normalized[0].title, '考试安排');
    assert.strictEqual(normalized[0].read, false);
    assert.strictEqual(normalized[1].read, true);
  });
});
