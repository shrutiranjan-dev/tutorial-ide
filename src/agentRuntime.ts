import type {
  AgentDiffFile,
  AgentPermissionRequest,
  AgentRuntimeEvent,
  AgentSessionDetail,
  AgentSessionSummary,
  AgentTodoItem,
  AgentToolPart,
  CommandResult
} from "./types";

export type AgentUiMessage = {
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
  todos?: AgentTodoItem[];
};

export type AgentActivityChip = {
  id: string;
  label: string;
  tone?: "info" | "success" | "warn" | "danger";
  detail?: string;
  sessionID?: string;
  count?: number;
};

export type AgentRuntimeState = {
  activeSessionID: string;
  activeMessageID: string;
  busy: boolean;
  model?: string;
  permissionMode?: string;
  messages: AgentUiMessage[];
  messagesMap: Record<string, AgentUiMessage>;
  sessions: AgentSessionSummary[];
  activityChips: AgentActivityChip[];
  permissions: AgentPermissionRequest[];
  diff: AgentDiffFile[];
  todos: AgentTodoItem[];
  log: string[];
  lastError?: string;
};

export type AgentRuntimeAction =
  | { type: "reset"; state?: Partial<AgentRuntimeState> }
  | { type: "sessionStarted"; sessionID: string; requestId?: string; model?: string; permissionMode?: string; title?: string; time?: number }
  | { type: "sessionResumed"; sessionID: string; detail?: AgentSessionDetail | null; messages?: unknown[]; diff?: AgentDiffFile[]; permissions?: AgentPermissionRequest[]; todos?: AgentTodoItem[]; title?: string }
  | { type: "sessionsUpdated"; sessions: AgentSessionSummary[] }
  | { type: "promptSubmitted"; requestId: string; prompt: string; userId?: string; assistantId?: string; meta?: string; model?: string; sessionID?: string; messageID?: string }
  | { type: "assistantText"; requestId?: string; sessionID?: string; messageID?: string; text: unknown; append?: boolean; pending?: boolean }
  | { type: "toolsUpdated"; requestId?: string; sessionID?: string; messageID?: string; tools: unknown[] | AgentToolPart[] }
  | { type: "permissionsUpdated"; requestId?: string; sessionID?: string; permissions: unknown }
  | { type: "permissionResponded"; sessionID: string; requestID: string }
  | { type: "diffUpdated"; requestId?: string; sessionID?: string; messageID?: string; diff: unknown }
  | { type: "todoUpdated"; requestId?: string; sessionID?: string; todos: unknown[] | AgentTodoItem[] }
  | { type: "statusUpdated"; requestId?: string; sessionID?: string; status: string; pending?: boolean }
  | { type: "sessionDone"; requestId?: string; sessionID?: string; messageID?: string; result?: Partial<CommandResult> & Record<string, unknown>; text?: unknown; command?: string; exitCode?: number; tools?: unknown[] | AgentToolPart[]; diff?: unknown }
  | { type: "sessionError"; requestId?: string; sessionID?: string; messageID?: string; error: unknown }
  | { type: "stop"; requestId?: string; sessionID?: string }
  | { type: "activity"; chip: AgentActivityChip }
  | { type: "runtimeEvent"; event: AgentRuntimeEvent | unknown }
  | { type: "clearError" };

const DEFAULT_WELCOME_MESSAGE: AgentUiMessage = {
  id: "welcome",
  role: "system",
  text: "Ask Code to review, explain, edit-plan, or reason about this workspace. The GUI runs the engine behind the scenes without opening the terminal UI.",
  meta: "Code Workbench"
};

