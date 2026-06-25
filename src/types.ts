export type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

export type TutorialIdeBridge = {
  project: {
    default: () => Promise<string>;
    open: () => Promise<string | null>;
  };
  opencode: {
    info: () => Promise<{ installed: boolean; version: string; bin: string; command: string }>;
    providers: () => Promise<Array<{ id: string; label: string; kind: string; command: string }>>;
    models: (provider?: string) => Promise<CommandResult & { models: string[] }>;
    syncOllama: (payload: { projectPath: string; models: string[] }) => Promise<{ ok: boolean; path: string; modelCount: number; defaultModel: string }>;
    commands: (payload: AgentProjectPayload) => Promise<AgentCommandInfo[]>;
    providerState: (payload: AgentProjectPayload) => Promise<AgentProviderState>;
    providerAuth: (payload: AgentProjectPayload) => Promise<AgentProviderAuthMap>;
    providerAuthorize: (payload: AgentProviderAuthorizePayload) => Promise<AgentProviderAuthorization | null>;
    providerCallback: (payload: AgentProviderCallbackPayload) => Promise<boolean>;
    providerApiKey: (payload: AgentProviderApiKeyPayload) => Promise<boolean>;
    command: (payload: AgentPromptPayload & { mode: "run" }) => Promise<CommandResult>;
    sendPrompt: (payload: AgentPromptPayload) => Promise<CommandResult>;
    shell: (payload: AgentShellPayload) => Promise<CommandResult>;
    sessions: (payload: AgentProjectPayload) => Promise<AgentSessionSummary[]>;
    startSession: (payload: AgentSessionStartPayload) => Promise<AgentSessionStartResult>;
    session: (payload: AgentSessionPayload) => Promise<AgentSessionDetail | null>;
    getSession: (payload: AgentSessionPayload) => Promise<AgentSessionDetail | null>;
    sessionUpdate: (payload: AgentSessionUpdatePayload) => Promise<AgentSessionDetail | boolean>;
    updateSession: (payload: AgentSessionUpdatePayload) => Promise<AgentSessionDetail | boolean>;
    sessionFork: (payload: AgentSessionForkPayload) => Promise<AgentSessionSummary | AgentSessionDetail>;
    fork: (payload: AgentSessionForkPayload) => Promise<AgentSessionSummary | AgentSessionDetail>;
    sessionDelete: (payload: AgentSessionPayload) => Promise<boolean>;
    deleteSession: (payload: AgentSessionPayload) => Promise<boolean>;
    messages: (payload: AgentSessionPayload) => Promise<unknown[]>;
    abort: (payload: AgentSessionPayload) => Promise<boolean>;
    eventsStart: (payload: AgentEventStreamPayload) => Promise<AgentEventStream>;
    startEvents: (payload: AgentEventStreamPayload) => Promise<AgentEventStream>;
    eventsStop: (payload: AgentEventStreamPayload | string) => Promise<boolean>;
    stopEvents: (payload: AgentEventStreamPayload | string) => Promise<boolean>;
    permissions: (payload: AgentSessionPayload) => Promise<AgentPermissionRequest[]>;
    permissionList: (payload: AgentSessionPayload) => Promise<AgentPermissionRequest[]>;
    permissionReply: (payload: AgentPermissionReplyPayload) => Promise<boolean>;
    todo: (payload: AgentTodoPayload) => Promise<AgentTodoItem[]>;
    diff: (payload: AgentDiffPayload) => Promise<AgentDiffFile[]>;
    sessionCommand: (payload: AgentSessionCommandPayload) => Promise<CommandResult>;
    revert: (payload: AgentRevertPayload) => Promise<boolean>;
    unrevert: (payload: AgentSessionPayload) => Promise<boolean>;
    onEvent: (callback: (event: AgentRuntimeEvent) => void) => () => void;
  };
  files: {
    list: (workspacePath: string) => Promise<FileNode[]>;
    read: (workspacePath: string, relativePath: string) => Promise<string>;
    write: (workspacePath: string, relativePath: string, content: string) => Promise<boolean>;
    createFile: (workspacePath: string, relativePath: string, content?: string) => Promise<boolean>;
    createFolder: (workspacePath: string, relativePath: string) => Promise<boolean>;
    delete: (workspacePath: string, relativePath: string) => Promise<boolean>;
    rename: (workspacePath: string, fromPath: string, toPath: string) => Promise<boolean>;
    duplicate: (workspacePath: string, fromPath: string, toPath: string) => Promise<boolean>;
  };
  workspace: {
    search: (workspacePath: string, payload: {
      query: string;
      regex?: boolean;
      matchCase?: boolean;
      wholeWord?: boolean;
      include?: string;
      exclude?: string;
    }) => Promise<Array<{ path: string; line: number; column: number; preview: string }>>;
    symbols: (workspacePath: string, query?: string) => Promise<Array<{ name: string; path: string; line: number; preview: string }>>;
  };
  git: {
    status: (workspacePath: string) => Promise<{
      ok: boolean;
      branch: string;
      changes: Array<{ status: string; path: string }>;
      message: string;
    }>;
    command: (workspacePath: string, command: "fetch" | "pull" | "push" | "status") => Promise<CommandResult>;
  };
  progress: {
    load: () => Promise<ProgressMap>;
    save: (progress: ProgressMap) => Promise<boolean>;
    record: (event: ProgressEvent) => Promise<ProgressMap>;
  };
  lessons: {
    list: () => Promise<Lesson[]>;
    open: (lessonId?: string) => Promise<{ lesson: Lesson; workspacePath: string }>;
    run: (lessonId: string, workspacePath: string) => Promise<CommandResult>;
    checkpoint: (lessonId: string, workspacePath: string) => Promise<CommandResult>;
  };
  roadmaps: {
    list: () => Promise<Roadmap[]>;
    create: (answers: unknown) => Promise<{ roadmap: Roadmap; lessonId?: string }>;
    interviewStart: (payload?: { model?: string }) => Promise<InterviewPrompt>;
    interviewReply: (payload: { transcript: InterviewTurn[]; answer: string; model?: string }) => Promise<InterviewPrompt>;
    createFromInterview: (payload: { transcript: InterviewTurn[]; model?: string }) => Promise<{ roadmap: Roadmap; lessonId?: string }>;
    advance: (lessonId: string, skipped?: boolean) => Promise<{ lesson?: Lesson; workspacePath?: string; progress?: ProgressMap; done?: boolean; action?: string; reason?: string }>;
    remove: (roadmapId: string) => Promise<{ ok: boolean; removedRoadmapId?: string; removedLessonIds?: string[] }>;
  };
  ollama: {
    status: () => Promise<{ online: boolean; message?: string }>;
    models: () => Promise<string[]>;
    chat: (payload: any) => Promise<string>;
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

export type Lesson = {
  id: string;
  order: number;
  roadmapId?: string;
  roadmapIndex?: number;
  sourceDir?: string;
  title: string;
  language: string;
  description: string;
  goal: string;
  steps: string[];
  hints: string[];
  skillsIntroduced?: string[];
  skillsPracticed?: string[];
  prerequisites?: string[];
  difficulty?: "intro" | "guided" | "practice" | "challenge" | "capstone";
  remediation?: string;
  entryFile: string;
  checkpoint?: {
    command: string;
    expectedOutput?: string;
  };
};

export type Roadmap = {
  id: string;
  topic: string;
  level: string;
  language: string;
  outcome: string;
  pace: string;
  goalType?: string;
  skillGap?: {
    actualLevel: string;
    missingPrerequisites: string[];
    estimatedDifficulty?: string;
  };
  capstone?: {
    capstone: string;
    skillsRequired: string[];
  };
  courseSource?: string;
  courseTrack?: {
    id: string;
    label: string;
    sourceUrl: string;
    exerciseUrl?: string;
  } | null;
  timePlan?: {
    pace: string;
    weeklyMinutes: number;
    targetWeeks: number;
    maxLessons: number;
    minutesPerLesson: number;
    depthLabel: string;
  };
  depthLevel?: string;
  topicOrder?: string[];
  milestones?: Array<{
    milestone: string;
    modules: Array<{
      title: string;
      objective: string;
      task: string;
      artifact: string;
      validation: string;
      estimatedHours?: number;
      skillsIntroduced?: string[];
      skillsPracticed?: string[];
      prerequisites?: string[];
      difficulty?: "intro" | "guided" | "practice" | "challenge" | "capstone";
      remediation?: string;
      estimatedMinutes?: number;
      w3schoolsTopic?: string;
      sourceUrl?: string;
      exerciseUrl?: string;
    }>;
    checkpoint: string;
    miniProject: string;
  }>;
  quality?: {
    validated: boolean;
    issues: string[];
  };
  currentIndex: number;
  createdAt: string;
  completedAt?: string;
  createdLessonIds: string[];
  skippedLessonIds: string[];
  modules: Array<{
    index: number;
    title: string;
    goal: string;
    objective?: string;
    level: string;
    outcome: string;
    task?: string;
    artifact?: string;
    validation?: string;
    milestone?: string;
    estimatedHours?: number;
    skillsIntroduced?: string[];
    skillsPracticed?: string[];
    prerequisites?: string[];
    difficulty?: "intro" | "guided" | "practice" | "challenge" | "capstone";
    remediation?: string;
    estimatedMinutes?: number;
    w3schoolsTopic?: string;
    sourceUrl?: string;
    exerciseUrl?: string;
    test?: string;
  }>;
};

export type RoadmapAnswers = {
  topic?: string;
  level?: string;
  language?: string;
  outcome?: string;
  pace?: string;
  goal?: string;
  experience?: string;
  stack?: string;
  depth?: string;
  learningStyle?: string;
  constraints?: string;
};

export type OpenTab = {
  path: string;
  content: string;
  savedContent: string;
  pinned?: boolean;
  preview?: boolean;
};

export type LearningStatus =
  | "locked"
  | "ready"
  | "in_progress"
  | "ran"
  | "failed_check"
  | "passed_check"
  | "skipped"
  | "needs_review"
  | "mastered"
  | "blocked";

export type ProgressEntry = {
  completed: boolean;
  completedAt?: string;
  status: LearningStatus;
  runAttempts: number;
  checkAttempts: number;
  hintCount: number;
  lastRunAt?: string;
  lastCheckAt?: string;
  lastError?: string;
  lastOutput?: string;
  masteryScore: number;
  timeSpentSeconds: number;
};

export type ProgressEvent = {
  verb: "opened" | "ran" | "checked" | "hinted" | "skipped" | "created";
  lessonId?: string;
  roadmapId?: string;
  success?: boolean;
  output?: string;
  error?: string;
  durationSeconds?: number;
  context?: Record<string, unknown>;
};

export type ProgressMap = Record<string, ProgressEntry>;

export type TutorMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  command: string;
  sessionID?: string;
  messageID?: string;
  providerID?: string;
  modelID?: string;
  tools?: AgentToolPart[];
  diff?: AgentDiffFile[];
  passed?: boolean;
  output?: string;
  progress?: ProgressMap;
};

export type AgentProjectPayload = {
  projectPath: string;
};

export type AgentCommandInfo = {
  name: string;
  description?: string;
  agent?: string;
  model?: string | AgentModelRef;
  source?: "command" | "mcp" | "skill" | string;
  hints?: string[];
  template?: string;
  subtask?: boolean;
};

export type AgentModelRef = {
  id: string;
  providerID: string;
  variant?: string;
};

export type AgentModelInfo = {
  id: string;
  providerID: string;
  name: string;
  enabled?: boolean;
  status?: "alpha" | "beta" | "deprecated" | "active" | string;
  capabilities?: {
    tools?: boolean;
    input?: string[];
    output?: string[];
  };
  variants?: Array<{ id: string; label?: string } & Record<string, unknown>>;
  limit?: {
    context?: number;
    input?: number;
    output?: number;
  };
  cost?: unknown[];
  [key: string]: unknown;
};

export type AgentProviderInfo = {
  id: string;
  name?: string;
  label?: string;
  env?: string[];
  models?: Record<string, AgentModelInfo | unknown>;
  options?: Record<string, unknown>;
  npm?: string;
  kind?: string;
  connected?: boolean;
  disabled?: boolean;
  api?: {
    type: "aisdk" | "native" | string;
    package?: string;
    url?: string;
    settings?: Record<string, unknown>;
  };
  request?: {
    headers?: Record<string, string>;
    body?: Record<string, unknown>;
  };
  [key: string]: unknown;
};

export type AgentProviderState = {
  all: AgentProviderInfo[];
  default?: Record<string, string>;
  connected?: string[];
  config?: AgentConfigInfo;
  rules?: AgentRuleset;
  agents?: AgentInfo[];
  routes?: {
    provider: typeof OPENCODE_PROVIDER_ROUTES;
    protocol: typeof OPENCODE_PROTOCOL_ROUTES;
    legacySession: typeof OPENCODE_LEGACY_SESSION_ROUTES;
  };
};

export type AgentProviderAuthMethod = {
  type: "oauth" | "api" | string;
  label: string;
  prompts?: Array<{
    type: "text" | "select" | string;
    key: string;
    message: string;
    placeholder?: string;
    when?: { key: string; op: "eq" | "neq"; value: string };
    options?: Array<{ label: string; value: string; hint?: string }>;
  }>;
};

export type AgentProviderAuthMap = Record<string, AgentProviderAuthMethod[]>;

export type AgentProviderAuthorization = {
  url?: string;
  method?: "auto" | "code" | string;
  instructions?: string;
};

export type AgentProviderAuthorizePayload = AgentProjectPayload & {
  providerID: string;
  method?: number;
  inputs?: Record<string, string>;
};

export type AgentProviderCallbackPayload = AgentProjectPayload & {
  providerID: string;
  method?: number;
  code?: string;
};

export type AgentProviderApiKeyPayload = AgentProjectPayload & {
  providerID: string;
  key: string;
};

export type AgentConfigInfo = {
  model?: string;
  small_model?: string;
  disabled_providers?: string[];
  enabled_providers?: string[];
  providers?: Record<string, unknown>;
  agents?: Record<string, AgentInfo>;
  rules?: AgentRuleset;
  permission?: AgentRuleset;
  [key: string]: unknown;
};

export type AgentInfo = {
  name?: string;
  mode?: "primary" | "subagent" | "all" | string;
  description?: string;
  model?: AgentModelRef | string;
  prompt?: string;
  tools?: Record<string, boolean>;
  [key: string]: unknown;
};

export type AgentRuleset = Array<{
  action?: string;
  resource?: string;
  effect?: "allow" | "deny" | "ask" | string;
  description?: string;
  [key: string]: unknown;
}>;

export const OPENCODE_PROVIDER_ROUTES = {
  list: "/provider",
  auth: "/provider/auth",
  oauthAuthorize: "/provider/:providerID/oauth/authorize",
  oauthCallback: "/provider/:providerID/oauth/callback",
  apiKey: "/auth/:providerID",
  config: "/config",
  configProviders: "/config/providers",
  globalConfig: "/global/config"
} as const;

export const OPENCODE_PROTOCOL_ROUTES = {
  commands: "/api/command",
  providers: "/api/provider",
  provider: "/api/provider/:providerID",
  models: "/api/model",
  sessions: "/api/session",
  sessionPrompt: "/api/session/:sessionID/prompt",
  sessionSwitchAgent: "/api/session/:sessionID/agent",
  sessionSwitchModel: "/api/session/:sessionID/model",
  sessionWait: "/api/session/:sessionID/wait",
  sessionContext: "/api/session/:sessionID/context"
} as const;

export const OPENCODE_LEGACY_SESSION_ROUTES = {
  promptAsync: "/session/:sessionID/prompt_async",
  command: "/session/:sessionID/command",
  shell: "/session/:sessionID/shell",
  permissions: "/session/:sessionID/permissions/:permissionID",
  revert: "/session/:sessionID/revert",
  unrevert: "/session/:sessionID/unrevert"
} as const;

export type AgentToolPart = {
  id: string;
  type: string;
  title: string;
  status?: string;
  detail?: string;
  raw?: unknown;
};

export type AgentDiffFile = {
  file?: string;
  path?: string;
  patch?: string;
  additions: number;
  deletions: number;
  status?: "added" | "deleted" | "modified" | string;
};

export type AgentSessionSummary = {
  id: string;
  sessionID?: string;
  title?: string;
  summary?: unknown;
  time?: {
    created?: number;
    updated?: number;
  };
  [key: string]: unknown;
};

export type AgentSessionDetail = AgentSessionSummary & {
  messages?: unknown[];
  permissions?: AgentPermissionRequest[];
  diff?: AgentDiffFile[];
  todos?: AgentTodoItem[];
};

export type AgentSessionPayload = AgentProjectPayload & {
  sessionID: string;
};

export type AgentSessionStartPayload = AgentProjectPayload & {
  model?: string;
  permissionMode?: string;
  title?: string;
};

export type AgentSessionStartResult = AgentSessionSummary & {
  sessionID?: string;
};

export type AgentSessionUpdatePayload = AgentSessionPayload & {
  title?: string;
  summary?: unknown;
  archived?: boolean;
  metadata?: Record<string, unknown>;
};

export type AgentSessionForkPayload = AgentSessionPayload & {
  messageID?: string;
  title?: string;
};

export type AgentPromptPayload = AgentProjectPayload & {
  mode?: "run";
  sessionID?: string;
  model?: string;
  prompt?: string;
  requestId?: string;
  permissionMode?: string;
  planMode?: boolean;
};

export type AgentShellPayload = AgentProjectPayload & {
  sessionID?: string;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type AgentSessionCommandPayload = AgentSessionPayload & {
  model?: string;
  command: string;
  arguments?: string;
};

export type AgentPermissionReply = "once" | "always" | "reject";

export type AgentPermissionReplyPayload = AgentSessionPayload & {
  requestID: string;
  reply: AgentPermissionReply;
};

export type AgentDiffPayload = AgentSessionPayload & {
  messageID?: string;
};

export type AgentRevertPayload = AgentSessionPayload & {
  messageID: string;
  partID?: string;
};

export type AgentTodoItem = {
  id: string;
  content?: string;
  title?: string;
  status?: "pending" | "in_progress" | "completed" | string;
  priority?: "low" | "medium" | "high" | string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AgentTodoPayload = AgentSessionPayload & {
  messageID?: string;
};

export type AgentEventStreamPayload = AgentProjectPayload & {
  sessionID?: string;
  requestId?: string;
};

export type AgentEventStream = {
  streamID?: string;
  id?: string;
  subscriptionID?: string;
  requestId?: string;
  sessionID?: string;
  ok?: boolean;
};

export type AgentPermissionRequest = {
  id?: string;
  requestID?: string;
  permissionID?: string;
  permission?: string;
  title?: string;
  message?: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
};

export type AgentRuntimeEvent =
  | { requestId: string; type: "status"; status: string; message?: string; time?: number }
  | { requestId: string; type: "session"; sessionID: string; model?: string; permissionMode?: string; time?: number }
  | { requestId: string; type: "text"; sessionID?: string; text: string; time?: number }
  | { requestId: string; type: "tools"; sessionID?: string; tools: AgentToolPart[]; time?: number }
  | { requestId: string; type: "permissions"; sessionID?: string; permissions: AgentPermissionRequest[]; time?: number }
  | { requestId: string; type: "diff"; sessionID?: string; messageID?: string; diff: AgentDiffFile[]; time?: number }
  | { requestId: string; type: "todo"; sessionID?: string; todos: AgentTodoItem[]; time?: number }
  | { requestId: string; type: "files"; sessionID?: string; file?: string; event?: string; time?: number };

export type InterviewTurn = {
  field: string;
  question: string;
  answer: string;
  rawAnswer?: string;
  normalizedAnswer?: string;
  isVague?: boolean;
  clarificationOf?: string;
  confidence?: number;
  evidence?: string[];
};

export type InterviewPrompt = {
  complete: boolean;
  mode: "ollama" | "fallback";
  nextField?: string;
  fieldOrder?: string[];
  completedFields?: string[];
  fieldConfidence?: Record<string, number>;
  inferredIntent?: string[];
  diagnostic?: {
    recommended: boolean;
    reason?: string;
    questions?: string[];
  };
  field?: string;
  question?: string;
  helper?: string;
  suggestions?: string[];
  summary?: RoadmapAnswers;
  w3schoolsTrack?: {
    label: string;
    sourceUrl: string;
    exerciseUrl?: string;
  } | null;
};
