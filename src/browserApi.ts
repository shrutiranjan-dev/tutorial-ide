import type {
  AgentCommandInfo,
  AgentConfigInfo,
  AgentProviderAuthMap,
  AgentProviderState,
  CommandResult,
  FileNode,
  InterviewPrompt,
  InterviewTurn,
  Lesson,
  ProgressEvent,
  ProgressMap,
  Roadmap
} from "./types";
import {
  OPENCODE_LEGACY_SESSION_ROUTES,
  OPENCODE_PROTOCOL_ROUTES,
  OPENCODE_PROVIDER_ROUTES
} from "./types";

type TutorialIdeApi = NonNullable<Window["tutorialIde"]>;

const browserWorkspace = "browser-mobile-demo";
const progressKey = "tutorialIde.browser.progress";
const filesKey = "tutorialIde.browser.files";

const demoLesson: Lesson = {
  id: "browser-python-start",
  order: 1,
  title: "Run Your First Python Program",
  language: "python",
  description: "Mobile preview mode uses browser storage. Desktop mode keeps the real terminal and local files.",
  goal: "Practice a beginner Python-style first program.",
  steps: [
    "Read README.md first.",
    "Open main.py.",
    "Change the printed name and goal.",
    "Use Run or Check to see simulated feedback in mobile preview mode."
  ],
  hints: [
    "A print line shows text between quotes.",
    "Keep the words welcome and goal in the output for the checkpoint."
  ],
  skillsIntroduced: ["running code", "printing output"],
  entryFile: "main.py",
  checkpoint: {
    command: "python3 check.py",
    expectedOutput: "passed"
  }
};

const defaultFiles: Record<string, string> = {
  "README.md": "# Run Your First Python Program\n\nThis mobile build is for testing the IDE UI on your phone. The desktop app still has the real local terminal, files, and Ollama integration.\n",
  "GUIDE.md": "# Guide\n\nUse `print()` to show text. Keep your program simple: one line can print a greeting, and one line can print your learning goal.\n",
  "TASK.md": "# Task\n\nUpdate `main.py` so it prints a welcome message and a learning goal.\n",
  "CHECKPOINT.md": "# Checkpoint\n\nThe simulated mobile checkpoint passes when `main.py` includes `print`, `welcome`, and `goal`.\n",
  "main.py": "print(\"Welcome to Python\")\nprint(\"My goal is to learn step by step\")\n",
  "solution.py": "print(\"Welcome to Python\")\nprint(\"My goal is to learn Python from zero to intermediate\")\n",
  "check.py": "print(\"passed\")\n"
};

const browserProviderState: AgentProviderState = {
  all: [
    {
      id: "ollama",
      name: "Ollama Local",
      label: "Ollama Local",
      kind: "local",
      connected: false,
      api: { type: "native", settings: { route: OPENCODE_PROTOCOL_ROUTES.providers } },
      request: { headers: {}, body: {} },
      models: {
        "llama3.2": {
          id: "llama3.2",
          providerID: "ollama",
          name: "Llama 3.2",
          enabled: true,
          status: "active",
          capabilities: { tools: true, input: ["text"], output: ["text"] }
        }
      }
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      label: "OpenRouter",
      kind: "cloud",
      connected: false,
      api: { type: "aisdk", package: "openrouter", url: "https://openrouter.ai/api/v1" },
      request: { headers: {}, body: {} },
      models: {}
    },
    {
      id: "opencode",
      name: "Code Zen",
      label: "Code Zen",
      kind: "cloud",
      connected: false,
      api: { type: "native", settings: { route: OPENCODE_PROVIDER_ROUTES.list } },
      request: { headers: {}, body: {} },
      models: {}
    }
  ],
  default: { ollama: "llama3.2" },
  connected: []
};

const browserProviderAuth: AgentProviderAuthMap = {
  ollama: [],
  openrouter: [{ type: "api", label: "API key" }],
  opencode: [{ type: "api", label: "API key" }],
  "github-copilot": [{ type: "oauth", label: "GitHub Copilot OAuth" }]
};

const browserCommands: AgentCommandInfo[] = [
  {
    name: "review",
    description: "Review the current project",
    source: "command",
    hints: ["$ARGUMENTS"],
    template: "Review this workspace and report risks first.",
    subtask: true
  },
  {
    name: "init",
    description: "Initialize project instructions",
    source: "command",
    hints: [],
    template: "Create or update project instructions."
  }
];

