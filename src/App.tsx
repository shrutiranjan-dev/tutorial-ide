import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from "react";
import { useToast } from "./ToastContext";
import { withApiError } from "./apiErrorHandler";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  ArrowLeft,
  Bot,
  Boxes,
  Bug,
  ChevronDown,
  ChevronRight,
  CirclePlay,
  Code2,
  Command,
  Copy,
  FilePlus2,
  FileDiff,
  FolderOpen,
  FolderPlus,
  GitBranch,
  GitFork,
  GitPullRequest,
  History,
  ListTodo,
  Maximize2,
  MonitorPlay,
  MoreHorizontal,
  PanelBottomClose,
  PanelRight,
  PanelRightClose,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  AgentCommandInfo,
  AgentDiffFile,
  AgentPermissionRequest,
  AgentProviderAuthMap,
  AgentProviderState,
  AgentQuestion,
  AgentRuntimeEvent,
  AgentToolPart,
  CommandResult,
  CredentialInfo,
  CredentialUpdatePayload,
  CredentialDeletePayload,
  FileNode,
  IntegrationInfo,
  IntegrationAuthMethod,
  OAuthAttempt,
  OpenTab,
  PermissionEffect,
  PermissionRule,
  ReferenceInfo,
  SavedPermission,
  SkillInfo
} from "./types";
import { createBrowserTutorialIde } from "./browserApi";
import { extensionIcon, languageFromPath } from "./utils";

const api = window.tutorialIde ?? createBrowserTutorialIde();
const workspaceStateKey = "code-workbench-state-v3";

const displayFilePath = (pathValue: string) =>
  pathValue
    .replace(/(^|[\\/])opencode\.json$/i, "$1code.json")
    .replace(/(^|[\\/])browser-opencode\.json$/i, "$1browser-code.json");

const displayFileName = (pathValue: string) => {
  const name = pathValue.split(/[\\/]/).pop() || pathValue;
  return displayFilePath(name);
};

type TerminalEvent = {
  id: string;
  text: string;
  execute?: boolean;
};

type ActivityView = "explorer" | "search" | "source" | "debug" | "extensions" | "ai";
type BottomPanel = "terminal" | "problems" | "output" | "debug" | "aiLogs";
type OverlayMode = "command" | "quickOpen" | "symbols" | null;
type AgentContextMode = "selection" | "file" | "openTabs" | "workspace";

type SearchResult = {
  path: string;
  line: number;
  column: number;
  preview: string;
};

type SymbolResult = {
  name: string;
  path: string;
  line: number;
  preview: string;
};

type GitState = {
  ok: boolean;
  branch: string;
  changes: Array<{ status: string; path: string }>;
  message: string;
};

type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  meta?: string;
  command?: string;
  exitCode?: number;
  requestId?: string;
  sessionID?: string;
  messageID?: string;
  pending?: boolean;
  status?: string;
  tools?: AgentToolPart[];
  diff?: AgentDiffFile[];
  permissions?: AgentPermissionRequest[];
};

type AgentSessionInfo = {
  id: string;
  title?: string;
  time?: { created?: number; updated?: number };
};

type AgentActivityChip = {
  id: string;
  label: string;
  tone?: "info" | "success" | "warn" | "danger";
  detail?: string;
  sessionID?: string;
  count?: number;
};

type AgentTodoItem = {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "done";
};

type OptionalOpenCodeBridge = typeof api.opencode & {
  startSession?: (payload: { projectPath: string; model?: string; sessionID?: string }) => Promise<{ sessionID?: string; id?: string; providerID?: string; modelID?: string }>;
  prompt?: (payload: { projectPath: string; sessionID?: string; model?: string; prompt: string; requestId?: string; permissionMode?: string; permissionRules?: Array<{ action?: string; resource?: string; effect: string; description?: string }>; planMode?: boolean }) => Promise<CommandResult & { admitted?: boolean }>;
  fork?: (payload: { projectPath: string; sessionID: string; messageID?: string }) => Promise<{ sessionID?: string; id?: string }>;
  startEvents?: (payload: { projectPath: string; sessionID?: string; requestId?: string }) => Promise<{ streamID?: string; subscriptionID?: string; id?: string }>;
  stopEvents?: (payload: string | { streamID?: string; subscriptionID?: string; requestId?: string }) => Promise<void>;
  permissionReply?: (payload: { projectPath: string; sessionID: string; requestID: string; reply: "once" | "always" | "reject" }) => Promise<unknown>;
  integrations?: (payload: { projectPath: string }) => Promise<IntegrationInfo[]>;
  oauthAttemptPoll?: (payload: { projectPath: string; attemptID: string }) => Promise<OAuthAttempt | null>;
  oauthAttemptCancel?: (payload: { projectPath: string; attemptID: string }) => Promise<{ ok: boolean }>;
  credentials?: (payload: { projectPath: string }) => Promise<CredentialInfo[]>;
  credentialUpdate?: (payload: CredentialUpdatePayload) => Promise<{ ok: boolean }>;
  credentialDelete?: (payload: CredentialDeletePayload) => Promise<{ ok: boolean }>;
  // Q&A methods
  questionRequests?: (payload: { projectPath: string; sessionID?: string }) => Promise<AgentQuestion[]>;
  sessionQuestions?: (payload: { projectPath: string; sessionID: string }) => Promise<AgentQuestion[]>;
  questionReply?: (payload: { projectPath: string; sessionID: string; requestID: string; reply: string }) => Promise<{ ok: boolean }>;
  questionReject?: (payload: { projectPath: string; sessionID: string; requestID: string }) => Promise<{ ok: boolean }>;
  // Skills method
  skills?: (payload: { projectPath: string }) => Promise<SkillInfo[]>;
  // References method
  references?: (payload: { projectPath: string }) => Promise<ReferenceInfo[]>;
  // Saved permissions methods
  savedPermissions?: (payload: { projectPath: string }) => Promise<SavedPermission[]>;
  deleteSavedPermission?: (payload: { projectPath: string; id: string }) => Promise<{ ok: boolean }>;
};

type WorkspaceState = {
  projectPath?: string;
  tabs?: string[];
  activePath?: string;
  activeActivity?: ActivityView;
  bottomPanel?: BottomPanel;
  sidebarWidth?: number;
  agentWidth?: number;
  bottomHeight?: number;
  sidebarOpen?: boolean;
  bottomOpen?: boolean;
  agentOpen?: boolean;
  minimap?: boolean;
  selectedModel?: string;
  cursorPositions?: Record<string, { lineNumber: number; column: number }>;
};

type FileContextMenu = {
  x: number;
  y: number;
  path: string;
  type: FileNode["type"];
} | null;

function uid() {
  return Math.random().toString(16).slice(2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function readWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(workspaceStateKey);
    return raw ? JSON.parse(raw) as WorkspaceState : {};
  } catch {
    return {};
  }
}

function commandBlock(label: string, result: CommandResult) {
  const body = `${result.stdout || ""}${result.stderr || ""}`.trim() || "No output.";
  return `\r\n$ ${result.command || label}\r\n[${label} exit ${result.exitCode}]\r\n${body}\r\n`;
}

function flattenFiles(nodes: FileNode[]): FileNode[] {
  return nodes.flatMap((node) => node.type === "directory" ? flattenFiles(node.children || []) : [node]);
}

function fuzzyScore(candidate: string, query: string) {
  const text = candidate.toLowerCase();
  const needle = query.toLowerCase().trim();
  if (!needle) return 1;
  if (text.includes(needle)) return 100 - text.indexOf(needle);
  let cursor = 0;
  let score = 0;
  for (const char of needle) {
    const index = text.indexOf(char, cursor);
    if (index === -1) return 0;
    score += Math.max(1, 16 - (index - cursor));
    cursor = index + 1;
  }
  return score;
}

const starterPrompt = "Review this project, explain the architecture, then suggest the safest first improvement.";
const slashCommands = [
  { command: "/review", label: "Review workspace", prompt: "Review this workspace, identify the safest improvements, and call out risky files first." },
  { command: "/explain", label: "Explain current file", prompt: "Explain the current file and how it fits into the project." },
  { command: "/fix", label: "Fix issue", prompt: "Investigate the described issue, propose a safe fix, and edit only the necessary files if permitted." },
  { command: "/tests", label: "Generate tests", prompt: "Find the right test strategy for this code and add or update focused tests if permitted." },
  { command: "/commit", label: "Prepare commit", prompt: "Review the current git changes and draft a concise commit summary with risks and test notes." },
  { command: "/continue", label: "Continue", prompt: "Continue from the previous assistant turn." },
  { command: "/models", label: "Show models", prompt: "Show the available model/provider options and recommend the best current choice." }
];

function expandSlashPrompt(value: string) {
  const trimmed = value.trim();
  const [command, ...rest] = trimmed.split(/\s+/);
  const match = slashCommands.find((item) => item.command === command);
  if (!match) return value;
  const detail = rest.join(" ").trim();
  return detail ? `${match.prompt}\n\nUser detail: ${detail}` : match.prompt;
}


const TOOL_PERMISSIONS = [
  { id: "read", label: "Read files" },
  { id: "edit", label: "Edit files" },
  { id: "glob", label: "Glob patterns" },
  { id: "grep", label: "Grep search" },
  { id: "list", label: "List directory" },
  { id: "bash", label: "Run commands" },
  { id: "task", label: "Run subtasks" },
  { id: "external_directory", label: "Access external dirs" },
  { id: "lsp", label: "LSP access" },
  { id: "skill", label: "Run skills" },
  { id: "todowrite", label: "Write todos" },
  { id: "webfetch", label: "Fetch web URLs" },
  { id: "websearch", label: "Web search" },
];

const TOOL_PERMISSION_GROUPS = [
  { label: "File operations", tools: ["read", "edit", "glob", "grep", "list"] },
  { label: "Execution", tools: ["bash", "task", "skill"] },
  { label: "External", tools: ["external_directory", "lsp"] },
  { label: "Other", tools: ["todowrite", "webfetch", "websearch"] },
];

function permissionRulesForMode(permissions: Record<string, string>): Array<{ action?: string; resource?: string; effect: string; description?: string }> {
  return TOOL_PERMISSIONS.map((tool) => ({
    action: tool.id,
    resource: "*",
    effect: permissions[tool.id] || "allow",
    description: tool.label,
  }));
}

function engineSlashCommands(commands: AgentCommandInfo[]) {
  return commands
    .filter((command) => command?.name)
    .map((command) => ({
      command: `/${command.name}`,
      label: command.description || command.name,
      prompt: `/${command.name}`,
      source: command.source || "command",
      hints: command.hints || []
    }));
}

function openCodeRole(message: unknown): AgentMessage["role"] {
  const item = message as Record<string, unknown>;
  const info = item.info as Record<string, unknown> | undefined;
  const nested = item.message as Record<string, unknown> | undefined;
  const role = String(info?.role || item.role || nested?.role || "assistant");
  return role === "user" || role === "system" ? role : "assistant";
}

function openCodeMessageId(message: unknown) {
  const item = message as Record<string, unknown>;
  const info = item.info as Record<string, unknown> | undefined;
  const nested = item.message as Record<string, unknown> | undefined;
  return String(info?.id || item.id || nested?.id || uid());
}

function safeJsonPreview(value: unknown, fallback = "") {
  try {
    return JSON.stringify(value, null, 2) || fallback;
  } catch {
    return fallback;
  }
}

function uiText(value: unknown, fallback = ""): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((item) => uiText(item)).filter(Boolean).join(", ");
    return text || fallback;
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    for (const key of ["title", "name", "tool", "type", "status", "message", "command", "path", "file", "text", "content"]) {
      const nested = item[key];
      if (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean" || typeof nested === "bigint") {
        return String(nested);
      }
    }
    return safeJsonPreview(value, fallback).slice(0, 4000);
  }
  return fallback;
}

function partText(part: unknown): string {
  if (!part || typeof part !== "object") return "";
  const item = part as Record<string, unknown>;
  if (item.part && typeof item.part === "object") return partText(item.part);
  if (typeof item.text === "string") return item.text;
  if (typeof item.content === "string") return item.content;
  if (typeof item.output === "string") return item.output;
  const text = item.text as Record<string, unknown> | undefined;
  const content = item.content as Record<string, unknown> | undefined;
  if (typeof text?.value === "string") return text.value;
  if (typeof content?.text === "string") return content.text;
  return "";
}

function summarizePartForUi(part: unknown): AgentToolPart | null {
  if (!part || typeof part !== "object") return null;
  const item = part as Record<string, unknown>;
  if (item.part && typeof item.part === "object") return summarizePartForUi(item.part);
  const type = String(item.type || "");
  if (["", "text", "reasoning", "patch", "step-start", "step-finish"].includes(type)) return null;
  const input = item.input as Record<string, unknown> | undefined;
  const title = uiText(item.tool || item.name || input?.filePath || input?.path || input?.command || input?.query || item.command || item.file || type, "Code step");
  const detail = partText(part) || (typeof input?.content === "string" ? input.content : "") || safeJsonPreview(item.output || item.metadata || item.input || "");
  return {
    id: uiText(item.id, `${type}-${title}`),
    type: uiText(item.tool || item.name || type, "tool"),
    title,
    status: uiText(item.status || item.state || ""),
    detail: detail.slice(0, 4000),
    raw: item
  };
}

function runtimeEventSessionID(event: unknown) {
  const item = event as Record<string, unknown>;
  const data = item?.data as Record<string, unknown> | undefined;
  const syncEvent = item?.syncEvent as Record<string, unknown> | undefined;
  return String(item?.sessionID || data?.sessionID || syncEvent?.sessionID || "");
}

function runtimeEventLabel(event: unknown) {
  const item = event as Record<string, unknown>;
  const type = String(item?.type || item?.event || "activity");
  const data = item?.data as Record<string, unknown> | undefined;
  const syncEvent = item?.syncEvent as Record<string, unknown> | undefined;
  const name = String(data?.tool || data?.permission || syncEvent?.type || type).replace(/^session\.|^sync\./, "");
  return name.replace(/[._-]+/g, " ").trim() || "activity";
}

function runtimeEventTone(event: unknown): AgentActivityChip["tone"] {
  const item = event as Record<string, unknown>;
  const data = item?.data as Record<string, unknown> | undefined;
  const text = [
    item?.type,
    item?.event,
    item?.status,
    item?.message,
    data?.type,
    data?.status,
    data?.message
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("failed") || text.includes("error") || text.includes("reject")) return "danger";
  if (text.includes("permission") || text.includes("ask")) return "warn";
  if (text.includes("success") || text.includes("done") || text.includes("idle")) return "success";
  return "info";
}

function shouldShowRuntimeActivity(event: unknown) {
  const item = event as Record<string, unknown>;
  const type = String(item?.type || item?.event || "");
  return ["status", "session", "tools", "permissions", "diff", "files", "error"].includes(type);
}

function activityChipFromEvent(event: unknown): AgentActivityChip {
  const item = event as Record<string, unknown>;
  return {
    id: String(item?.id || `${Date.now()}-${uid()}`),
    label: runtimeEventLabel(event),
    tone: runtimeEventTone(event),
    detail: String(item?.type || item?.event || ""),
    sessionID: runtimeEventSessionID(event)
  };
}

