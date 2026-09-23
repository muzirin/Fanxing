/**
 * 轻量 i18n（中文 / English）。
 */
import * as vscode from 'vscode';
import { Settings } from './settings';

export type Locale = 'zh' | 'en';

type Dict = Record<string, [zh: string, en: string]>;

const DICT: Dict = {
  'login.prompt': ['请输入学习通手机号', 'Enter your Chaoxing phone number'],
  'login.password': ['请输入密码', 'Enter your password'],
  'login.success': ['登录成功', 'Signed in'],
  'login.failed': ['登录失败', 'Sign-in failed'],
  'login.needCaptcha': ['需要验证码，请查看输出面板中的验证码地址后重试', 'Captcha required, check the output panel'],
  'login.qr.title': ['扫码登录：请使用学习通 APP 扫描二维码', 'QR sign-in: scan with the Chaoxing app'],
  'login.qr.confirmed': ['扫码确认成功', 'QR sign-in confirmed'],
  'login.qr.expired': ['二维码已失效，请重新登录', 'QR code expired'],
  'login.qr.cancelled': ['用户取消了扫码登录', 'QR sign-in cancelled'],
  'login.cookie.prompt': ['粘贴 Cookie（至少包含 _uid、_d、vc3、fid）', 'Paste cookies (at least _uid, _d, vc3, fid)'],
  'logout.done': ['已退出登录', 'Signed out'],
  'account.switch': ['选择要切换到的账号', 'Select an account to switch to'],
  'account.none': ['尚未保存任何账号', 'No saved account'],
  'course.refresh.done': ['课程已刷新', 'Courses refreshed'],
  'course.empty': ['未获取到课程', 'No course found'],
  'notify.check.done': ['通知检查完成', 'Notification check done'],
  'notify.unread': ['条未读通知', ' unread notifications'],
  'env.title': ['运行环境检测', 'Environment check'],
  'env.missing': ['缺少工具，请按提示安装：', 'Missing tools, follow the guide to install:'],
  'env.ok': ['运行环境就绪', 'Environment ready'],
  'judge.compiling': ['编译中...', 'Compiling...'],
  'judge.running': ['运行测试中...', 'Running tests...'],
  'judge.pass': ['本地测试全部通过', 'All local tests passed'],
  'judge.fail': ['存在未通过的测试用例', 'Some test cases failed'],
  'submit.confirm': ['确认提交该代码到学习通？', 'Submit this code to Chaoxing?'],
  'submit.blocked': ['本地测试未全部通过，已阻止提交（可在设置中调整）', 'Local tests not all passed, submit blocked (configurable)'],
  'submit.done': ['提交成功，正在轮询判题结果', 'Submitted, polling judge result'],
  'ai.disabled': ['AI 辅助未启用，请先在设置中配置', 'AI assistant is not enabled'],
  'ai.nokey': ['未配置 API Key，请运行“配置 AI 提供商”', 'API key missing, run "Configure AI Provider"'],
  'ai.working': ['AI 分析中...', 'AI is analyzing...'],
  'ddl.exported': ['日程已导出', 'Deadlines exported'],
  'deadline.warn': ['即将截止', 'due soon'],
  'signin.detected': ['检测到新的签到活动', 'New sign-in activity detected']
};

export class I18n {
  constructor(private readonly settings: Settings) {}

  get locale(): Locale {
    const pref = this.settings.locale;
    if (pref === 'zh' || pref === 'en') {
      return pref;
    }
    return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  }

  t(key: keyof typeof DICT | string, ...args: Array<string | number>): string {
    const entry = DICT[key];
    let text = entry ? entry[this.locale === 'zh' ? 0 : 1] : key;
    args.forEach((arg, i) => {
      text = text.replace(`{${i}}`, String(arg));
    });
    return text;
  }
}