const browserConfig: AgentConfigInfo = {
  model: "ollama/llama3.2",
  disabled_providers: [],
  providers: {
    ollama: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://localhost:11434/v1" } }
  },
  agents: {
    build: { name: "build", mode: "primary", model: { providerID: "ollama", id: "llama3.2" } },
    review: { name: "review", mode: "subagent", description: "Focused review agent" }
  },
  rules: [
    { action: "provider.use", resource: "ollama", effect: "allow", description: "Local browser-preview provider" },
    { action: "tool.execute", resource: "shell", effect: "ask", description: "Desktop shell execution requires approval" }
  ]
};

export const browserOpenCodeSurface = {
  providers: OPENCODE_PROVIDER_ROUTES,
  protocol: OPENCODE_PROTOCOL_ROUTES,
  legacySession: OPENCODE_LEGACY_SESSION_ROUTES,
  config: browserConfig
} as const;

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T) {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function ensureFiles() {
  const files = readJson<Record<string, string>>(filesKey, {});
  if (Object.keys(files).length) return files;
  writeJson(filesKey, defaultFiles);
  return { ...defaultFiles };
}

function fileNodesFromFiles(files: Record<string, string>): FileNode[] {
  return Object.keys(files)
    .sort((left, right) => left.localeCompare(right))
    .map((path) => ({ name: path, path, type: "file" as const }));
}

function progressPatch(event: ProgressEvent, current: ProgressMap): ProgressMap {
  if (!event.lessonId) return current;
  const existing = current[event.lessonId] || {
    completed: false,
    status: "ready",
    runAttempts: 0,
    checkAttempts: 0,
    hintCount: 0,
    masteryScore: 0,
    timeSpentSeconds: 0
  };
  const next = { ...existing };
  if (event.verb === "opened") next.status = "ready";
  if (event.verb === "ran") {
    next.status = "ran";
    next.runAttempts += 1;
    next.lastRunAt = new Date().toISOString();
    next.lastOutput = event.output;
  }
  if (event.verb === "checked") {
    next.checkAttempts += 1;
    next.lastCheckAt = new Date().toISOString();
    next.lastOutput = event.output;
    next.lastError = event.error;
    if (event.success) {
      next.status = "mastered";
      next.completed = true;
      next.completedAt = new Date().toISOString();
      next.masteryScore = 1;
    } else {
      next.status = next.checkAttempts >= 2 ? "needs_review" : "failed_check";
    }
  }
  if (event.verb === "hinted") {
    next.hintCount += 1;
  }
  return { ...current, [event.lessonId]: next };
}

function nextPromptFromTranscript(transcript: InterviewTurn[]): InterviewPrompt {
  const fields = ["goal", "experience", "stack", "outcome", "depth", "learningStyle", "constraints"];
  const questions: Record<string, { question: string; helper: string; suggestions: string[] }> = {
    goal: {
      question: "What programming language or topic do you want to learn?",
      helper: "For example: Python, JavaScript, Java, HTML, CSS, SQL, or C++.",
      suggestions: ["Python", "JavaScript", "HTML and CSS"]
    },
    experience: {
      question: "What is your current experience level?",
      helper: "If you are new, just say beginner.",
      suggestions: ["Beginner", "I know a little", "Intermediate"]
    },
    stack: {
      question: "Which language or track should the lessons use?",
      helper: "For beginner language learning, choose the base language first.",
      suggestions: ["Python", "JavaScript", "Java"]
    },
    outcome: {
      question: "What kind of beginner result would feel useful?",
      helper: "Keep this simple: fundamentals, tiny programs, or practice exercises.",
      suggestions: ["Learn complete fundamentals", "Practice each core topic", "Beginner to intermediate path"]
    },
    depth: {
      question: "How much time can you practice?",
      helper: "This controls lesson count and pacing.",
      suggestions: ["20 minutes daily", "1 hour daily", "Weekend practice"]
    },
    learningStyle: {
      question: "How do you prefer to learn?",
      helper: "Choose the style that feels easiest to follow.",
      suggestions: ["Examples first", "Guided practice", "Small challenges"]
    },
    constraints: {
      question: "Any personal constraints I should respect?",
      helper: "For personal development, simple answers are fine.",
      suggestions: ["No rush", "Keep it beginner friendly", "Offline practice"]
    }
  };
  const completedFields = transcript.map((turn) => turn.field);
  const nextField = fields.find((field) => !completedFields.includes(field));
  if (!nextField) {
    return {
      complete: true,
      mode: "fallback",
      fieldOrder: fields,
      completedFields,
      fieldConfidence: Object.fromEntries(fields.map((field) => [field, 0.8])),
      summary: Object.fromEntries(transcript.map((turn) => [turn.field, turn.answer])),
      w3schoolsTrack: { label: "Python", sourceUrl: "https://www.w3schools.com/python/" }
    };
  }
  const item = questions[nextField];
  return {
    complete: false,
    mode: "fallback",
    field: nextField,
    nextField,
    fieldOrder: fields,
    completedFields,
    fieldConfidence: Object.fromEntries(completedFields.map((field) => [field, 0.8])),
    question: item.question,
    helper: item.helper,
    suggestions: item.suggestions,
    w3schoolsTrack: { label: "Python", sourceUrl: "https://www.w3schools.com/python/" }
  };
}

export function createBrowserTutorialIde(): TutorialIdeApi {
  ensureFiles();

  return {
    project: {
      default: async () => browserWorkspace,
      open: async () => browserWorkspace
    },
    opencode: {
      info: async () => ({
        installed: false,
        version: "Desktop only",
        bin: "code",
        command: "code"
      }),
      providers: async () => [
        { id: "ollama", label: "Ollama Local", kind: "local", command: "/models ollama" },
        { id: "openrouter", label: "OpenRouter", kind: "cloud", command: "/connect OpenRouter" },
        { id: "opencode", label: "Code Zen", kind: "cloud", command: "/connect Code Zen" },
        { id: "z-ai", label: "Z.AI", kind: "cloud", command: "/connect Z.AI" }
      ],
      models: async () => ({ exitCode: 0, stdout: "", stderr: "", command: "code models", models: [] }),
      syncOllama: async () => ({ ok: true, path: "browser-code.json", modelCount: 0, defaultModel: "" }),
      commands: async () => browserCommands,
      providerState: async () => ({
        ...browserProviderState,
        config: browserConfig,
        rules: browserConfig.rules,
        agents: Object.values(browserConfig.agents || {}),
        routes: {
          provider: OPENCODE_PROVIDER_ROUTES,
          protocol: OPENCODE_PROTOCOL_ROUTES,
          legacySession: OPENCODE_LEGACY_SESSION_ROUTES
        }
      }),
      providerAuth: async () => browserProviderAuth,
      providerAuthorize: async ({ providerID, method = 0 }) => {
        const authMethod = browserProviderAuth[providerID]?.[method];
        if (authMethod?.type !== "oauth") return null;
        return {
          url: `https://opencode.ai/auth/${encodeURIComponent(providerID)}`,
          method: "code" as const,
          instructions: `Browser preview documents ${OPENCODE_PROVIDER_ROUTES.oauthCallback}; paste the desktop OAuth code here.`
        };
      },
      providerCallback: async () => true,
      providerApiKey: async () => true,
      command: async ({ prompt }) => ({
        exitCode: 0,
        stdout: [
          `Mobile preview cannot launch Code. Prompt queued for desktop: ${prompt || ""}`,
          `Provider auth: ${OPENCODE_PROVIDER_ROUTES.auth}`,
          `Config/rules: ${OPENCODE_PROVIDER_ROUTES.config}`,
          `Command discovery: ${OPENCODE_PROTOCOL_ROUTES.commands}`,
          `Session command execution: ${OPENCODE_LEGACY_SESSION_ROUTES.command}`
        ].join("\n"),
        stderr: "",
        command: "code"
      }),
      sendPrompt: async ({ prompt }) => ({
        exitCode: 0,
        stdout: `Mobile preview prompt accepted for desktop replay: ${prompt || ""}`,
        stderr: "",
        command: OPENCODE_PROTOCOL_ROUTES.sessionPrompt
      }),
      shell: async ({ command }) => ({
        exitCode: 0,
        stdout: `Shell command "${command}" is desktop-only in this preview.`,
        stderr: "",
        command: OPENCODE_LEGACY_SESSION_ROUTES.shell
      }),
      sessions: async () => [],
      startSession: async () => ({
        id: `browser-session-${Date.now().toString(36)}`,
        sessionID: `browser-session-${Date.now().toString(36)}`,
        title: "Browser preview session"
      }),
      session: async ({ sessionID }) => ({
        id: sessionID,
        title: "Browser preview session",
        messages: [],
        permissions: [],
        diff: [],
        todos: []
      }),
      getSession: async ({ sessionID }) => ({
        id: sessionID,
        title: "Browser preview session",
        messages: [],
        permissions: [],
        diff: [],
        todos: []
      }),
      sessionUpdate: async ({ sessionID, title }) => ({
        id: sessionID,
        title: title || "Browser preview session"
      }),
      updateSession: async ({ sessionID, title }) => ({
        id: sessionID,
        title: title || "Browser preview session"
      }),
      sessionFork: async ({ sessionID }) => ({
        id: `${sessionID}-browser-fork`,
        sessionID: `${sessionID}-browser-fork`,
        title: "Browser preview fork"
      }),
      fork: async ({ sessionID }) => ({
        id: `${sessionID}-browser-fork`,
        sessionID: `${sessionID}-browser-fork`,
        title: "Browser preview fork"
      }),
      sessionDelete: async () => true,
      deleteSession: async () => true,
      messages: async () => [],
      abort: async () => true,
      eventsStart: async ({ requestId, sessionID }) => ({ ok: true, requestId, sessionID }),
      startEvents: async ({ requestId, sessionID }) => ({ ok: true, requestId, sessionID }),
      eventsStop: async () => true,
      stopEvents: async () => true,
      permissions: async () => [],
      permissionList: async () => [],
      permissionReply: async () => true,
      todo: async () => [],
      diff: async () => [],
      sessionCommand: async ({ command }) => ({
        exitCode: 0,
        stdout: `Command ${command} is available in desktop mode.`,
        stderr: "",
        command
      }),
      revert: async () => true,
      unrevert: async () => true,
      onEvent: () => () => undefined
    },
    lessons: {
      list: async () => [demoLesson],
      open: async () => {
        const progress = progressPatch({ verb: "opened", lessonId: demoLesson.id }, readJson(progressKey, {}));
        writeJson(progressKey, progress);
        return { lesson: demoLesson, workspacePath: browserWorkspace };
      },
      run: async () => {
        const files = ensureFiles();
        const body = files[demoLesson.entryFile] || "";
        const stdout = body.includes("print") ? "Mobile preview simulated run.\nWelcome output detected.\n" : "Mobile preview simulated run.\nNo print line found.\n";
        const progress = progressPatch({ verb: "ran", lessonId: demoLesson.id, output: stdout }, readJson(progressKey, {}));
        writeJson(progressKey, progress);
        return { exitCode: 0, stdout, stderr: "", command: "mobile-preview run", progress };
      },
      checkpoint: async () => {
        const body = ensureFiles()[demoLesson.entryFile] || "";
        const passed = /print\s*\(/.test(body) && /welcome/i.test(body) && /goal/i.test(body);
        const stdout = passed
          ? "passed: main.py prints a welcome message and a learning goal.\n"
          : "failed: main.py should include print(), a welcome message, and a learning goal.\n";
        const progress = progressPatch({
          verb: "checked",
          lessonId: demoLesson.id,
          success: passed,
          output: stdout,
          error: passed ? "" : stdout
        }, readJson(progressKey, {}));
        writeJson(progressKey, progress);
        return { exitCode: passed ? 0 : 1, stdout, stderr: "", command: "mobile-preview check", passed, output: stdout, progress };
      }
    },
    roadmaps: {
      list: async () => [],
      create: async () => ({ roadmap: {} as Roadmap, lessonId: demoLesson.id }),
      interviewStart: async () => nextPromptFromTranscript([]),
      interviewReply: async ({ transcript }: { transcript: InterviewTurn[] }) => nextPromptFromTranscript(transcript),
      createFromInterview: async () => ({
        roadmap: {
          id: "browser-roadmap",
          topic: "Mobile Preview Roadmap",
          level: "beginner",
          language: "python",
          outcome: "UI test",
          pace: "preview",
          currentIndex: 0,
          createdAt: new Date().toISOString(),
          createdLessonIds: [demoLesson.id],
          skippedLessonIds: [],
          modules: []
        },
        lessonId: demoLesson.id
      }),
      advance: async () => ({ done: true, action: "preview-only", reason: "Mobile preview has one demo lesson." }),
      remove: async () => ({ ok: true, removedLessonIds: [] })
    },
    files: {
      list: async () => fileNodesFromFiles(ensureFiles()),
      read: async (_workspacePath, relativePath) => ensureFiles()[relativePath] || "",
      write: async (_workspacePath, relativePath, content) => {
        const files = ensureFiles();
        files[relativePath] = content;
        writeJson(filesKey, files);
        return true;
      },
      createFile: async (_workspacePath, relativePath, content = "") => {
        const files = ensureFiles();
        if (files[relativePath] !== undefined) throw new Error("File already exists.");
        files[relativePath] = content;
        writeJson(filesKey, files);
        return true;
      },
      createFolder: async () => true,
      delete: async (_workspacePath, relativePath) => {
        const files = ensureFiles();
        Object.keys(files).forEach((path) => {
          if (path === relativePath || path.startsWith(`${relativePath}/`)) delete files[path];
        });
        writeJson(filesKey, files);
        return true;
      },
      rename: async (_workspacePath, fromPath, toPath) => {
        const files = ensureFiles();
        Object.keys(files).forEach((path) => {
          if (path === fromPath || path.startsWith(`${fromPath}/`)) {
            const nextPath = path.replace(fromPath, toPath);
            files[nextPath] = files[path];
            delete files[path];
          }
        });
        writeJson(filesKey, files);
        return true;
      },
      duplicate: async (_workspacePath, fromPath, toPath) => {
        const files = ensureFiles();
        files[toPath] = files[fromPath] || "";
        writeJson(filesKey, files);
        return true;
      }
    },
    workspace: {
      search: async (_workspacePath, payload) => {
        const query = payload.query.toLowerCase();
        return Object.entries(ensureFiles()).flatMap(([path, content]) =>
          content.split(/\r?\n/).flatMap((line, index) =>
            line.toLowerCase().includes(query)
              ? [{ path, line: index + 1, column: Math.max(1, line.toLowerCase().indexOf(query) + 1), preview: line.trim() }]
              : []
          )
        );
      },
      symbols: async (_workspacePath, query = "") => {
        const needle = query.toLowerCase();
        return Object.entries(ensureFiles()).flatMap(([path, content]) =>
          content.split(/\r?\n/).flatMap((line, index) => {
            const match = /^\s*(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(line);
            const name = match?.[1];
            if (!name || (needle && !name.toLowerCase().includes(needle))) return [];
            return [{ name, path, line: index + 1, preview: line.trim() }];
          })
        );
      }
    },
    git: {
      status: async () => ({ ok: false, branch: "browser-preview", changes: [], message: "Git is available in the desktop app." }),
      command: async (_workspacePath, command) => ({
        exitCode: 0,
        stdout: `Git ${command} is desktop-only in this preview.`,
        stderr: "",
        command: `git ${command}`
      })
    },
    progress: {
      load: async () => readJson(progressKey, {}),
      save: async (progress) => {
        writeJson(progressKey, progress);
        return true;
      },
      record: async (event) => {
        const progress = progressPatch(event, readJson(progressKey, {}));
        writeJson(progressKey, progress);
        return progress;
      }
    },
    ollama: {
      status: async () => ({ online: false, message: "Mobile preview uses offline fallback." }),
      models: async () => [],
      chat: async ({ task }) => `Mobile preview mode cannot call the desktop Ollama service yet. Task received: ${task}.`
    },
    terminal: {
      start: async () => ({ id: "browser-terminal", mode: "browser" }),
      write: () => undefined,
      resize: () => undefined,
      stop: () => undefined,
      onData: (callback) => {
        window.setTimeout(() => callback("browser-terminal", "Mobile preview terminal is simulated. Use the desktop app for real shell commands.\r\n"), 50);
        return () => undefined;
      },
      onExit: () => () => undefined
    }
  };
}
