# 参与贡献

感谢你对 Fanxing（泛星）的关注。本项目是超星学习通的 VS Code 集成开发环境，目标是把「查作业 → 写代码 → 本地测试 → 提交」完整搬进 VS Code。

## 开发环境

- Node.js 18+、VS Code 1.90+
- 本地工具链按需：gcc/g++、JDK、Python 3.8+（插件内置检测）

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # mocha 单元测试
npm run build       # esbuild 打包 -> dist/extension.js
```

调试运行：用 VS Code 打开本目录，按 **F5**（Run Extension）启动插件开发宿主。

## 仓库结构

```
src/
├── extension.ts        # 入口：装配与注册
├── context.ts          # 依赖容器（API/服务/状态）
├── workbench.ts        # 命令与业务流程
├── api/                # 学习通接口封装（auth/course/homework/notification/signin/grade/oj + parsers）
├── providers/          # TreeView / Webview / CodeLens / StatusBar
├── services/           # 判题、环境检测、AI、缓存、会话、密钥、公式、DDL、i18n、日志
├── views/              # Webview 外壳（原生样式 + KaTeX）
├── utils/              # 纯函数工具（文本/加密/时间）
└── config/             # 常量与语言/判题定义
docs/API-RESEARCH.md    # 接口调研报告（改动接口前必读）
test/                   # 单元测试（mocha + tsx）
```

## 代码规范

- TypeScript 严格模式；核心解析/判题逻辑保持纯函数、与 VS Code API 解耦，便于单测
- 注释使用中文，简洁说明「为什么」；不引入无意义注释
- UI 一律 VS Code 原生视觉（`--vscode-*` 变量、codicon、ThemeIcon），**不使用 emoji 作为图标**
- 遵循既有文件的结构与命名习惯，优先扩展既有模块而非另起炉灶

## 测试要求

- 提交前确保 `npm run typecheck` 与 `npm test` 全绿
- 新功能必须补单元测试；修 bug 先补能复现的回归用例（参考 `test/parsers.test.ts`、`test/judge.test.ts`）
- 解析器改动请把真实页面结构裁剪成脱敏样本加入测试

## 接口适配流程（本项目最常见的贡献）

学习通接口与页面结构会变化，适配流程：

1. 命令面板执行 `Fanxing: 抓取作业原始响应`，得到 `fanxing-debug/`（含 `summary.txt`、课程中间页、作业列表、stu-work、通知、签到的原始响应）
2. **脱敏**后（去掉姓名/学号/手机号等）把样本提交 Issue 或放进 PR
3. 修改 `src/api/parsers.ts` 适配结构，并补回归测试
4. 同步更新 `docs/API-RESEARCH.md`（接口、参数、结构要点与置信度标注）

## 安全与合规红线

- **禁止**代签、位置伪造/模拟、批量刷课等能力进入代码库；签到位置必须由使用者本人提供真实值
- 凭据（密码 / Cookie / API Key）只允许存 `SecretStorage`，禁止写入配置文件、日志或仓库
- 日志必须经脱敏（见 `utils/text.ts` `redact`）；调试样本入库前自行脱敏

## 提交与 PR

1. Fork 并建分支：`feat/*`、`fix/*`、`docs/*`
2. 提交信息简洁明确（中文或英文均可），一个提交只做一件事
3. PR 说明：动机、方案、验证方式（测试/复现步骤）；接口变更附脱敏样本
4. 保持 `dist/`、`node_modules/`、`fanxing-debug/` 不入库

## 许可证

本项目以 [GPL-3.0-only](LICENSE) 发布。提交贡献即表示你同意以 **GPL-3.0-only** 将该贡献授权给本项目（与项目同许可证，inbound = outbound），并确认你有权如此授权（例如为本人原创或已获再授权）。
