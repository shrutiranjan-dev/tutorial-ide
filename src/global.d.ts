import type {
  CommandResult,
  FileNode,
  InterviewPrompt,
  InterviewTurn,
  Lesson,
  ProgressEvent,
  ProgressMap,
  Roadmap,
  RoadmapAnswers
} from "./types";

type ChatPayload = {
  model: string;
  task: string;
  lessonTitle?: string;
  lessonGoal?: string;
  filePath?: string;
  code?: string;
  terminal?: string;
  question?: string;
};

declare global {
  interface Window {
    tutorialIde: {
      lessons: {
        list: () => Promise<Lesson[]>;
        open: (lessonId?: string) => Promise<{ lesson: Lesson; workspacePath: string }>;
        run: (lessonId: string, workspacePath: string) => Promise<CommandResult>;
        checkpoint: (
          lessonId: string,
          workspacePath: string
        ) => Promise<CommandResult & { passed: boolean; output: string }>;
      };
      roadmaps: {
        list: () => Promise<Roadmap[]>;
        create: (answers: RoadmapAnswers) => Promise<{ roadmap: Roadmap; lessonId: string }>;
        interviewStart: (payload: { model?: string }) => Promise<InterviewPrompt>;
        interviewReply: (payload: {
          model?: string;
          transcript: InterviewTurn[];
        }) => Promise<InterviewPrompt>;
        createFromInterview: (payload: {
          model?: string;
          transcript: InterviewTurn[];
        }) => Promise<{ roadmap: Roadmap; lessonId: string }>;
        advance: (
          lessonId: string,
          skipped?: boolean
        ) => Promise<{ done: boolean; roadmap?: Roadmap; lessonId?: string; action?: string; reason?: string }>;
        remove: (roadmapId: string) => Promise<{ ok: boolean; removedLessonIds: string[] }>;
      };
      files: {
        list: (workspacePath: string) => Promise<FileNode[]>;
        read: (workspacePath: string, relativePath: string) => Promise<string>;
        write: (workspacePath: string, relativePath: string, content: string) => Promise<boolean>;
      };
      progress: {
        load: () => Promise<ProgressMap>;
        save: (progress: ProgressMap) => Promise<boolean>;
        record: (event: ProgressEvent) => Promise<ProgressMap>;
      };
      ollama: {
        status: () => Promise<{ online: boolean; message?: string }>;
        models: () => Promise<string[]>;
        chat: (payload: ChatPayload) => Promise<string>;
      };
      terminal: {
        start: (workspacePath: string) => Promise<{ id: string; mode: string }>;
        write: (terminalId: string, data: string) => void;
        resize: (terminalId: string, cols: number, rows: number) => void;
        stop: (terminalId: string) => void;
        onData: (callback: (terminalId: string, data: string) => void) => () => void;
        onExit: (callback: (terminalId: string) => void) => () => void;
      };
    };
  }
}

export {};
