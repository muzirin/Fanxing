# Fanxing 泛星（繁星）

> 超星学习通的 VS Code 集成开发环境（Chaoxing-VSC）。
> 课程 / 通知 / 作业 / 编程题「在 VS Code 里写、在 VS Code 里测、一键提交学习通」，外加环境检测与 AI 引导式辅导。

界面完全使用 VS Code 原生视觉（`--vscode-*` 主题变量 + codicon 图标），不使用 emoji 作为图标。

当前版本：**1.0.0-b1**（首个 Beta，见 [CHANGELOG.md](CHANGELOG.md)）。

---

## 功能

### 信息
- 课程列表（TreeView）：课程 → 章节 → 任务点，完成状态与进度
- 通知：未读/已读、分类（系统/课程/作业/考试）、桌面提醒、轮询间隔可配置
- 作业：按课程分组，截止倒计时与临近预警，区分编程题/书面/测验/小组
- 成绩：分项成绩 + 趋势条形图（主题自适应）
- 日程（DDL）：汇总作业/考试截止时间，状态栏倒计时，一键导出 `.ics` 到系统日历
- 签到：检测教师发起的签到并提醒，插件内完成普通/手势/签到码/二维码签到（位置签到只展示要求、由本人确认真实位置，**不做位置模拟、不代签**）

### 编程作业（核心）
- 题目面板（Webview）+ 代码编辑器分屏
  - 富文本题干、KaTeX 公式渲染
  - 图片公式：优先用图片 alt 文本还原 LaTeX，否则下载到本地缓存（带 Referer 破防盗链）正常展示，可选外部 OCR 还原服务
  - 题库编号（题号）展示，方便对照题库
  - 样例输入输出表格化展示、时间/内存限制展示
- 自动创建**每题独立**源文件（`q1.c` / `q2.cpp` / `q1.py`；Java 固定 `Main.java`，按 `q{n}/` 目录区分），并填入模板/上次作答代码；历史文件自动迁移
- **本地测试**：本地编译运行 → 与样例输出 diff 对比 → 逐用例状态 / 耗时；每题下方独立结果区，**始终展示控制台输出**，失败用例附标准错误、进程退出码与崩溃解读（如 `0xC0000005 访问违例：常见于 scanf 缺 &`）
- 自定义测试用例（按题写入 `q{n}/cases/customNN.in|.out`）
- **提交到学习通**：本地测试全部通过后才允许提交（可配置）→ 提交前确认代码 → 逐题附带各自代码 → 轮询平台判题（AC/WA/TLE/MLE/RE/CE）→ 记录提交历史
- 切换作业时自动保存并关闭当前作业的面板与文件，同一作业各题文件在同一编辑器组内以标签并存
- CodeLens：代码文件顶部直接显示「本地测试 / 提交到学习通 / AI 代码审查 / AI 思路引导」

### 运行环境
- 首次使用自动检测 gcc/g++、JDK、Python 等，给出版本与「学习通 OJ 环境」说明
- 未安装时提供分平台安装引导（winget / brew / apt/dnf/pacman）
- 检测并推荐 VS Code 语言扩展（C/C++、Python、Java）

### AI 辅助（引导而非代写）
- 自定义 AI 提供商（OpenAI 兼容：OpenAI / DeepSeek / 通义千问 / 本地 Ollama），支持代理
- API Key 存 `SecretStorage`，不写入配置文件
- 能力：代码审查、思路引导、错误分析、复杂度分析（TLE 风险）、代码风格、样例推导讲解
- **禁止代写**：系统提示词层面禁止输出完整解题代码，并对输出做后置校验（疑似完整代码时附提醒）

### 安全与隐私
- 密码 / Cookie / API Key 全部 `SecretStorage`；日志自动脱敏（Cookie、Token、密码等）
- 多账号保存与切换
- 离线缓存（globalStorage JSON + TTL），断网可看已缓存数据

## 安装

### 从源码构建

```bash
git clone https://github.com/muzirin/Fanxing.git fanxing
cd fanxing
npm install
npm run build        # esbuild 打包 -> dist/extension.js
```

调试运行：用 VS Code 打开本目录，按 F5（Run Extension）。

打包 vsix：

```bash
npm i -D @vscode/vsce
npx vsce package      # 生成 fanxing-1.0.0-b1.vsix
```

然后在 VS Code 中 `扩展: 从 VSIX 安装`。

### 环境要求

- VS Code 1.90+
- 本地编译器（按需）：gcc/g++、JDK、Python 3.8+（插件内置检测与安装引导）

## 使用

