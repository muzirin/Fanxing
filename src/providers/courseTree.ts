/**
 * 课程树：课程 -> 章节 -> 任务点（TreeView，原生图标 ThemeIcon）。
 */
import * as vscode from 'vscode';
import { FanxingContext } from '../context';
import { Chapter, Course, TaskPoint } from '../api/types';

export class CourseNode extends vscode.TreeItem {
  constructor(readonly course: Course) {
    super(course.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(course.status === 'active' ? 'book' : 'archive');
    this.description = `${course.teacher}${course.progress !== undefined ? `  ${course.progress}%` : ''}`;
    this.tooltip = new vscode.MarkdownString(
      `**${course.name}**\n\n教师: ${course.teacher}\n\n班级: ${course.clazzId}\n\n课程: ${course.courseId}\n\n状态: ${
        course.status === 'active' ? '进行中' : '已结课'
      }${course.progress !== undefined ? `\n\n进度: ${course.progress}%` : ''}`
    );
    this.contextValue = 'course';
  }
}

export class ChapterNode extends vscode.TreeItem {
  constructor(readonly course: Course, readonly chapter: Chapter) {
    super(chapter.name, vscode.TreeItemCollapsibleState.Collapsed);
    this.iconPath = new vscode.ThemeIcon(chapter.unlocked ? 'folder' : 'lock');
    this.description = chapterProgressLabel(chapter);
    this.contextValue = 'chapter';
  }
}

function chapterProgressLabel(chapter: Chapter): string {
  if (chapter.tasks.length) {
    const done = chapter.tasks.filter((t) => t.done).length;
    return `${done}/${chapter.tasks.length} 任务点`;
  }
  if (chapter.jobCount !== undefined) {
    return `${chapter.doneCount ?? 0}/${chapter.jobCount} 任务点`;
  }
  if (chapter.pendingCount !== undefined) {
    return chapter.pendingCount ? `${chapter.pendingCount} 个待完成` : '已完成';
  }
  return '';
}

export class TaskNode extends vscode.TreeItem {
  constructor(readonly task: TaskPoint) {
    super(task.name, vscode.TreeItemCollapsibleState.None);
    this.iconPath = new vscode.ThemeIcon(taskIcon(task));
    this.description = task.done ? '已完成' : '未完成';
    this.contextValue = `task-${task.kind}`;
  }
}

function taskIcon(task: TaskPoint): string {
  switch (task.kind) {
    case 'video':
      return task.done ? 'check' : 'circle-large-outline';
    case 'document':
      return 'file';
    case 'work':
      return 'note';
    case 'discussion':
      return 'comment';
    case 'read':
      return 'book';
    default:
      return 'circle-outline';
  }
}

export class CourseTreeProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly emitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.emitter.event;
  private readonly tasksLoaded = new Set<string>();

  constructor(private readonly ctx: FanxingContext) {}

  refresh(): void {
    this.emitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: vscode.TreeItem): Promise<vscode.TreeItem[]> {
    if (!this.ctx.session.isLoggedIn) {
      return [];
    }
    if (!element) {
      return this.ctx.state.courses.map((c) => new CourseNode(c));
    }
    if (element instanceof CourseNode) {
      const course = element.course;
      let chapters = this.ctx.state.chapters.get(course.courseId);
      if (!chapters) {
        try {
          const content = await this.ctx.courses.loadCourseContent(course);
          chapters = content.chapters;
          this.ctx.state.chapters.set(course.courseId, chapters);
          if (content.progress && content.progress.total > 0) {
            course.progress = Math.round((content.progress.done / content.progress.total) * 100);
          }
        } catch (err) {
          this.ctx.logger.warn('章节加载失败', String(err));
          return [];
        }
      }
      return chapters.map((ch) => new ChapterNode(course, ch));
    }
    if (element instanceof ChapterNode) {
      const chapter = element.chapter;
      if (!this.tasksLoaded.has(chapter.id)) {
        this.tasksLoaded.add(chapter.id);
        try {
          chapter.tasks = await this.ctx.courses.listTasks(element.course, chapter);
        } catch (err) {
          this.ctx.logger.debug('任务点加载失败', String(err));
        }
      }
      return chapter.tasks.map((t) => new TaskNode(t));
    }
    return [];
  }
}
