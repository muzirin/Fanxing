/**
 * 签到模块：活动检测、预签到、码校验、签到提交。
 * 合规约束：仅服务用户本人课程；不做位置模拟、不提供代签。
 */
import { ENDPOINTS, SIGN_TYPE_LABEL, SignType } from '../config/constants';
import { parseDateTime, stripHtml, tryParseJson } from '../utils/text';
import { HttpClient } from './client';
import { SignActivity } from './types';
import { Logger } from '../services/logger';

interface RawActive {
  id?: number | string;
  activeId?: number | string;
  nameOtherId?: number;
  type?: number;
  status?: number;
  startTime?: number | string;
  endTime?: number | string;
  name4CourseId?: string;
  courseId?: number | string;
  classId?: number | string;
  uid?: number | string;
  address?: string;
  userStatus?: number;
}

export interface SignSubmitParams {
  /** 位置签到 */
  address?: string;
  latitude?: number;
  longitude?: number;
  /** 拍照签到云盘 objectId */
  objectId?: string;
  /** 二维码 enc */
  enc?: string;
  /** 手势/签到码 */
  signCode?: string;
}

export class SignInApi {
  constructor(private readonly http: HttpClient, private readonly logger: Logger) {}

  private get uid(): string {
    return this.http.getCookies()['_uid'] ?? '';
  }

  private get fid(): string {
    return this.http.getCookies()['fid'] ?? '-1';
  }

  /** 进行中的签到活动列表（接口逐课带 courseId/classId，缺参会 500） */
  async listActivities(courses?: Array<{ courseId: string; clazzId: string }>): Promise<SignActivity[]> {
    const targets = courses?.length ? courses.slice(0, 50) : [{ courseId: '', clazzId: '' }];
    const out = new Map<string, SignActivity>();
    let ok = 0;
    for (const course of targets) {
      const qs =
        `fid=${this.fid}&uid=${this.uid}` +
        (course.courseId ? `&courseId=${course.courseId}&classId=${course.clazzId}` : '');
      try {
        const text = await this.http.getHtml(`${ENDPOINTS.activeList}?${qs}`, { retries: 0 });
        ok++;
        for (const act of this.parseActivities(text)) {
          out.set(act.activeId, act);
        }
      } catch (err) {
        this.logger.debug(`activelist 拉取失败${course.courseId ? ` course=${course.courseId}` : ''}`, String(err));
      }
    }
    if (!ok) {
      this.logger.warn('签到活动接口全部失败（active/student/activelist 异常，详见调试日志）');
    }
    return [...out.values()];
  }

  private parseActivities(text: string): SignActivity[] {
    const json = tryParseJson<{ data?: { activeList?: RawActive[]; learningList?: Array<{ courseInfo?: unknown; activeList?: RawActive[] }> } }>(text);
    const raws: RawActive[] = [];
    const data = json?.data;
    if (data?.activeList) {
      raws.push(...data.activeList);
    }
    if (data?.learningList) {
      for (const item of data.learningList) {
        if (item.activeList) {
          raws.push(...item.activeList);
        }
      }
    }
    return raws
      .filter((r) => Number(r.status) === 1 && Number(r.nameOtherId ?? r.type ?? -1) in SIGN_TYPE_LABEL)
      .map((r) => ({
        activeId: String(r.activeId ?? r.id ?? ''),
        courseId: String(r.courseId ?? r.name4CourseId ?? ''),
        clazzId: String(r.classId ?? ''),
        courseName: String((r as unknown as { courseName?: string }).courseName ?? ''),
        nameOtherId: Number(r.nameOtherId ?? r.type ?? 0),
        type: Number(r.type ?? 0),
        status: Number(r.status ?? 0),
        startTime: typeof r.startTime === 'number' ? r.startTime : parseDateTime(r.startTime),
        endTime: r.endTime ? (typeof r.endTime === 'number' ? r.endTime : parseDateTime(r.endTime)) : undefined,
        signed: Number(r.userStatus ?? 0) === 1,
        address: r.address
      }));
  }

