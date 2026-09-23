/**
 * Fanxing 全局常量：域名、接口、判题状态机、题型枚举。
 * 接口置信度见 docs/API-RESEARCH.md。
 */

export const BRAND = {
  name: 'Fanxing',
  nameZh: '泛星',
  outputChannel: 'Fanxing',
  statusBarPrefix: 'Fanxing'
};

export const DOMAINS = {
  passport: 'https://passport2.chaoxing.com',
  portal: 'https://i.chaoxing.com',
  moocApi: 'https://mooc1-api.chaoxing.com',
  mooc: 'https://mooc1.chaoxing.com',
  mooc2: 'https://mooc2-ans.chaoxing.com',
  mobileLearn: 'https://mobilelearn.chaoxing.com',
  notice: 'https://notice.chaoxing.com',
  pan: 'https://pan-yz.chaoxing.com',
  imageCdn: 'https://p.ananas.chaoxing.com',
  stat: 'https://stat2-ans.chaoxing.com'
};

export const ENDPOINTS = {
  // 认证
  login: `${DOMAINS.passport}/fanyalogin`,
  loginByCode: `${DOMAINS.passport}/fanyaloginbycode`,
  loginQrPage: `${DOMAINS.passport}/mlogin`,
  createQr: `${DOMAINS.passport}/createqr`,
  qrAuthStatus: `${DOMAINS.passport}/getauthstatus`,

  // 课程
  courseList: `${DOMAINS.moocApi}/mycourse/backclazzdata`,
  courseVisit: `${DOMAINS.moocApi}/visit/courses`,
  courseMiddle: `${DOMAINS.mooc}/visit/stucoursemiddle`,
  chapterList: `${DOMAINS.mooc2}/visit/stucoursemiddle`,
  studentCourse: `${DOMAINS.mooc2}/mooc2-ans/mycourse/studentcourse`,
  chapterCards: `${DOMAINS.mooc}/mooc-ans/knowledge/cards`,

  // 通知
  noticeList: `${DOMAINS.notice}/pc/notice/getNotices`,
  noticeListNew: `${DOMAINS.notice}/pc/notice/getNoticeList`,
  noticeDetail: `${DOMAINS.notice}/pc/notice/noticeDetail`,

  // 作业
  workList: `${DOMAINS.mooc}/mooc2/work/list`,
  workListLegacy: `${DOMAINS.moocApi}/mooc-ans/work/list`,
  stuWork: `${DOMAINS.moocApi}/work/stu-work`,
  workTask: `${DOMAINS.mooc}/mooc-ans/mooc2/work/task`,
  workDetailMobile: `${DOMAINS.moocApi}/mooc-ans/work/phone/doHomeWork`,
  workDetailWeb: `${DOMAINS.mooc}/mooc-ans/work/dowork`,
  workSubmit: `${DOMAINS.moocApi}/work/addStudentWorkNew`,
  workSubmitNew: `${DOMAINS.mooc}/mooc-ans/work/addStudentWork`,
  workSave: `${DOMAINS.moocApi}/work/addStudentWorkSave`,

  // 签到
  activeList: `${DOMAINS.mobileLearn}/v2/apis/active/student/activelist`,
  preSign: `${DOMAINS.mobileLearn}/newsign/preSign`,
  signAnalysis: `${DOMAINS.mobileLearn}/pptSign/analysis`,
  signAnalysis2: `${DOMAINS.mobileLearn}/pptSign/analysis2`,
  checkSignCode: `${DOMAINS.mobileLearn}/pptSign/checkSignCode`,
  signSubmit: `${DOMAINS.mobileLearn}/pptSign/stuSignajax`,
  panToken: `${DOMAINS.pan}/api/token/uservalid`,
  panUpload: `${DOMAINS.pan}/upload`,

  // 成绩
  gradeList: `${DOMAINS.moocApi}/mooc-ans/coursegrade/gradeList`
};

/** AES 登录加密常量（key = iv = 前 16 字节） */
export const AES_KEY = 'u2oh6Vu^HWe4_AES';