export function createAgentRuntimeId(prefix = "agent") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`;
}

export function safeJson(value: unknown, fallback = ""): string {
  const seen = new WeakSet<object>();
  try {
    const text = JSON.stringify(value, (_key, nested) => {
      if (typeof nested === "bigint") return nested.toString();
      if (nested && typeof nested === "object") {
        if (seen.has(nested)) return "[Circular]";
        seen.add(nested);
      }
      return nested;
    }, 2);
    return text || fallback;
  } catch {
    return fallback;
  }
}

export function safeUiText(value: unknown, fallback = "", maxLength = 4000): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value.slice(0, maxLength);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value).slice(0, maxLength);
  }
  if (Array.isArray(value)) {
    const text = value.map((item) => safeUiText(item)).filter(Boolean).join(", ");
    return (text || fallback).slice(0, maxLength);
  }
  if (typeof value === "object") {
    const item = value as Record<string, unknown>;
    for (const key of ["title", "name", "tool", "type", "status", "message", "command", "path", "file", "text", "content"]) {
      const nested = item[key];
      if (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean" || typeof nested === "bigint") {
        return String(nested).slice(0, maxLength);
      }
    }
    return safeJson(value, fallback).slice(0, maxLength);
  }
  return fallback;
}

export const uiText = safeUiText;

function assistantText(value: unknown, fallback = "") {
  return safeUiText(value, fallback, 24000).trim();
}

function isSyntheticToolSummary(value: string) {
  return /^Code completed with \d+ tool steps?\.?$/i.test(value.trim());
}

function isNoAssistantTimeout(value: string) {
  return /timed out before an assistant response|code timed out|no response returned/i.test(value.trim());
}

function hasMeaningfulAssistantText(value: string) {
  const text = assistantText(value);
  return Boolean(text) && !isSyntheticToolSummary(text) && !isNoAssistantTimeout(text);
}

function mergeAssistantText(current: string, incoming: string) {
  const existing = assistantText(current);
  const next = assistantText(incoming);
  if (!next) return existing;
  if (!existing) return next;
  if (isSyntheticToolSummary(next)) return existing;
  if (next === existing || existing.includes(next)) return existing;
  if (next.includes(existing)) return next;
  return next.length >= existing.length ? next : existing;
}

export function createInitialAgentRuntimeState(overrides: Partial<AgentRuntimeState> = {}): AgentRuntimeState {
  const state: AgentRuntimeState = {
    activeSessionID: "",
    activeMessageID: "",
    busy: false,
    messages: [{ ...DEFAULT_WELCOME_MESSAGE }],
    messagesMap: { welcome: DEFAULT_WELCOME_MESSAGE },
    sessions: [],
    activityChips: [],
    permissions: [],
    diff: [],
    todos: [],
    log: [
      "Code GUI mode active. Terminal UI launching is disabled.",
      "Use the Ollama model dropdown for local and cloud models.",
      "Provider auth stays compatible with the vendored Code engine."
    ],
  };
  return {
    ...state,
    ...overrides,
    messages: overrides.messages ? [...overrides.messages] : state.messages,
    messagesMap: overrides.messagesMap ? { ...overrides.messagesMap } : state.messagesMap,
    sessions: overrides.sessions ? [...overrides.sessions] : state.sessions,
    activityChips: overrides.activityChips ? [...overrides.activityChips] : state.activityChips,
    permissions: overrides.permissions ? [...overrides.permissions] : state.permissions,
    diff: overrides.diff ? [...overrides.diff] : state.diff,
    todos: overrides.todos ? [...overrides.todos] : state.todos,
    log: overrides.log ? [...overrides.log] : state.log
  };
}

export const initialAgentRuntimeState = createInitialAgentRuntimeState;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function compactLog(log: string[]) {
  return log.filter(Boolean).slice(0, 30);
}

function addLog(state: AgentRuntimeState, entry: string) {
  return { ...state, log: compactLog([entry, ...state.log]) };
}

export function openCodeRole(message: unknown): AgentUiMessage["role"] {
  const item = isRecord(message) ? message : {};
  const info = isRecord(item.info) ? item.info : undefined;
  const nested = isRecord(item.message) ? item.message : undefined;
  const role = safeUiText(info?.role || item.role || nested?.role || "assistant");
  return role === "user" || role === "system" ? role : "assistant";
}

export function openCodeMessageId(message: unknown, fallback = createAgentRuntimeId("message")) {
  const item = isRecord(message) ? message : {};
  const info = isRecord(item.info) ? item.info : undefined;
  const nested = isRecord(item.message) ? item.message : undefined;
  return safeUiText(info?.id || item.id || nested?.id, fallback);
}

export function openCodePartText(part: unknown): string {
  if (!isRecord(part)) return "";
  if (isRecord(part.part)) return openCodePartText(part.part);
  if (isRecord(part.delta)) return openCodePartText(part.delta);
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (typeof part.output === "string") return part.output;
  const text = isRecord(part.text) ? part.text : undefined;
  const content = isRecord(part.content) ? part.content : undefined;
  if (typeof text?.value === "string") return text.value;
  if (typeof content?.text === "string") return content.text;
  if (Array.isArray(part.content)) return part.content.map(openCodePartText).filter(Boolean).join("\n");
  return "";
}

export function openCodeToolPart(part: unknown, index = 0): AgentToolPart | null {
  if (!isRecord(part)) return null;
  if (isRecord(part.part)) return openCodeToolPart(part.part, index);
  const type = safeUiText(part.type);
  if (["", "text", "reasoning", "patch", "step-start", "step-finish"].includes(type)) return null;
  const state = isRecord(part.state) ? part.state : undefined;
  const input = isRecord(part.input) ? part.input : isRecord(state?.input) ? state.input : undefined;
  const output = isRecord(part.output) ? part.output : isRecord(state?.output) ? state.output : undefined;
  const metadata = isRecord(part.metadata) ? part.metadata : isRecord(state?.metadata) ? state.metadata : undefined;
  const time = isRecord(part.time) ? part.time : isRecord(state?.time) ? state.time : undefined;
  const raw = {
    ...(isRecord(part.raw) ? part.raw : part),
    input: input || {},
    output: output || state?.output,
    metadata: metadata || {},
    time,
    state: state || {},
    status: safeUiText(state?.status || part.status || part.phase || part.finish),
    outputPath: safeUiText(part.outputPath || metadata?.outputPath || output?.outputPath)
  };
  const title = safeUiText(
    state?.title || part.title || part.tool || part.name || input?.filePath || input?.path || input?.command || input?.query || metadata?.filepath || metadata?.path || part.command || part.file || type,
    "Code step"
  );
  const errorText = safeUiText(part.error || part.stderr || output?.error || metadata?.error);
  const outputText = openCodePartText(part)
    || (typeof state?.output === "string" ? state.output : "")
    || (typeof part.detail === "string" ? part.detail : "")
    || (typeof input?.content === "string" ? input.content : "")
    || safeUiText(part.stdout || output?.stdout || output?.stderr || output?.text || output?.content || output?.result || metadata?.preview, "", 4000);
  const detail = [
    errorText ? `Error: ${errorText}` : "",
    outputText || safeJson(part.output || part.metadata || part.input || "", "")
  ].filter(Boolean).join("\n\n");
  const id = safeUiText(part.id, `${type || "tool"}-${title || index}`);
  const status = errorText
    ? "error"
    : safeUiText(state?.status || part.status || part.phase || part.finish || metadata?.status || output?.status);
  return {
    id,
    type: safeUiText(part.tool || part.name || type, "tool"),
    title,
    status,
    detail: detail.slice(0, 4000),
    raw
  };
}

export function openCodeToolParts(parts: unknown[] = []): AgentToolPart[] {
  return parts.map(openCodeToolPart).filter((part): part is AgentToolPart => Boolean(part));
}

function toolFingerprint(tool: AgentToolPart, index = 0) {
  const raw = isRecord(tool.raw) ? tool.raw : {};
  const input = isRecord(raw.input) ? raw.input : {};
  const path = safeUiText(input.filePath || input.path || raw.path || raw.file || raw.filename);
  const command = safeUiText(input.command || raw.command);
  const query = safeUiText(input.query || raw.query);
  const stableId = safeUiText(tool.id);
  if (stableId && !/^tool-code step-\d+$/i.test(stableId)) return stableId;
  return [
    safeUiText(tool.type, "tool"),
    safeUiText(tool.title, "Code step"),
    path,
    command,
    query,
    index
  ].filter(Boolean).join(":");
}

function mergeToolParts(existing: AgentToolPart[] = [], incoming: AgentToolPart[] = []) {
  const merged = new Map<string, AgentToolPart>();
  existing.forEach((tool, index) => {
    merged.set(toolFingerprint(tool, index), tool);
  });
  incoming.forEach((tool, index) => {
    const key = toolFingerprint(tool, index);
    const previous = merged.get(key);
    merged.set(key, {
      ...(previous || {}),
      ...tool,
      detail: tool.detail || previous?.detail,
      raw: tool.raw || previous?.raw,
      status: tool.status || previous?.status
    });
  });
  return Array.from(merged.values());
}

function messageParts(message: unknown) {
  if (!isRecord(message)) return [];
  const nested = isRecord(message.message) ? message.message : undefined;
  const parts = Array.isArray(message.parts) ? message.parts : Array.isArray(nested?.parts) ? nested.parts : [];
  return parts;
}

export function agentUiMessagesFromOpenCode(messages: unknown[], sessionID = ""): AgentUiMessage[] {
  return messages.map((message) => {
    const item = isRecord(message) ? message : {};
    const parts = messageParts(message);
    const role = openCodeRole(message);
    const id = openCodeMessageId(message);
    const text = [
      ...parts.map(openCodePartText),
      typeof item.text === "string" ? item.text : "",
      typeof item.content === "string" ? item.content : ""
    ].filter(Boolean).join("\n\n").trim();
    const tools = openCodeToolParts(parts);
    return {
      id,
      role,
      text,
      meta: sessionID || undefined,
      sessionID: sessionID || undefined,
      messageID: id,
      tools
    };
  }).filter((message) => Boolean(message.text || message.tools?.length));
}

export const convertOpenCodeMessages = agentUiMessagesFromOpenCode;
export const convertOpenCodeToolPart = openCodeToolPart;

export function normalizeTodos(todos: unknown[] = []): AgentTodoItem[] {
  return todos.map<AgentTodoItem>((todo, index) => {
    if (!isRecord(todo)) {
      return { id: `todo-${index}`, content: safeUiText(todo, "Task"), status: "pending" };
    }
    const status = safeUiText(todo.status || todo.state, "pending").toLowerCase();
    return {
      ...todo,
      id: safeUiText(todo.id, `todo-${index}`),
      content: safeUiText(todo.content || todo.text || todo.title, "Task"),
      title: todo.title === undefined ? undefined : safeUiText(todo.title),
      status: status.includes("done") || status.includes("complete") ? "completed" : status.includes("progress") ? "in_progress" : status || "pending"
    };
  });
}

function countPatchLines(patch: string, prefix: "+" | "-") {
  return patch
    .split(/\r?\n/)
    .filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`))
    .length;
}

