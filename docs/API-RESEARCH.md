# Fanxing API 调研报告（超星学习通 / Chaoxing）

> 调研时间：2026-09-23
> 调研方式：GitHub 开源项目横向对比 + 公开协议分析文章交叉验证
> 用途：Fanxing VS Code 插件 API 封装层实现依据

---

## 一、GitHub 开源项目调研

| 项目 | Star/状态 | 语言 | 可借鉴点 | 维护状态 |
| --- | --- | --- | --- | --- | 
| [chettoy/FxxkStar](https://github.com/chettoy/FxxkStar) | 63 | Python | API 面最全：登录、课程、章节、视频/文档链接、课后题、播放进度上报、消息通知、签到；同时覆盖网页协议与安卓 SDK 协议 | 活跃（AGPL-3.0） |
| [CodFrm/cxmooc-tools](https://github.com/CodFrm/cxmooc-tools)（chettoy 重制版） | 高 | TS/Rust/Wasm | 浏览器扩展形态；作业/考试题库协议；WebAssembly 还原超星字体混淆 | 活跃 |
| [XilyFeAAAA/Chaoxing](https://github.com/XilyFeAAAA/Chaoxing) | 中 | Python/Vue | 前后端分离架构参考；账号密码 + 扫码双登录；多账号绑定 | 活跃 |
| [menghuanshiguang/chaoxing-cli](https://github.com/menghuanshiguang/chaoxing-cli) | 中 | Python | 2026 年逆向的登录协议（AES-CBC 参数加密 + 扫码全流程）；任务点/章节/进度/讨论接口；字体解密 | 活跃（2026 实测） |
| [HEDBS/chaoxing-sign](https://github.com/HEDBS/chaoxing-sign) | 12 | Python | 6 种签到类型全流程；2026-08 实测协议；踩坑记录（backclazzdata、fid、checkSignCode 强校验） | 活跃（2026-08 实测） |
| [MetaQiu/xxtSignApi](https://github.com/MetaQiu/xxtSignApi) | 低 | Node | 签到/云盘上传/预签到接口；`enc` 参数来源 | 稳定 |
| [LIXIYAN01/chaoxing-api](https://github.com/LIXIYAN01/chaoxing-api) | 低 | Python | 作业详情解析、题型解析 | 稳定 |
| [liuyunfz/chaoxing_tool](https://github.com/liuyunfz/chaoxing_tool) | 中 | Python | 老牌工具，通知/签到/资料下载 | 归档参考 |
| [yatori-dev/yatori-go-core](https://pkg.go.dev/github.com/yatori-dev/yatori-go-core/api/xuexitong) | 中 | Go | 作业提交接口常量表（`addStudentWorkNew` 等）、AES 常量 | 活跃 |

结论：
1. 登录协议在 2024-2026 间多次变化（DES → AES-CBC），必须以 `passport2.chaoxing.com/fanyalogin` 的 AES 方案为准。
2. 课程列表 `courselistdata` 页面方案已失效，必须使用 `mooc1-api.chaoxing.com/mycourse/backclazzdata` JSON 接口。
3. 手势/签到码签到存在服务端强校验（`checkSignCode`），老的"跳过校验直接提交"方案已失效。
4. 作业/编程题提交统一走 `work/addStudentWorkNew`，题型通过 `answerList` 结构区分。
5. 无任何项目提供"VS Code 形态客户端"，Fanxing 属于空白领域。

---

## 二、域名与认证机制

### 2.1 关键域名

| 域名 | 职责 |
| --- | --- |
| `passport2.chaoxing.com` | 统一登录认证 |
| `i.chaoxing.com` | 个人门户 |
| `mooc1-api.chaoxing.com` | 课程/作业主 API |
| `mooc1.chaoxing.com` / `mooc2-ans.chaoxing.com` | 作业/测验答题页与提交 |
| `mobilelearn.chaoxing.com` | 签到、活动、移动端任务点 |
| `notice.chaoxing.com` | 通知公告、文件上传（图床） |
| `pan-yz.chaoxing.com` | 超星云盘（拍照签到取图、附件） |
| `p.ananas.chaoxing.com` | 图片资源 CDN |
| `stat2-ans.chaoxing.com` | 任务点/学习进度上报 |
| `passport2.chaoxing.com/createqr` | 扫码登录二维码 |

### 2.2 Cookie 凭证（登录后从 Set-Cookie 提取）

| 字段 | 含义 |
| --- | --- |
| `_uid` | 用户 ID（也是 `puid`） |
| `_d` | 登录票据关键字段 |
| `vc3` | 核心会话校验 token（后续请求必须携带） |
| `fid` | 学校/机构 ID（签到接口必须使用真实值，不可写死 -1） |
| `uf` | 用户附加信息 |
| `UID` / `vc` | 老接口兼容字段 |

持久化要求：Cookie 存 `SecretStorage`；过期表现为 `vc3` 失效（接口返回未登录 HTML 或 `status:false`），
需要静默重登或提示用户重新登录。

### 2.3 登录接口

#### ① 手机号 + 密码（AES-CBC）

```
POST https://passport2.chaoxing.com/fanyalogin
Content-Type: application/x-www-form-urlencoded
UA: PC 浏览器 UA

uname    = base64(AES-CBC-PKCS7(手机号))
password = base64(AES-CBC-PKCS7(密码))
fid      = -1
refer    = https%3A%2F%2Fi.chaoxing.com
t        = true
forbidotherlogin = 0
validate =
doubleFactorLogin = 0
independentId = 0
```

- 算法：AES-128-CBC，`key = iv = "u2oh6Vu^HWe4_AES"`（取硬编码常量前 16 字节），PKCS7 填充，输出 Base64。
- 返回 JSON：`{ status: true, uid,昵称..., url }`；失败时 `mes` 给出原因（验证码、密码错误）。
- 若返回需要验证码（`validate` 字段），需先拉验证码图片再次提交。

#### ② 短信验证码登录

```
POST https://passport2.chaoxing.com/fanyaloginbycode
uname   = 手机号(明文)
verCode = urlencode(base64(AES-CBC(验证码)))
fid     = -1
refer   = https://i.chaoxing.com
```

#### ③ 学习通 APP 扫码登录（Fanxing 首选方案）

```
GET  passport2.chaoxing.com/login?fid=&newversion=true&refer=https://i.chaoxing.com
     -> 302 -> /mlogin，解析 <input id="uuid"> 与 <input id="enc">
GET  passport2.chaoxing.com/createqr?uuid=<uuid>&fid=-1      # 二维码 PNG
POST passport2.chaoxing.com/getauthstatus   body: enc=<enc>&uuid=<uuid>
     data.status == true            -> 登录成功，回跳补全 cookie
     data.type  == 4                -> 已扫码，等待手机确认
     data.type  == 2                -> 二维码失效
     data.type  == 6                -> 用户取消
```

- 轮询间隔 3s，上限约 55 次（~2.7 分钟）。
- 二维码内容为 `https://passport2.chaoxing.com/toauthlogin?uuid=..&enc=..&type=0`。

#### ④ 手动粘贴 Cookie（兜底）

直接写入 2.2 中的 Cookie 字段即可，适用于无法自动登录/需要学校 SSO 的场景。

---

## 三、接口清单

置信度说明：`[实测]` = 多个 2026 年项目交叉验证；`[参考]` = 来自单一项目/文档；`[设计]` = 依据页面结构推断，运行时以真实响应适配。

### 3.1 认证模块

| 接口 | 方法 | 参数 | 返回 | 置信度 |
| --- | --- | --- | --- | --- |
| `/fanyalogin` | POST | uname, password(AES), fid, refer, t | 登录态 + Set-Cookie | [实测] |
| `/fanyaloginbycode` | POST | uname, verCode(AES), fid | 同上 | [实测] |
| `/mlogin` | GET | — | uuid/enc 隐藏域 | [实测] |
| `/createqr` | GET | uuid, fid | 二维码 PNG | [实测] |
| `/getauthstatus` | POST | enc, uuid | `{status,type}` | [实测] |

### 3.2 课程模块

| 接口 | 方法 | 参数 | 返回 | 置信度 |
| --- | --- | --- | --- | --- | 
| `mooc1-api.chaoxing.com/mycourse/backclazzdata?rss=1` | GET | — | `channelList[]`：`content.id`=clazzId、`content.course.data[0].id`=courseId、`cpi`、课程名、教师、封面 | [实测] |
| `mooc1-api.chaoxing.com/visit/courses` | GET | — | HTML 课程列表（老接口，兜底） | [参考] |
| `mooc1.chaoxing.com/visit/stucoursemiddle` | GET | courseid, clazzid, vc, cpi, ismooc2=1, v=2 | 课程中间页：隐藏域 `enc`/`openc`/`oldenc`/`workEnc`/`examEnc` + `title="作业" data-url` tab 直链 | [实测] |
| `mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse` | GET | courseid, clazzid, cpi, enc, openc, fromMiddle=1, ut=s | 章节树 + 总进度（`已完成任务点: <span>N</span>/M`） | [实测] |
| `mooc1.chaoxing.com/mooc-ans/knowledge/cards` | GET | clazzid, courseid, knowledgeid, num=0, ut=s, cpi | `mArg={...}` JSON：`attachments[]` 任务点（jobid/type/property/isPassed） | [实测] |
| `mooc2-ans.chaoxing.com/visit/stucoursemiddle` | GET | 同上 | 老布局章节树 HTML（兜底） | [参考] |

章节解析要点（studentcourse）：
- 一级章：`catalog_num` 序号 + `catalog_name`；二级节：`id="cur<knowledgeId>"` / `chapter_item`，名称在 `a.clicktitle`（或 `catalog_name` title）。
- 任务点计数：`input.knowledgeJobCount`；状态在 `catalog_task` / `bntHoverTips`：`icon_yiwanc`=已完成、`catalog_points_yi` 数字=N 个待完成、"解锁"=未开放。
- 任务点明细（视频/文档/作业/阅读/直播）需按小节再取 `knowledge/cards` 的 `mArg.attachments`，`isPassed` 为完成态，`type:"workid"` 的 `jobid` 形如 `workid<id>`。

### 3.3 通知模块

| 接口 | 方法 | 参数 | 返回 | 置信度 |
| --- | --- | --- | --- | --- |
| `notice.chaoxing.com/pc/notice/getNoticeList` | POST | type, notice_type, lastValue, sort（游标 `notices.lastGetId`） | 通知列表 JSON：title/content/createrName/completeTime/isread（content 即全文） | [实测] |
| `notice.chaoxing.com/pc/notice/getNotices` | GET | type, page, size | 通知列表（旧接口，兜底） | [设计] |
| `notice.chaoxing.com/pc/notice/noticeDetail` | GET | `noticeId` | 通知详情 HTML | [设计] |
| `notice.chaoxing.com/pc/files/uploadNoticeFile` | POST | 文件流 | objectId（作业图片回填会用到） | [实测] |
| `mooc1-api.chaoxing.com/visit/iscourse...` | GET | — | 课程内消息（FxxkStar 实现） | [参考] |

类型划分：系统通知 / 课程通知 / 作业通知 / 考试通知（`noticeType` 字段区分）。

### 3.4 作业模块（含编程题）

| 接口 | 方法 | 参数 | 返回 | 置信度 |
| --- | --- | --- | --- | --- |
| `mooc1.chaoxing.com/mooc2/work/list` | GET | `courseId`, `classId`, `cpi`, `ut=s`, `openc`, `enc=<workEnc>`（**必须用中间页 workEnc**）, `t=<毫秒>`, `stuenc=<页面enc>`, `isdisplaytable=2`, `pageNum` | 作业列表 HTML：条目在 `<li onclick="goTask(this);" data="详情直链">`，标题 `p.overHidden2`，状态 `span.status`（未交/待批阅/已完成/已批阅），时间 `span.time`；分页数见 JS `pageNum : N` | [实测] |
| `mooc1-api.chaoxing.com/work/stu-work` | GET | — | **全局**学生作业聚合列表：`li[data]` + `p` 标题 + `span.status` 状态 + 课程名 span + `span.fr` 剩余时间 | [实测] |
| `mooc1-api.chaoxing.com/mooc-ans/work/list` | GET | `courseId`, `classId`, `cpi`, `ut=s` | 旧版作业列表（无 enc 参数，多数环境返回无权限/空页） | [参考] |
| `mooc1-api.chaoxing.com/mooc-ans/work/phone/doHomeWork` | GET | `workId`, `classId`, `cpi`, `ut=s` | 答题页 HTML：`div.pad30` 分题 + `h2.titType` 题型；链接常由详情页 script 中 `/work/phone/doHomeWork?...` 提取 | [实测] |
| `mooc1.chaoxing.com/mooc-ans/mooc2/work/task` | GET | `courseId`, `classId`, `cpi`, `workId`, `answerId`, `enc` | 作业详情直链（列表 li[data] 即此 URL）：题量/满分/"作答时间: MM-DD HH:MM 至 MM-DD HH:MM"/得分 | [实测] |
| `mooc1-api.chaoxing.com/work/addStudentWorkNew` | POST | `courseid`, `classId`, `cpi`, `workId`, `answer`(JSON), `totalScore`, `pyAnswer`... | 提交结果 | [实测] |
| `mooc1.chaoxing.com/mooc-ans/work/addStudentWork` | POST | 同上 | 提交结果（新版） | [实测] |
| `mooc1-api.chaoxing.com/work/addStudentWorkSave` | POST | 同上 | 暂存成功 | [参考] |

**2026-09 实测修正**：`work/list` 不带 `enc=<workEnc>`（或误用页面 `enc`）会返回"无权限"空页——这正是早期"作业列表全为空"的根因；
作业条目也不再是 `<a>` 链接结构，必须解析 `li[data]` 直链（含条目独立 `enc`）。

`answer`（answerList）结构（数组 JSON 字符串）：

```json
[
  {
    "answer": "<作答内容，编程题为纯文本/代码>",
    "answertype": 0,
    "questionId": 123456,
    "questionScore": 10,
    "answerid": "",
    "isRight": "",
    "ownScore": null
  }
]
```

题型（`answertype` / 页面 `topic`）：单选、多选、判断、填空、简答、**程序设计/程序填空（编程题）**、完形、连线。
编程题特征：题干含 `<pre class="brush:cpp">` 之类模板代码块、或题面声明"输入类作业/程序设计"，提交内容为源代码文本。

判题结果获取：
- 提交后轮询作业详情（`doHomeWork` / 查看页），读取 `score`、`isRight`、`teacherAnswer`、`markState`。
- 编程题平台侧判题状态：待测评 → 测评中 → 通过/答案错误/超时/运行错误/编译错误，与本地判题状态机保持同名映射（见 `services/judge.ts`）。

### 3.5 签到模块

| 接口 | 方法 | 参数 | 返回 | 置信度 |
| --- | --- | --- | --- | --- |
| `mobilelearn.chaoxing.com/v2/apis/active/student/activelist` | GET | `fid`, `uid` | `activeList[]`：`status==1 && otherId∈[0,5]` 为有效签到 | [实测] |
| `mobilelearn.chaoxing.com/newsign/preSign` | GET | `activeId`, `classId`, `uid`, `courseId`, `fid` | 预签到（所有签到前必须调用） | [实测] |
| `mobilelearn.chaoxing.com/pptSign/analysis` | GET | `id` | 解析出签到 code | [实测] |
| `mobilelearn.chaoxing.com/pptSign/analysis2` | GET | `id` | 备用解析 | [实测] |
| `mobilelearn.chaoxing.com/pptSign/checkSignCode` | GET | `activeId`, `signCode` | 手势/签到码校验（**必须先过校验**） | [实测] |
| `mobilelearn.chaoxing.com/pptSign/stuSignajax` | GET | `activeId`, `uid`, `name`, `fid`, `objectId`/`address`/`enc`/`signCode` | 签到结果 | [实测] |
| `pan-yz.chaoxing.com/api/token/uservalid` | GET | — | 云盘 token | [实测] |
| `pan-yz.chaoxing.com/upload` | POST | `puid`, `_token`, 文件 | objectId | [实测] |

`otherId` 签到类型：0=普通/拍照、2=二维码、3=手势、4=位置、5=签到码。

**合规约束（Fanxing 必须遵守）**：不提供位置伪造、不代签他人；位置签到仅展示教师要求的位置范围并由用户本人确认真实位置后提交。

### 3.6 成绩模块

| 接口 | 方法 | 参数 | 返回 | 置信度 |
| --- | --- | --- | --- | --- |
| `mooc1-api.chaoxing.com/mooc-ans/coursegrade/gradeList` | GET | `courseId`, `classId`, `cpi` | 分项成绩（平时/作业/考试） | [设计] |
| `mooc2-ans.chaoxing.com/visit/stucoursemiddle` 成绩区块 | GET | 同上 | 成绩入口与总评 | [参考] |

### 3.7 图片 / 公式资源

| 资源 | 处理方式 |
| --- | --- |
| `p.ananas.chaoxing.com/star3/...` | 题目图片；**防盗链**：请求需带 `Referer: https://mooc1.chaoxing.com/` 与浏览器 UA，下载到本地缓存后经 `webview.asWebviewUri` 提供 |
| `<img alt="公式">` | alt 文本若为 LaTeX/可识别数学表达式 → 直接用 KaTeX 渲染 |
| 纯图片公式 | 保留原图 + 用户可手动输入 LaTeX 替换；OCR 还原为可选增强（`fanxing.formula.ocrEndpoint`） |

---

## 四、字体混淆（题目文本解密）

部分作业题目文本使用自定义字体映射混淆（同一张字体文件中字形编码随机化）。
参考实现：`menghuanshiguang/chaoxing-cli` 的 `cxlib/`（fonttools 映射表）、`chettoy/cxmooc-tools` 的 WebAssembly 解密模块。
Fanxing 策略：
1. 解析答题页 HTML 中的 `@font-face` 指向的字体文件（`p.ananas.chaoxing.com` 或 `mooc1-api` 静态域）；
2. 使用内置映射表（`src/api/fontmap.json`，可更新）尝试还原；
3. 还原失败时原文展示并提示用户对照网页端题目。

---

## 五、对 Fanxing 的实现约束

1. 全部请求模拟浏览器 UA，携带 Cookie 与 `Referer`，失败自动重试（指数退避，最多 3 次）。
2. 密码/Cookie/API Key 一律存 `SecretStorage`，日志脱敏（只打印 URL 与状态码）。
3. 编程题流程：**本地编译 + 样例测试通过后才允许提交**（可配置关闭），提交前二次确认。
4. AI 只做"引导"，系统提示词层面禁止输出完整解题代码。
5. 签到功能仅限用户本人课程，位置签到不做任何模拟。
6. 接口存在变更风险：`[设计]` 级接口首次调用需把原始响应写入调试日志（脱敏）便于适配。