/** 浏览器 UA（部分接口校验 UA/Referer） */
export const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/** 官方 App UA：部分网络环境下浏览器 UA 会被 passport WAF 302 到 passport403，App UA 可正常通行 */
export const APP_UA = 'com.ssreader.ChaoXingStudy/ChaoXingStudy_3_6.0.2_ios_phone';

/** 图片防盗链 Referer */
export const IMAGE_REFERER = `${DOMAINS.mooc}/`;

/** 签到类型（otherId） */
export enum SignType {
  Normal = 0,
  QrCode = 2,
  Gesture = 3,
  Location = 4,
  Code = 5
}

export const SIGN_TYPE_LABEL: Record<number, string> = {
  0: '普通/拍照签到',
  2: '二维码签到',
  3: '手势签到',
  4: '位置签到',
  5: '签到码签到'
};

/** 作业题型 */
export enum QuestionType {
  Single = 'single',
  Multiple = 'multiple',
  Judge = 'judge',
  Blank = 'blank',
  ShortAnswer = 'short',
  Programming = 'programming',
  Unknown = 'unknown'
}

export const QUESTION_TYPE_LABEL: Record<string, string> = {
  single: '单选题',
  multiple: '多选题',
  judge: '判断题',
  blank: '填空题',
  short: '简答题',
  programming: '程序设计',
  unknown: '未知题型'
};

/** 编程语言配置 */
export interface LanguageSpec {
  id: 'c' | 'cpp' | 'java' | 'python';
  label: string;
  ext: string;
  /** VS Code 语言 id */
  vscodeLanguage: string;
  /** 本地编译命令；null 表示解释型 */
  compile: string | null;
  /** 运行命令模板，{file} 为源文件路径，{main} 为入口类/产物 */
  run: string[];
  defaultArgs: string[];
  /** 学习通 OJ 常见环境描述 */
  ojEnvironment: string;
}

export const LANGUAGES: Record<string, LanguageSpec> = {
  c: {
    id: 'c',
    label: 'C',
    ext: '.c',
    vscodeLanguage: 'c',
    compile: 'gcc',
    run: ['./a.out'],
    defaultArgs: ['-O2', '-std=c11', '-lm'],
    ojEnvironment: 'GCC，编译参数 -O2 -std=c11，GNU/Linux x86_64'
  },
  cpp: {
    id: 'cpp',
    label: 'C++',
    ext: '.cpp',
    vscodeLanguage: 'cpp',
    compile: 'g++',
    run: ['./a.out'],
    defaultArgs: ['-O2', '-std=c++17', '-lm'],
    ojEnvironment: 'G++，编译参数 -O2 -std=c++17，GNU/Linux x86_64'
  },
  java: {
    id: 'java',
    label: 'Java',
    ext: '.java',
    vscodeLanguage: 'java',
    compile: 'javac',
    run: ['java', '-Xss64m', 'Main'],
    defaultArgs: ['-encoding', 'UTF-8'],
    ojEnvironment: 'JDK 8/11，主类名 Main，栈大小 64m'
  },
  python: {
    id: 'python',
    label: 'Python',
    ext: '.py',
    vscodeLanguage: 'python',
    compile: null,
    run: ['python3'],
    defaultArgs: [],
    ojEnvironment: 'Python 3.8+，标准库可用'
  }
};

/** 判题状态机（本地与平台保持同名） */
export enum Verdict {
  Pending = 'Pending',
  Judging = 'Judging',
  Accepted = 'AC',
  WrongAnswer = 'WA',
  TimeLimitExceeded = 'TLE',
  MemoryLimitExceeded = 'MLE',
  RuntimeError = 'RE',
  CompileError = 'CE',
  OutputLimitExceeded = 'OLE',
  Skipped = 'Skipped'
}

export const VERDICT_LABEL: Record<string, string> = {
  Pending: '待测评',
  Judging: '测评中',
  AC: '通过',
  WA: '答案错误',
  TLE: '运行超时',
  MLE: '内存超限',
  RE: '运行错误',
  CE: '编译错误',
  OLE: '输出超限',
  Skipped: '跳过'
};

/** 配置作用域前缀 */
export const CONFIG_SECTION = 'fanxing';