function diffFilesFromPatchText(patch: string, fallbackPath = "workspace.diff"): AgentDiffFile[] {
  const text = safeUiText(patch, "", 200000);
  if (!text.trim()) return [];
  const files: AgentDiffFile[] = [];
  let current: { path: string; status: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const filePatch = current.lines.join("\n");
    files.push({
      file: current.path,
      path: current.path,
      patch: filePatch,
      additions: countPatchLines(filePatch, "+"),
      deletions: countPatchLines(filePatch, "-"),
      status: current.status
    });
  };
  for (const line of text.split(/\r?\n/)) {
    const header = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (header) {
      flush();
      current = { path: header[2], status: "modified", lines: [line] };
      continue;
    }
    if (!current) current = { path: fallbackPath, status: "modified", lines: [] };
    if (line.startsWith("new file mode")) current.status = "added";
    if (line.startsWith("deleted file mode")) current.status = "deleted";
    if (line.startsWith("rename from ")) current.status = "renamed";
    if (line.startsWith("rename to ")) {
      current.status = "renamed";
      current.path = line.slice("rename to ".length).trim() || current.path;
    }
    if (line.startsWith("+++ b/")) current.path = line.slice(6).trim() || current.path;
    current.lines.push(line);
  }
  flush();
  return files.length ? files : [{
    file: fallbackPath,
    path: fallbackPath,
    patch: text,
    additions: countPatchLines(text, "+"),
    deletions: countPatchLines(text, "-"),
    status: "modified"
  }];
}

