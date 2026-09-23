/**
 * 运行环境检测：编译器/解释器 + VS Code 语言扩展 + 安装引导（复刻学习通 OJ 环境）。
 */
import * as vscode from 'vscode';
import { LANGUAGES, LanguageSpec } from '../config/constants';
import { LocalJudge } from './judge';

export interface ToolStatus {
  id: string;
  label: string;
  command: string;
  ok: boolean;
  version?: string;
  /** 各平台安装引导 */
  fix: { windows: string; macos: string; linux: string };
  ojEnvironment: string;
}

export interface ExtensionStatus {
  id: string;
  label: string;
  ok: boolean;
}

/** 语言 -> 推荐扩展 */
const RECOMMENDED_EXTENSIONS: Array<{ language: string; id: string; label: string }> = [
  { language: 'c', id: 'ms-vscode.cpptools', label: 'C/C++' },
  { language: 'cpp', id: 'ms-vscode.cpptools', label: 'C/C++' },
  { language: 'java', id: 'vscjava.vscode-java-pack', label: 'Extension Pack for Java' },
  { language: 'python', id: 'ms-python.python', label: 'Python' }
];

export class EnvChecker {
  /** 检测指定语言所需工具链 */
  async checkTools(languages: LanguageSpec[] = Object.values(LANGUAGES)): Promise<ToolStatus[]> {
    const out: ToolStatus[] = [];
    for (const lang of languages) {
      const commands = lang.compile ? [lang.compile] : ['python3', 'python'];
      let found: ToolStatus | undefined;
      for (const cmd of commands) {
        const version = await LocalJudge.detect(cmd, lang.id === 'java' && cmd === 'javac' ? ['-version'] : ['--version']);
        if (version) {
          found = {
            id: lang.id,
            label: `${lang.label} (${cmd})`,
            command: cmd,
            ok: true,
            version,
            fix: fixFor(cmd),
            ojEnvironment: lang.ojEnvironment
          };
          break;
        }
      }
      out.push(
        found ?? {
          id: lang.id,
          label: `${lang.label} (${commands.join('/')})`,
          command: commands[0],
          ok: false,
          fix: fixFor(commands[0]),
          ojEnvironment: lang.ojEnvironment
        }
      );
    }
    return out;
  }

  /** 检测推荐的 VS Code 语言扩展 */
  checkExtensions(languages: LanguageSpec[] = Object.values(LANGUAGES)): ExtensionStatus[] {
    const ids = new Set<string>(languages.map((l) => l.id));
    return RECOMMENDED_EXTENSIONS.filter((e) => ids.has(e.language)).map((e) => ({
      id: e.id,
      label: e.label,
      ok: !!vscode.extensions.getExtension(e.id)
    }));
  }

  /** 生成安装引导（按平台） */
  buildGuide(tools: ToolStatus[]): string {
    const platform = process.platform;
    const lines: string[] = [];
    for (const tool of tools.filter((t) => !t.ok)) {
      const fix = platform === 'win32' ? tool.fix.windows : platform === 'darwin' ? tool.fix.macos : tool.fix.linux;
      lines.push(`- ${tool.label}: ${fix}`);
    }
    return lines.join('\n');
  }

  /** 一键安装命令（由 UI 提示用户执行，不自动执行） */
  suggestInstallCommand(command: string): string {
    const platform = process.platform;
    const map: Record<string, { win: string; mac: string; linux: string }> = {
      gcc: { win: 'winget install -e --id MSYS2.MSYS2  # 或 MinGW', mac: 'xcode-select --install', linux: 'sudo apt install build-essential  /  sudo dnf groupinstall "Development Tools"' },
      gpp: { win: 'winget install -e --id MSYS2.MSYS2', mac: 'xcode-select --install', linux: 'sudo apt install g++' },
      javac: { win: 'winget install -e --id Microsoft.OpenJDK.21', mac: 'brew install openjdk', linux: 'sudo apt install default-jdk' },
      java: { win: 'winget install -e --id Microsoft.OpenJDK.21', mac: 'brew install openjdk', linux: 'sudo apt install default-jdk' },
      python3: { win: 'winget install -e --id Python.Python.3.12', mac: 'brew install python3', linux: 'sudo apt install python3' },
      python: { win: 'winget install -e --id Python.Python.3.12', mac: 'brew install python3', linux: 'sudo apt install python3' }
    };
    const key = command === 'g++' ? 'gpp' : command;
    const item = map[key];
    if (!item) {
      return `请安装 ${command} 并加入 PATH`;
    }
    return platform === 'win32' ? item.win : platform === 'darwin' ? item.mac : item.linux;
  }
}

function fixFor(command: string): { windows: string; macos: string; linux: string } {
  const map: Record<string, { windows: string; macos: string; linux: string }> = {
    gcc: {
      windows: 'winget install -e --id MSYS2.MSYS2（含 gcc）或安装 MinGW-w64',
      macos: 'xcode-select --install（Command Line Tools 自带 clang/gcc）',
      linux: 'sudo apt install build-essential'
    },
    'g++': {
      windows: 'winget install -e --id MSYS2.MSYS2（含 g++）',
      macos: 'xcode-select --install',
      linux: 'sudo apt install g++'
    },
    javac: {
      windows: 'winget install -e --id Microsoft.OpenJDK.21',
      macos: 'brew install openjdk',
      linux: 'sudo apt install default-jdk'
    },
    python3: {
      windows: 'winget install -e --id Python.Python.3.12',
      macos: 'brew install python3',
      linux: 'sudo apt install python3'
    },
    python: {
      windows: 'winget install -e --id Python.Python.3.12',
      macos: 'brew install python3',
      linux: 'sudo apt install python3'
    }
  };
  return (
    map[command] ?? {
      windows: `安装 ${command} 并加入 PATH`,
      macos: `brew install ${command}`,
      linux: `sudo apt install ${command}`
    }
  );
}