function compactActivityChips(chips: AgentActivityChip[]) {
  const grouped = new Map<string, AgentActivityChip>();
  for (const chip of chips) {
    const label = uiText(chip.label, "activity").toLowerCase();
    const detail = uiText(chip.detail);
    const key = `${label}:${detail}:${chip.tone || "info"}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.count = (existing.count || 1) + (chip.count || 1);
      existing.sessionID = existing.sessionID || chip.sessionID;
    } else {
      grouped.set(key, {
        ...chip,
        id: key,
        label: uiText(chip.label, "activity"),
        detail,
        count: chip.count || 1
      });
    }
  }
  return Array.from(grouped.values()).slice(0, 4);
}

function todosFromMessages(messages: AgentMessage[]): AgentTodoItem[] {
  const explicit = messages.flatMap((message) => (message.tools || []).flatMap((tool) => {
    const raw = tool.raw as Record<string, unknown> | undefined;
    const todos = raw?.todos || raw?.items || raw?.todo;
    if (!Array.isArray(todos)) return [];
    return todos.map((todo, index) => {
      const item = todo as Record<string, unknown>;
      const status = String(item.status || item.state || "").toLowerCase();
      return {
        id: String(item.id || `${tool.id}-${index}`),
        text: String(item.content || item.text || item.title || "Task"),
        status: status.includes("done") || status.includes("complete") ? "done" : status.includes("progress") ? "in_progress" : "pending"
      } satisfies AgentTodoItem;
    });
  }));
  if (explicit.length) return explicit.slice(-8);
  const latestPlan = [...messages].reverse().find((message) => /(^|\n)\s*(-|\d+\.)\s+\[?[ x]?\]?/i.test(message.text));
  if (!latestPlan) return [];
  return latestPlan.text
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^\s*(?:-|\d+\.)\s+(?:\[( |x|-)\]\s*)?(.+)/i);
      if (!match) return null;
      return {
        id: `${latestPlan.id}-todo-${index}`,
        text: match[2].trim().slice(0, 120),
        status: match[1]?.toLowerCase() === "x" ? "done" : match[1] === "-" ? "in_progress" : "pending"
      } satisfies AgentTodoItem;
    })
    .filter((item): item is AgentTodoItem => Boolean(item))
    .slice(0, 8);
}

function agentMessagesFromOpenCode(messages: unknown[], sessionID: string): AgentMessage[] {
  return messages.map((message) => {
    const item = message as Record<string, unknown>;
    const role = openCodeRole(message);
    const parts = Array.isArray(item.parts) ? item.parts : [];
    const text = parts.map(partText).filter(Boolean).join("\n\n").trim();
    const tools = parts.map(summarizePartForUi).filter(Boolean) as AgentToolPart[];
    return {
      id: openCodeMessageId(message),
      role,
      text: text || (tools.length ? `Code completed with ${tools.length} tool ${tools.length === 1 ? "step" : "steps"}.` : ""),
      meta: sessionID,
      sessionID,
      messageID: openCodeMessageId(message),
      tools
    };
  }).filter((message) => message.text || message.tools?.length);
}

export function App() {
  const { showToast: toast } = useToast();
  const initialStateRef = useRef(readWorkspaceState());
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const pendingRevealRef = useRef<{ path: string; line: number; column?: number } | null>(null);

  const [projectPath, setProjectPath] = useState("");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState("");
  const [selectedCode, setSelectedCode] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [commandEvent, setCommandEvent] = useState<TerminalEvent | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(initialStateRef.current.sidebarWidth || 300);
  const [agentWidth, setAgentWidth] = useState(initialStateRef.current.agentWidth || 360);
  const [bottomHeight, setBottomHeight] = useState(initialStateRef.current.bottomHeight || 280);
  const [isSidebarOpen, setIsSidebarOpen] = useState(initialStateRef.current.sidebarOpen ?? true);
  const [isBottomOpen, setIsBottomOpen] = useState(initialStateRef.current.bottomOpen ?? true);
  const [isAgentOpen, setIsAgentOpen] = useState(initialStateRef.current.agentOpen ?? false);
  const [activeActivity, setActiveActivity] = useState<ActivityView>(initialStateRef.current.activeActivity || "explorer");
  const [bottomPanel, setBottomPanel] = useState<BottomPanel>(initialStateRef.current.bottomPanel || "terminal");
  const [overlayMode, setOverlayMode] = useState<OverlayMode>(null);
  const [overlayQuery, setOverlayQuery] = useState("");
  const [minimap, setMinimap] = useState(initialStateRef.current.minimap ?? false);
  const [cursorPositions, setCursorPositions] = useState<Record<string, { lineNumber: number; column: number }>>(initialStateRef.current.cursorPositions || {});
  const [ollamaOnline, setOllamaOnline] = useState(false);
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [opencodeVersion, setOpencodeVersion] = useState("");
  const [selectedModel, setSelectedModel] = useState(initialStateRef.current.selectedModel || "");
  const [serverHealth, setServerHealth] = useState<{ healthy: boolean; [key: string]: unknown }>({ healthy: false });
  const [serverLocation, setServerLocation] = useState<{ url?: string; port?: number; [key: string]: unknown } | null>(null);
  const [lastHealthCheck, setLastHealthCheck] = useState<string>("");
  const [agentPrompt, setAgentPrompt] = useState(starterPrompt);
  const [agentBusy, setAgentBusy] = useState(false);
  const [activeAgentSessionId, setActiveAgentSessionId] = useState("");
  const [activeAgentMessageId, setActiveAgentMessageId] = useState("");
  const [agentPermissionMode, setAgentPermissionMode] = useState("Full access");
  const [granularPermissions, setGranularPermissions] = useState<Record<string, "allow" | "ask" | "deny">>(() => {
    const defaults: Record<string, "allow" | "ask" | "deny"> = {};
    TOOL_PERMISSIONS.forEach(t => defaults[t.id] = "allow");
    return defaults;
  });
  const [savedPermissions, setSavedPermissions] = useState<SavedPermission[]>([]);
  const [agentPlanMode, setAgentPlanMode] = useState(false);
  const [agentContextMode, setAgentContextMode] = useState<AgentContextMode>("workspace");
  const [agentSessions, setAgentSessions] = useState<AgentSessionInfo[]>([]);
  const [agentCommands, setAgentCommands] = useState<AgentCommandInfo[]>([]);
  const [agentProviderState, setAgentProviderState] = useState<AgentProviderState>({ all: [], default: {}, connected: [] });
  const [agentProviderAuth, setAgentProviderAuth] = useState<AgentProviderAuthMap>({});
  const [v2Models, setV2Models] = useState<Array<{ id: string; providerID: string; name: string }>>([]);
  const [agentList, setAgentList] = useState<Array<{ name: string; mode?: string; description?: string }>>([]);
  const [selectedAgent, setSelectedAgent] = useState("build");
  const [agentActivityChips, setAgentActivityChips] = useState<AgentActivityChip[]>([]);
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      id: "welcome",
      role: "system",
      text: "Ask Code to review, explain, edit-plan, or reason about this workspace. The GUI runs the engine behind the scenes without opening the terminal UI.",
      meta: "Code Workbench"
    }
  ]);
  const [pendingQuestions, setPendingQuestions] = useState<AgentQuestion[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [references, setReferences] = useState<ReferenceInfo[]>([]);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [agentLog, setAgentLog] = useState<string[]>([
    "Code GUI mode active. Terminal UI launching is disabled.",
    "Use the Ollama model dropdown for local and cloud models.",
    "Provider auth stays compatible with the vendored Code engine."
  ]);
  const [outputLog, setOutputLog] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchOptions, setSearchOptions] = useState({ regex: false, matchCase: false, wholeWord: false, include: "", exclude: "" });
  const [symbols, setSymbols] = useState<SymbolResult[]>([]);
  const [gitState, setGitState] = useState<GitState>({ ok: false, branch: "checking", changes: [], message: "" });
  const [fileContextMenu, setFileContextMenu] = useState<FileContextMenu>(null);
  const [configEditorOpen, setConfigEditorOpen] = useState(false);
  const [configData, setConfigData] = useState<any>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [configTab, setConfigTab] = useState("general");
  const [configExternalChanged, setConfigExternalChanged] = useState(false);
  // MCP config panel state
  const [mcpEditorOpen, setMcpEditorOpen] = useState(false);
  const [mcpConfig, setMcpConfig] = useState<{ servers: Record<string, any> }>({ servers: {} });
  const [mcpDirty, setMcpDirty] = useState(false);
  // Project copy state
  const [copyProjectBusy, setCopyProjectBusy] = useState(false);

  const activeTab = tabs.find((tab) => tab.path === activePath) || null;
  const dirtyCount = tabs.filter((tab) => tab.content !== tab.savedContent).length;
  const flatFiles = useMemo(() => flattenFiles(files), [files]);
  const modelOptions = useMemo(() => {
    const ollama = ollamaModels.map((model) => `ollama/${model}`);
    const v2 = v2Models.map((m) => `${m.providerID}/${m.id}`);
    return [...new Set([...ollama, ...v2])];
  }, [ollamaModels, v2Models]);
  const dynamicSlashCommands = useMemo(() => {
    const seen = new Set<string>();
    return [...slashCommands, ...engineSlashCommands(agentCommands)]
      .filter((item) => {
        if (seen.has(item.command)) return false;
        seen.add(item.command);
        return true;
      });
  }, [agentCommands]);
  const effectiveModel = selectedModel;

  const refreshFiles = useCallback(async (workspace = projectPath) => {
    if (!workspace) return;
    setFiles((await withApiError(api.files.list(workspace), toast)) ?? []);
  }, [projectPath, toast]);

  const refreshGit = useCallback(async (workspace = projectPath) => {
    if (!workspace) return;
    setGitState((await withApiError(api.git.status(workspace), toast)) ?? { ok: false, branch: "unknown", changes: [], message: "Unable to read Git status" });
  }, [projectPath, toast]);

  const refreshOpenTabsFromDisk = useCallback(async (workspace = projectPath) => {
    if (!workspace) return;
    const cleanTabs = tabs.filter((tab) => tab.content === tab.savedContent);
    if (!cleanTabs.length) return;
    const refreshed = await Promise.all(cleanTabs.map(async (tab) => {
      try {
        const content = await withApiError(api.files.read(workspace, tab.path), toast);
        return typeof content === "string" ? { path: tab.path, content } : null;
      } catch {
        return null;
      }
    }));
    const contentByPath = new Map(refreshed.filter(Boolean).map((item) => [item!.path, item!.content]));
    setTabs((current) => current.map((tab) => {
      const content = contentByPath.get(tab.path);
      return content === undefined ? tab : { ...tab, content, savedContent: content };
    }));
  }, [projectPath, tabs, toast]);

  const refreshSkills = useCallback(async (workspace = projectPath) => {
    if (!workspace) return;
    try {
      const bridge = api.opencode as OptionalOpenCodeBridge;
      if (bridge.skills) {
        setSkills((await withApiError(bridge.skills({ projectPath: workspace }), toast)) ?? []);
      }
    } catch {
      setSkills([]);
    }
  }, [projectPath, toast]);

  const refreshReferences = useCallback(async (workspace = projectPath) => {
    if (!workspace) return;
    try {
      const bridge = api.opencode as OptionalOpenCodeBridge;
      if (bridge.references) {
        setReferences((await withApiError(bridge.references({ projectPath: workspace }), toast)) ?? []);
      }
    } catch {
      setReferences([]);
    }
  }, [projectPath, toast]);

  const loadSavedPermissions = useCallback(async () => {
    try {
      const bridge = api.opencode as OptionalOpenCodeBridge;
      if (bridge.savedPermissions) {
        const list = await bridge.savedPermissions({ projectPath });
        if (Array.isArray(list)) {
          setSavedPermissions(list);
        }
      }
    } catch {
      // silently ignore
    }
  }, [projectPath]);

  const refreshAgentSessions = useCallback(async (workspace = projectPath) => {
    if (!workspace || !api.opencode.sessions) return;
    try {
      setAgentSessions((await withApiError(api.opencode.sessions({ projectPath: workspace }), toast)) ?? []);
    } catch {
      setAgentSessions([]);
    }
  }, [projectPath, toast]);

  const refreshAgentCapabilities = useCallback(async (workspace = projectPath) => {
    if (!workspace) return;
    const bridge = api.opencode as OptionalOpenCodeBridge;
    const [commands, providerState, providerAuth, modelsResult, agentsResult] = await Promise.all([
      withApiError(api.opencode.commands({ projectPath: workspace }), toast),
      withApiError(api.opencode.providerState({ projectPath: workspace }), toast),
      withApiError(api.opencode.providerAuth({ projectPath: workspace }), toast),
      bridge.models ? withApiError(bridge.models(undefined), toast) : Promise.resolve([]),
      bridge.agents ? withApiError(bridge.agents({ projectPath: workspace }), toast) : Promise.resolve([])
    ]);
    setAgentCommands(commands ?? []);
    setAgentProviderState(providerState ?? { all: [], default: {}, connected: [] });
    setAgentProviderAuth(providerAuth ?? {});
    const modelsArr = Array.isArray(modelsResult) ? modelsResult : (modelsResult && Array.isArray(modelsResult.models) ? modelsResult.models.map(function(m: string) { return { id: m, providerID: "ollama", name: m }; }) : []);
    if (modelsArr.length > 0 && typeof modelsArr[0] === "object") {
      setV2Models(modelsArr);
    }
    const agentsArr = Array.isArray(agentsResult) ? agentsResult : [];
    if (agentsArr.length > 0) {
      setAgentList(agentsArr);
      setSelectedAgent(function(current) {
        if (!current || !agentsArr.some(function(a) { return a.name === current; })) {
          return agentsArr[0]?.name || "build";
        }
        return current;
      });
    }
  }, [projectPath, toast]);

  const openAgentSession = useCallback(async (sessionID: string) => {
    if (!projectPath || !sessionID) return;
    const bridge = api.opencode as OptionalOpenCodeBridge;
    const messages = (await withApiError(bridge.messages({ projectPath, sessionID }), toast)) ?? [];
    const uiMessages = agentMessagesFromOpenCode(messages, sessionID);
    const diff = (await withApiError(bridge.diff({ projectPath, sessionID }), toast)) ?? [];
    setActiveAgentSessionId(sessionID);
    setAgentActivityChips((chips) => [
      { id: `open-${sessionID}-${Date.now()}`, label: "session resumed", tone: "success" as const, sessionID },
      ...chips
    ].slice(0, 10));
    setAgentMessages(uiMessages.length ? uiMessages : [{
      id: `session-${sessionID}`,
      role: "system",
      text: "This session has no visible messages yet.",
      meta: sessionID,
      sessionID
    }]);
    if (diff.length) {
      setAgentMessages((current) => current.map((message, index) => index === current.length - 1 ? { ...message, diff } : message));
    }
    setIsAgentOpen(true);
    setActiveActivity("ai");
  }, [projectPath, toast]);

  const startNewAgentSession = useCallback(async () => {
    if (!projectPath) return;
    const bridge = api.opencode as OptionalOpenCodeBridge;
    if (bridge.startSession) {
      const session = await bridge.startSession({ projectPath, model: effectiveModel, agent: selectedAgent });
      const sessionID = session.sessionID || session.id || "";
      if (sessionID) {
        setActiveAgentSessionId(sessionID);
        setAgentActivityChips((chips) => [{ id: `new-${sessionID}`, label: "new session", tone: "success" as const, sessionID }, ...chips].slice(0, 10));
      }
    } else {
      setActiveAgentSessionId("");
    }
    setAgentMessages([{
      id: `new-session-${uid()}`,
      role: "system",
      text: "Started a fresh Code thread. Your next prompt will create or attach to a backend session.",
      meta: effectiveModel || "Code engine"
    }]);
    setIsAgentOpen(true);
    setActiveActivity("ai");
  }, [effectiveModel, projectPath, selectedAgent]);

  const forkAgentSession = useCallback(async (sessionID = activeAgentSessionId, messageID = activeAgentMessageId) => {
    if (!projectPath || !sessionID) return;
    const bridge = api.opencode as OptionalOpenCodeBridge;
    if (bridge.fork) {
      const forked = await bridge.fork({ projectPath, sessionID, messageID });
      const nextID = String(forked?.sessionID || forked?.id || "");
      if (nextID) {
        await openAgentSession(nextID);
        setAgentActivityChips((chips) => [{ id: `fork-${nextID}`, label: "session forked", tone: "success" as const, sessionID: nextID }, ...chips].slice(0, 10));
        return;
      }
    }
    setAgentPrompt((prompt) => prompt || `/fork ${sessionID}${messageID ? ` ${messageID}` : ""}`);
    setAgentActivityChips((chips) => [{ id: `fork-staged-${Date.now()}`, label: "fork staged", tone: "warn" as const, sessionID }, ...chips].slice(0, 10));
  }, [activeAgentMessageId, activeAgentSessionId, openAgentSession, projectPath]);

  const openFile = useCallback(async (path: string, options: { pinned?: boolean; preview?: boolean; line?: number; column?: number } = {}) => {
    if (!projectPath) return;
    if (options.line) pendingRevealRef.current = { path, line: options.line, column: options.column };
    const existing = tabs.find((tab) => tab.path === path);
    if (existing) {
      setTabs((current) => current.map((tab) => tab.path === path ? { ...tab, pinned: tab.pinned || options.pinned, preview: options.pinned ? false : tab.preview } : tab));
      setActivePath(path);
      return;
    }
    const content = await withApiError(api.files.read(projectPath, path), toast);
    if (typeof content !== "string") return;
    const nextTab: OpenTab = {
      path,
      content,
      savedContent: content,
      pinned: options.pinned ?? false,
      preview: options.preview ?? !options.pinned
    };
    setTabs((current) => {
      if (!nextTab.preview) return [...current, nextTab];
      const previewIndex = current.findIndex((tab) => tab.preview && tab.content === tab.savedContent);
      if (previewIndex === -1) return [...current, nextTab];
      return current.map((tab, index) => index === previewIndex ? nextTab : tab);
    });
    setActivePath(path);
  }, [projectPath, tabs, toast]);

  const boot = useCallback(async () => {
    const saved = initialStateRef.current;
    const [defaultProject, status, info] = await Promise.all([
      api.project.default(),
      api.ollama.status(),
      api.opencode.info()
    ]);
    const nextProject = saved.projectPath || defaultProject;
    setProjectPath(nextProject);
    setOllamaOnline(status.online);
    setOpencodeVersion(info.installed ? info.version : "not installed");
    // Fetch initial server health
    try {
      const health = await api.opencode.health(nextProject);
      setServerHealth(health);
      setLastHealthCheck(new Date().toLocaleTimeString());
    } catch {
      setServerHealth({ healthy: false });
    }
    try {
      const location = await api.opencode.location(nextProject);
      setServerLocation(location);
    } catch {
      setServerLocation(null);
    }
    setFiles(await api.files.list(nextProject));
    await refreshGit(nextProject);
    await refreshAgentSessions(nextProject);
    await refreshAgentCapabilities(nextProject);
    await refreshSkills(nextProject);
    await refreshReferences(nextProject);
    await loadSavedPermissions();
    if (status.online) {
      const models = await api.ollama.models();
      setOllamaModels(models);
      if (!saved.selectedModel) setSelectedModel(models[0] ? `ollama/${models[0]}` : "");
      if (models.length) {
        const sync = await api.opencode.syncOllama({ projectPath: nextProject, models });
        setAgentLog((log) => [`Synced ${sync.modelCount} Ollama models to ${sync.path}.`, ...log].slice(0, 30));
      }
    }
    const restoredTabs = await Promise.all((saved.tabs || []).slice(0, 12).map(async (path) => {
      try {
        const content = await api.files.read(nextProject, path);
        return { path, content, savedContent: content, pinned: true, preview: false } satisfies OpenTab;
      } catch {
        return null;
      }
    }));
    const validTabs: OpenTab[] = restoredTabs.filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
    setTabs(validTabs);
    setActivePath(saved.activePath && validTabs.some((tab) => tab.path === saved.activePath) ? saved.activePath : validTabs[0]?.path || "");
  }, [refreshAgentCapabilities, refreshAgentSessions, refreshGit, refreshSkills, refreshReferences, loadSavedPermissions]);

  useEffect(() => {
    boot().catch((error) => setAgentLog((log) => [`Startup failed: ${String(error)}`, ...log]));
  }, [boot]);

  useEffect(() => {
    const bridge = api.opencode as OptionalOpenCodeBridge;
    if (!bridge.onEvent) return undefined;
    let disposed = false;
    const disposeEvent = bridge.onEvent((event: AgentRuntimeEvent | unknown) => {
      if (disposed || !event) return;
      if (shouldShowRuntimeActivity(event)) {
        const chip = activityChipFromEvent(event);
        setAgentActivityChips((chips) => [chip, ...chips.filter((item) => item.id !== chip.id)].slice(0, 10));
      }
      const runtimeEvent = event as AgentRuntimeEvent;
      if (!runtimeEvent.requestId) return;
      if (runtimeEvent.type === "session") {
        setActiveAgentSessionId(runtimeEvent.sessionID);
        setAgentLog((log) => [`Session ${runtimeEvent.sessionID} using ${runtimeEvent.model || "selected model"}.`, ...log].slice(0, 30));
      }
      if (runtimeEvent.type === "files") {
        refreshFiles(projectPath);
        refreshGit(projectPath);
        refreshOpenTabsFromDisk(projectPath);
        return;
      }
      // Q&A events
      if (runtimeEvent.type === "question.asked") {
        const bridge = api.opencode as OptionalOpenCodeBridge;
        if (bridge.questionRequests) {
          bridge.questionRequests({ projectPath }).then((questions: AgentQuestion[]) => {
            if (Array.isArray(questions)) {
              setPendingQuestions((prev) => {
                const existing = new Set(prev.map((q) => q.id));
                const newOnes = questions.filter((q: AgentQuestion) => !existing.has(q.id));
                return [...prev, ...newOnes].slice(-20);
              });
            }
          }).catch(() => {});
        }
        return;
      }
      if (runtimeEvent.type === "question.replied") {
        setPendingQuestions((current) =>
          current.map((q) =>
            q.id === (runtimeEvent as any).questionID || q.requestID === (runtimeEvent as any).requestID
              ? { ...q, status: "replied" }
              : q
          )
        );
        return;
      }
      // Permission saved events
      if (runtimeEvent.type === "permission.saved") {
        loadSavedPermissions();
        return;
      }
      // Skills events
      if (runtimeEvent.type === "skill.registered") {
        refreshSkills(projectPath);
        return;
      }
      // References events
      if (runtimeEvent.type === "reference.updated") {
        refreshReferences(projectPath);
        return;
      }
      setAgentMessages((messages) => messages.map((message) => {
        if (message.requestId !== runtimeEvent.requestId) return message;
        if (runtimeEvent.type === "status") {
          return { ...message, status: runtimeEvent.status, pending: runtimeEvent.status !== "done" };
        }
        if (runtimeEvent.type === "session") {
          return { ...message, sessionID: runtimeEvent.sessionID, meta: runtimeEvent.model || message.meta };
        }
        if (runtimeEvent.type === "text") {
          const nextText = runtimeEvent.text || "";
          const currentText = message.text || "";
          return {
            ...message,
            text: nextText.length >= currentText.length ? nextText : currentText,
            sessionID: runtimeEvent.sessionID || message.sessionID,
            pending: true
          };
        }
        if (runtimeEvent.type === "tools") {
          return { ...message, tools: runtimeEvent.tools, sessionID: runtimeEvent.sessionID || message.sessionID };
        }
        if (runtimeEvent.type === "permissions") {
          return { ...message, permissions: runtimeEvent.permissions, sessionID: runtimeEvent.sessionID || message.sessionID, status: "needs permission" };
        }
        if (runtimeEvent.type === "diff") {
          setActiveAgentMessageId(runtimeEvent.messageID || "");
          return { ...message, diff: runtimeEvent.diff, sessionID: runtimeEvent.sessionID || message.sessionID, messageID: runtimeEvent.messageID };
        }
        return message;
      }));
    });
    return () => {
      disposed = true;
      disposeEvent();
    };
  }, [projectPath, refreshFiles, refreshGit, refreshOpenTabsFromDisk, refreshSkills, refreshReferences, loadSavedPermissions]);

  useEffect(() => {
    if (!projectPath) return;
    const state: WorkspaceState = {
      projectPath,
      tabs: tabs.map((tab) => tab.path),
      activePath,
      activeActivity,
      bottomPanel,
      sidebarWidth,
      agentWidth,
      bottomHeight,
      sidebarOpen: isSidebarOpen,
      bottomOpen: isBottomOpen,
      agentOpen: isAgentOpen,
      minimap,
      selectedModel,
      cursorPositions
    };
    window.localStorage.setItem(workspaceStateKey, JSON.stringify(state));
  }, [activeActivity, activePath, agentWidth, bottomHeight, bottomPanel, cursorPositions, isAgentOpen, isBottomOpen, isSidebarOpen, minimap, projectPath, selectedModel, sidebarWidth, tabs]);

  // Periodic health polling
  useEffect(() => {
    if (!projectPath) return;
    const interval = window.setInterval(async () => {
      try {
        const health = await api.opencode.health(projectPath);
        setServerHealth(health);
        setLastHealthCheck(new Date().toLocaleTimeString());
      } catch {
        setServerHealth({ healthy: false });
      }
    }, 30000);
    return () => window.clearInterval(interval);
  }, [projectPath]);

  useEffect(() => {
    const normalizeLayout = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setSidebarWidth((value) => clamp(value, 170, Math.min(450, Math.max(170, width * 0.32))));
      setAgentWidth((value) => clamp(value, width < 1180 ? 300 : 320, Math.max(300, Math.min(480, width * 0.26))));
      setBottomHeight((value) => clamp(value, 150, Math.min(600, Math.max(150, height * 0.48))));
    };
    normalizeLayout();
    window.addEventListener("resize", normalizeLayout);
    return () => window.removeEventListener("resize", normalizeLayout);
  }, []);

  useEffect(() => {
    window.setTimeout(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      const pending = pendingRevealRef.current;
      const savedPosition = cursorPositions[activePath];
      const target = pending?.path === activePath ? { lineNumber: pending.line, column: pending.column || 1 } : savedPosition;
      if (target) {
        editor.setPosition(target);
        editor.revealLineInCenter(target.lineNumber);
        pendingRevealRef.current = null;
      }
    }, 30);
  }, [activePath, cursorPositions]);

  useEffect(() => {
    if (overlayMode !== "symbols" || !projectPath) return;
    const handle = window.setTimeout(() => {
      api.workspace.symbols(projectPath, overlayQuery).then(setSymbols).catch(() => setSymbols([]));
    }, 120);
    return () => window.clearTimeout(handle);
  }, [overlayMode, overlayQuery, projectPath]);

  const saveActive = useCallback(async () => {
    if (!projectPath || !activeTab) return;
    await api.files.write(projectPath, activeTab.path, activeTab.content);
    setTabs((current) => current.map((tab) => tab.path === activeTab.path ? { ...tab, savedContent: tab.content, preview: false, pinned: true } : tab));
    await refreshFiles(projectPath);
    await refreshGit(projectPath);
  }, [activeTab, projectPath, refreshFiles, refreshGit]);

  const saveAll = useCallback(async () => {
    if (!projectPath) return;
    const dirtyTabs = tabs.filter((tab) => tab.content !== tab.savedContent);
    if (!dirtyTabs.length) return;
    await Promise.all(dirtyTabs.map((tab) => api.files.write(projectPath, tab.path, tab.content)));
    setTabs((current) => current.map((tab) => ({ ...tab, savedContent: tab.content, preview: false, pinned: true })));
    await refreshFiles(projectPath);
    await refreshGit(projectPath);
  }, [projectPath, tabs, refreshFiles, refreshGit]);

  const closeTab = useCallback((path: string) => {
    setTabs((current) => {
      const index = current.findIndex((tab) => tab.path === path);
      const next = current.filter((tab) => tab.path !== path);
      if (path === activePath) {
        const nextActive = next[Math.min(index, next.length - 1)]?.path || "";
        window.setTimeout(() => setActivePath(nextActive), 0);
      }
      return next;
    });
  }, [activePath]);

  const updateActiveContent = (content: string | undefined) => {
    setTabs((current) => current.map((tab) => tab.path === activePath ? { ...tab, content: content || "", preview: false, pinned: true } : tab));
  };

  const openProject = async () => {
    const nextProject = await api.project.open();
    if (!nextProject) return;
    setProjectPath(nextProject);
    setFiles(await api.files.list(nextProject));
    setTabs([]);
    setActivePath("");
    setTerminalOutput("");
    setActiveActivity("explorer");
    setCommandEvent({ id: uid(), text: `\r\n# Project changed to ${nextProject}\r\n` });
    await refreshGit(nextProject);
    await refreshAgentSessions(nextProject);
    await refreshAgentCapabilities(nextProject);
    await refreshSkills(nextProject);
    await refreshReferences(nextProject);
    await loadSavedPermissions();
  };

  const runSearch = useCallback(async () => {
    if (!projectPath || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    setSearchBusy(true);
    try {
      setSearchResults(await api.workspace.search(projectPath, { query: searchQuery, ...searchOptions }));
    } finally {
      setSearchBusy(false);
    }
  }, [projectPath, searchOptions, searchQuery]);

  const createFile = async () => {
    if (!projectPath) return;
    const relativePath = window.prompt("New file path");
    if (!relativePath) return;
    await api.files.createFile(projectPath, relativePath, "");
    await refreshFiles(projectPath);
    await openFile(relativePath, { pinned: true });
  };

  const createFolder = async () => {
    if (!projectPath) return;
    const relativePath = window.prompt("New folder path");
    if (!relativePath) return;
    await api.files.createFolder(projectPath, relativePath);
    await refreshFiles(projectPath);
  };

  const renamePath = async (fromPath: string) => {
    if (!projectPath) return;
    const toPath = window.prompt("Rename to", fromPath);
    if (!toPath || toPath === fromPath) return;
    await api.files.rename(projectPath, fromPath, toPath);
    setTabs((current) => current.map((tab) => tab.path === fromPath ? { ...tab, path: toPath } : tab));
    if (activePath === fromPath) setActivePath(toPath);
    await refreshFiles(projectPath);
    await refreshGit(projectPath);
  };

  const duplicatePath = async (fromPath: string) => {
    if (!projectPath) return;
    const toPath = window.prompt("Duplicate to", fromPath.replace(/(\.[^/.]+)?$/, "-copy$1"));
    if (!toPath || toPath === fromPath) return;
    await api.files.duplicate(projectPath, fromPath, toPath);
    await refreshFiles(projectPath);
    await openFile(toPath, { pinned: true });
  };

  const deletePath = async (relativePath: string) => {
    if (!projectPath || !window.confirm(`Delete ${relativePath}?`)) return;
    await api.files.delete(projectPath, relativePath);
    setTabs((current) => current.filter((tab) => tab.path !== relativePath && !tab.path.startsWith(`${relativePath}/`)));
    if (activePath === relativePath || activePath.startsWith(`${relativePath}/`)) setActivePath("");
    await refreshFiles(projectPath);
    await refreshGit(projectPath);
  };

  const refreshOllama = async () => {
    const status = await api.ollama.status();
    setOllamaOnline(status.online);
    const models = status.online ? await api.ollama.models() : [];
    setOllamaModels(models);
    if (!selectedModel && models[0]) setSelectedModel(`ollama/${models[0]}`);
    if (status.online && models.length) {
      const sync = await api.opencode.syncOllama({ projectPath, models });
      setAgentLog((log) => [`Ollama online - ${models.length} local models found. Synced to ${sync.path}.`, ...log].slice(0, 30));
      await refreshAgentCapabilities(projectPath);
      return;
    }
    setAgentLog((log) => [`Ollama ${status.online ? "online" : "offline"} - ${models.length} local models found.`, ...log].slice(0, 30));
  };

  const openAgent = useCallback((prompt?: string) => {
    setIsAgentOpen(true);
    setActiveActivity("ai");
    if (prompt) setAgentPrompt(prompt);
  }, []);

  const submitAgentPrompt = useCallback(async (options: { permissionMode?: string; planMode?: boolean; promptOverride?: string } = {}) => {
    const sourcePrompt = options.promptOverride ?? agentPrompt;
    const rawPrompt = sourcePrompt.trim();
    const slashName = /^\/([a-zA-Z0-9:_-]+)/.exec(rawPrompt)?.[1] || "";
    const promptText = slashName && agentCommands.some((command) => command.name === slashName)
      ? rawPrompt
      : expandSlashPrompt(rawPrompt);
    if (!promptText || agentBusy) return;
    setIsAgentOpen(true);
    setActiveActivity("ai");
    setAgentPrompt("");
    const requestId = uid();
    const assistantId = uid();
    const permissionMode = options.permissionMode || agentPermissionMode;
    const planMode = options.planMode ?? agentPlanMode;
    const userMessage: AgentMessage = {
      id: uid(),
      role: "user",
      text: promptText,
      meta: activePath || projectName(projectPath)
    };
    const assistantMessage: AgentMessage = {
      id: assistantId,
      requestId,
      role: "assistant",
      text: "",
      meta: effectiveModel || "Code engine",
      pending: true,
      status: "queued"
    };
    setAgentMessages((messages) => [...messages, userMessage, assistantMessage]);
    setAgentBusy(true);
    try {
      const bridge = api.opencode as OptionalOpenCodeBridge;
      const fullPrompt = contextPrompt(
        promptText,
        agentContextMode,
        activePath,
        selectedCode,
        tabs.map((tab) => tab.path),
        gitState.changes,
        terminalOutput
      );
      if (bridge.prompt) {
        let sessionID = activeAgentSessionId;
        if (!sessionID && bridge.startSession) {
          const session = await bridge.startSession({ projectPath, model: effectiveModel, agent: selectedAgent });
          sessionID = session.sessionID || session.id || "";
          if (sessionID) setActiveAgentSessionId(sessionID);
        }
        const result = await bridge.prompt({
          projectPath,
          sessionID,
          model: effectiveModel,
          agent: selectedAgent,
          prompt: fullPrompt,
          requestId,
          permissionMode,
          permissionRules: permissionRulesForMode(granularPermissions),
          planMode
        });
        const nextSessionID = result.sessionID || sessionID;
        if (nextSessionID) setActiveAgentSessionId(nextSessionID);
        setAgentMessages((messages) => messages.map((message) => (
          message.id === assistantId
            ? {
              ...message,
              text: result.stdout && result.stdout.length >= (message.text || "").length ? result.stdout : message.text || result.stdout || "",
              meta: effectiveModel || "Code engine",
              command: result.command,
              exitCode: result.exitCode,
              pending: false,
              status: result.exitCode === 0 ? "done" : "failed",
              sessionID: nextSessionID || message.sessionID,
              messageID: result.messageID || message.messageID,
              tools: result.tools || message.tools,
              diff: result.diff || message.diff
          }
            : message
        )));
        setAgentActivityChips((chips) => [{ id: `prompt-${requestId}`, label: "done", tone: result.exitCode === 0 ? "success" as const : "danger" as const, sessionID: nextSessionID }, ...chips].slice(0, 10));
        setAgentLog((log) => [`Prompt finished in ${nextSessionID || "Code"} with exit ${result.exitCode}.`, ...log].slice(0, 30));
        await refreshAgentSessions(projectPath);
        return;
      }
      const result = await api.opencode.command({
        mode: "run",
        projectPath,
        model: effectiveModel,
        prompt: fullPrompt,
        requestId,
        permissionMode,
        planMode
      });
      const responseText = `${result.stdout || ""}${result.stderr ? `\n${result.stderr}` : ""}`.trim() || "No response returned.";
      setActiveAgentSessionId(result.sessionID || activeAgentSessionId);
      setActiveAgentMessageId(result.messageID || activeAgentMessageId);
      setAgentMessages((messages) => messages.map((message) => (
        message.id === assistantId
          ? {
            ...message,
            text: responseText,
            meta: result.exitCode === 0 ? effectiveModel || "Code engine" : "Run failed",
            command: result.command,
            exitCode: result.exitCode,
            pending: false,
            status: result.exitCode === 0 ? "done" : "failed",
            sessionID: result.sessionID || message.sessionID,
            messageID: result.messageID || message.messageID,
            tools: result.tools || message.tools,
            diff: result.diff || message.diff
          }
          : message
      )));
      setAgentLog((log) => [`Prompt finished with exit ${result.exitCode}.`, ...log].slice(0, 30));
      setOutputLog((log) => [commandBlock("code run", result), ...log].slice(0, 20));
      await refreshAgentSessions(projectPath);
      await refreshAgentCapabilities(projectPath);
      if (result.diff?.length || result.exitCode === 0) {
        await refreshOpenTabsFromDisk(projectPath);
        await refreshFiles(projectPath);
        await refreshGit(projectPath);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setAgentMessages((messages) => messages.map((item) => (
        item.id === assistantId
          ? {
            ...item,
            text: `Code engine failed to run this prompt.\n\n${message}`,
            meta: "Error",
            exitCode: 1,
            pending: false,
            status: "failed"
          }
          : item
      )));
      setAgentLog((log) => [`Prompt failed: ${message}`, ...log].slice(0, 30));
    } finally {
      setAgentBusy(false);
    }
  }, [
    activeAgentMessageId,
    activeAgentSessionId,
    activePath,
    agentBusy,
    agentCommands,
    agentPermissionMode,
    granularPermissions,
    agentPlanMode,
    agentPrompt,
    agentContextMode,
    effectiveModel,
    gitState.changes,
    projectPath,
    refreshAgentCapabilities,
    refreshAgentSessions,
    refreshFiles,
    refreshGit,
    refreshOpenTabsFromDisk,
    selectedAgent,
    selectedCode,
    tabs,
    terminalOutput
  ]);

  const copyPrompt = async () => {
    if (!agentPrompt.trim()) return;
    await navigator.clipboard?.writeText(agentPrompt);
    setAgentLog((log) => ["Copied staged prompt to clipboard.", ...log].slice(0, 30));
  };

  const stopAgent = useCallback(async () => {
    if (!activeAgentSessionId) return;
    await api.opencode.abort({ projectPath, sessionID: activeAgentSessionId });
    setAgentBusy(false);
    setAgentMessages((messages) => messages.map((message) => (
      message.pending ? { ...message, pending: false, status: "stopped", text: message.text || "Stopped." } : message
    )));
    setAgentLog((log) => [`Stopped session ${activeAgentSessionId}.`, ...log].slice(0, 30));
  }, [activeAgentSessionId, projectPath]);

  const onSwitchModel = useCallback(async (model: string) => {
    setSelectedModel(model);
    if (activeAgentSessionId && projectPath) {
      const bridge = api.opencode as OptionalOpenCodeBridge;
      if (bridge.sessionSwitchModel) {
        try {
          const result = await bridge.sessionSwitchModel({ projectPath, sessionID: activeAgentSessionId, model });
          if (result.ok) {
            toast("Model switched to " + model, "success");
          } else {
            toast("Failed to switch model for active session", "error");
          }
        } catch (error) {
          toast("Error switching model: " + (error instanceof Error ? error.message : String(error)), "error");
        }
      }
    }
  }, [activeAgentSessionId, projectPath, toast]);

  const onSwitchAgent = useCallback(async (agent: string) => {
    setSelectedAgent(agent);
    if (activeAgentSessionId && projectPath) {
      const bridge = api.opencode as OptionalOpenCodeBridge;
      if (bridge.sessionSwitchAgent) {
        try {
          const result = await bridge.sessionSwitchAgent({ projectPath, sessionID: activeAgentSessionId, agent });
          if (result.ok) {
            toast("Agent switched to " + agent, "success");
            setAgentActivityChips((chips) => [{ id: `agent-switch-${Date.now()}`, label: "agent: " + agent, tone: "info" as const, sessionID: activeAgentSessionId }, ...chips].slice(0, 10));
          } else {
            toast("Failed to switch agent for active session", "error");
          }
        } catch (error) {
          toast("Error switching agent: " + (error instanceof Error ? error.message : String(error)), "error");
        }
      }
    }
  }, [activeAgentSessionId, projectPath, toast]);

  const continueAgent = useCallback(() => {
    submitAgentPrompt({ permissionMode: agentPermissionMode, planMode: agentPlanMode, promptOverride: "/continue" });
  }, [agentPermissionMode, agentPlanMode, submitAgentPrompt]);

  const retryLastAgentPrompt = useCallback(() => {
    const lastUser = [...agentMessages].reverse().find((message) => message.role === "user");
    if (!lastUser) return;
    submitAgentPrompt({ permissionMode: agentPermissionMode, planMode: agentPlanMode, promptOverride: lastUser.text });
  }, [agentMessages, agentPermissionMode, agentPlanMode, submitAgentPrompt]);

  const replyAgentPermission = useCallback(async (sessionID: string, permission: AgentPermissionRequest, reply: "once" | "always" | "reject") => {
    const requestID = String(permission.id || permission.requestID || permission.permissionID || "");
    if (!sessionID || !requestID) return;
    await api.opencode.permissionReply({ projectPath, sessionID, requestID, reply });
    setAgentMessages((messages) => messages.map((message) => (
      message.sessionID === sessionID
        ? {
          ...message,
          permissions: (message.permissions || []).filter((item) => String(item.id || item.requestID || item.permissionID || "") !== requestID)
        }
        : message
    )));
  }, [projectPath]);

  const replyToQuestion = useCallback(async (question: AgentQuestion, reply: string) => {
    const bridge = api.opencode as OptionalOpenCodeBridge;
    if (!bridge.questionReply || !question.sessionID || !question.requestID) return;
    try {
      await bridge.questionReply({ projectPath, sessionID: question.sessionID, requestID: question.requestID, reply });
      setPendingQuestions((current) => current.filter((q) => q.id !== question.id));
    } catch (error) {
      toast('Failed to reply to question: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
  }, [projectPath, toast]);

  const rejectQuestion_ = useCallback(async (question: AgentQuestion) => {
    const bridge = api.opencode as OptionalOpenCodeBridge;
    if (!bridge.questionReject || !question.sessionID || !question.requestID) return;
    try {
      await bridge.questionReject({ projectPath, sessionID: question.sessionID, requestID: question.requestID });
      setPendingQuestions((current) => current.filter((q) => q.id !== question.id));
    } catch (error) {
      toast('Failed to reject question: ' + (error instanceof Error ? error.message : String(error)), 'error');
    }
  }, [projectPath, toast]);

  const revertAgentTurn = useCallback(async (sessionID?: string, messageID?: string) => {
    const targetSession = sessionID || activeAgentSessionId;
    const targetMessage = messageID || activeAgentMessageId;
    if (!targetSession || !targetMessage) return;
    await api.opencode.revert({ projectPath, sessionID: targetSession, messageID: targetMessage });
    setAgentLog((log) => [`Reverted session turn ${targetMessage}.`, ...log].slice(0, 30));
    await refreshFiles(projectPath);
    await refreshGit(projectPath);
  }, [activeAgentMessageId, activeAgentSessionId, projectPath, refreshFiles, refreshGit]);

  const runGitCommand = async (command: "fetch" | "pull" | "push" | "status") => {
    if (!projectPath) return;
    setIsBottomOpen(true);
    setBottomPanel("output");
    const result = await api.git.command(projectPath, command);
    const block = commandBlock(`git ${command}`, result);
    setOutputLog((log) => [block, ...log].slice(0, 20));
    setCommandEvent({ id: uid(), text: block });
    await refreshGit(projectPath);
  };

  const startAiAction = useCallback((label: string) => {
    const editor = editorRef.current;
    const selection = editor?.getSelection();
    const model = editor?.getModel();
    const selected = selection && model ? model.getValueInRange(selection).trim() : selectedCode;
    setIsAgentOpen(true);
    setActiveActivity("ai");
    setAgentPrompt([
      label,
      activePath ? `File: ${activePath}` : "",
      selected ? `Selected code:\n${selected}` : "Use the current file and workspace context."
    ].filter(Boolean).join("\n\n"));
  }, [activePath, selectedCode]);

  const loadConfigIntoEditor = useCallback(async () => {
    if (!projectPath) return;
    try {
      const bridge = api.opencode as any;
      if (bridge.readConfig) {
        const result = await bridge.readConfig({ projectPath });
        if (result.ok) {
          setConfigData(result.config);
          setConfigDirty(false);
          setConfigExternalChanged(false);
          setConfigTab("general");
        } else {
          toast("Failed to load config: " + (result.error || "Unknown error"), "error");
        }
      }
    } catch (error) {
      toast("Error loading config: " + (error instanceof Error ? error.message : String(error)), "error");
    }
  }, [projectPath, toast]);

  const loadMCPConfig = useCallback(async () => {
    if (!projectPath) return;
    try {
      const bridge = api.opencode as any;
      if (bridge.readMCPConfig) {
        const result = await bridge.readMCPConfig({ projectPath });
        if (result.ok) {
          setMcpConfig(result.mcpConfig || { servers: {} });
          setMcpDirty(false);
        } else {
          toast("Failed to load MCP config: " + (result.error || "Unknown error"), "error");
        }
      }
    } catch (error) {
      toast("Error loading MCP config: " + (error instanceof Error ? error.message : String(error)), "error");
    }
  }, [projectPath, toast]);

  const commands = useMemo(() => [
    { id: "file.open", label: "File: Open Folder", detail: "Open a workspace folder", run: openProject },
    { id: "file.new", label: "File: New File", detail: "Create a file in this workspace", run: createFile },
    { id: "file.folder", label: "File: New Folder", detail: "Create a folder in this workspace", run: createFolder },
    { id: "workbench.quickOpen", label: "Go to File...", detail: "Ctrl+P", run: () => openOverlay("quickOpen") },
    { id: "workbench.search", label: "Search: Find in Files", detail: "Ctrl+Shift+F", run: () => { setActiveActivity("search"); setIsSidebarOpen(true); } },
    { id: "workbench.symbols", label: "Go to Symbol in Workspace...", detail: "Ctrl+T", run: () => openOverlay("symbols") },
    { id: "workbench.toggleSidebar", label: "View: Toggle Side Bar", detail: "Ctrl+B", run: () => setIsSidebarOpen((value) => !value) },
    { id: "workbench.togglePanel", label: "View: Toggle Bottom Panel", detail: "Ctrl+J", run: () => setIsBottomOpen((value) => !value) },
    { id: "workbench.toggleAi", label: "Code: Toggle Agent Chat", detail: "Open the Codex-style agent panel", run: () => setIsAgentOpen((value) => !value) },
    { id: "code.chat", label: "Code: Focus Chat", detail: "Open the GUI agent composer", run: () => openAgent() },
    { id: "code.review", label: "Code: Review Workspace", detail: "Ask Code for a safe project review", run: () => openAgent(starterPrompt) },
    { id: "ai.inline", label: "AI: Inline Prompt", detail: "Ctrl+I", run: () => startAiAction("Inline AI request") },
    { id: "ai.explain", label: "AI: Explain Selection", detail: "Explain highlighted code", run: () => startAiAction("Explain this code") },
    { id: "ai.tests", label: "AI: Generate Tests", detail: "Create test suggestions", run: () => startAiAction("Generate tests for this code") },
    { id: "terminal.open", label: "Terminal: Focus Terminal", detail: "Ctrl+`", run: () => { setIsBottomOpen(true); setBottomPanel("terminal"); } },
    { id: "git.refresh", label: "Git: Refresh Source Control", detail: "Read git status", run: () => refreshGit(projectPath) },
    { id: "settings.minimap", label: `Editor: ${minimap ? "Hide" : "Show"} Minimap`, detail: "Toggle minimap", run: () => setMinimap((value) => !value) },
    { id: "config.open", label: "Code: Open Configuration", detail: "Edit opencode.json", run: () => { loadConfigIntoEditor(); setConfigEditorOpen(true); } },
    // MCP Config
    { id: "mcp.open", label: "MCP: Configure Servers", detail: "Manage MCP server definitions", run: () => { loadMCPConfig(); setMcpEditorOpen(true); } },
    // Project copy
    { id: "project.copy", label: "Project: Copy", detail: "Duplicate the current project", run: async () => {
      if (!projectPath) return;
      const destPath = window.prompt("Destination path for copied project", projectPath + "-copy");
      if (!destPath) return;
      setCopyProjectBusy(true);
      try {
        const bridge = api.opencode as any;
        if (bridge.copyProject) {
          const result = await bridge.copyProject({ sourcePath: projectPath, destPath });
          if (result.ok) {
            toast("Project copied to " + destPath, "success");
            setOutputLog((log) => [`Project copied from ${projectPath} to ${destPath}`, ...log].slice(0, 20));
          } else {
            toast("Failed to copy project: " + (result.error || "Unknown error"), "error");
          }
        }
      } catch (error) {
        toast("Error copying project: " + (error instanceof Error ? error.message : String(error)), "error");
      } finally {
        setCopyProjectBusy(false);
      }
    } },
    // CLI commands
    { id: "cli.start", label: "CLI: Start Coding Session", detail: "Run the Code CLI in the current project", run: async () => {
      if (!projectPath) return;
      try {
        const bridge = api.opencode as any;
        if (bridge.cli) {
          const result = await bridge.cli({ projectPath, args: ["run", projectPath] });
          const block = commandBlock("code run", result);
          setOutputLog((log) => [block, ...log].slice(0, 20));
          setCommandEvent({ id: uid(), text: block });
          toast("CLI: Start session " + (result.ok ? "succeeded" : "failed"), result.ok ? "success" : "error");
        }
      } catch (error) {
        toast("CLI error: " + (error instanceof Error ? error.message : String(error)), "error");
      }
    } },
    { id: "cli.install", label: "CLI: Install Dependencies", detail: "Install project dependencies via CLI", run: async () => {
      if (!projectPath) return;
      try {
        const bridge = api.opencode as any;
        if (bridge.cli) {
          const result = await bridge.cli({ projectPath, args: ["install"] });
          const block = commandBlock("code install", result);
          setOutputLog((log) => [block, ...log].slice(0, 20));
          setCommandEvent({ id: uid(), text: block });
          toast("CLI: Install " + (result.ok ? "succeeded" : "failed"), result.ok ? "success" : "error");
        }
      } catch (error) {
        toast("CLI error: " + (error instanceof Error ? error.message : String(error)), "error");
      }
    } },
    { id: "cli.update", label: "CLI: Check for Updates", detail: "Check for Code engine updates", run: async () => {
      if (!projectPath) return;
      try {
        const bridge = api.opencode as any;
        if (bridge.cli) {
          const result = await bridge.cli({ projectPath, args: ["update", "--check"] });
          const block = commandBlock("code update --check", result);
          setOutputLog((log) => [block, ...log].slice(0, 20));
          setCommandEvent({ id: uid(), text: block });
          toast("CLI: Update check " + (result.ok ? "succeeded" : "failed"), result.ok ? "success" : "error");
        }
      } catch (error) {
        toast("CLI error: " + (error instanceof Error ? error.message : String(error)), "error");
      }
    } },
    { id: "cli.models", label: "CLI: List Models", detail: "List available models via CLI", run: async () => {
      if (!projectPath) return;
      try {
        const bridge = api.opencode as any;
        if (bridge.cli) {
          const result = await bridge.cli({ projectPath, args: ["models"] });
          const block = commandBlock("code models", result);
          setOutputLog((log) => [block, ...log].slice(0, 20));
          setCommandEvent({ id: uid(), text: block });
        }
      } catch (error) {
        toast("CLI error: " + (error instanceof Error ? error.message : String(error)), "error");
      }
    } }
  ], [loadConfigIntoEditor, loadMCPConfig, minimap, openAgent, projectPath, refreshGit, startAiAction, toast, setOutputLog, setCommandEvent]);

  function openOverlay(mode: Exclude<OverlayMode, null>) {
    setOverlayMode(mode);
    setOverlayQuery("");
  }

  const saveMCPConfig = useCallback(async () => {
    if (!projectPath) return;
    try {
      const bridge = api.opencode as any;
      if (bridge.writeMCPConfig) {
        const result = await bridge.writeMCPConfig({ projectPath, mcpConfig });
        if (result.ok) {
          toast("MCP configuration saved", "success");
          setMcpDirty(false);
        } else {
          toast("Failed to save MCP config: " + (result.error || "Unknown error"), "error");
        }
      }
    } catch (error) {
      toast("Error saving MCP config: " + (error instanceof Error ? error.message : String(error)), "error");
    }
  }, [projectPath, mcpConfig, toast]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const mod = event.ctrlKey || event.metaKey;
      if (mod && key === "s") {
        event.preventDefault();
        saveActive();
      }
      if (mod && event.shiftKey && key === "p") {
        event.preventDefault();
        openOverlay("command");
      } else if (mod && key === "p") {
        event.preventDefault();
        openOverlay("quickOpen");
      } else if (mod && event.shiftKey && key === "f") {
        event.preventDefault();
        setActiveActivity("search");
        setIsSidebarOpen(true);
      } else if (mod && key === "t") {
        event.preventDefault();
        openOverlay("symbols");
      } else if (mod && key === "b") {
        event.preventDefault();
        setIsSidebarOpen((value) => !value);
      } else if (mod && key === "j") {
        event.preventDefault();
        setIsBottomOpen((value) => !value);
      } else if (mod && key === "`") {
        event.preventDefault();
        setIsBottomOpen(true);
        setBottomPanel("terminal");
      } else if (mod && key === "i") {
        event.preventDefault();
        startAiAction("Inline AI request");
      } else if (event.key === "F2" && activePath) {
        event.preventDefault();
        renamePath(activePath);
      } else if (event.key === "F12" && activePath) {
        event.preventDefault();
        openOverlay("symbols");
      }
      if (event.key === "Escape") {
        setOverlayMode(null);
        setFileContextMenu(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activePath, saveActive, startAiAction]);

  const handleEditorMount: OnMount = useCallback((editor, monacoInstance) => {
    editorRef.current = editor;
    configureEditor(editor, monacoInstance);
    editor.onDidChangeCursorPosition((event) => {
      if (!activePath) return;
      setCursorPositions((current) => ({ ...current, [activePath]: event.position }));
    });
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      const model = editor.getModel();
      setSelectedCode(selection && model ? model.getValueInRange(selection).trim() : "");
    });
    [
      ["ai.explainSelection", "AI: Explain Selection", "Explain this code"],
      ["ai.fixSelection", "AI: Fix Selection", "Fix this code"],
      ["ai.refactorSelection", "AI: Refactor Selection", "Refactor this code"],
      ["ai.optimizeSelection", "AI: Optimize Selection", "Optimize this code"],
      ["ai.generateTests", "AI: Generate Tests", "Generate tests for this code"],
      ["ai.documentSelection", "AI: Document Selection", "Document this code"]
    ].forEach(([id, label, prompt], index) => {
      editor.addAction({
        id,
        label,
        contextMenuGroupId: "ai",
        contextMenuOrder: index,
        run: () => startAiAction(prompt)
      });
    });
  }, [activePath, startAiAction]);

  const filteredFiles = useMemo(() =>
    flatFiles
      .map((file) => ({ file, score: fuzzyScore(file.path, overlayQuery) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 80),
  [flatFiles, overlayQuery]);

  const filteredCommands = useMemo(() =>
    commands
      .map((command) => ({ command, score: fuzzyScore(`${command.label} ${command.detail}`, overlayQuery) }))
      .filter((item) => item.score > 0)
      .sort((left, right) => right.score - left.score)
      .slice(0, 40),
  [commands, overlayQuery]);

  return (
    <div
      className={[
        "app-shell opencode-shell vscode-workbench",
        !isSidebarOpen ? "sidebar-collapsed" : "",
        !isAgentOpen ? "agent-collapsed" : "",
        !isBottomOpen ? "bottom-collapsed" : ""
      ].filter(Boolean).join(" ")}
      style={{
        "--sidebar-width": `${sidebarWidth}px`,
        "--tutor-width": `${agentWidth}px`,
        "--bottom-height": `${bottomHeight}px`
      } as CSSProperties}
      onClick={() => setFileContextMenu(null)}
    >
      <header className="app-titlebar">
        <div className="title-menu">
          <Code2 size={16} />
          <span>File</span>
          <span>Edit</span>
          <span>Selection</span>
          <span>View</span>
          <span>Go</span>
          <span>Run</span>
          <span>Terminal</span>
          <span>Help</span>
        </div>
        <button className="command-center command-button" onClick={() => openOverlay("command")}>
          <Command size={14} />
          <span>{projectPath ? projectName(projectPath) : "Open Folder"} - Ctrl+Shift+P</span>
        </button>
        <div className="title-actions">
          <span className={ollamaOnline ? "ok" : "warn"}>{ollamaOnline ? `${ollamaModels.length}` : "0"}</span>
          <button onClick={() => setMinimap((value) => !value)}>{minimap ? "Minimap On" : "Minimap Off"}</button>
        </div>
      </header>

      <aside className="activity-bar">
        <ActivityButton active={activeActivity === "explorer"} title="Explorer" onClick={() => { setActiveActivity("explorer"); setIsSidebarOpen(true); }} icon={<FolderOpen size={20} />} />
        <ActivityButton active={activeActivity === "search"} title="Search" onClick={() => { setActiveActivity("search"); setIsSidebarOpen(true); }} icon={<Search size={20} />} />
        <ActivityButton active={activeActivity === "source"} title="Source Control" onClick={() => { setActiveActivity("source"); setIsSidebarOpen(true); refreshGit(projectPath); }} icon={<GitPullRequest size={20} />} />
        <ActivityButton active={activeActivity === "debug"} title="Run and Debug" onClick={() => { setActiveActivity("debug"); setIsSidebarOpen(true); }} icon={<Bug size={20} />} />
        <ActivityButton active={activeActivity === "extensions"} title="Extensions" onClick={() => { setActiveActivity("extensions"); setIsSidebarOpen(true); }} icon={<Boxes size={20} />} />
        <ActivityButton active={activeActivity === "ai"} title="AI" onClick={() => { setActiveActivity("ai"); setIsAgentOpen(true); }} icon={<Bot size={20} />} />
        <div className="activity-bar-spacer" />
        <button className="activity-button settings-button" title="Settings" onClick={() => { loadConfigIntoEditor(); setConfigEditorOpen(true); }}>
          <Settings2 size={20} />
        </button>
        <button className="activity-button permissions-button" title="Saved Permissions" onClick={() => { loadConfigIntoEditor(); setConfigEditorOpen(true); }}>
          <ShieldCheck size={20} />
        </button>
      </aside>

      {isSidebarOpen ? (
        <aside className="sidebar opencode-sidebar">
          <div className="workspace-title">
            <div>
              <span>{sidebarTitle(activeActivity)}</span>
              <strong>{projectPath ? projectName(projectPath) : "Loading"}</strong>
            </div>
            <button className="icon-button small" title="Collapse Side Bar" onClick={() => setIsSidebarOpen(false)}>
              <PanelRightClose size={17} />
            </button>
          </div>
          <SidebarContent
            activeActivity={activeActivity}
            projectPath={projectPath}
            files={files}
            activePath={activePath}
            openProject={openProject}
            createFile={createFile}
            createFolder={createFolder}
            refreshFiles={() => refreshFiles(projectPath)}
            openFile={openFile}
            setFileContextMenu={setFileContextMenu}
            ollamaOnline={ollamaOnline}
            opencodeVersion={opencodeVersion}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            searchOptions={searchOptions}
            setSearchOptions={setSearchOptions}
            searchResults={searchResults}
            searchBusy={searchBusy}
            runSearch={runSearch}
            gitState={gitState}
            refreshGit={() => refreshGit(projectPath)}
            runGitCommand={runGitCommand}
            startAiAction={startAiAction}
          />
        </aside>
      ) : null}
      {isSidebarOpen ? <div className="resize-handle vertical left-resize" onMouseDown={startResize("sidebar", setSidebarWidth)} /> : null}

      <main className="workbench opencode-workbench">
        <div className="top-strip">
          <div className="lesson-brief">
            <strong>{activeTab?.path || "No file open"}</strong>
            <Breadcrumbs path={activeTab?.path || ""} onOpen={(path) => openFile(path, { pinned: true })} />
          </div>
          <div className="top-actions">
            <button className="icon-button" title="Save" onClick={saveActive}>
              <Save size={17} />
            </button>
            <button className="icon-button" title="Save All" onClick={saveAll}>
              <Save size={17} className="save-all-icon" />
            </button>
            <button className="icon-button" title="Quick Open" onClick={() => openOverlay("quickOpen")}>
              <Search size={17} />
            </button>
            <button className="run-button secondary" onClick={() => openAgent()}>
              <MonitorPlay size={16} />
              Code Agent
            </button>
            <button className="icon-button" title={isAgentOpen ? "Hide AI Panel" : "Show AI Panel"} onClick={() => setIsAgentOpen((value) => !value)}>
              <PanelRight size={17} />
            </button>
          </div>
        </div>

        <div className="editor-grid">
          <div className="editor-terminal-column">
            <section className="editor-pane">
              <div className="tabs">
                {tabs.length ? (
                  tabs.map((tab) => (
                    <button
                      key={tab.path}
                      className={`tab ${tab.path === activePath ? "active" : ""} ${tab.preview ? "preview-tab" : ""}`}
                      onClick={() => setActivePath(tab.path)}
                      onDoubleClick={() => setTabs((current) => current.map((item) => item.path === tab.path ? { ...item, preview: false, pinned: true } : item))}
                    >
                      <span>{extensionIcon(tab.path)}</span>
                      {displayFileName(tab.path)}
                      <span className="tab-spacer" />
                      {tab.content !== tab.savedContent ? <b /> : <X size={13} onClick={(event) => { event.stopPropagation(); closeTab(tab.path); }} />}
                    </button>
                  ))
                ) : (
                  <div className="tab empty-tab">No file open</div>
                )}
              </div>
              {activeTab ? (
                <Editor
                  theme="vs-dark"
                  path={activePath}
                  language={languageFromPath(activePath)}
                  value={activeTab.content}
                  onChange={updateActiveContent}
                  onMount={handleEditorMount}
                  options={{
                    minimap: { enabled: minimap },
                    fontSize: 14,
                    fontFamily: "Consolas, 'Courier New', monospace, 'Fira Code'",
                    lineHeight: 21,
                    padding: { top: 18, bottom: 18 },
                    smoothScrolling: false,
                    cursorSmoothCaretAnimation: "off",
                    wordWrap: "on",
                    folding: true,
                    autoIndent: "full",
                    autoClosingBrackets: "always",
                    autoClosingQuotes: "always",
                    autoClosingDelete: "always",
                    autoClosingOvertype: "always",
                    multiCursorModifier: "alt",
                    columnSelection: true,
                    quickSuggestions: true
                  }}
                />
              ) : (
                <WelcomeEditor
                  projectPath={projectPath}
                  onOpenProject={openProject}
                  onQuickOpen={() => openOverlay("quickOpen")}
                  onOpenAgent={() => openAgent(starterPrompt)}
                />
              )}
            </section>

            {isBottomOpen ? <div className="resize-handle horizontal bottom-resize" onMouseDown={startResize("bottom", setBottomHeight)} /> : null}
            {isBottomOpen ? (
              <div className="bottom-grid">
                <TerminalPanel
                  workspacePath={projectPath}
                  terminalOutput={terminalOutput}
                  setTerminalOutput={setTerminalOutput}
                  commandEvent={commandEvent}
                  activePanel={bottomPanel}
                  setActivePanel={setBottomPanel}
                  outputLog={outputLog}
                  agentLog={agentLog}
                  onClose={() => setIsBottomOpen(false)}
                />
              </div>
            ) : null}
          </div>

          {isAgentOpen ? <div className="resize-handle vertical right-resize" onMouseDown={startResize("agent", setAgentWidth)} /> : null}

          {isAgentOpen ? (
            <AgentPanel
              modelOptions={modelOptions}
              selectedModel={selectedModel}
              setSelectedModel={setSelectedModel}
              effectiveModel={effectiveModel}
              ollamaOnline={ollamaOnline}
              ollamaModels={ollamaModels}
              selectedCode={selectedCode}
              activePath={activePath}
              projectPath={projectPath}
              agentPrompt={agentPrompt}
              setAgentPrompt={setAgentPrompt}
              agentMessages={agentMessages}
              activityChips={agentActivityChips}
              todos={todosFromMessages(agentMessages)}
              agentLog={agentLog}
              agentBusy={agentBusy}
              activeSessionId={activeAgentSessionId}
              agentSessions={agentSessions}
              agentCommands={agentCommands}
              agentProviderState={agentProviderState}
              agentProviderAuth={agentProviderAuth}
              slashItems={dynamicSlashCommands}
              permissionMode={agentPermissionMode}
              setPermissionMode={setAgentPermissionMode}
              granularPermissions={granularPermissions}
              setGranularPermissions={setGranularPermissions}
              savedPermissions={savedPermissions}
              onRevokeSavedPermission={async (id: string) => {
                try {
                  const bridge = api.opencode as OptionalOpenCodeBridge;
                  if (bridge.deleteSavedPermission) {
                    await bridge.deleteSavedPermission({ projectPath, id });
                    setSavedPermissions((prev) => prev.filter((p) => p.id !== id));
                  }
                } catch {
                  // silently ignore
                }
              }}
              planMode={agentPlanMode}
              setPlanMode={setAgentPlanMode}
              contextMode={agentContextMode}
              setContextMode={setAgentContextMode}
              onRefreshOllama={refreshOllama}
              onSubmitPrompt={submitAgentPrompt}
              onCopyPrompt={copyPrompt}
              onStop={stopAgent}
              onContinue={continueAgent}
              onRetry={retryLastAgentPrompt}
              onOpenSession={openAgentSession}
              onNewSession={startNewAgentSession}
              onForkSession={forkAgentSession}
              onPermissionReply={replyAgentPermission}
              agentList={agentList}
              selectedAgent={selectedAgent}
              onSwitchAgent={onSwitchAgent}
              onRevert={revertAgentTurn}
              pendingQuestions={pendingQuestions}
              skills={skills}
              references={references}
              skillsOpen={skillsOpen}
              setSkillsOpen={setSkillsOpen}
              referencesOpen={referencesOpen}
              setReferencesOpen={setReferencesOpen}
              onReplyToQuestion={replyToQuestion}
              onRejectQuestion={rejectQuestion_}
              onClose={() => setIsAgentOpen(false)}
            />
          ) : null}
        </div>
      </main>

      <footer className={`status-bar ${projectPath ? "connected" : "empty"}`}>
        <span>{projectPath || "No project"}</span>
        <span>{activePath ? languageFromPath(activePath) : "no file"}</span>
        <span>{dirtyCount ? `${dirtyCount} unsaved` : "saved"}</span>
        <span>{gitState.ok ? gitState.branch : "no git"}</span>
        <span className={ollamaOnline ? "ok" : "warn"}>{ollamaOnline ? `${ollamaModels.length} Ollama models` : "Ollama offline"}</span>
        <span>{effectiveModel || "No model selected"}</span>
        <span
          className={`server-health ${serverHealth.healthy ? "healthy" : "unhealthy"}`}
          title={serverHealth.healthy
            ? `Server URL: ${serverLocation?.url || "unknown"}
${serverHealth.uptime ? `Uptime: ${serverHealth.uptime}` : ""}
${serverLocation?.port ? `Port: ${serverLocation.port}` : ""}
${lastHealthCheck ? `Last check: ${lastHealthCheck}` : ""}`
            : "Engine is offline"}
        >
          <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", backgroundColor: serverHealth.healthy ? "#4caf50" : "#f44336", marginRight: 4 }} />
          {serverHealth.healthy ? "Engine running" : "Engine offline"}
          {opencodeVersion ? ` v${opencodeVersion}` : ""}
          {lastHealthCheck ? ` (${lastHealthCheck})` : ""}
        </span>
      </footer>

      {overlayMode ? (
        <CommandOverlay
          mode={overlayMode}
          query={overlayQuery}
          setQuery={setOverlayQuery}
          commands={filteredCommands}
          files={filteredFiles}
          symbols={symbols}
          close={() => setOverlayMode(null)}
          openFile={(path, line) => {
            openFile(path, { pinned: true, line });
            setOverlayMode(null);
          }}
          runCommand={(run) => {
            run();
            setOverlayMode(null);
          }}
        />
      ) : null}

      {fileContextMenu ? (
        <FileMenu
          menu={fileContextMenu}
          renamePath={renamePath}
          duplicatePath={duplicatePath}
          deletePath={deletePath}
          copyPath={(path) => navigator.clipboard?.writeText(path)}
          close={() => setFileContextMenu(null)}
        />
      ) : null}

      {configEditorOpen && configData ? (
        <ConfigEditorPanel
          configData={configData}
          setConfigData={setConfigData}
          configDirty={configDirty}
          setConfigDirty={setConfigDirty}
          configTab={configTab}
          setConfigTab={setConfigTab}
          configExternalChanged={configExternalChanged}
          setConfigExternalChanged={setConfigExternalChanged}
          projectPath={projectPath}
          modelOptions={modelOptions}
          api={api}
          toast={toast}
          onClose={() => setConfigEditorOpen(false)}
          onRefresh={() => {
            loadConfigIntoEditor();
            refreshAgentCapabilities(projectPath);
          }}
        />
      ) : null}

      {mcpEditorOpen ? (
        <MCPConfigPanel
          mcpConfig={mcpConfig}
          setMcpConfig={setMcpConfig}
          mcpDirty={mcpDirty}
          setMcpDirty={setMcpDirty}
          projectPath={projectPath}
          onSave={saveMCPConfig}
          onClose={() => setMcpEditorOpen(false)}
        />
      ) : null}
    </div>
  );
}


function ConfigEditorPanel({
  configData,
  setConfigData,
  configDirty,
  setConfigDirty,
  configTab,
  setConfigTab,
  configExternalChanged,
  setConfigExternalChanged,
  projectPath,
  modelOptions,
  api,
  toast,
  onClose,
  onRefresh
}: {
  configData: any;
  setConfigData: (value: any) => void;
  configDirty: boolean;
  setConfigDirty: (value: boolean) => void;
  configTab: string;
  setConfigTab: (value: string) => void;
  configExternalChanged: boolean;
  setConfigExternalChanged: (value: boolean) => void;
  projectPath: string;
  modelOptions: string[];
  api: any;
  toast: (message: string, type: "success" | "error" | "info") => void;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [jsonText, setJsonText] = useState("");
  const [editorMode, setEditorMode] = useState(false);

  const syncJsonToConfig = useCallback(() => {
    try {
      const parsed = JSON.parse(jsonText);
      setConfigData(parsed);
      setConfigDirty(true);
      toast("JSON parsed successfully", "info");
    } catch (error) {
      toast("Invalid JSON: " + (error instanceof Error ? error.message : String(error)), "error");
    }
  }, [jsonText, setConfigData, setConfigDirty, toast]);

  const handleSave = useCallback(async () => {
    if (!projectPath) return;
    try {
      const bridge = api.opencode as any;
      if (bridge.writeConfig) {
        const result = await bridge.writeConfig({ projectPath, config: configData });
        if (result.ok) {
          toast("Configuration saved", "success");
          setConfigDirty(false);
          onRefresh();
        } else {
          toast("Failed to save: " + (result.error || "Unknown error"), "error");
        }
      }
    } catch (error) {
      toast("Error saving config: " + (error instanceof Error ? error.message : String(error)), "error");
    }
  }, [projectPath, configData, api, toast, setConfigDirty, onRefresh]);

  const formatJson = useCallback(() => {
    try {
      const formatted = JSON.stringify(configData, null, 2);
      setJsonText(formatted);
    } catch {
      toast("Could not format config", "error");
    }
  }, [configData, setJsonText, toast]);

  const addProvider = useCallback(() => {
    const name = window.prompt("Provider name (e.g., openai, anthropic)");
    if (!name) return;
    const providers = { ...(configData.providers || configData.provider || {}), [name]: { name, npm: "@ai-sdk/openai-compatible", options: { baseURL: "" }, models: {} } };
    setConfigData({ ...configData, providers, provider: providers });
    setConfigDirty(true);
  }, [configData, setConfigData, setConfigDirty]);

  const removeProvider = useCallback((name: string) => {
    if (!window.confirm(`Remove provider "${name}"?`)) return;
    const providers = { ...(configData.providers || configData.provider || {}) };
    delete providers[name];
    setConfigData({ ...configData, providers, provider: providers });
    setConfigDirty(true);
  }, [configData, setConfigData, setConfigDirty]);

  const addAgent = useCallback(() => {
    const name = window.prompt("Agent name");
    if (!name) return;
    const agents = [...(configData.agents || []), { name, model: "", prompt: "", tools: [] }];
    setConfigData({ ...configData, agents });
    setConfigDirty(true);
  }, [configData, setConfigDirty]);

  const removeAgent = useCallback((index: number) => {
    if (!window.confirm("Remove this agent?")) return;
    const agents = [...(configData.agents || [])];
    agents.splice(index, 1);
    setConfigData({ ...configData, agents });
    setConfigDirty(true);
  }, [configData, setConfigDirty]);

  const addRule = useCallback(() => {
    const rules = [...(configData.rules || configData.permissions || []), { action: "read", resource: "*", effect: "allow", description: "" }];
    setConfigData({ ...configData, rules, permissions: rules });
    setConfigDirty(true);
  }, [configData, setConfigDirty]);

  const removeRule = useCallback((index: number) => {
    if (!window.confirm("Remove this rule?")) return;
    const rules = [...(configData.rules || configData.permissions || [])];
    rules.splice(index, 1);
    setConfigData({ ...configData, rules, permissions: rules });
    setConfigDirty(true);
  }, [configData, setConfigDirty]);

  const providers = configData.providers || configData.provider || {};
  const providersList = Object.keys(providers);
  const agentsList = configData.agents || [];
  const rulesList = configData.rules || configData.permissions || [];
  const defaultModel = configData.model || configData.default_model || "";
  const smallModel = configData.small_model || "";

  return (
    <div className="overlay config-editor-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="config-editor-panel">
        <div className="config-editor-header">
          <h2>Configuration Editor</h2>
          <div className="config-editor-actions">
            {configExternalChanged ? (
              <button className="config-action-button warn" onClick={onRefresh}>
                <RefreshCw size={14} /> Config changed externally - Reload
              </button>
            ) : null}
            {configDirty ? <span className="config-dirty-badge">Unsaved changes</span> : null}
            <button className="config-action-button primary" onClick={handleSave} disabled={!configDirty}>
              <Save size={14} /> Save
            </button>
            <button className="config-action-button" onClick={onClose}>Cancel</button>
            <button className="icon-button" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="config-editor-tabs">
          <button className={configTab === "general" ? "active" : ""} onClick={() => setConfigTab("general")}>General</button>
          <button className={configTab === "providers" ? "active" : ""} onClick={() => setConfigTab("providers")}>Providers</button>
          <button className={configTab === "agents" ? "active" : ""} onClick={() => setConfigTab("agents")}>Agents</button>
          <button className={configTab === "rules" ? "active" : ""} onClick={() => setConfigTab("rules")}>Rules</button>
          <button className={configTab === "json" ? "active" : ""} onClick={() => { setConfigTab("json"); formatJson(); }}>JSON</button>
        </div>

        <div className="config-editor-body">
          {configTab === "general" && (
            <div className="config-tab-content">
              <div className="config-field">
                <label>Default Model</label>
                <select
                  value={defaultModel}
                  onChange={(e) => {
                    setConfigData({ ...configData, model: e.target.value, default_model: e.target.value });
                    setConfigDirty(true);
                  }}
                >
                  <option value="">None selected</option>
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="config-field">
                <label>Small Model</label>
                <select
                  value={smallModel}
                  onChange={(e) => {
                    setConfigData({ ...configData, small_model: e.target.value });
                    setConfigDirty(true);
                  }}
                >
                  <option value="">None selected</option>
                  {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
            </div>
          )}

          {configTab === "providers" && (
            <div className="config-tab-content">
              <div className="config-section-header">
                <span>Configured Providers ({providersList.length})</span>
                <button className="config-action-button primary" onClick={addProvider}>+ Add Provider</button>
              </div>
              {providersList.length === 0 ? (
                <div className="config-empty-state">No providers configured. Click "Add Provider" to add one.</div>
              ) : (
                <div className="config-list">
                  {providersList.map((name) => {
                    const provider = providers[name];
                    return (
                      <div key={name} className="config-list-item">
                        <div className="config-item-header">
                          <strong>{name}</strong>
                          <button className="icon-button danger" onClick={() => removeProvider(name)}><Trash2 size={14} /></button>
                        </div>
                        <div className="config-item-details">
                          <div className="config-field compact">
                            <label>NPM Package</label>
                            <input value={provider.npm || ""} onChange={(e) => {
                              const updated = { ...providers, [name]: { ...provider, npm: e.target.value } };
                              setConfigData({ ...configData, providers: updated, provider: updated });
                              setConfigDirty(true);
                            }} />
                          </div>
                          <div className="config-field compact">
                            <label>Base URL</label>
                            <input value={provider.options?.baseURL || ""} onChange={(e) => {
                              const updated = { ...providers, [name]: { ...provider, options: { ...provider.options, baseURL: e.target.value } } };
                              setConfigData({ ...configData, providers: updated, provider: updated });
                              setConfigDirty(true);
                            }} />
                          </div>
                          <div className="config-field compact">
                            <label>API Key</label>
                            <input
                              type="password"
                              placeholder="Enter API key (stored separately)"
                              value=""
                              onFocus={(e) => {
                                e.target.value = "";
                              }}
                              onBlur={(e) => {
                                if (e.target.value) {
                                  const bridge = api.opencode as any;
                                  if (bridge.providerApiKey) {
                                    bridge.providerApiKey({ projectPath, providerID: name, key: e.target.value }).then(() => {
                                      toast("API key saved for " + name, "success");
                                    }).catch(() => {
                                      toast("API key save failed (may require engine running)", "error");
                                    });
                                  }
                                }
                              }}
                            />
                          </div>
                          <div className="config-item-meta">
                            <span>Models: {Object.keys(provider.models || {}).length}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {configTab === "agents" && (
            <div className="config-tab-content">
              <div className="config-section-header">
                <span>Configured Agents ({agentsList.length})</span>
                <button className="config-action-button primary" onClick={addAgent}>+ Add Agent</button>
              </div>
              {agentsList.length === 0 ? (
                <div className="config-empty-state">No agents configured. Click "Add Agent" to add one.</div>
              ) : (
                <div className="config-list">
                  {agentsList.map((agent: any, index: number) => (
                    <div key={index} className="config-list-item">
                      <div className="config-item-header">
                        <strong>{agent.name || "Unnamed Agent"}</strong>
                        <button className="icon-button danger" onClick={() => removeAgent(index)}><Trash2 size={14} /></button>
                      </div>
                      <div className="config-item-details">
                        <div className="config-field compact">
                          <label>Model</label>
                          <select value={agent.model || ""} onChange={(e) => {
                            const updated = [...agentsList];
                            updated[index] = { ...updated[index], model: e.target.value };
                            setConfigData({ ...configData, agents: updated });
                            setConfigDirty(true);
                          }}>
                            <option value="">Default model</option>
                            {modelOptions.map((m) => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div className="config-field compact">
                          <label>Prompt</label>
                          <textarea
                            rows={3}
                            value={agent.prompt || ""}
                            onChange={(e) => {
                              const updated = [...agentsList];
                              updated[index] = { ...updated[index], prompt: e.target.value };
                              setConfigData({ ...configData, agents: updated });
                              setConfigDirty(true);
                            }}
                          />
                        </div>
                        <div className="config-field compact">
                          <label>Tools</label>
                          <input
                            value={Array.isArray(agent.tools) ? agent.tools.join(", ") : (agent.tools || "")}
                            placeholder="read, edit, bash, glob, grep, list, webfetch"
                            onChange={(e) => {
                              const tools = e.target.value.split(/,\s*/).filter(Boolean);
                              const updated = [...agentsList];
                              updated[index] = { ...updated[index], tools };
                              setConfigData({ ...configData, agents: updated });
                              setConfigDirty(true);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {configTab === "rules" && (
            <div className="config-tab-content">
              <div className="config-section-header">
                <span>Permission Rules ({rulesList.length})</span>
                <button className="config-action-button primary" onClick={addRule}>+ Add Rule</button>
              </div>
              {rulesList.length === 0 ? (
                <div className="config-empty-state">No rules configured. Add rules to control agent permissions.</div>
              ) : (
                <div className="config-list">
                  {rulesList.map((rule: any, index: number) => (
                    <div key={index} className="config-list-item rule-item">
                      <div className="config-item-header">
                        <strong>{rule.action || rule.permission || "action"}: {rule.resource || rule.pattern || "*"}</strong>
                        <div className="config-item-actions">
                          <span className={`rule-effect effect-${rule.effect || "allow"}`}>{rule.effect || "allow"}</span>
                          <button className="icon-button danger" onClick={() => removeRule(index)}><Trash2 size={14} /></button>
                        </div>
                      </div>
                      <div className="config-item-details">
                        <div className="config-field compact inline">
                          <label>Action</label>
                          <select value={rule.action || rule.permission || "read"} onChange={(e) => {
                            const updated = [...rulesList];
                            updated[index] = { ...updated[index], action: e.target.value, permission: e.target.value };
                            setConfigData({ ...configData, rules: updated, permissions: updated });
                            setConfigDirty(true);
                          }}>
                            {["read", "edit", "glob", "grep", "list", "bash", "task", "external_directory", "lsp", "skill", "todowrite", "webfetch", "websearch"].map((a) => (
                              <option key={a} value={a}>{a}</option>
                            ))}
                          </select>
                        </div>
                        <div className="config-field compact inline">
                          <label>Effect</label>
                          <select value={rule.effect || "allow"} onChange={(e) => {
                            const updated = [...rulesList];
                            updated[index] = { ...updated[index], effect: e.target.value };
                            setConfigData({ ...configData, rules: updated, permissions: updated });
                            setConfigDirty(true);
                          }}>
                            <option value="allow">allow</option>
                            <option value="ask">ask</option>
                            <option value="deny">deny</option>
                          </select>
                        </div>
                        <div className="config-field compact">
                          <label>Resource Pattern</label>
                          <input value={rule.resource || rule.pattern || "*"} onChange={(e) => {
                            const updated = [...rulesList];
                            updated[index] = { ...updated[index], resource: e.target.value, pattern: e.target.value };
                            setConfigData({ ...configData, rules: updated, permissions: updated });
                            setConfigDirty(true);
                          }} />
                        </div>
                        <div className="config-field compact">
                          <label>Description</label>
                          <input value={rule.description || ""} onChange={(e) => {
                            const updated = [...rulesList];
                            updated[index] = { ...updated[index], description: e.target.value };
                            setConfigData({ ...configData, rules: updated, permissions: updated });
                            setConfigDirty(true);
                          }} />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {configTab === "json" && (
            <div className="config-tab-content json-editor-tab">
              <div className="config-section-header">
                <span>Raw JSON Editor</span>
                <button className="config-action-button" onClick={formatJson}>Format</button>
                <button className="config-action-button primary" onClick={syncJsonToConfig}>Apply JSON</button>
              </div>
              <textarea
                className="config-json-textarea"
                value={jsonText}
                onChange={(e) => setJsonText(e.target.value)}
                spellCheck={false}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


function startResize(type: "sidebar" | "agent" | "bottom", setter: (value: number | ((current: number) => number)) => void) {
  return (event: ReactMouseEvent) => {
    event.preventDefault();
    const move = (moveEvent: MouseEvent) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (type === "sidebar") setter(clamp(moveEvent.clientX - 48, 170, 450));
      if (type === "agent") setter(clamp(width - moveEvent.clientX, 300, Math.max(300, Math.min(480, width * 0.26))));
      if (type === "bottom") setter(clamp(height - moveEvent.clientY - 22, 150, 600));
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };
}

const configureEditor: OnMount = (editor, monacoInstance) => {
  editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => undefined);
};

function projectName(projectPath: string) {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath;
}

function sidebarTitle(activeActivity: ActivityView) {
  return {
    explorer: "Explorer",
    search: "Search",
    source: "Source Control",
    debug: "Run and Debug",
    extensions: "Extensions",
    ai: "AI Context"
  }[activeActivity];
}

function contextPrompt(
  prompt: string,
  contextMode: AgentContextMode,
  filePath?: string,
  selectedCode?: string,
  openTabs: string[] = [],
  gitChanges: Array<{ status: string; path: string }> = [],
  terminalOutput = ""
) {
  return [
    prompt,
    "\n--- GUI context ---",
    `\nContext mode: ${contextMode}`,
    ["selection", "file", "openTabs", "workspace"].includes(contextMode) && filePath ? `\nCurrent file: ${filePath}` : "",
    contextMode === "selection" && selectedCode ? `\nSelected code:\n${selectedCode}` : "",
    contextMode !== "selection" && selectedCode ? `\nAvailable selected code summary:\n${selectedCode.slice(0, 2000)}` : "",
    ["openTabs", "workspace"].includes(contextMode) && openTabs.length ? `\nOpen tabs:\n${openTabs.join("\n")}` : "",
    contextMode === "workspace" && gitChanges.length ? `\nGit changes:\n${gitChanges.map((change) => `${change.status} ${change.path}`).join("\n")}` : "",
    contextMode === "workspace" && terminalOutput ? `\nRecent terminal output:\n${terminalOutput.slice(-4000)}` : ""
  ].filter(Boolean).join("\n");
}

function ActivityButton({ active, title, icon, onClick }: { active: boolean; title: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button className={`activity-button ${active ? "active" : ""}`} title={title} onClick={onClick}>
      {icon}
    </button>
  );
}

function SidebarContent(props: {
  activeActivity: ActivityView;
  projectPath: string;
  files: FileNode[];
  activePath: string;
  openProject: () => void;
  createFile: () => void;
  createFolder: () => void;
  refreshFiles: () => void;
  openFile: (path: string, options?: { pinned?: boolean; preview?: boolean; line?: number; column?: number }) => void;
  setFileContextMenu: (menu: FileContextMenu) => void;
  ollamaOnline: boolean;
  opencodeVersion: string;
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  searchOptions: { regex: boolean; matchCase: boolean; wholeWord: boolean; include: string; exclude: string };
  setSearchOptions: (value: { regex: boolean; matchCase: boolean; wholeWord: boolean; include: string; exclude: string }) => void;
  searchResults: SearchResult[];
  searchBusy: boolean;
  runSearch: () => void;
  gitState: GitState;
  refreshGit: () => void;
  runGitCommand: (command: "fetch" | "pull" | "push" | "status") => void;
  startAiAction: (label: string) => void;
}) {
  if (props.activeActivity === "search") {
    return <SearchPanel {...props} />;
  }
  if (props.activeActivity === "source") {
    return <SourceControlPanel gitState={props.gitState} refreshGit={props.refreshGit} runGitCommand={props.runGitCommand} openFile={props.openFile} />;
  }
  if (props.activeActivity === "debug") {
    return <UtilityPanel title="Run and Debug" icon={<Bug size={18} />} message="Use the terminal or Code agent for now. Debug configurations will appear here." action="Focus terminal with Ctrl+`." />;
  }
  if (props.activeActivity === "extensions") {
    return <UtilityPanel title="Extensions" icon={<Boxes size={18} />} message="Extension host architecture is reserved here. Commands, views, and integrations can register into this surface later." action="Core workbench APIs are now separated for this." />;
  }
  if (props.activeActivity === "ai") {
    return <UtilityPanel title="AI Context" icon={<Bot size={18} />} message="AI should assist the editor, not replace it. Use Ctrl+I or editor context actions to send current code context." action="Open the AI panel from the top-right button." />;
  }
  return (
    <>
      <section className="panel-block project-card">
        <div className="panel-heading">Project</div>
        <button className="wide-action" onClick={props.openProject}>
          <FolderOpen size={16} />
          Open Folder
        </button>
        <div className="path-readout">{props.projectPath || "No project selected"}</div>
        <div className="status-stack">
          <span className={props.ollamaOnline ? "ok" : "warn"}>{props.ollamaOnline ? "Ollama online" : "Ollama offline"}</span>
          <span>Code {props.opencodeVersion || "checking"}</span>
        </div>
      </section>
      <section className="panel-block sidebar-section explorer opencode-files">
        <div className="sidebar-section-header explorer-header">
          <span>Files</span>
          <div>
            <button className="icon-button tiny" title="New File" onClick={props.createFile}><FilePlus2 size={14} /></button>
            <button className="icon-button tiny" title="New Folder" onClick={props.createFolder}><FolderPlus size={14} /></button>
            <button className="icon-button tiny" title="Refresh" onClick={props.refreshFiles}><RefreshCw size={14} /></button>
          </div>
        </div>
        {props.files.length ? (
          <FileTree
            nodes={props.files}
            activePath={props.activePath}
            onPreview={(path) => props.openFile(path, { preview: true })}
            onPin={(path) => props.openFile(path, { pinned: true })}
            onContextMenu={props.setFileContextMenu}
          />
        ) : (
          <div className="sidebar-empty-state">
            <strong>No files</strong>
            <span>Open a project folder to start editing with Code.</span>
          </div>
        )}
      </section>
    </>
  );
}

function SearchPanel({
  searchQuery,
  setSearchQuery,
  searchOptions,
  setSearchOptions,
  searchResults,
  searchBusy,
  runSearch,
  openFile
}: Parameters<typeof SidebarContent>[0]) {
  return (
    <section className="panel-block search-panel">
      <div className="panel-heading">Search</div>
      <input
        className="search-input"
        value={searchQuery}
        placeholder="Search in workspace"
        onChange={(event) => setSearchQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") runSearch();
        }}
      />
      <div className="search-flags">
        <button className={searchOptions.matchCase ? "active" : ""} onClick={() => setSearchOptions({ ...searchOptions, matchCase: !searchOptions.matchCase })}>Aa</button>
        <button className={searchOptions.wholeWord ? "active" : ""} onClick={() => setSearchOptions({ ...searchOptions, wholeWord: !searchOptions.wholeWord })}>W</button>
        <button className={searchOptions.regex ? "active" : ""} onClick={() => setSearchOptions({ ...searchOptions, regex: !searchOptions.regex })}>.*</button>
        <button onClick={runSearch}>{searchBusy ? "..." : "Find"}</button>
      </div>
      <input className="search-input compact" value={searchOptions.include} placeholder="files to include" onChange={(event) => setSearchOptions({ ...searchOptions, include: event.target.value })} />
      <input className="search-input compact" value={searchOptions.exclude} placeholder="files to exclude" onChange={(event) => setSearchOptions({ ...searchOptions, exclude: event.target.value })} />
      <div className="search-results">
        {searchResults.map((result) => (
          <button key={`${result.path}:${result.line}:${result.column}`} onClick={() => openFile(result.path, { pinned: true, line: result.line, column: result.column })}>
            <strong>{result.path}</strong>
            <span>{result.line}:{result.column} {result.preview}</span>
          </button>
        ))}
        {!searchResults.length ? <div className="sidebar-empty-state"><strong>No results</strong><span>Use Ctrl+Shift+F to search the workspace.</span></div> : null}
      </div>
    </section>
  );
}

function SourceControlPanel({
  gitState,
  refreshGit,
  runGitCommand,
  openFile
}: {
  gitState: GitState;
  refreshGit: () => void;
  runGitCommand: (command: "fetch" | "pull" | "push" | "status") => void;
  openFile: (path: string, options?: { pinned?: boolean; preview?: boolean; line?: number; column?: number }) => void;
}) {
  return (
    <section className="panel-block source-panel">
      <div className="panel-heading">Source Control</div>
      <div className="source-summary">
        <GitBranch size={16} />
        <strong>{gitState.ok ? gitState.branch : "No repository"}</strong>
        <button className="icon-button tiny" onClick={refreshGit}><RefreshCw size={14} /></button>
      </div>
      {gitState.ok ? (
        <div className="git-actions">
          <button onClick={() => runGitCommand("fetch")}>Fetch</button>
          <button onClick={() => runGitCommand("pull")}>Pull</button>
          <button onClick={() => runGitCommand("push")}>Push</button>
        </div>
      ) : <p className="provider-note">{gitState.message || "Open a git repository to see changes."}</p>}
      <div className="git-changes">
        {gitState.changes.map((change) => (
          <button key={`${change.status}:${change.path}`} onClick={() => openFile(change.path, { pinned: true })}>
            <span>{change.status}</span>
            <strong>{change.path}</strong>
          </button>
        ))}
        {gitState.ok && !gitState.changes.length ? <div className="sidebar-empty-state"><strong>Clean working tree</strong><span>No pending file changes.</span></div> : null}
      </div>
    </section>
  );
}

function UtilityPanel({ title, icon, message, action }: { title: string; icon: ReactNode; message: string; action: string }) {
  return (
    <section className="panel-block utility-panel">
      <div className="utility-card">
        {icon}
        <strong>{title}</strong>
        <span>{message}</span>
        <small>{action}</small>
      </div>
    </section>
  );
}

function Breadcrumbs({ path, onOpen }: { path: string; onOpen: (path: string) => void }) {
  if (!path) return <span>Open a file or press Ctrl+P</span>;
  const parts = path.split(/[\\/]/);
  return (
    <span className="breadcrumbs">
      {parts.map((part, index) => {
        const partial = parts.slice(0, index + 1).join("/");
        return (
          <button key={partial} onClick={() => index === parts.length - 1 ? onOpen(path) : undefined}>
            {part}
          </button>
        );
      })}
    </span>
  );
}

function WelcomeEditor({
  projectPath,
  onOpenProject,
  onQuickOpen,
  onOpenAgent
}: {
  projectPath: string;
  onOpenProject: () => void;
  onQuickOpen: () => void;
  onOpenAgent: () => void;
}) {
  const recent = ["producers-wave-backend", "jackcoins-ton", "python-exercise", "producer-wave-admin", "erelgo"];
  return (
    <div className="welcome-workspace">
      <div className="welcome-inner">
        <section className="welcome-main">
          <div>
            <h1>Code Workbench</h1>
            <p>Editing evolved for local and cloud coding agents.</p>
          </div>
          <div className="welcome-actions">
            <button onClick={onQuickOpen}><Search size={17} />Quick Open...</button>
            <button onClick={onOpenProject}><FolderOpen size={17} />Open Folder...</button>
            <button onClick={onOpenAgent}><MonitorPlay size={17} />Open Code Chat...</button>
            <button onClick={onOpenAgent}><Sparkles size={17} />Review This Workspace...</button>
          </div>
          <div className="welcome-recent">
            <h2>Recent</h2>
            {recent.map((item) => (
              <div key={item}>
                <span>{item}</span>
                <small>~/Documents</small>
              </div>
            ))}
            <small className="current-project">{projectPath}</small>
          </div>
        </section>
        <section className="welcome-walkthroughs">
          <h2>Walkthroughs</h2>
          <div className="walkthrough-card active"><strong>Get productive with Code</strong><span>Use Ctrl+P, Ctrl+Shift+P, the terminal panel, and contextual AI actions.</span></div>
          <div className="walkthrough-card"><strong>Use Code with Ollama</strong><span>Choose a local model, ask in the side chat, and keep the terminal for shell work.</span></div>
          <div className="walkthrough-card"><strong>Connect OpenRouter or Zen</strong><span>Keep provider compatibility while using this GUI as the agent surface.</span></div>
        </section>
      </div>
    </div>
  );
}

function AgentPanel({
  modelOptions,
  selectedModel,
  setSelectedModel,
  effectiveModel,
  ollamaOnline,
  ollamaModels,
  selectedCode,
  activePath,
  projectPath,
  agentPrompt,
  setAgentPrompt,
  agentMessages,
  activityChips,
  todos,
  agentLog,
  agentBusy,
  activeSessionId,
  agentSessions,
  agentCommands,
  agentProviderState,
  agentProviderAuth,
  slashItems,
  permissionMode,
  setPermissionMode,
  granularPermissions,
  setGranularPermissions,
  savedPermissions,
  onRevokeSavedPermission,
  planMode,
  setPlanMode,
  contextMode,
  setContextMode,
  onRefreshOllama,
  onSubmitPrompt,
  onCopyPrompt,
  onStop,
  onContinue,
  onRetry,
  onOpenSession,
  onNewSession,
  onForkSession,
  onPermissionReply,
  agentList,
  selectedAgent,
  onSwitchAgent,
  pendingQuestions,
  skills,
  references,
  skillsOpen,
  setSkillsOpen,
  referencesOpen,
  setReferencesOpen,
  onReplyToQuestion,
  onRejectQuestion,
  onClose
}: {
  modelOptions: string[];
  selectedModel: string;
  setSelectedModel: (value: string) => void;
  effectiveModel: string;
  ollamaOnline: boolean;
  ollamaModels: string[];
  selectedCode: string;
  activePath: string;
  projectPath: string;
  agentPrompt: string;
  setAgentPrompt: (value: string) => void;
  agentMessages: AgentMessage[];
  activityChips: AgentActivityChip[];
  todos: AgentTodoItem[];
  agentLog: string[];
  agentBusy: boolean;
  activeSessionId: string;
  agentSessions: AgentSessionInfo[];
  agentCommands: AgentCommandInfo[];
  agentProviderState: AgentProviderState;
  agentProviderAuth: AgentProviderAuthMap;
  slashItems: Array<{ command: string; label: string; prompt: string; source?: string; hints?: string[] }>;
  permissionMode: string;
  setPermissionMode: (value: string) => void;
  granularPermissions: Record<string, "allow" | "ask" | "deny">;
  setGranularPermissions: (value: Record<string, "allow" | "ask" | "deny"> | ((prev: Record<string, "allow" | "ask" | "deny">) => Record<string, "allow" | "ask" | "deny">)) => void;
  savedPermissions: SavedPermission[];
  onRevokeSavedPermission: (id: string) => void;
  planMode: boolean;
  setPlanMode: (value: boolean | ((current: boolean) => boolean)) => void;
  contextMode: AgentContextMode;
  setContextMode: (value: AgentContextMode) => void;
  onRefreshOllama: () => void;
  onSubmitPrompt: (options?: { permissionMode?: string; planMode?: boolean; promptOverride?: string }) => void;
  onCopyPrompt: () => void;
  onStop: () => void;
  onContinue: () => void;
  onRetry: () => void;
  onOpenSession: (sessionID: string) => void;
  onNewSession: () => void;
  onForkSession: (sessionID?: string, messageID?: string) => void;
  onPermissionReply: (sessionID: string, permission: AgentPermissionRequest, reply: "once" | "always" | "reject") => void;
  agentList: Array<{ name: string; mode?: string; description?: string }>;
  selectedAgent: string;
  onSwitchAgent: (agent: string) => void;
  onRevert: (sessionID?: string, messageID?: string) => void;
  pendingQuestions: AgentQuestion[];
  skills: SkillInfo[];
  references: ReferenceInfo[];
  skillsOpen: boolean;
  setSkillsOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  referencesOpen: boolean;
  setReferencesOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  onReplyToQuestion: (question: AgentQuestion, reply: string) => void;
  onRejectQuestion: (question: AgentQuestion) => void;
  onClose: () => void;
}) {
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [accessMenuOpen, setAccessMenuOpen] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const [providerNotice, setProviderNotice] = useState("");
  const [activeOAuthAttempt, setActiveOAuthAttempt] = useState<OAuthAttempt | null>(null);
  const [providerCredentials, setProviderCredentials] = useState<Record<string, CredentialInfo[]>>({});
  const modelLabel = selectedModel ? selectedModel.split("/").pop() || selectedModel : (ollamaOnline ? "Choose model" : "Ollama offline");
  const [agentMenuOpen, setAgentMenuOpen] = useState(false);
  const connectedProviders = new Set(agentProviderState.connected || []);
  const providerCount = agentProviderState.all.length || (ollamaOnline ? 1 : 0);
  const authProviderCount = Object.keys(agentProviderAuth || {}).length;
  const openMenu = (menu: "plus" | "access" | "model") => {
    setPlusMenuOpen(menu === "plus" ? (value) => !value : false);
    setAccessMenuOpen(menu === "access" ? (value) => !value : false);
    setModelMenuOpen(menu === "model" ? (value) => !value : false);
    setProviderMenuOpen(false);
    setSessionMenuOpen(false);
    setAgentMenuOpen(false);
  };
  const visibleSlashCommands = agentPrompt.trim().startsWith("/")
    ? slashItems.filter((item) => item.command.includes(agentPrompt.trim().split(/\s+/)[0])).slice(0, 10)
    : [];
  const visibleActivityChips = compactActivityChips(activityChips);
  const connectProvider = async (providerID: string) => {
    // Find auth methods from the provider state (v2 integration info)
    const providerInfo = (agentProviderState.all || []).find(function(p) { return p.id === providerID || p.name === providerID; });
    const authMethods = (providerInfo as IntegrationInfo)?.auth || agentProviderAuth[providerID] || [];
    const apiMethod = authMethods.find(function(m) { return m.type === "key" || m.type === "api"; });
    const oauthMethod = authMethods.find(function(m) { return m.type === "oauth"; });
    try {
      if (apiMethod) {
        const key = window.prompt(`Enter API key for \${providerID}`);
        if (!key) return;
        const bridge = api.opencode as any;
        if (bridge.integrations) {
          await bridge.providerApiKey({ projectPath, providerID, key });
        } else {
          await api.opencode.providerApiKey({ projectPath, providerID, key });
        }
        setProviderNotice(`\${providerID} API key saved.`);
        onRefreshOllama();
        return;
      }
      if (oauthMethod) {
        const bridge = api.opencode as any;
        // Try v2 authorize with OAuth attempt tracking
        if (bridge.integrations) {
          const auth = await bridge.providerAuthorize({ projectPath, providerID, method: 0 });
          if (auth?.url) {
            setActiveOAuthAttempt({ attemptID: auth.attemptID || "", url: auth.url, method: auth.method || "oauth", status: "pending" });
            window.open(auth.url, "_blank", "noopener,noreferrer");
            setProviderNotice(`\${providerID} OAuth flow started. Complete auth in the browser.`);
            // Start polling the attempt
            const pollTimer = window.setInterval(async function() {
              if (!auth.attemptID) { window.clearInterval(pollTimer); return; }
              try {
                const status = await bridge.oauthAttemptPoll({ projectPath, attemptID: auth.attemptID });
                if (status && (status.status === "completed" || status.status === "connected")) {
                  window.clearInterval(pollTimer);
                  setActiveOAuthAttempt(null);
                  setProviderNotice(`\${providerID} connected via OAuth.`);
                  onRefreshOllama();
                } else if (status && (status.status === "failed" || status.status === "error")) {
                  window.clearInterval(pollTimer);
                  setActiveOAuthAttempt(null);
                  setProviderNotice(`\${providerID} OAuth failed: \${status.error || status.status}`);
                }
              } catch (_e) { /* poll error */ }
            }, 2000);
            return;
          }
        }
        // Fallback to legacy OAuth flow
        const auth = await api.opencode.providerAuthorize({ projectPath, providerID, method: 0 });
        if (auth?.url) window.open(auth.url, "_blank", "noopener,noreferrer");
        if (auth?.method === "code") {
          const code = window.prompt((auth as any).instructions || `Paste \${providerID} authorization code`);
          if (code) await api.opencode.providerCallback({ projectPath, providerID, method: 0, code });
        }
        setProviderNotice((auth as any)?.instructions || `\${providerID} OAuth flow started.`);
        onRefreshOllama();
        return;
      }
      setAgentPrompt(`/connect \${providerID}`);
      setProviderNotice(`No direct auth form for \${providerID}. Added /connect command to composer.`);
    } catch (error) {
      setProviderNotice(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <aside className="tutor-pane opencode-agent">
      <header className="agent-chat-header">
        <div className="agent-tabs">
          <button>CHAT</button>
          <button className="active">CODEX</button>
        </div>
        <div className="agent-header-actions">
          <button className="icon-button tiny" title="Refresh models" onClick={onRefreshOllama}><RefreshCw size={15} /></button>
          <button className="icon-button tiny" title="Hide AI" onClick={onClose}><X size={15} /></button>
        </div>
      </header>

      <div className="agent-thread-toolbar">
        <div className="agent-thread-title">
          <ArrowLeft size={14} />
          <span>{activePath ? `Work on ${displayFileName(activePath)}` : "Review workspace"}</span>
        </div>
        <div className="agent-thread-actions">
          <button className="icon-button tiny" title="Sessions" onClick={() => setSessionMenuOpen((value) => !value)}><MoreHorizontal size={15} /></button>
          <button className="icon-button tiny" title="New session" onClick={onNewSession}><History size={14} /></button>
          <button className="icon-button tiny" title="Fork session" onClick={() => onForkSession(activeSessionId)}><GitFork size={14} /></button>
          <button className="icon-button tiny" title="Retry last prompt" onClick={onRetry}><RotateCcw size={14} /></button>
          <button className="icon-button tiny" title={agentBusy ? "Stop" : "Continue"} onClick={agentBusy ? onStop : onContinue}>
            {agentBusy ? <X size={14} /> : <CirclePlay size={14} />}
          </button>
          <button className="icon-button tiny" title="Settings"><Settings2 size={14} /></button>
          <button className="icon-button tiny" title="Expand"><Maximize2 size={14} /></button>
        </div>
        {sessionMenuOpen ? (
          <div className="agent-session-popover">
            <strong>Session history</strong>
            <button onClick={() => { onNewSession(); setSessionMenuOpen(false); }}>
              <span>New session</span>
              <small>fresh context</small>
            </button>
            {activeSessionId ? (
              <button onClick={() => { onForkSession(activeSessionId); setSessionMenuOpen(false); }}>
                <span>Fork active session</span>
                <small>{activeSessionId}</small>
              </button>
            ) : null}
            {agentSessions.length ? agentSessions.slice(0, 8).map((session) => (
              <button key={session.id} className={session.id === activeSessionId ? "active" : ""} onClick={() => { onOpenSession(session.id); setSessionMenuOpen(false); }}>
                <span>{session.title || session.id}</span>
                <small>{session.id === activeSessionId ? "active" : sessionTimeLabel(session)}</small>
              </button>
            )) : <p>No sessions yet.</p>}
          </div>
        ) : null}
      </div>

      <div className="agent-capability-strip">
        <button onClick={() => setProviderMenuOpen((value) => !value)}>
          <span>{ollamaOnline ? "Ollama online" : "Ollama offline"}</span>
          <strong>{providerCount} providers</strong>
        </button>
        <span>{agentCommands.length} commands</span>
        <span>{authProviderCount} auth flows</span>
        <span>{effectiveModel || "No model"}</span>
        <span title="Current agent">{selectedAgent ? "Agent: " + selectedAgent : "Agent: build"}</span>
        <button className="capability-button" onClick={() => setSkillsOpen((v) => !v)} title="Registered skills">
          <span>{skills.length} skills</span>
        </button>
        <button className="capability-button" onClick={() => setReferencesOpen((v) => !v)} title="Project references">
          <span>{references.length} references</span>
        </button>
        {providerMenuOpen ? (
          <div className="agent-provider-popover">
            <div>
              <strong>Providers</strong>
              <button className="icon-button tiny" onClick={onRefreshOllama}><RefreshCw size={13} /></button>
            </div>
            {activeOAuthAttempt ? (
              <div className="agent-provider-row oauth-attempt">
                <span>OAuth in progress</span>
                <small className="oauth-polling">pending...</small>
                <button className="oauth-cancel" onClick={async () => {
                  const bridge = api.opencode as any;
                  if (bridge.oauthAttemptCancel) {
                    await bridge.oauthAttemptCancel({ projectPath, attemptID: activeOAuthAttempt.attemptID });
                  }
                  setActiveOAuthAttempt(null);
                  setProviderNotice("OAuth cancelled.");
                }}>Cancel</button>
              </div>
            ) : null}
            {(agentProviderState.all.length ? agentProviderState.all : [{ id: "ollama", name: "Ollama", kind: "local" }]).slice(0, 10).map((provider) => {
              const id = String((provider as any).id || (provider as any).name || "provider");
              const providerCreds = providerCredentials[id] || [];
              return (
                <div key={id} className="agent-provider-section">
                  <div className="agent-provider-row">
                    <span>{(provider as any).name || (provider as any).label || id}</span>
                    <small>{connectedProviders.has(id) || (id === "ollama" && ollamaOnline) ? "connected" : "available"}</small>
                    <button onClick={() => connectProvider(id)}>
                      {connectedProviders.has(id) || (id === "ollama" && ollamaOnline) ? "Manage" : "Connect"}
                    </button>
                  </div>
                  {providerCreds.length > 0 ? (
                    <div className="agent-credential-list">
                      {providerCreds.map(function(cred: CredentialInfo) {
                        return (
                          <div key={cred.id} className="agent-credential-row">
                            <span className="cred-label">{cred.label || cred.id.slice(0, 8)}</span>
                            <span className="cred-type">{cred.type || "key"}</span>
                            <button className="icon-button tiny" title="Edit label" onClick={async function() {
                              const newLabel = window.prompt("Credential label", cred.label || "");
                              if (newLabel !== null && newLabel !== cred.label) {
                                const bridge = api.opencode as any;
                                if (bridge.credentialUpdate) {
                                  await bridge.credentialUpdate({ projectPath, credentialID: cred.id, label: newLabel });
                                  setProviderCredentials(function(prev) {
                                    const updated = { ...prev };
                                    const list = (updated[id] || []).map(function(c) {
                                      return c.id === cred.id ? { ...c, label: newLabel } : c;
                                    });
                                    updated[id] = list;
                                    return updated;
                                  });
                                  setProviderNotice("Credential updated.");
                                }
                              }
                            }}><Settings2 size={12} /></button>
                            <button className="icon-button tiny danger" title="Delete credential" onClick={async function() {
                              if (!window.confirm("Delete this credential?")) return;
                              const bridge = api.opencode as any;
                              if (bridge.credentialDelete) {
                                await bridge.credentialDelete({ projectPath, credentialID: cred.id });
                                setProviderCredentials(function(prev) {
                                  const updated = { ...prev };
                                  updated[id] = (updated[id] || []).filter(function(c) { return c.id !== cred.id; });
                                  return updated;
                                });
                                setProviderNotice("Credential deleted.");
                              }
                            }}><Trash2 size={12} /></button>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            {providerNotice ? <p className="provider-inline-notice">{providerNotice}</p> : null}
          </div>
        ) : null}
        {skillsOpen ? (
          <div className="agent-skills-popover">
            <div className="popover-header">
              <strong>Skills ({skills.length})</strong>
              <button className="icon-button tiny" onClick={() => setSkillsOpen(false)}><X size={13} /></button>
            </div>
            {skills.length > 0 ? (
              <div className="skills-list">
                {skills.map((skill) => (
                  <div key={skill.id} className="skill-item">
                    <strong>{skill.name || skill.id}</strong>
                    {skill.description ? <span>{skill.description}</span> : null}
                    {skill.source ? <small>Source: {skill.source}</small> : null}
                    {skill.commands && skill.commands.length > 0 ? (
                      <div className="skill-commands">
                        {skill.commands.map((cmd, i) => (
                          <code key={i}>{cmd}</code>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : (
              <span className="empty-state">No skills registered.</span>
            )}
          </div>
        ) : null}
        {referencesOpen ? (
          <div className="agent-references-popover">
            <div className="popover-header">
              <strong>References ({references.length})</strong>
              <button className="icon-button tiny" onClick={() => setReferencesOpen(false)}><X size={13} /></button>
            </div>
            {references.length > 0 ? (
              <div className="references-list">
                {references.map((ref) => (
                  <div key={ref.id} className="reference-item">
                    <strong>{ref.title || ref.path || ref.id}</strong>
                    {ref.path ? <span className="reference-path">{ref.path}</span> : null}
                    {ref.type ? <small>Type: {ref.type}</small> : null}
                    {ref.source ? <small>Source: {ref.source}</small> : null}
                  </div>
                ))}
              </div>
            ) : (
              <span className="empty-state">No references found.</span>
            )}
          </div>
        ) : null}
      </div>

      <div className="agent-activity-rail">
        {todos.length ? (
          <span className="agent-activity-chip todo" title={todos.map((todo) => `${todo.status}: ${todo.text}`).join("\n")}>
            <ListTodo size={13} />
            {todos.filter((todo) => todo.status !== "done").length}/{todos.length} todos
          </span>
        ) : null}
        {visibleActivityChips.map((chip) => (
          <span key={chip.id} className={`agent-activity-chip ${chip.tone || "info"}`} title={chip.detail || chip.sessionID || chip.label}>
            {chip.label}
            {chip.count && chip.count > 1 ? <b>x{chip.count}</b> : null}
          </span>
        ))}
        {!todos.length && !visibleActivityChips.length ? <span className="agent-activity-chip info">ready</span> : null}
      </div>

      <div className="agent-chat-scroll">
        {agentMessages.map((message) => (
          <article key={message.id} className={`agent-message ${message.role}`}>
            <div className="agent-message-meta">
              <span>{message.role === "user" ? "You" : message.role === "assistant" ? "Code" : "System"}</span>
              {message.status ? <small>{message.status}</small> : message.meta ? <small>{message.meta}</small> : null}
            </div>
            <div className="agent-message-body">{message.text}</div>
            {message.role === "assistant" && message.pending ? <ActivityChipRow chips={[{ id: `${message.id}-pending`, label: "running", tone: "info" }]} /> : null}
            {message.tools?.length ? (
              <div className="agent-tool-list">
                {message.tools.map((tool, index) => (
                  <ToolActivityCard key={uiText(tool.id, `tool-${index}`)} tool={tool} />
                ))}
              </div>
            ) : null}
            {message.permissions?.length ? (
              <div className="agent-permission-list">
                {message.permissions.map((permission) => (
                  <PermissionRequestCard
                    key={permissionKey(permission)}
                    permission={permission}
                    onReply={(reply) => onPermissionReply(message.sessionID || activeSessionId, permission, reply)}
                  />
                ))}
              </div>
            ) : null}
            {message.diff?.length ? (
              <div className="agent-diff-list">
                <div className="agent-diff-header">
                  <strong>File changes</strong>
                  <button onClick={() => onRevert(message.sessionID, message.messageID)}>Revert turn</button>
                  <button onClick={() => onForkSession(message.sessionID, message.messageID)}>Fork here</button>
                </div>
                {message.diff.map((file, index) => (
                  <DiffChangeCard key={`${file.file || file.path || "file"}-${index}`} file={file} />
                ))}
              </div>
            ) : null}
            {message.command ? (
              <details className="agent-tool-details">
                <summary>Engine command {typeof message.exitCode === "number" ? `- exit ${message.exitCode}` : ""}</summary>
                <code>{message.command}</code>
              </details>
            ) : null}
          </article>
        ))}
        {agentBusy ? (
          <article className="agent-message assistant loading">
            <div className="agent-message-meta"><span>Code</span><small>working</small></div>
            <div className="agent-typing"><i /><i /><i /></div>
          </article>
        ) : null}
      </div>

      {pendingQuestions.length > 0 ? (
        <div className="pending-questions-section">
          {pendingQuestions.filter((q) => q.status !== "replied").map((question) => (
            <QuestionCard
              key={question.id}
              question={question}
              onReply={(reply) => onReplyToQuestion(question, reply)}
              onReject={() => onRejectQuestion(question)}
            />
          ))}
        </div>
      ) : null}

      <div className="agent-composer-shell">
        <section className="agent-composer-card">
            <div className="composer-context-line">
              <div className="composer-project-pill">
                <Bot size={14} />
                <span>{projectPath ? projectName(projectPath) : "Code Workbench"}</span>
              </div>
              <div className="composer-context-chips">
                <span>{contextMode}</span>
                <span>{activePath ? displayFileName(activePath) : "No file"}</span>
                {activeSessionId ? <span>Session</span> : null}
                {planMode ? <span>Plan</span> : null}
              </div>
            </div>
          <textarea
            value={agentPrompt}
            onChange={(event) => setAgentPrompt(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                onSubmitPrompt({ permissionMode, planMode });
              }
            }}
            placeholder="Ask Code to review, explain, refactor, or plan an edit..."
          />
          {visibleSlashCommands.length ? (
            <div className="slash-command-menu">
              {visibleSlashCommands.map((item) => (
                <button key={item.command} onClick={() => setAgentPrompt(item.command)}>
                  <strong>{item.command}</strong>
                  <span>{item.label}</span>
                  {item.source || item.hints?.length ? <small>{[item.source, ...(item.hints || [])].filter(Boolean).join(" · ")}</small> : null}
                </button>
              ))}
            </div>
          ) : null}
          <div className="agent-composer-footer">
            <div className="composer-control-wrap">
              <button className={`composer-icon-button ${plusMenuOpen ? "active" : ""}`} title="Add context or mode" onClick={() => openMenu("plus")}>
                <Plus size={16} />
              </button>
              {plusMenuOpen ? (
                <div className="composer-popover plus-menu">
                  <button className={planMode ? "selected" : ""} onClick={() => { setPlanMode((value) => !value); setPlusMenuOpen(false); }}>
                    <strong>Plan mode</strong>
                    <small>Think through changes before editing.</small>
                  </button>
                  <button className={contextMode === "selection" ? "selected" : ""} onClick={() => { setContextMode("selection"); setPlusMenuOpen(false); }}>
                    <strong>Use selection</strong>
                    <small>{selectedCode ? "Send highlighted code." : "Highlight code first."}</small>
                  </button>
                  <button className={contextMode === "file" ? "selected" : ""} onClick={() => { setContextMode("file"); setPlusMenuOpen(false); }}>
                    <strong>Attach current file</strong>
                    <small>{activePath || "Open a file first."}</small>
                  </button>
                  <button className={contextMode === "openTabs" ? "selected" : ""} onClick={() => { setContextMode("openTabs"); setPlusMenuOpen(false); }}>
                    <strong>Attach open tabs</strong>
                    <small>Use visible editor context.</small>
                  </button>
                  <button className={contextMode === "workspace" ? "selected" : ""} onClick={() => { setContextMode("workspace"); setPlusMenuOpen(false); }}>
                    <strong>Use whole project</strong>
                    <small>Include workspace context.</small>
                  </button>
                </div>
              ) : null}
            </div>
            <div className="composer-control-wrap access-wrap">
              <button className="permission-button" title="Agent permission level" onClick={() => openMenu("access")}>
                <ShieldCheck size={14} />
                <span>Permissions</span>
                <ChevronDown size={13} />
              </button>
              {accessMenuOpen ? (
                <div className="composer-popover permission-editor">
                  <div className="permission-editor-header">
                    <strong>Granular tool permissions</strong>
                    <small>{Object.values(granularPermissions).filter(v => v === "ask").length} ask, {Object.values(granularPermissions).filter(v => v === "allow").length} allow</small>
                  </div>
                  <div className="permission-tool-list">
                    {TOOL_PERMISSION_GROUPS.map((group) => (
                      <div key={group.label} className="permission-group">
                        <div className="permission-group-label">{group.label}</div>
                        {group.tools.map((toolId) => {
                          const tool = TOOL_PERMISSIONS.find((t) => t.id === toolId);
                          if (!tool) return null;
                          const value = granularPermissions[toolId] || "allow";
                          return (
                            <div key={toolId} className="permission-tool-row">
                              <span className="permission-tool-label">{tool.label}</span>
                              <div className="permission-toggle-group">
                                {(["allow", "ask", "deny"] as const).map((opt) => (
                                  <button
                                    key={opt}
                                    className={`permission-toggle-option ${value === opt ? "active" : ""}`}
                                    onClick={() => setGranularPermissions((prev) => ({ ...prev, [toolId]: opt }))}
                                  >
                                    {opt === "allow" ? "Allow" : opt === "ask" ? "Ask" : "Deny"}
                                  </button>
                                ))}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {savedPermissions.length > 0 ? (
                    <div className="saved-permissions-section">
                      <div className="saved-permissions-header">
                        <strong>Saved permissions</strong>
                        <small>{savedPermissions.length}</small>
                      </div>
                      <div className="saved-permissions-list">
                        {savedPermissions.map((sp) => (
                          <div key={sp.id} className="saved-permission-row">
                            <div className="saved-permission-info">
                              <span className="saved-permission-action">{sp.rule.action || "any"}</span>
                              <span className={`saved-permission-effect ${sp.rule.effect}`}>{sp.rule.effect}</span>
                              {sp.rule.description ? <small>{sp.rule.description}</small> : null}
                            </div>
                            <button
                              className="icon-button tiny danger"
                              title="Revoke"
                              onClick={() => onRevokeSavedPermission(sp.id)}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="composer-control-wrap model-wrap">
              <button className="model-button" title="Model" onClick={() => openMenu("model")}>
                <span>{modelLabel}</span>
                <ChevronDown size={13} />
              </button>
              {modelMenuOpen ? (
                <div className="composer-popover model-menu">
                  {modelOptions.length ? modelOptions.map((model) => (
                    <button key={model} className={selectedModel === model ? "selected" : ""} onClick={() => { setSelectedModel(model); setModelMenuOpen(false); }}>
                      <strong>{model.replace(/^ollama\//, "")}</strong>
                    </button>
                  )) : (
                    <button disabled><strong>{ollamaOnline ? "No Ollama models" : "Ollama offline"}</strong></button>
                  )}
                </div>
              ) : null}
            </div>
            <div className="composer-control-wrap agent-wrap">
              <button className="model-button" title="Agent" onClick={() => { setAgentMenuOpen((v) => !v); setModelMenuOpen(false); setPlusMenuOpen(false); setAccessMenuOpen(false); }}>
                <span>{selectedAgent ? "Agent: " + selectedAgent : "Agent: build"}</span>
                <ChevronDown size={13} />
              </button>
              {agentMenuOpen && agentList && agentList.length > 0 ? (
                <div className="composer-popover agent-menu">
                  {agentList.map(function(agent: { name: string; mode?: string; description?: string }) {
                    const isCurrent = agent.name === selectedAgent;
                    return (
                      <button key={agent.name} className={isCurrent ? "selected" : ""} onClick={function() {
                        if (onSwitchAgent) { onSwitchAgent(agent.name); }
                        setAgentMenuOpen(false);
                      }}>
                        <strong>{agent.name}{isCurrent ? " (active)" : ""}</strong>
                        {agent.description ? <small>{agent.description}</small> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
            <button className="composer-tool" onClick={onCopyPrompt}><Copy size={15} /></button>
            <button className="composer-send" disabled={!agentPrompt.trim() || agentBusy} onClick={() => onSubmitPrompt({ permissionMode, planMode })}>
              {agentBusy ? <X size={17} /> : <Send size={17} />}
            </button>
          </div>
        </section>
        <button className="agent-work-locally" type="button">
          <MonitorPlay size={14} />
          <span>Work locally</span>
          <ChevronDown size={13} />
        </button>
      </div>
    </aside>
  );
}

function ToolActivityCard({ tool }: { tool: AgentToolPart }) {
  const type = uiText(tool.type, "tool").toLowerCase();
  const title = uiText(tool.title, "Code step");
  const status = uiText(tool.status);
  const detail = uiText(tool.detail);
  const label =
    type.includes("bash") ? "Terminal" :
    type.includes("edit") || type.includes("write") || type.includes("patch") ? "Edit" :
    type.includes("grep") || type.includes("glob") || type.includes("list") || type.includes("read") ? "Context" :
    type.includes("web") ? "Web" :
    type.includes("task") ? "Subtask" :
    "Tool";
  return (
    <details className={`agent-tool-card tool-${type.replace(/[^a-z0-9_-]/g, "-")}`}>
      <summary>
        <span>{label}</span>
        <strong>{title}</strong>
        {status ? <em>{status}</em> : null}
      </summary>
      {detail ? <pre>{detail}</pre> : <small>No extra output.</small>}
    </details>
  );
}

function ActivityChipRow({ chips }: { chips: AgentActivityChip[] }) {
  if (!chips.length) return null;
  return (
    <div className="agent-inline-activity" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
      {chips.map((chip) => (
        <span key={chip.id} className={`agent-activity-chip ${chip.tone || "info"}`} title={chip.detail || chip.sessionID || chip.label}>
          {chip.label}
        </span>
      ))}
    </div>
  );
}

function permissionKey(permission: AgentPermissionRequest) {
  return uiText(permission.id || permission.requestID || permission.permissionID || permission.permission || permission, "permission").slice(0, 120);
}

function PermissionRequestCard({
  permission,
  onReply
}: {
  permission: AgentPermissionRequest;
  onReply: (reply: "once" | "always" | "reject") => void;
}) {
  const metadata = permission.metadata || {};
  const target = uiText(metadata.path || metadata.file || metadata.command || metadata.pattern || "");
  const title = uiText(permission.title || permission.permission, "Permission requested");
  const message = uiText(permission.message || target, "Code needs approval to continue this action.");
  return (
    <div className="agent-permission-card">
      <strong>{title}</strong>
      <span>{message}</span>
      {target && permission.message ? <small>{target}</small> : null}
      <div>
        <button onClick={() => onReply("once")}>Allow once</button>
        <button onClick={() => onReply("always")}>Always</button>
        <button onClick={() => onReply("reject")}>Reject</button>
      </div>
    </div>
  );
}

function QuestionCard({
  question,
  onReply,
  onReject
}: {
  question: AgentQuestion;
  onReply: (reply: string) => void;
  onReject: () => void;
}) {
  const [replyText, setReplyText] = useState("");
  const [selectedOption, setSelectedOption] = useState("");
  return (
    <div className="agent-question-card">
      <div className="question-header">
        <strong>Question</strong>
        {question.status ? <small>{question.status}</small> : null}
      </div>
      <p className="question-text">{question.question}</p>
      {question.options && question.options.length > 0 ? (
        <div className="question-options">
          {question.options.map((option) => (
            <button
              key={option}
              className={"option-button " + (selectedOption === option ? "selected" : "")}
              onClick={() => {
                setSelectedOption(option);
                setReplyText(option);
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}
      <textarea
        className="question-reply-field"
        value={replyText}
        onChange={(e) => setReplyText(e.target.value)}
        placeholder="Type your reply..."
        rows={2}
      />
      <div className="question-actions">
        <button
          className="reply-button"
          disabled={!replyText.trim()}
          onClick={() => {
            if (replyText.trim()) {
              onReply(replyText.trim());
              setReplyText("");
              setSelectedOption("");
            }
          }}
        >
          Reply
        </button>
        <button className="reject-button" onClick={() => { onReject(); setReplyText(""); setSelectedOption(""); }}>
          Reject
        </button>
      </div>
    </div>
  );
}

function DiffChangeCard({ file }: { file: AgentDiffFile }) {
  const path = uiText(file.file || file.path, "changed file");
  const status = uiText(file.status, "modified");
  return (
    <details className="agent-diff-card">
      <summary>
        <FileDiff size={14} />
        <span>{status}</span>
        <strong>{path}</strong>
        <em>+{file.additions || 0} -{file.deletions || 0}</em>
      </summary>
      {file.patch ? <DiffPreview patch={file.patch} /> : <small>No patch preview available.</small>}
    </details>
  );
}

function sessionTimeLabel(session: AgentSessionInfo) {
  const value = session.time?.updated || session.time?.created;
  if (!value) return "history";
  const date = new Date(value > 10_000_000_000 ? value : value * 1000);
  return Number.isNaN(date.getTime()) ? "history" : date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function DiffPreview({ patch }: { patch: string }) {
  const lines = patch.split(/\r?\n/).slice(0, 220);
  return (
    <div className="agent-diff-preview">
      {lines.map((line, index) => {
        const kind = line.startsWith("+") && !line.startsWith("+++") ? "add" : line.startsWith("-") && !line.startsWith("---") ? "del" : line.startsWith("@@") ? "hunk" : "ctx";
        return (
          <code key={`${index}:${line}`} className={kind}>
            <span>{kind === "add" ? "+" : kind === "del" ? "-" : kind === "hunk" ? "@" : " "}</span>
            {line.replace(/^[+\-]/, "")}
          </code>
        );
      })}
    </div>
  );
}

function FileTree({
  nodes,
  activePath,
  onPreview,
  onPin,
  onContextMenu,
  depth = 0
}: {
  nodes: FileNode[];
  activePath: string;
  onPreview: (path: string) => void;
  onPin: (path: string) => void;
  onContextMenu: (menu: FileContextMenu) => void;
  depth?: number;
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="file-tree">
      {nodes.map((node) => {
        const isOpen = open[node.path] ?? depth < 1;
        if (node.type === "directory") {
          return (
            <div key={node.path}>
              <button
                className="file-row folder"
                style={{ paddingLeft: 12 + depth * 8 }}
                onClick={() => setOpen((value) => ({ ...value, [node.path]: !isOpen }))}
                onContextMenu={(event) => {
                  event.preventDefault();
                  onContextMenu({ x: event.clientX, y: event.clientY, path: node.path, type: node.type });
                }}
              >
                {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                {displayFileName(node.path || node.name)}
              </button>
              {isOpen ? <FileTree nodes={node.children || []} activePath={activePath} onPreview={onPreview} onPin={onPin} onContextMenu={onContextMenu} depth={depth + 1} /> : null}
            </div>
          );
        }
        return (
          <button
            key={node.path}
            className={`file-row ${activePath === node.path ? "active" : ""}`}
            style={{ paddingLeft: 28 + depth * 8 }}
            onClick={() => onPreview(node.path)}
            onDoubleClick={() => onPin(node.path)}
            onContextMenu={(event) => {
              event.preventDefault();
              onContextMenu({ x: event.clientX, y: event.clientY, path: node.path, type: node.type });
            }}
          >
            <span>{extensionIcon(node.path)}</span>
            {displayFileName(node.path || node.name)}
          </button>
        );
      })}
    </div>
  );
}

function TerminalPanel({
  workspacePath,
  terminalOutput,
  setTerminalOutput,
  commandEvent,
  activePanel,
  setActivePanel,
  outputLog,
  agentLog,
  onClose
}: {
  workspacePath: string;
  terminalOutput: string;
  setTerminalOutput: (value: string | ((current: string) => string)) => void;
  commandEvent: TerminalEvent | null;
  activePanel: BottomPanel;
  setActivePanel: (panel: BottomPanel) => void;
  outputLog: string[];
  agentLog: string[];
  onClose: () => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef("");

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "Consolas, 'Courier New', monospace, 'Fira Code'",
      fontSize: 12,
      lineHeight: 1.4,
      theme: {
        background: "#101318",
        foreground: "#d7dee8",
        cursor: "#f1c84b",
        selectionBackground: "#2d3f53"
      }
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(hostRef.current);
    terminalRef.current = term;
    fitRef.current = fit;
    fit.fit();
    term.writeln(workspacePath ? `Terminal: ${workspacePath}` : "Terminal ready.");
    api.terminal.start(workspacePath).then(({ id }) => {
      idRef.current = id;
      fit.fit();
      api.terminal.resize(id, term.cols, term.rows);
    });
    const dataDispose = api.terminal.onData((id, data) => {
      if (id !== idRef.current) return;
      term.write(data);
      setTerminalOutput((current) => `${current}${data}`.slice(-16000));
    });
    const exitDispose = api.terminal.onExit((id) => {
      if (id === idRef.current) term.writeln("\r\nTerminal closed.");
    });
    const inputDispose = term.onData((data) => {
      if (idRef.current) api.terminal.write(idRef.current, data);
    });
    const resize = () => {
      fit.fit();
      if (idRef.current) api.terminal.resize(idRef.current, term.cols, term.rows);
    };
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      inputDispose.dispose();
      dataDispose();
      exitDispose();
      if (idRef.current) api.terminal.stop(idRef.current);
      term.dispose();
      setTerminalOutput("");
    };
  }, [workspacePath, setTerminalOutput]);

  useEffect(() => {
    if (!commandEvent || !terminalRef.current) return;
    if (commandEvent.execute) {
      if (idRef.current) api.terminal.write(idRef.current, commandEvent.text);
    } else {
      terminalRef.current.write(commandEvent.text);
    }
    fitRef.current?.fit();
  }, [commandEvent]);

  useEffect(() => {
    if (activePanel === "terminal") window.setTimeout(() => fitRef.current?.fit(), 40);
  }, [activePanel]);

  return (
    <section className="bottom-pane terminal-pane">
      <div className="pane-header panel-tabs">
        <div>
          {(["terminal", "problems", "output", "debug", "aiLogs"] as BottomPanel[]).map((panel) => (
            <button key={panel} className={activePanel === panel ? "active" : ""} onClick={() => setActivePanel(panel)}>
              {bottomPanelLabel(panel)}
            </button>
          ))}
        </div>
        <small>{terminalOutput ? "output captured" : "ready"}</small>
        <button className="icon-button tiny" title="Close Panel" onClick={onClose}><PanelBottomClose size={15} /></button>
      </div>
      <div className={`terminal-host ${activePanel === "terminal" ? "active" : "hidden-panel"}`} ref={hostRef} />
      {activePanel !== "terminal" ? <BottomPanelContent activePanel={activePanel} outputLog={outputLog} agentLog={agentLog} /> : null}
    </section>
  );
}

function bottomPanelLabel(panel: BottomPanel) {
  return {
    terminal: "Terminal",
    problems: "Problems",
    output: "Output",
    debug: "Debug Console",
    aiLogs: "AI Logs"
  }[panel];
}

function BottomPanelContent({ activePanel, outputLog, agentLog }: { activePanel: BottomPanel; outputLog: string[]; agentLog: string[] }) {
  if (activePanel === "problems") {
    return <div className="panel-empty"><CirclePlay size={20} /><strong>No problems detected</strong><span>Diagnostics from language services and build tasks will appear here.</span></div>;
  }
  if (activePanel === "output") {
    return <pre className="output-view">{outputLog.length ? outputLog.join("\n") : "No output yet. Run Code, Git, or a task to capture output here."}</pre>;
  }
  if (activePanel === "debug") {
    return <div className="panel-empty"><Bug size={20} /><strong>No debug session</strong><span>Debug console is reserved for run configurations and adapters.</span></div>;
  }
  return <pre className="output-view">{agentLog.join("\n\n")}</pre>;
}

function CommandOverlay({
  mode,
  query,
  setQuery,
  commands,
  files,
  symbols,
  close,
  openFile,
  runCommand
}: {
  mode: Exclude<OverlayMode, null>;
  query: string;
  setQuery: (value: string) => void;
  commands: Array<{ command: { label: string; detail: string; run: () => void }; score: number }>;
  files: Array<{ file: FileNode; score: number }>;
  symbols: SymbolResult[];
  close: () => void;
  openFile: (path: string, line?: number) => void;
  runCommand: (run: () => void) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const title = mode === "command" ? "Command Palette" : mode === "quickOpen" ? "Quick Open" : "Workspace Symbols";
  const placeholder = mode === "command" ? "Type a command" : mode === "quickOpen" ? "Type a file name" : "Type a symbol name";
  const runFirst = () => {
    if (mode === "command" && commands[0]) runCommand(commands[0].command.run);
    if (mode === "quickOpen" && files[0]) openFile(files[0].file.path);
    if (mode === "symbols" && symbols[0]) openFile(symbols[0].path, symbols[0].line);
  };
  return (
    <div className="command-overlay">
      <div className="command-palette">
        <div className="palette-title">
          <span>{title}</span>
          <button onClick={close}><X size={15} /></button>
        </div>
        <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter") runFirst();
          if (event.key === "Escape") close();
        }} placeholder={placeholder} />
        <div className="palette-results">
          {mode === "command" ? commands.map(({ command }) => (
            <button key={command.label} onClick={() => runCommand(command.run)}><strong>{command.label}</strong><span>{command.detail}</span></button>
          )) : null}
          {mode === "quickOpen" ? files.map(({ file }) => (
            <button key={file.path} onClick={() => openFile(file.path)}><strong>{displayFileName(file.path || file.name)}</strong><span>{displayFilePath(file.path)}</span></button>
          )) : null}
          {mode === "symbols" ? symbols.map((symbol) => (
            <button key={`${symbol.path}:${symbol.line}:${symbol.name}`} onClick={() => openFile(symbol.path, symbol.line)}><strong>{symbol.name}</strong><span>{symbol.path}:{symbol.line} - {symbol.preview}</span></button>
          )) : null}
        </div>
      </div>
    </div>
  );
}

function FileMenu({
  menu,
  renamePath,
  duplicatePath,
  deletePath,
  copyPath,
  close
}: {
  menu: NonNullable<FileContextMenu>;
  renamePath: (path: string) => void;
  duplicatePath: (path: string) => void;
  deletePath: (path: string) => void;
  copyPath: (path: string) => void;
  close: () => void;
}) {
  const run = (action: () => void) => {
    action();
    close();
  };
  return (
    <div className="file-context-menu" style={{ left: menu.x, top: menu.y }} onClick={(event) => event.stopPropagation()}>
      <button onClick={() => run(() => renamePath(menu.path))}><Settings2 size={14} />Rename</button>
      <button onClick={() => run(() => duplicatePath(menu.path))}><Copy size={14} />Duplicate</button>
      <button onClick={() => run(() => copyPath(menu.path))}><Copy size={14} />Copy Path</button>
      <button className="danger" onClick={() => run(() => deletePath(menu.path))}><Trash2 size={14} />Delete</button>
    </div>
  );
}

// ── MCP Server Config Panel ──

type MCPServerEntry = {
  name: string;
  type: "stdio" | "sse";
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  disabled?: boolean;
};

function MCPConfigPanel({
  mcpConfig,
  setMcpConfig,
  mcpDirty,
  setMcpDirty,
  projectPath,
  onSave,
  onClose
}: {
  mcpConfig: { servers: Record<string, any> };
  setMcpConfig: (config: { servers: Record<string, any> }) => void;
  mcpDirty: boolean;
  setMcpDirty: (dirty: boolean) => void;
  projectPath: string;
  onSave: () => void;
  onClose: () => void;
}) {
  const servers = mcpConfig.servers || {};
  const serverNames = Object.keys(servers);

  const addServer = () => {
    const name = window.prompt("Server name (e.g., filesystem, github)");
    if (!name) return;
    const updated = { ...servers, [name]: { type: "stdio", command: "", args: [], env: {}, disabled: false } };
    setMcpConfig({ ...mcpConfig, servers: updated });
    setMcpDirty(true);
  };

  const removeServer = (name: string) => {
    if (!window.confirm(`Remove MCP server "${name}"?`)) return;
    const updated = { ...servers };
    delete updated[name];
    setMcpConfig({ ...mcpConfig, servers: updated });
    setMcpDirty(true);
  };

  const updateServer = (name: string, field: string, value: any) => {
    const updated = { ...servers, [name]: { ...servers[name], [field]: value } };
    setMcpConfig({ ...mcpConfig, servers: updated });
    setMcpDirty(true);
  };

  const updateEnvVar = (serverName: string, key: string, value: string) => {
    const env = { ...(servers[serverName]?.env || {}), [key]: value };
    updateServer(serverName, "env", env);
  };

  const removeEnvVar = (serverName: string, key: string) => {
    const env = { ...(servers[serverName]?.env || {}) };
    delete env[key];
    updateServer(serverName, "env", env);
  };

  const addEnvVar = (serverName: string) => {
    const key = window.prompt("Environment variable name");
    if (!key) return;
    const value = window.prompt(`Value for ${key}`) || "";
    updateEnvVar(serverName, key, value);
  };

  return (
    <div className="overlay mcp-editor-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="mcp-editor-panel">
        <div className="mcp-editor-header">
          <h2>MCP Server Configuration</h2>
          <div className="mcp-editor-actions">
            {mcpDirty ? <span className="mcp-dirty-badge">Unsaved changes</span> : null}
            <button className="mcp-action-button primary" onClick={onSave} disabled={!mcpDirty}>
              <Save size={14} /> Save
            </button>
            <button className="mcp-action-button" onClick={onClose}>Close</button>
            <button className="icon-button" onClick={onClose}><X size={18} /></button>
          </div>
        </div>

        <div className="mcp-editor-body">
          <div className="mcp-section-header">
            <span>MCP Servers ({serverNames.length})</span>
            <button className="mcp-action-button primary" onClick={addServer}>+ Add Server</button>
          </div>

          {serverNames.length === 0 ? (
            <div className="mcp-empty-state">
              <strong>No MCP servers configured</strong>
              <span>MCP (Model Context Protocol) servers provide additional tools and data sources for the coding agent.</span>
              <span>Click "Add Server" to configure a stdio or SSE-based server.</span>
            </div>
          ) : (
            <div className="mcp-server-list">
              {serverNames.map((name) => {
                const server = servers[name] || {};
                const envVars = server.env || {};
                const envKeys = Object.keys(envVars);
                return (
                  <div key={name} className="mcp-server-item">
                    <div className="mcp-server-header">
                      <div className="mcp-server-name">
                        <strong>{name}</strong>
                        <span className={`mcp-server-status ${server.disabled ? "disabled" : "active"}`}>
                          {server.disabled ? "Disabled" : "Active"}
                        </span>
                        <span className="mcp-server-type">{server.type === "sse" ? "SSE" : "STDIO"}</span>
                      </div>
                      <div className="mcp-server-actions">
                        <button className="icon-button" title="Toggle disabled"
                          onClick={() => updateServer(name, "disabled", !server.disabled)}>
                          {server.disabled ? <CirclePlay size={14} /> : <X size={14} />}
                        </button>
                        <button className="icon-button danger" title="Remove server"
                          onClick={() => removeServer(name)}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>

                    <div className="mcp-server-fields">
                      <div className="mcp-field compact">
                        <label>Type</label>
                        <select value={server.type || "stdio"}
                          onChange={(e) => updateServer(name, "type", e.target.value)}>
                          <option value="stdio">stdio</option>
                          <option value="sse">sse</option>
                        </select>
                      </div>

                      {server.type !== "sse" ? (
                        <>
                          <div className="mcp-field compact">
                            <label>Command</label>
                            <input value={server.command || ""}
                              onChange={(e) => updateServer(name, "command", e.target.value)}
                              placeholder="e.g., npx, uvx, node" />
                          </div>
                          <div className="mcp-field compact">
                            <label>Args</label>
                            <input value={(server.args || []).join(" ")}
                              onChange={(e) => updateServer(name, "args", e.target.value.split(/\s+/).filter(Boolean))}
                              placeholder="space-separated arguments" />
                          </div>
                        </>
                      ) : (
                        <div className="mcp-field compact">
                          <label>URL</label>
                          <input value={server.url || ""}
                            onChange={(e) => updateServer(name, "url", e.target.value)}
                            placeholder="e.g., http://localhost:3000/sse" />
                        </div>
                      )}

                      <div className="mcp-field compact">
                        <label>
                          Environment Variables ({envKeys.length})
                          <button className="icon-button tiny" title="Add env var"
                            onClick={() => addEnvVar(name)}>
                            <Plus size={12} />
                          </button>
                        </label>
                        {envKeys.length > 0 ? (
                          <div className="mcp-env-list">
                            {envKeys.map((key) => (
                              <div key={key} className="mcp-env-row">
                                <span className="mcp-env-key">{key}</span>
                                <input
                                  value={envVars[key] || ""}
                                  onChange={(e) => updateEnvVar(name, key, e.target.value)}
                                  placeholder="value"
                                />
                                <button className="icon-button tiny danger"
                                  onClick={() => removeEnvVar(name, key)}>
                                  <Trash2 size={11} />
                                </button>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <span className="mcp-env-empty">No environment variables set.</span>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