function hasGitPatchHeader(patch: string) {
  return /^diff --git /m.test(patch);
}

function recordPatchPath(file: Record<string, unknown>, fallbackPath: string) {
  return safeUiText(file.path || file.file || file.name || file.filePath, fallbackPath);
}

function normalizeUnknownArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isRecord(value)) return value === undefined || value === null ? [] : [value];
  const candidates = [value.items, value.permissions, value.requests, value.files, value.diff, value.changes, value.todos, value.todo, value.questions, value.status];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate;
  }
  return [value];
}

export function normalizePermissionRequests(value: unknown): AgentPermissionRequest[] {
  return normalizeUnknownArray(value).map((permission, index) => {
    if (!isRecord(permission)) {
      const text = safeUiText(permission, "Permission requested");
      return {
        id: `permission-${index}`,
        requestID: `permission-${index}`,
        permission: text,
        title: text,
        message: text
      };
    }
    const input = isRecord(permission.input) ? permission.input : {};
    const params = isRecord(permission.params) ? permission.params : {};
    const metadata = {
      ...(isRecord(permission.metadata) ? permission.metadata : {}),
      ...(isRecord(permission.meta) ? permission.meta : {}),
      action: permission.action || permission.permission || permission.type || permission.name,
      tool: permission.tool || permission.name,
      command: permission.command || input.command || params.command,
      path: permission.path || permission.file || permission.filePath || input.path || input.file || input.filePath || params.path,
      resource: permission.resource || permission.uri || permission.url || input.resource || input.uri || input.url || params.resource,
      pattern: permission.pattern || input.pattern || params.pattern
    };
    const id = safeUiText(
      permission.id || permission.requestID || permission.permissionID || permission.callID || permission.toolCallID,
      `permission-${index}`
    );
    const kind = safeUiText(
      permission.permission || permission.action || permission.tool || permission.type || permission.name,
      "Permission requested"
    );
    const title = safeUiText(permission.title || permission.label || kind, kind);
    const target = safeUiText(metadata.command || metadata.path || metadata.resource || metadata.pattern || metadata.tool);
    const message = safeUiText(permission.message || permission.description || permission.reason || target, title);
    return {
      ...permission,
      id,
      requestID: safeUiText(permission.requestID || id, id),
      permissionID: safeUiText(permission.permissionID || id, id),
      permission: kind,
      title,
      message,
      metadata
    };
  });
}