1. **登录**：命令面板执行 `Fanxing: 登录`（推荐扫码），或 `Fanxing: 使用 Cookie 登录`
2. **刷新**：侧边栏课程视图标题栏的刷新按钮，或 `Fanxing: 刷新课程`
3. **答题**：作业视图中点击作业 → 自动打开题目面板与该题代码文件（`q1.c`…，切换作业时自动保存并关闭上一份）
4. **本地测试**：CodeLens / 面板按钮 / 命令面板 `Fanxing: 本地测试`
5. **提交**：本地样例全过 → `Fanxing: 提交当前作业` → 确认代码 → 等待判题结果
6. **AI**：`Fanxing: 配置 AI 提供商` 后可使用各类 AI 引导命令

### 命令一览

| 命令 | 说明 |
| --- | --- |
| `Fanxing: 登录` | 扫码/密码/短信/Cookie 登录 |
| `Fanxing: 切换账号` | 多账号切换 |
| `Fanxing: 刷新课程` | 拉取课程/作业/通知 |
| `Fanxing: 检查通知` | 手动检查通知 |
| `Fanxing: 提交当前作业` | 提交编程题（含前置本地测试） |
| `Fanxing: 本地测试` | 编译运行 + 样例比对 |
| `Fanxing: 添加测试用例` | 自定义测试数据 |
| `Fanxing: AI 代码审查 / 思路引导 / 错误分析 / 复杂度分析` | AI 引导式辅助 |
| `Fanxing: 检查运行环境` | 编译器/扩展检测与安装引导 |
| `Fanxing: 查看成绩` / `刷新成绩` | 成绩与趋势 |
| `Fanxing: 导出日程到日历文件` | 生成 `.ics` |
| `Fanxing: 提交记录` | 历史提交与判题结果 |

## 配置

全部配置位于 `fanxing.*`（设置面板搜索 `Fanxing`）：通知/签到轮询间隔、默认语言、本地测试强制开关、
编译参数（默认 `-O2 -std=c++17` 等，对齐学习通 OJ）、单用例超时、AI 提供商、公式 OCR 服务、缓存 TTL、下载目录、界面语言、日志级别。

## 截图

- 侧边栏（课程/作业/通知/签到/成绩/日程/概览）
  > 截图待补充：`docs/images/sidebar.png`
- 题目面板 + 分屏编辑器
  > 截图待补充：`docs/images/problem-panel.png`
- 本地测试结果（diff 对比）
  > 截图待补充：`docs/images/local-test.png`
- 环境检测报告
  > 截图待补充：`docs/images/env-check.png`

## 项目结构

```
Fanxing/
├── src/
│   ├── extension.ts          # 入口：装配与注册
│   ├── context.ts            # 依赖容器（API/服务/状态）
│   ├── workbench.ts          # 命令与业务流程
│   ├── api/                  # 学习通接口封装（auth/course/homework/notification/signin/grade/oj + parsers）
│   ├── providers/            # TreeView / Webview / CodeLens / StatusBar
│   ├── services/             # 判题、环境检测、AI、缓存、会话、密钥、公式、DDL、i18n、日志
│   ├── views/                # Webview 外壳（原生样式 + KaTeX）
│   ├── utils/                # 纯函数工具（文本/加密/时间）
│   └── config/               # 常量与语言/判题定义
├── docs/API-RESEARCH.md      # 接口调研报告（必读）
├── test/                     # 单元测试（mocha）
├── media/                    # 图标（SVG，非 emoji）
└── package.json              # 插件 manifest（视图/命令/配置）
```

## 测试

```bash
npm run typecheck   # tsc --noEmit
npm test            # mocha（纯逻辑层：解析/工具/判题/日志脱敏）
```

## 已知限制

- 部分接口标记为「待验证」（见 `docs/API-RESEARCH.md`），首次运行如遇结构变化，请开启 `fanxing.log.level=debug` 提交 issue
- 题目文本若存在超星字体混淆，未命中内置映射表时以原文展示
- 书面/小组作业的附件批量下载、讨论区集成在后续版本提供

## 合规声明

本项目仅用于本人学习与作业开发流程提效。请勿用于代签、位置伪造、批量刷课或其他违反校规校纪与平台条款的行为。
使用本项目产生的任何后果由使用者自行承担。

## 贡献

欢迎 Issue 与 Pull Request，详见 [CONTRIBUTING.md](CONTRIBUTING.md)。概要：

1. Fork & branch（`feat/*` / `fix/*`）
2. 保持 `npm run typecheck` 与 `npm test` 通过，新功能补测试
3. 接口变更请同步更新 `docs/API-RESEARCH.md`；结构变化可运行「Fanxing: 抓取作业原始响应」提供脱敏样本
4. 提交 Pull Request，说明动机、方案与验证方式

## License

[GPL-3.0-only](LICENSE)（GNU General Public License v3.0）

本项目免费开源，依 GPL-3.0 条款分发：你可以使用、修改与再分发，但衍生作品必须以相同协议开源，并保留版权声明与许可文本。