  /** 预签到（所有签到提交前必须调用） */
  async preSign(activity: SignActivity): Promise<{ ok: boolean; code?: string; message?: string }> {
    const url =
      `${ENDPOINTS.preSign}?activeId=${activity.activeId}&classId=${activity.clazzId}` +
      `&uid=${this.uid}&courseId=${activity.courseId}&fid=${this.fid}`;
    const html = await this.http.getHtml(url);
    if (/您已签到|已经签到/.test(html)) {
      return { ok: false, message: '您已签到过了' };
    }
    const code = await this.resolveSignCode(activity);
    return { ok: true, code, message: '预签到完成' };
  }

  /** 解析签到 code（analysis / analysis2 两级） */
  async resolveSignCode(activity: SignActivity): Promise<string | undefined> {
    for (const endpoint of [ENDPOINTS.signAnalysis, ENDPOINTS.signAnalysis2]) {
      try {
        const text = await this.http.getHtml(`${endpoint}?id=${activity.activeId}`);
        const code = /(?:code|signCode)["'\s:=]+([0-9A-Za-z]{2,20})/i.exec(stripHtml(text))?.[1];
        if (code) {
          return code;
        }
      } catch (err) {
        this.logger.debug(`resolveSignCode via ${endpoint} failed`, String(err));
      }
    }
    return undefined;
  }

  /** 手势/签到码强校验（未通过返回 false） */
  async checkSignCode(activity: SignActivity, signCode: string): Promise<boolean> {
    const text = await this.http.getHtml(
      `${ENDPOINTS.checkSignCode}?activeId=${activity.activeId}&signCode=${encodeURIComponent(signCode)}`
    );
    return /"status"\s*:\s*true|成功|正确/.test(text);
  }

  /** 提交签到 */
  async submitSign(activity: SignActivity, params: SignSubmitParams, name: string): Promise<{ ok: boolean; message: string }> {
    const form: Record<string, string | number | undefined> = {
      activeId: activity.activeId,
      uid: this.uid,
      name,
      fid: this.fid,
      clientip: '',
      location: JSON.stringify({ isCustom: 0, latitude: -1, longitude: -1 })
    };

    switch (activity.nameOtherId as SignType) {
      case SignType.Location:
        if (params.latitude === undefined || params.longitude === undefined || !params.address) {
          return { ok: false, message: '位置签到需要本人提供真实位置信息（插件不做位置模拟）' };
        }
        form['address'] = params.address;
        form['latitude'] = params.latitude;
        form['longitude'] = params.longitude;
        form['ifTiJiao'] = 1;
        break;
      case SignType.QrCode:
        if (!params.enc) {
          return { ok: false, message: '二维码签到需要 enc 参数（扫码后从链接中提取）' };
        }
        form['enc'] = params.enc;
        form['location'] = JSON.stringify({ isCustom: 0, latitude: -1, longitude: -1 });
        break;
      case SignType.Gesture:
      case SignType.Code: {
        if (!params.signCode) {
          return { ok: false, message: '需要手势轨迹编码或签到码' };
        }
        const passed = await this.checkSignCode(activity, params.signCode);
        if (!passed) {
          return { ok: false, message: '码校验失败：手势/签到码不正确' };
        }
        form['signCode'] = params.signCode;
        break;
      }
      default:
        // 普通 / 拍照
        if (params.objectId) {
          form['objectId'] = params.objectId;
        } else {
          form['latitude'] = -1;
          form['longitude'] = -1;
        }
        break;
    }

    const text = await this.http.getHtml(
      `${ENDPOINTS.signSubmit}?${Object.entries(form)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
        .join('&')}`
    );
    const body = stripHtml(text);
    if (/成功|签到成功/.test(body)) {
      return { ok: true, message: '签到成功' };
    }
    if (/已签到/.test(body)) {
      return { ok: true, message: '您已签到过了' };
    }
    return { ok: false, message: body.slice(0, 120) || '签到失败' };
  }
}