export function normalizeDiffFiles(value: unknown): AgentDiffFile[] {
  if (typeof value === "string") return diffFilesFromPatchText(value);
  if (isRecord(value)) {
    const directPatch = safeUiText(value.patch || value.diff || value.content || value.text, "", 200000);
    const collectionCandidates = [value.items, value.files, value.changes].some(Array.isArray);
    if (directPatch && hasGitPatchHeader(directPatch) && !collectionCandidates) {
      return diffFilesFromPatchText(directPatch, recordPatchPath(value, "workspace.diff"));
    }
  }
  return normalizeUnknownArray(value).flatMap((file, index) => {
    if (typeof file === "string") {
      return diffFilesFromPatchText(file, `patch-${index + 1}`);
    }
    if (!isRecord(file)) {
      return {
        file: `change-${index + 1}`,
        path: `change-${index + 1}`,
        patch: "",
        additions: 0,
        deletions: 0,
        status: "modified"
      };
    }
    const patch = safeUiText(file.patch || file.diff || file.content || file.text, "", 120000);
    const path = recordPatchPath(file, `change-${index + 1}`);
    if (patch && hasGitPatchHeader(patch) && !file.path && !file.file && !file.name && !file.filePath) {
      return diffFilesFromPatchText(patch, path);
    }
    const additions = typeof file.additions === "number" ? file.additions : countPatchLines(patch, "+");
    const deletions = typeof file.deletions === "number" ? file.deletions : countPatchLines(patch, "-");
    return {
      ...file,
      file: safeUiText(file.file || path, path),
      path,
      patch,
      additions,
      deletions,
      status: safeUiText(file.status || file.state || file.type || file.change, patch ? "modified" : "modified")
    };
  }).filter((file) => Boolean(file.path || file.file || file.patch));
}

export function deriveTodosFromUiMessages(messages: AgentUiMessage[]): AgentTodoItem[] {
  const latestPlan = [...messages].reverse().find((message) => /(^|\n)\s*(-|\d+\.)\s+\[?[ x-]?\]?/i.test(message.text));
  if (!latestPlan) return [];
  return latestPlan.text
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.match(/^\s*(?:-|\d+\.)\s+(?:\[( |x|-)\]\s*)?(.+)/i);
      if (!match) return null;
      const todo: AgentTodoItem = {
        id: `${latestPlan.id}-todo-${index}`,
        content: match[2].trim().slice(0, 120),
        status: match[1]?.toLowerCase() === "x" ? "completed" : match[1] === "-" ? "in_progress" : "pending"
      };
      return todo;
    })
    .filter((item): item is AgentTodoItem => Boolean(item))
    .slice(0, 8);
}

function compactActivityChips(chips: AgentActivityChip[]) {
  const grouped = new Map<string, AgentActivityChip>();
  for (const chip of chips) {
    const label = safeUiText(chip.label, "activity").toLowerCase();
    const detail = safeUiText(chip.detail);
    const key = `${label}:${detail}:${chip.tone || "info"}`;
    const existing = grouped.get(key);
    if (existing) {
      grouped.set(key, {
        ...existing,
        count: (existing.count || 1) + (chip.count || 1),
        sessionID: existing.sessionID || chip.sessionID
      });
    } else {
      grouped.set(key, {
        ...chip,
        id: key,
        label: safeUiText(chip.label, "activity"),
        detail,
        count: chip.count || 1
      });
    }
  }
  return Array.from(grouped.values()).slice(0, 10);
}

function addActivity(state: AgentRuntimeState, chip: AgentActivityChip) {
  return {
    ...state,
    activityChips: compactActivityChips([chip, ...state.activityChips])
  };
}

function shouldRecordRuntimeActivity(event: unknown) {
  const item = isRecord(event) ? event : {};
  const type = safeUiText(item.type || item.event).toLowerCase();
  if (!type) return false;
  if (["text", "tools", "status", "message.done"].includes(type)) return false;
  return type.includes("permission")
    || type.includes("diff")
    || type.includes("error")
    || type.includes("session")
    || type.includes("file");
}

function updateTargetMessage(
  state: AgentRuntimeState,
  target: { requestId?: string; messageID?: string; sessionID?: string },
  update: (message: AgentUiMessage) => AgentUiMessage
) {
  const { messageID, requestId } = target;
  let targetMsg = state.messagesMap[messageID || ""];

  if (!targetMsg && requestId) {
    targetMsg = state.messages.find(m => m.requestId === requestId);
  }

  if (targetMsg) {
    const updatedMsg = update(targetMsg);
    const nextMap = { ...state.messagesMap, [updatedMsg.id]: updatedMsg };
    const nextMessages = state.messages.map(m => m.id === updatedMsg.id ? updatedMsg : m);
    return { ...state, messages: nextMessages, messagesMap: nextMap };
  }

  const fallback = update({
    id: createAgentRuntimeId("assistant"),
    role: "assistant",
    text: "",
    requestId: requestId,
    sessionID: target.sessionID,
    messageID: messageID,
    pending: true,
    status: "running"
  });

  return {
    ...state,
    messages: [...state.messages, fallback],
    messagesMap: { ...state.messagesMap, [fallback.id]: fallback }
  };
}

function runtimeEventSessionID(event: unknown) {
  const item = isRecord(event) ? event : {};
  const data = isRecord(item.data) ? item.data : undefined;
  const syncEvent = isRecord(item.syncEvent) ? item.syncEvent : undefined;
  return safeUiText(item.sessionID || data?.sessionID || syncEvent?.sessionID);
}

