/**
 * Fanxing 只读联调测试（不落任何凭据：从环境变量读取）。
 * 安全约束：本脚本严禁包含提交类调用（submitWork / saveDraft / submitSign）。
 */
const Module = require('module');
const path = require('path');

const FANXING = path.resolve(__dirname, '../../Fanxing');

// stub vscode（api 层只用到 Logger 的类型，但保险起见桩掉）
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...args) {
  if (request === 'vscode') {
    return 'stub:vscode';
  }
  return origResolve.call(this, request, ...args);
};
const fakeChannel = { appendLine() {}, show() {}, dispose() {} };
require.cache['stub:vscode'] = {
  id: 'stub:vscode',
  loaded: true,
  exports: {
    window: { createOutputChannel: () => fakeChannel },
    workspace: { getConfiguration: () => ({ get: () => undefined }) },
    env: { language: 'zh-cn' }
  }
};

const api = (name) => require(path.join(FANXING, 'src/api', name));

const logger = {
  debug: () => {},
  info: (m) => console.log('  [info]', m),
  warn: (m) => console.log('  [warn]', m),
  error: (m) => console.log('  [error]', m)
};

const show = (label, value) => {
  console.log(`\n== ${label} ==`);
  console.log(typeof value === 'string' ? value : JSON.stringify(value, null, 2));
};

async function main() {
  const phone = process.env.FANXING_PHONE;
  const pass = process.env.FANXING_PASS;
  if (!phone || !pass) {
    throw new Error('缺少环境变量 FANXING_PHONE / FANXING_PASS');
  }

  const { HttpClient } = api('client');
  const { AuthApi } = api('auth');
  const { CourseApi } = api('course');
  const { HomeworkApi } = api('homework');
  const { NotificationApi } = api('notification');
  const { SignInApi } = api('signin');
  const { GradeApi } = api('grade');

  const http = new HttpClient(logger);
  const auth = new AuthApi(http, logger);
  const courses = new CourseApi(http, logger);
  const homework = new HomeworkApi(http, logger);
  const notices = new NotificationApi(http, logger);
  const signIn = new SignInApi(http, logger);
  const grade = new GradeApi(http, logger);

  // 1) 登录（密码 AES 加密）
  console.log('== 登录（手机号+密码） ==');
  const login = await auth.loginByPassword(phone, pass);
  show('登录结果', {
    ok: login.ok,
    message: login.message ?? '',
    account: login.account ? { id: login.account.id, name: login.account.name, fid: login.account.fid } : null,
    cookieKeys: Object.keys(login.cookies ?? {}).sort()
  });
  if (!login.ok) {
    return;
  }

  // 2) 会话校验
  show('会话校验 validateSession', await auth.validateSession());

  // 3) 资料
  try {
    show('账号资料 fetchProfile', await auth.fetchProfile());
  } catch (e) {
    console.log('fetchProfile 失败:', String(e));
  }

  // 4) 课程列表
  let courseList = [];
  try {
    courseList = await courses.listCourses();
    show(
      `课程列表 (${courseList.length})`,
      courseList.map((c) => ({
        courseId: c.courseId,
        clazzId: c.clazzId,
        name: c.name,
        teacher: c.teacher,
        status: c.status,
        progress: c.progress
      }))
    );
  } catch (e) {
    console.log('listCourses 失败:', String(e));
  }

  // 5) 章节树（第一门课）
  if (courseList.length) {
    try {
      const chapters = await courses.listChapters(courseList[0]);
      show(
        `章节树 [${courseList[0].name}] (${chapters.length} 章)`,
        chapters.slice(0, 5).map((ch) => ({
          id: ch.id,
          name: ch.name,
          unlocked: ch.unlocked,
          tasks: ch.tasks.map((t) => `${t.kind}:${t.name}${t.done ? '[done]' : ''}`)
        }))
      );
    } catch (e) {
      console.log('listChapters 失败:', String(e));
    }
  }

  // 6) 作业列表（前 2 门课）
  const allHomework = [];
  for (const c of courseList.slice(0, 2)) {
    try {
      const list = await homework.listHomework(c);
      allHomework.push(...list.map((h) => ({ course: c.name, h })));
      show(
        `作业列表 [${c.name}] (${list.length})`,
        list.map((h) => ({
          workId: h.workId,
          title: h.title,
          kind: h.kind,
          deadline: h.deadline ? new Date(h.deadline).toLocaleString() : '-',
          submitted: h.submitted,
          marked: h.marked,
          score: h.score
        }))
      );
    } catch (e) {
      console.log(`listHomework [${c.name}] 失败:`, String(e));
    }
  }

  // 7) 题目解析（只读，优先取已提交/编程类，绝不提交）
  const target = allHomework.find((x) => x.h.kind === 'code') ?? allHomework[0];
  if (target) {
    try {
      const problems = await homework.getHomeworkDetail(target.h);
      show(
        `题目解析 [${target.h.title}] (${problems.length} 题)`,
        problems.map((p) => ({
          index: p.index,
          type: p.type,
          bankId: p.questionBankId ?? null,
          score: p.score,
          limits: p.limits ?? null,
          hasTemplate: !!p.templateCode,
          tests: (p.sampleTests ?? []).map((t) => ({ in: t.input.slice(0, 40), out: t.expectedOutput.slice(0, 40) })),
          images: (p.images ?? []).length,
          stem: p.contentText.slice(0, 120)
        }))
      );
    } catch (e) {
      console.log('getHomeworkDetail 失败:', String(e));
    }
  }

  // 8) 通知
  try {
    const list = await notices.listNotices(1, 10);
    show(
      `通知 (${list.length})`,
      list.slice(0, 8).map((n) => ({
        id: n.id,
        title: n.title,
        category: n.category,
        read: n.read,
        time: n.publishTime ? new Date(n.publishTime).toLocaleString() : '-'
      }))
    );
  } catch (e) {
    console.log('listNotices 失败:', String(e));
  }

  // 9) 签到活动（仅检测，不签到）
  try {
    const acts = await signIn.listActivities();
    show(
      `签到活动 (${acts.length})`,
      acts.map((a) => ({
        activeId: a.activeId,
        courseName: a.courseName,
        type: a.nameOtherId,
        signed: a.signed,
        startTime: a.startTime ? new Date(a.startTime).toLocaleString() : '-'
      }))
    );
  } catch (e) {
    console.log('listActivities 失败:', String(e));
  }

  // 10) 成绩（第一门课，只读）
  if (courseList.length) {
    try {
      show('成绩 [第一门课]', await grade.getGrades(courseList[0]));
    } catch (e) {
      console.log('getGrades 失败:', String(e));
    }
  }

  console.log('\n== 测试结束（全程只读，无任何提交调用） ==');
}

main().catch((e) => {
  console.error('测试失败:', e);
  process.exit(1);
});