function runtimeEventLabel(event: unknown) {
  const item = isRecord(event) ? event : {};
  const type = safeUiText(item.type || item.event, "activity");
  const data = isRecord(item.data) ? item.data : undefined;
  const syncEvent = isRecord(item.syncEvent) ? item.syncEvent : undefined;
  const name = safeUiText(data?.tool || data?.permission || syncEvent?.type || type, type).replace(/^session\.|^sync\./, "");
  return name.replace(/[._-]+/g, " ").trim() || "activity";
}

function runtimeEventTone(event: unknown): AgentActivityChip["tone"] {
  const item = isRecord(event) ? event : {};
  const data = isRecord(item.data) ? item.data : undefined;
  const text = [
    item.type,
    item.event,
    item.status,
    item.message,
    data?.type,
    data?.status,
    data?.message
  ].map((value) => safeUiText(value)).filter(Boolean).join(" ").toLowerCase();
  if (text.includes("failed") || text.includes("error") || text.includes("reject")) return "danger";
  if (text.includes("permission") || text.includes("ask")) return "warn";
  if (text.includes("success") || text.includes("done") || text.includes("idle")) return "success";
  return "info";
}

export function activityChipFromRuntimeEvent(event: unknown): AgentActivityChip {
  const item = isRecord(event) ? event : {};
  return {
    id: safeUiText(item.id, createAgentRuntimeId("activity")),
    label: runtimeEventLabel(event),
    tone: runtimeEventTone(event),
    detail: safeUiText(item.type || item.event),
    sessionID: runtimeEventSessionID(event) || undefined
  };
}

export function agentRuntimeActionFromEvent(event: AgentRuntimeEvent | unknown): AgentRuntimeAction | null {
  if (!isRecord(event)) return null;
  const requestId = safeUiText(event.requestId);
  const sessionID = safeUiText(event.sessionID);
  if (!requestId && !sessionID) return { type: "activity", chip: activityChipFromRuntimeEvent(event) };
  switch (event.type) {
    case "session":
      return { type: "sessionStarted", requestId, sessionID, model: safeUiText(event.model), permissionMode: safeUiText(event.permissionMode) };
    case "session.created":
      return { type: "sessionStarted", requestId, sessionID, title: safeUiText(event.title) };
    case "session.deleted":
      return { type: "activity", chip: { id: `deleted-${sessionID || requestId}`, label: "session deleted", tone: "warn", sessionID } };
    case "session.updated":
      return { type: "activity", chip: { id: `updated-${sessionID || requestId}`, label: "session updated", tone: "info", sessionID } };
    case "text":
      return { type: "assistantText", requestId, sessionID, messageID: safeUiText(event.messageID), text: event.text };
    case "tools":
      return { type: "toolsUpdated", requestId, sessionID, messageID: safeUiText(event.messageID), tools: Array.isArray(event.tools) ? event.tools : [] };
    case "permissions":
      return { type: "permissionsUpdated", requestId, sessionID, permissions: event.permissions };
    case "permission.replied": {
      const requestID = safeUiText(event.permissionID || event.requestID || event.id);
      return requestID && sessionID
        ? { type: "permissionResponded", sessionID, requestID }
        : { type: "activity", chip: activityChipFromRuntimeEvent(event) };
    }
    case "diff":
      return { type: "diffUpdated", requestId, sessionID, messageID: safeUiText(event.messageID), diff: event.diff };
    case "todo":
      return { type: "todoUpdated", requestId, sessionID, todos: normalizeUnknownArray(event.todos) };
    case "status":
      return { type: "statusUpdated", requestId, sessionID, status: safeUiText(event.status, "running"), pending: event.status !== "done" };
    case "question.asked":
      return { type: "activity", chip: { ...activityChipFromRuntimeEvent(event), label: "question asked", tone: "warn" } };
    case "question.replied":
      return { type: "activity", chip: { ...activityChipFromRuntimeEvent(event), label: "question replied", tone: "success" } };
    case "error.internal":
    case "error.session":
    case "error.provider":
    case "error":
      return { type: "sessionError", requestId, sessionID, error: event.error || event.message || event };
    case "message.done":
      return { type: "sessionDone", requestId, sessionID, messageID: safeUiText(event.messageID) };
    case "files":
      return { type: "activity", chip: { ...activityChipFromRuntimeEvent(event), label: "files changed", tone: "info" } };
    default:
      return { type: "activity", chip: activityChipFromRuntimeEvent(event) };
  }
}

export function agentRuntimeReducer(state: AgentRuntimeState, action: AgentRuntimeAction): AgentRuntimeState {
  switch (action.type) {
    case "reset":
      return createInitialAgentRuntimeState(action.state);
    case "clearError":
      return { ...state, lastError: undefined };
    case "activity":
      return addActivity(state, action.chip);
    case "sessionsUpdated":
      return { ...state, sessions: [...action.sessions] };
    case "sessionStarted": {
      let next: AgentRuntimeState = {
        ...state,
        activeSessionID: action.sessionID,
        busy: true,
        model: action.model || state.model,
        permissionMode: action.permissionMode || state.permissionMode,
        lastError: undefined
      };
      next = updateTargetMessage(next, action, (message) => ({
        ...message,
        sessionID: action.sessionID,
        meta: action.model || message.meta,
        pending: message.role === "assistant" ? true : message.pending,
        status: message.role === "assistant" ? "running" : message.status
      }));
      return addActivity(addLog(next, `Session ${action.sessionID} using ${action.model || "selected model"}.`), {
        id: `session-${action.sessionID}`,
        label: action.title || "session started",
        tone: "success",
        sessionID: action.sessionID
      });
    }
    case "sessionResumed": {
      const messages = action.messages
        ? agentUiMessagesFromOpenCode(action.messages, action.sessionID)
        : action.detail?.messages
          ? agentUiMessagesFromOpenCode(action.detail.messages, action.sessionID)
          : [];
      const permissions = normalizePermissionRequests(action.permissions || action.detail?.permissions || []);
      const diff = normalizeDiffFiles(action.diff || action.detail?.diff || []);
      const fallbackMessage: AgentUiMessage = {
        id: `session-${action.sessionID}`,
        role: "system",
        text: "This session has no visible messages yet.",
        meta: action.sessionID,
        sessionID: action.sessionID
      };
      const visibleMessages = messages.length ? messages : [fallbackMessage];
      const messagesWithArtifacts = visibleMessages.map((message, index) => (
        index === visibleMessages.length - 1
          ? {
            ...message,
            diff: diff.length ? diff : message.diff,
            permissions: permissions.length ? permissions : message.permissions
          }
          : message
      ));
      return addActivity({
        ...state,
        activeSessionID: action.sessionID,
        messages: messagesWithArtifacts,
        permissions,
        diff,
        todos: normalizeTodos(action.todos || action.detail?.todos || []),
        busy: false,
        lastError: undefined
      }, {
        id: `open-${action.sessionID}`,
        label: action.title || "session resumed",
        tone: "success",
        sessionID: action.sessionID
      });
    }
    case "promptSubmitted": {
      const userMessage: AgentUiMessage = {
        id: action.userId || createAgentRuntimeId("user"),
        role: "user",
        text: safeUiText(action.prompt),
        meta: action.meta,
        sessionID: action.sessionID
      };
      const assistantMessage: AgentUiMessage = {
        id: action.assistantId || createAgentRuntimeId("assistant"),
        requestId: action.requestId,
        role: "assistant",
        text: "",
        meta: action.model || "Code engine",
        pending: true,
        status: "queued",
        sessionID: action.sessionID,
        messageID: action.messageID
      };
      return {
        ...state,
        messages: [...state.messages, userMessage, assistantMessage],
        activeSessionID: action.sessionID || state.activeSessionID,
        activeMessageID: action.messageID || state.activeMessageID,
        busy: true,
        model: action.model || state.model,
        lastError: undefined
      };
    }
    case "assistantText": {
      return updateTargetMessage({
        ...state,
        activeSessionID: action.sessionID || state.activeSessionID
      }, action, (message) => {
        const nextText = assistantText(action.text);
        const currentText = message.text || "";
        return {
          ...message,
          text: action.append ? assistantText(`${currentText}${nextText}`) : mergeAssistantText(currentText, nextText),
          sessionID: action.sessionID || message.sessionID,
          messageID: action.messageID || message.messageID,
          pending: action.pending ?? true,
          status: message.status === "queued" ? "running" : message.status
        };
      });
    }
    case "toolsUpdated": {
      const tools = openCodeToolParts(action.tools);
      return updateTargetMessage(state, action, (message) => ({
        ...message,
        tools: mergeToolParts(message.tools || [], tools),
        sessionID: action.sessionID || message.sessionID,
        messageID: action.messageID || message.messageID
      }));
    }
    case "permissionsUpdated": {
      const permissions = normalizePermissionRequests(action.permissions);
      return updateTargetMessage({
        ...state,
        permissions
      }, action, (message) => ({
        ...message,
        permissions,
        sessionID: action.sessionID || message.sessionID,
        status: "needs permission"
      }));
    }
    case "permissionResponded": {
      const key = action.requestID;
      const keepPermission = (permission: AgentPermissionRequest) =>
        safeUiText(permission.id || permission.requestID || permission.permissionID || "") !== key;
      return {
        ...state,
        permissions: state.permissions.filter(keepPermission),
        messages: state.messages.map((message) => (
          message.sessionID === action.sessionID
            ? { ...message, permissions: (message.permissions || []).filter(keepPermission) }
            : message
        ))
      };
    }
    case "diffUpdated": {
      const diff = normalizeDiffFiles(action.diff);
      return updateTargetMessage({
        ...state,
        activeMessageID: action.messageID || state.activeMessageID,
        diff
      }, action, (message) => ({
        ...message,
        diff,
        sessionID: action.sessionID || message.sessionID,
        messageID: action.messageID || message.messageID
      }));
    }
    case "todoUpdated": {
      const todos = normalizeTodos(action.todos);
      return updateTargetMessage({
        ...state,
        todos
      }, action, (message) => ({
        ...message,
        todos,
        sessionID: action.sessionID || message.sessionID
      }));
    }
    case "statusUpdated": {
      return updateTargetMessage(state, action, (message) => ({
        ...message,
        sessionID: action.sessionID || message.sessionID,
        status: safeUiText(action.status, "running"),
        pending: action.pending ?? action.status !== "done"
      }));
    }
    case "sessionDone": {
      const result = action.result || {};
      const exitCode = action.exitCode ?? result.exitCode ?? 0;
      const tools = action.tools || result.tools;
      const normalizedTools = tools ? openCodeToolParts(normalizeUnknownArray(tools)) : undefined;
      const text = assistantText(action.text ?? result.stdout ?? result.stderr);
      const fallbackText = normalizedTools?.length ? `Code completed with ${normalizedTools.length} tool ${normalizedTools.length === 1 ? "step" : "steps"}.` : "";
      const diff = normalizeDiffFiles(action.diff || result.diff);
      const next = updateTargetMessage({
        ...state,
        activeSessionID: action.sessionID || result.sessionID || state.activeSessionID,
        activeMessageID: action.messageID || result.messageID || state.activeMessageID,
        busy: false
      }, {
        ...action,
        sessionID: action.sessionID || result.sessionID,
        messageID: action.messageID || result.messageID
      }, (message) => {
        const existingText = assistantText(message.text || "");
        const incomingText = existingText && isNoAssistantTimeout(text) ? "" : text;
        const mergedText = mergeAssistantText(existingText, incomingText) || fallbackText;
        const hasAnswer = hasMeaningfulAssistantText(mergedText);
        return {
          ...message,
          text: mergedText,
          command: action.command || result.command || message.command,
          exitCode,
          pending: false,
          status: exitCode === 0 ? "done" : hasAnswer ? "warning" : "failed",
          sessionID: action.sessionID || result.sessionID || message.sessionID,
          messageID: action.messageID || result.messageID || message.messageID,
          tools: normalizedTools ? mergeToolParts(message.tools || [], normalizedTools) : message.tools,
          diff: diff.length ? diff : message.diff
        };
      });
      return addActivity(addLog(next, `Prompt finished in ${action.sessionID || result.sessionID || "Code"} with exit ${exitCode}.`), {
        id: `done-${action.requestId || action.messageID || Date.now()}`,
        label: "done",
        tone: exitCode === 0
          ? "success"
          : state.messages.some((message) => message.requestId === action.requestId && hasMeaningfulAssistantText(message.text))
            ? "warn"
            : "danger",
        sessionID: action.sessionID || result.sessionID
      });
    }
    case "sessionError": {
      const errorText = safeUiText(action.error, "Code engine failed to run this prompt.");
      let preservedAnswer = false;
      const next = updateTargetMessage({
        ...state,
        busy: false,
        lastError: errorText
      }, action, (message) => ({
        ...message,
        ...(() => {
          const existingText = assistantText(message.text || "");
          preservedAnswer = hasMeaningfulAssistantText(existingText);
          return {
            text: existingText || `Code engine failed to run this prompt.\n\n${errorText}`,
            meta: preservedAnswer ? message.meta : "Error",
            exitCode: preservedAnswer ? message.exitCode : 1,
            pending: false,
            status: preservedAnswer ? (isNoAssistantTimeout(errorText) ? "done" : "warning") : "failed",
            sessionID: action.sessionID || message.sessionID,
            messageID: action.messageID || message.messageID
          };
        })()
      }));
      return addActivity(addLog(next, `${preservedAnswer ? "Tool warning" : "Prompt failed"}: ${errorText}`), {
        id: `error-${action.requestId || action.messageID || Date.now()}`,
        label: preservedAnswer ? "tool warning" : "error",
        tone: preservedAnswer ? "warn" : "danger",
        detail: errorText,
        sessionID: action.sessionID
      });
    }
    case "stop":
      return {
        ...state,
        busy: false,
        messages: state.messages.map((message) => {
          const matchesRequest = action.requestId ? message.requestId === action.requestId : true;
          const matchesSession = action.sessionID ? message.sessionID === action.sessionID : true;
          return message.pending && matchesRequest && matchesSession
            ? { ...message, pending: false, status: "stopped", text: message.text || "Stopped." }
            : message;
        })
      };
    case "runtimeEvent": {
      const eventAction = agentRuntimeActionFromEvent(action.event);
      if (!eventAction) return state;
      const withActivity = shouldRecordRuntimeActivity(action.event) ? addActivity(state, activityChipFromRuntimeEvent(action.event)) : state;
      return eventAction.type === "activity" ? withActivity : agentRuntimeReducer(withActivity, eventAction);
    }
    default:
      return state;
  }
}
