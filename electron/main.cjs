const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const fsp = require("fs/promises");
const os = require("os");
const { exec, spawn } = require("child_process");

const logger = {
  log: (...args) => console.log(`[LOG] ${new Date().toISOString()} ${args.join(" ")}`),
  warn: (...args) => console.warn(`[WARN] ${new Date().toISOString()} ${args.join(" ")}`),
  error: (...args) => console.error(`[ERROR] ${new Date().toISOString()} ${args.join(" ")}`),
  debug: (...args) => {
    if (process.env.DEBUG) console.log(`[DEBUG] ${new Date().toISOString()} ${args.join(" ")}`);
  },
};

let pty;
try {
  pty = require("node-pty");
} catch (error) {
  pty = null;
}

const rootDir = path.resolve(__dirname, "..");
const lessonsDir = path.join(rootDir, "lessons");
const terminals = new Map();
const defaultProjectPath = rootDir;
const openCodeSessions = new Map();
const openCodeSyncedDirectories = new Set();
const openCodeEventStreams = new Map();
let openCodeServer = null;
let openCodeServerStarting = null;

const codeWorkbenchIdentity = [
  "You are Code, the AI coding agent inside Code Workbench.",
  "Your visible product name is Code. Never introduce yourself as OpenCode or opencode.",
  "If the user asks your name, who you are, or what tool you are, answer as Code, not as a CLI.",
  "You may use the vendored Code engine and selected local/cloud model behind the scenes, but do not expose OpenCode branding unless the user explicitly asks about engine internals.",
  "Work through the Code Workbench GUI experience: explain, plan, edit, inspect files, use tools, and report progress clearly."
].join("\n");

const codeWorkbenchIdentityReminder = `<system-reminder>\n${codeWorkbenchIdentity}\n</system-reminder>`;

function withCodeWorkbenchIdentity(promptText) {
  return [codeWorkbenchIdentityReminder, String(promptText || "").trim()].filter(Boolean).join("\n\n");
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    title: "Code Workbench",
    autoHideMenuBar: true,
    backgroundColor: "#121418",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  mainWindow.setMenu(null);
  mainWindow.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    const levels = ["log", "warn", "error", "debug"];
    logger[levels[level] || "log"](`[renderer] ${message}${sourceId ? ` (${sourceId}:${line})` : ""}`);
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    logger.error(`[renderer gone] ${details.reason} exitCode=${details.exitCode}`);
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL) => {
    logger.error(`[renderer load failed] ${errorCode} ${errorDescription} ${validatedURL}`);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(rootDir, "dist", "index.html"));
  }
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const term of terminals.values()) term.kill();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  for (const term of terminals.values()) term.kill();
  if (openCodeServer?.proc && !openCodeServer.proc.killed) {
    openCodeServer.proc.kill();
  }
});

function userDataPath(...parts) {
  return path.join(app.getPath("userData"), ...parts);
}

function safeJoin(base, relativePath = "") {
  const target = path.resolve(base, relativePath);
  if (!target.startsWith(path.resolve(base))) {
    throw new Error("Path is outside of the workspace.");
  }
  return target;
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fsp.readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function copyDirIfMissing(source, destination) {
  if (fs.existsSync(destination)) return;
  await fsp.mkdir(destination, { recursive: true });
  await fsp.cp(source, destination, { recursive: true });
}

function slugify(value) {
  return String(value || "lesson")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42) || "lesson";
}

function titleCase(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function generatedLessonsDir() {
  return userDataPath("generated-lessons");
}

function roadmapStorePath() {
  return userDataPath("roadmaps.json");
}

function progressStorePath() {
  return userDataPath("progress.json");
}

function progressEventsPath() {
  return userDataPath("progress-events.json");
}

function opencodeBin() {
  return path.join(rootDir, "node_modules", ".bin", process.platform === "win32" ? "opencode.cmd" : "opencode");
}

function opencodeCommand(args = "") {
  const bin = opencodeBin();
  return `"${bin}"${args ? ` ${args}` : ""}`;
}

function normalizeAgentModel(model = "") {
  if (model && typeof model === "object") {
    const providerID = String(model.providerID || model.provider || "").trim() || "ollama";
    const modelID = String(model.modelID || model.id || model.model || "").trim();
    if (!modelID) return null;
    return {
      providerID,
      modelID,
      label: `${providerID}/${modelID}`
    };
  }
  const raw = String(model || "").trim();
  if (!raw) return null;
  if (!raw.includes("/")) {
    return {
      providerID: "ollama",
      modelID: raw,
      label: `ollama/${raw}`
    };
  }
  const slash = raw.indexOf("/");
  const providerID = raw.slice(0, slash).trim() || "ollama";
  const modelID = raw.slice(slash + 1).trim();
  if (!modelID) return null;
  return {
    providerID,
    modelID,
    label: `${providerID}/${modelID}`
  };
}

function openCodeDirectoryQuery(projectPath) {
  return `directory=${encodeURIComponent(path.resolve(projectPath || rootDir))}`;
}

function openCodeQuery(projectPath, params = {}) {
  const query = new URLSearchParams();
  query.set("directory", path.resolve(projectPath || rootDir));
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  return query.toString();
}

function openCodeJsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body)
  };
}

async function openCodeFetchFirst(candidates) {
  let lastError;
  for (const candidate of candidates) {
    try {
      return await openCodeFetch(candidate.route, candidate.options || {});
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("No Code engine endpoint candidates were provided.");
}

function unwrapOpenCodeData(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "data")) return value.data;
  return value;
}

function openCodeArray(value) {
  const data = unwrapOpenCodeData(value);
  return Array.isArray(data) ? data : [];
}

function openCodeModelForInstance(modelSpec) {
  if (!modelSpec) return undefined;
  return {
    providerID: modelSpec.providerID,
    id: modelSpec.modelID
  };
}

function openCodeModelRef(modelSpec) {
  if (!modelSpec) return undefined;
  return {
    providerID: modelSpec.providerID,
    modelID: modelSpec.modelID
  };
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureOpenCodeServer() {
  if (openCodeServer?.url && openCodeServer.proc && !openCodeServer.proc.killed) {
    return Promise.resolve(openCodeServer);
  }
  if (openCodeServerStarting) return openCodeServerStarting;

  openCodeServerStarting = new Promise((resolve, reject) => {
    const bin = opencodeBin();
    if (!fs.existsSync(bin)) {
      openCodeServerStarting = null;
      reject(new Error(`Code engine binary was not found at ${bin}.`));
      return;
    }

    const proc = spawn(bin, ["serve", "--hostname=127.0.0.1", "--port=0"], {
      cwd: rootDir,
      env: { ...process.env, NO_COLOR: "1" },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const logs = [];
    let buffer = "";
    let settled = false;

    const cleanupTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      openCodeServerStarting = null;
      if (!proc.killed) proc.kill();
      
      const fullLogs = logs.join("\n");
      let errorMessage = `Timed out starting Code server.\n${fullLogs.slice(-3000)}`;
      if (fullLogs.includes("EADDRINUSE")) errorMessage = "Port conflict: The port is already in use. Try restarting the application.";
      else if (fullLogs.includes("permission denied")) errorMessage = "Permission denied: The application lacks necessary permissions to run the Code engine.";
      else if (fullLogs.includes("command not found")) errorMessage = "Binary missing: The Code engine binary could not be executed.";
      
      reject(new Error(errorMessage));
    }, 20000);

    const resolveWithUrl = (url) => {
      if (settled) return;
      settled = true;
      clearTimeout(cleanupTimer);
      openCodeServer = { proc, url, logs };
      openCodeServerStarting = null;
      resolve(openCodeServer);
    };

    const handleOutput = (chunk) => {
      const text = String(chunk || "");
      buffer += text;
      for (const line of text.split(/\r?\n/).filter(Boolean)) {
        logs.push(line);
      }
      const match =
        buffer.match(/opencode server listening.*on\s+(https?:\/\/[^\s]+)/i) ||
        buffer.match(/(https?:\/\/127\.0\.0\.1:\d+)/);
      if (match?.[1]) resolveWithUrl(match[1].replace(/[.,;]+$/, ""));
    };

    proc.stdout?.on("data", handleOutput);
    proc.stderr?.on("data", handleOutput);
    proc.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(cleanupTimer);
      openCodeServerStarting = null;
      reject(error);
    });
    proc.on("exit", (code, signal) => {
      if (openCodeServer?.proc === proc) {
        openCodeServer = null;
        openCodeSyncedDirectories.clear();
        openCodeSessions.clear();
      }
      if (settled) return;
      settled = true;
      clearTimeout(cleanupTimer);
      openCodeServerStarting = null;
      reject(new Error(`Code server exited before startup (${signal || code}).\n${logs.join("\n").slice(-3000)}`));
    });
  });

  return openCodeServerStarting;
}

async function openCodeFetch(route, options = {}) {
  const server = await ensureOpenCodeServer();
  const response = await fetch(`${server.url}${route}`, options);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Code server returned ${response.status} for ${route}.\n${text.slice(0, 3000)}`);
  }
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function ensureOpenCodeSync(projectPath) {
  const directory = path.resolve(projectPath || rootDir);
  if (openCodeSyncedDirectories.has(directory)) return;
  await openCodeFetchFirst([
    { route: `/sync/start?${openCodeQuery(projectPath)}`, options: openCodeJsonOptions("POST", {}) },
    { route: `/api/sync/start?${openCodeQuery(projectPath)}`, options: openCodeJsonOptions("POST", {}) }
  ]);
  openCodeSyncedDirectories.add(directory);
}

function fullAccessPermissionRules() {
  return permissionRulesForMode("full");
}

function permissionRulesForMode(mode = "full") {
  const value = String(mode || "full").toLowerCase();
  const permissions = [
    "read",
    "edit",
    "glob",
    "grep",
    "list",
    "bash",
    "task",
    "external_directory",
    "lsp",
    "skill",
    "todowrite",
    "webfetch",
    "websearch"
  ];
  const readonlyDenied = new Set(["edit", "bash", "task", "external_directory", "todowrite"]);
  const askBefore = new Set(["edit", "bash", "task", "external_directory", "webfetch", "websearch"]);
  return permissions.map((permission) => {
    let action = "allow";
    if (value.includes("read")) action = readonlyDenied.has(permission) ? "deny" : "allow";
    if (value.includes("ask")) action = askBefore.has(permission) ? "ask" : "allow";
    return { permission, pattern: "*", action };
  });
}

function openCodeSessionKey(projectPath, modelSpec, permissionMode = "full") {
  return `${path.resolve(projectPath || rootDir)}::${modelSpec.providerID}/${modelSpec.modelID}::${permissionMode}`;
}

async function createOpenCodeSession(projectPath, modelSpec, permissionMode = "full") {
  const directory = path.resolve(projectPath || rootDir);
  const instanceBody = {
    agent: "build",
    title: "Code Workbench",
    model: openCodeModelForInstance(modelSpec),
    permission: permissionRulesForMode(permissionMode)
  };
  const protocolBody = {
    agent: "build",
    model: openCodeModelRef(modelSpec),
    permission: permissionRulesForMode(permissionMode),
    location: {
      directory
    }
  };

  const created = await openCodeFetchFirst([
    { route: `/session?${openCodeQuery(projectPath)}`, options: openCodeJsonOptions("POST", instanceBody) },
    { route: "/api/session", options: openCodeJsonOptions("POST", protocolBody) }
  ]);
  const session = unwrapOpenCodeData(created);
  if (session?.id) return session;

  throw new Error("Code server did not return a session id.");
}

async function createOpenCodeSessionFromPayload(projectPath, payload = {}) {
  const modelSpec = normalizeAgentModel(payload.model || payload.modelRef || payload.modelID || "");
  if (modelSpec) return createOpenCodeSession(projectPath, modelSpec, payload.permissionMode || payload.mode || "full");
  const body = {
    title: payload.title || "Code Workbench",
    agent: payload.agent || "build",
    metadata: payload.metadata || undefined,
    permission: payload.permission || permissionRulesForMode(payload.permissionMode || "full"),
    workspaceID: payload.workspaceID || undefined
  };
  const data = await openCodeFetchFirst([
    { route: `/session?${openCodeQuery(projectPath)}`, options: openCodeJsonOptions("POST", body) },
    {
      route: "/api/session",
      options: openCodeJsonOptions("POST", {
        id: payload.id || undefined,
        agent: payload.agent || undefined,
        location: { directory: path.resolve(projectPath || rootDir) }
      })
    }
  ]);
  const session = unwrapOpenCodeData(data);
  if (session?.id) return session;
  throw new Error("Code server did not return a session id.");
}

async function ensureOpenCodeSession(projectPath, modelSpec, permissionMode = "full") {
  await ensureOpenCodeSync(projectPath);
  const key = openCodeSessionKey(projectPath, modelSpec, permissionMode);
  const existing = openCodeSessions.get(key);
  if (existing?.id) {
    const statusMap = await readOpenCodeSessionStatus(projectPath).catch(() => ({}));
    const status = statusMap?.[existing.id]?.type || statusMap?.[existing.id]?.status || "";
    if (status !== "busy") return existing;
    openCodeSessions.delete(key);
  }
  const session = await createOpenCodeSession(projectPath, modelSpec, permissionMode);
  const value = { id: session.id, model: modelSpec, directory: projectPath || rootDir, permissionMode };
  openCodeSessions.set(key, value);
  return value;
}

async function readOpenCodeMessages(sessionID, projectPath) {
  if (!sessionID) return [];
  const id = encodeURIComponent(sessionID);
  const data = await openCodeFetchFirst([
    { route: `/session/${id}/message?${openCodeQuery(projectPath, { limit: 80 })}` },
    { route: `/api/session/${id}/message?${openCodeQuery(projectPath, { limit: 80, order: "asc" })}` }
  ]);
  return openCodeArray(data);
}

async function readOpenCodeSessionStatus(projectPath) {
  try {
    const data = await openCodeFetch(`/session/status?${openCodeQuery(projectPath)}`);
    return unwrapOpenCodeData(data) || {};
  } catch {
    return {};
  }
}

async function listOpenCodeSessions(projectPath) {
  const data = await openCodeFetchFirst([
    { route: `/session?${openCodeQuery(projectPath, { scope: "project", limit: 40 })}` },
    { route: `/api/session?${openCodeQuery(projectPath, { limit: 40, order: "desc" })}` }
  ]);
  return openCodeArray(data);
}

async function getOpenCodeSession(sessionID, projectPath) {
  if (!sessionID) return null;
  const id = encodeURIComponent(sessionID);
  const data = await openCodeFetchFirst([
    { route: `/session/${id}?${openCodeQuery(projectPath)}` },
    { route: `/api/session/${id}?${openCodeQuery(projectPath)}` }
  ]);
  return unwrapOpenCodeData(data);
}

async function forkOpenCodeSession(sessionID, projectPath, payload = {}) {
  if (!sessionID) return null;
  const id = encodeURIComponent(sessionID);
  const body = payload.messageID ? { messageID: payload.messageID } : undefined;
  const data = await openCodeFetchFirst([
    { route: `/session/${id}/fork?${openCodeQuery(projectPath)}`, options: openCodeJsonOptions("POST", body) },
    { route: `/api/session`, options: openCodeJsonOptions("POST", { id: payload.id, location: { directory: path.resolve(projectPath || rootDir) } }) }
  ]);
  return unwrapOpenCodeData(data);
}

async function updateOpenCodeSession(sessionID, projectPath, payload = {}) {
  if (!sessionID) return null;
  const id = encodeURIComponent(sessionID);
  const { sessionID: _sessionID, id: _id, projectPath: _projectPath, update: _update, ...rest } = payload || {};
  const body = payload.update && typeof payload.update === "object" ? payload.update : rest;
  const data = await openCodeFetch(`/session/${id}?${openCodeQuery(projectPath)}`, openCodeJsonOptions("PATCH", body));
  return unwrapOpenCodeData(data);
}

async function deleteOpenCodeSession(sessionID, projectPath) {
  if (!sessionID) return false;
  const id = encodeURIComponent(sessionID);
  await openCodeFetch(`/session/${id}?${openCodeQuery(projectPath)}`, { method: "DELETE" });
  for (const [key, value] of openCodeSessions.entries()) {
    if (value?.id === sessionID) openCodeSessions.delete(key);
  }
  return true;
}

function openCodeMessageRole(message) {
  return message?.info?.role || message?.role || message?.message?.role || "";
}

function openCodePartText(part) {
  if (!part || typeof part !== "object") return "";
  const nested = part.part && typeof part.part === "object" ? openCodePartText(part.part) : "";
  if (nested) return nested;
  if (part.type === "text" && typeof part.text === "string") return part.text;
  if (part.type === "reasoning" && typeof part.text === "string") return part.text;
  if (typeof part.text === "string") return part.text;
  if (typeof part.content === "string") return part.content;
  if (typeof part.output === "string") return part.output;
  if (typeof part.result === "string") return part.result;
  if (part.text && typeof part.text === "object" && typeof part.text.value === "string") return part.text.value;
  if (part.content && typeof part.content === "object" && typeof part.content.text === "string") return part.content.text;
  return "";
}

function latestAssistantText(messages, previousAssistantCount) {
  const assistants = messages.filter((message) => openCodeMessageRole(message) === "assistant");
  const candidates = assistants.slice(previousAssistantCount);
  const latest = candidates.at(-1) || assistants.at(-1);
  if (!latest) return "";
  return (latest.parts || [])
    .map(openCodePartText)
    .filter(Boolean)
    .join("\n")
    .trim();
}

function bestAssistantText(messages, previousAssistantCount) {
  const assistants = messages.filter((message) => openCodeMessageRole(message) === "assistant");
  const candidates = assistants.slice(previousAssistantCount);
  return candidates
    .map((message) => (message.parts || []).map(openCodePartText).filter(Boolean).join("\n").trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)[0] || latestAssistantText(messages, previousAssistantCount);
}

function latestAssistantMessage(messages, previousAssistantCount = 0) {
  const assistants = messages.filter((message) => openCodeMessageRole(message) === "assistant");
  const candidates = assistants.slice(previousAssistantCount);
  return candidates.at(-1) || assistants.at(-1) || null;
}

function safeJsonPreview(value, fallback = "") {
  try {
    return JSON.stringify(value, null, 2) || fallback;
  } catch {
    return fallback;
  }
}

function safeOpenCodeText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  if (Array.isArray(value)) {
    const text = value.map((item) => safeOpenCodeText(item)).filter(Boolean).join(", ");
    return text || fallback;
  }
  if (typeof value === "object") {
    for (const key of ["title", "name", "tool", "type", "status", "message", "command", "path", "file", "text", "content"]) {
      const nested = value[key];
      if (typeof nested === "string" || typeof nested === "number" || typeof nested === "boolean" || typeof nested === "bigint") {
        return String(nested);
      }
    }
    return safeJsonPreview(value, fallback).slice(0, 4000);
  }
  return fallback;
}

function summarizeOpenCodePart(part) {
  if (!part || typeof part !== "object") return null;
  if (part.part && typeof part.part === "object") return summarizeOpenCodePart(part.part);
  if (["text", "reasoning", "patch", "step-start", "step-finish"].includes(part.type)) return null;
  if (part.type === "tool" && ["todowrite"].includes(String(part.tool || part.name || ""))) return null;
  if (part.type === "tool" && String(part.tool || part.name || "") === "question" && ["pending", "running"].includes(String(part.status || part.state || ""))) return null;
  const title =
    part.title ||
    part.name ||
    part.tool ||
    part.input?.filePath ||
    part.input?.path ||
    part.input?.command ||
    part.input?.query ||
    part.command ||
    part.filename ||
    part.file ||
    part.type ||
    "Code step";
  const detail =
    part.text ||
    part.content ||
    part.output ||
    part.error ||
    part.metadata?.filediff ||
    part.input?.content ||
    part.input?.command ||
    part.input?.query ||
    part.path ||
    part.url ||
    part.command ||
    "";
  const titleText = safeOpenCodeText(title, "Code step");
  const typeText = safeOpenCodeText(part.tool || part.name || part.type || "part", "part");
  return {
    id: safeOpenCodeText(part.id, `${typeText}-${titleText}`),
    type: typeText,
    title: titleText,
    status: safeOpenCodeText(part.status || part.state || part.phase || ""),
    detail: safeOpenCodeText(detail).slice(0, 4000),
    raw: part
  };
}

function collectOpenCodeTools(messages, previousAssistantCount = 0) {
  const assistants = messages.filter((message) => openCodeMessageRole(message) === "assistant");
  return assistants
    .slice(previousAssistantCount)
    .flatMap((message) => (message.parts || []).map(summarizeOpenCodePart).filter(Boolean));
}

function emitAgentEvent(sender, requestId, event) {
  if (!sender || !requestId || sender.isDestroyed?.()) return;
  sender.send("opencode:event", {
    requestId,
    time: Date.now(),
    ...event
  });
}

async function streamOpenCodeEvents(sender, requestId, sessionID, projectPath, controller) {
  const server = await ensureOpenCodeServer();
  const response = await fetch(`${server.url}/event?${openCodeQuery(projectPath)}`, {
    signal: controller.signal,
    headers: { Accept: "text/event-stream" }
  });
  if (!response.ok || !response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let textByPart = new Map();
  let toolsByPart = new Map();

  const handleEvent = (raw) => {
    const lines = raw.split(/\r?\n/);
    const dataLines = lines
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart());
    if (!dataLines.length) return;
    let event;
    try {
      event = JSON.parse(dataLines.join("\n"));
    } catch {
      return;
    }
    const type = event.type || "";
    const properties = event.properties || event.data || {};
    if (sessionID && properties.sessionID && properties.sessionID !== sessionID) return;

    if (type === "message.part.delta" && properties.field === "text") {
      const partID = properties.partID || "assistant";
      const next = `${textByPart.get(partID) || ""}${properties.delta || ""}`;
      textByPart.set(partID, next);
      emitAgentEvent(sender, requestId, { type: "text", sessionID, text: Array.from(textByPart.values()).join("\n") });
      return;
    }

    if (type === "permission.asked" || type === "permission.v2.asked") {
      emitAgentEvent(sender, requestId, {
        type: "permissions",
        sessionID,
        permissions: [properties.request || properties.permission || properties]
      });
      return;
    }

    if (type === "session.diff" && Array.isArray(properties.diff)) {
      emitAgentEvent(sender, requestId, { type: "diff", sessionID, diff: properties.diff });
      return;
    }

    if (type === "file.watcher.updated") {
      emitAgentEvent(sender, requestId, {
        type: "files",
        sessionID,
        file: properties.file,
        event: properties.event || "change"
      });
      return;
    }

    if (type.startsWith("message.part.") && properties.part && properties.part.type !== "text") {
      const summary = summarizeOpenCodePart(properties.part);
      if (summary) {
        toolsByPart.set(summary.id, summary);
        emitAgentEvent(sender, requestId, { type: "tools", sessionID, tools: Array.from(toolsByPart.values()) });
      }
      return;
    }

    if (type === "session.status" && properties.status?.type) {
      emitAgentEvent(sender, requestId, {
        type: "status",
        status: properties.status.type,
        message: properties.status.type === "busy" ? "Code is working..." : "Code is idle."
      });
    }
  };

  while (!controller.signal.aborted) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split(/\n\n/);
    buffer = chunks.pop() || "";
    chunks.forEach(handleEvent);
  }
}

function stopOpenCodeEventStream(streamID) {
  const stream = openCodeEventStreams.get(streamID);
  if (!stream) return false;
  stream.controller.abort();
  openCodeEventStreams.delete(streamID);
  return true;
}

function startOpenCodeEventStream(sender, payload = {}) {
  const streamID = payload.streamID || `stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  stopOpenCodeEventStream(streamID);
  const controller = new AbortController();
  const projectPath = payload.projectPath || rootDir;
  const sessionID = payload.sessionID || "";
  const requestId = payload.requestId || streamID;
  openCodeEventStreams.set(streamID, { controller, sessionID, projectPath });
  streamOpenCodeEvents(sender, requestId, sessionID, projectPath, controller)
    .catch((error) => {
      if (!controller.signal.aborted) {
        emitAgentEvent(sender, requestId, { type: "error", message: error.message || String(error) });
      }
    })
    .finally(() => {
      if (openCodeEventStreams.get(streamID)?.controller === controller) openCodeEventStreams.delete(streamID);
    });
  return { streamID, subscriptionID: streamID, id: streamID, requestId, sessionID: sessionID || undefined };
}

async function listOpenCodeCommands(projectPath) {
  try {
    const data = await openCodeFetch(`/api/command?${openCodeQuery(projectPath)}`);
    return openCodeArray(data);
  } catch {
    const data = await openCodeFetch(`/command?${openCodeQuery(projectPath)}`);
    return openCodeArray(data);
  }
}

async function readOpenCodeProviderState(projectPath) {
  try {
    const data = await openCodeFetch(`/provider?${openCodeDirectoryQuery(projectPath)}`);
    return data?.data || data || { all: [], default: {}, connected: [] };
  } catch {
    try {
      const data = await openCodeFetch(`/api/provider?${openCodeDirectoryQuery(projectPath)}`);
      const providers = data?.data || data || [];
      return {
        all: Array.isArray(providers) ? providers : [],
        default: {},
        connected: Array.isArray(providers) ? providers.filter((item) => item.auth || item.connected).map((item) => item.id) : []
      };
    } catch {
      return { all: [], default: {}, connected: [] };
    }
  }
}

async function readOpenCodeProviderAuth(projectPath) {
  try {
    const data = await openCodeFetch(`/provider/auth?${openCodeDirectoryQuery(projectPath)}`);
    return data?.data || data || {};
  } catch {
    return {};
  }
}

async function authorizeOpenCodeProvider(providerID, method, inputs, projectPath) {
  return openCodeFetch(
    `/provider/${encodeURIComponent(providerID)}/oauth/authorize?${openCodeDirectoryQuery(projectPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: Number(method || 0), inputs: inputs || {} })
    }
  );
}

async function callbackOpenCodeProvider(providerID, method, code, projectPath) {
  return openCodeFetch(
    `/provider/${encodeURIComponent(providerID)}/oauth/callback?${openCodeDirectoryQuery(projectPath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: Number(method || 0), code: code || undefined })
    }
  );
}

async function saveOpenCodeProviderApiKey(providerID, key, projectPath) {
  await openCodeFetch(`/auth/${encodeURIComponent(providerID)}?${openCodeDirectoryQuery(projectPath)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "api", key })
  });
  return true;
}

async function readOpenCodePermissions(sessionID, projectPath) {
  const query = openCodeQuery(projectPath);
  if (!sessionID) {
    try {
      return openCodeArray(await openCodeFetch(`/permission?${query}`));
    } catch {
      try {
        return openCodeArray(await openCodeFetch(`/api/permission/request?${query}`));
      } catch {
        return [];
      }
    }
  }
  try {
    const data = await openCodeFetch(`/permission?${query}`);
    const all = openCodeArray(data);
    return all.filter((item) => !item.sessionID || item.sessionID === sessionID);
  } catch {
    try {
      const data = await openCodeFetch(`/api/session/${encodeURIComponent(sessionID)}/permission?${query}`);
      return openCodeArray(data);
    } catch {
      return [];
    }
  }
}

async function replyOpenCodePermission(sessionID, requestID, reply, projectPath, message) {
  if (!requestID) return false;
  const body = { reply, message: message || undefined };
  try {
    await openCodeFetch(
      `/permission/${encodeURIComponent(requestID)}/reply?${openCodeQuery(projectPath)}`,
      openCodeJsonOptions("POST", body)
    );
    return true;
  } catch {
    if (!sessionID) throw new Error("Permission reply fallback requires a session id.");
    await openCodeFetch(
      `/api/session/${encodeURIComponent(sessionID)}/permission/${encodeURIComponent(requestID)}/reply?${openCodeQuery(projectPath)}`,
      openCodeJsonOptions("POST", body)
    );
    return true;
  }
}

async function readOpenCodeDiff(sessionID, projectPath, messageID) {
  if (!sessionID) return [];
  const suffix = openCodeQuery(projectPath, { messageID });
  try {
    const data = await openCodeFetch(`/session/${encodeURIComponent(sessionID)}/diff?${suffix}`);
    return openCodeArray(data);
  } catch {
    return [];
  }
}

async function readOpenCodeTodo(sessionID, projectPath) {
  if (!sessionID) return [];
  const data = await openCodeFetch(`/session/${encodeURIComponent(sessionID)}/todo?${openCodeQuery(projectPath)}`);
  return openCodeArray(data);
}

async function abortOpenCodeSession(sessionID, projectPath) {
  if (!sessionID) return false;
  await openCodeFetch(`/session/${encodeURIComponent(sessionID)}/abort?${openCodeQuery(projectPath)}`, { method: "POST" });
  return true;
}

async function revertOpenCodeSession(sessionID, projectPath, payload = {}) {
  if (!sessionID || !payload.messageID) return null;
  const data = await openCodeFetch(
    `/session/${encodeURIComponent(sessionID)}/revert?${openCodeQuery(projectPath)}`,
    openCodeJsonOptions("POST", { messageID: payload.messageID, partID: payload.partID || undefined })
  );
  return unwrapOpenCodeData(data);
}

async function unrevertOpenCodeSession(sessionID, projectPath) {
  if (!sessionID) return null;
  const data = await openCodeFetch(`/session/${encodeURIComponent(sessionID)}/unrevert?${openCodeQuery(projectPath)}`, {
    method: "POST"
  });
  return unwrapOpenCodeData(data);
}

function openCodePromptPayload(payload = {}, modelSpec) {
  const text = payload.prompt ?? payload.text ?? payload.message ?? "";
  return {
    messageID: payload.messageID || undefined,
    agent: payload.agent || "build",
    model: payload.modelRef || openCodeModelRef(modelSpec || normalizeAgentModel(payload.model || "")) || undefined,
    noReply: payload.noReply || undefined,
    system: payload.system || undefined,
    variant: payload.variant || undefined,
    parts: Array.isArray(payload.parts) && payload.parts.length ? payload.parts : [{ type: "text", text: String(text) }]
  };
}

function openCodeProtocolPromptPayload(payload = {}) {
  const parts = Array.isArray(payload.parts) ? payload.parts : [];
  const text =
    payload.promptText ||
    payload.prompt ||
    payload.text ||
    parts
      .filter((part) => part?.type === "text")
      .map((part) => part.text || "")
      .join("\n");
  const files = parts
    .filter((part) => part?.type === "file")
    .map((part) => ({
      uri: part.url,
      mime: part.mime,
      name: part.filename,
      description: part.description,
      source: part.source
    }));
  const agents = parts
    .filter((part) => part?.type === "agent")
    .map((part) => ({
      name: part.name,
      source: part.source
    }));
  return {
    id: payload.messageID || undefined,
    prompt: {
      text: String(text || ""),
      files: files.length ? files : undefined,
      agents: agents.length ? agents : undefined
    },
    delivery: payload.delivery || undefined,
    resume: payload.resume
  };
}

async function sendOpenCodePrompt(sessionID, projectPath, payload = {}) {
  if (!sessionID) throw new Error("No active Code session.");
  const modelSpec = payload.model ? normalizeAgentModel(payload.model) : null;
  const body = openCodePromptPayload(payload, modelSpec);
  const route = payload.async === false ? "message" : "prompt_async";
  const id = encodeURIComponent(sessionID);
  const data = await openCodeFetchFirst([
    { route: `/session/${id}/${route}?${openCodeQuery(projectPath)}`, options: openCodeJsonOptions("POST", body) },
    {
      route: `/api/session/${id}/prompt?${openCodeQuery(projectPath)}`,
      options: openCodeJsonOptions("POST", openCodeProtocolPromptPayload(payload))
    }
  ]);
  const admitted = unwrapOpenCodeData(data) || data || {};
  const admittedObject = typeof admitted === "object" && admitted ? admitted : {};
  return {
    exitCode: 0,
    stdout: "",
    stderr: "",
    command: `code prompt ${sessionID}`,
    sessionID,
    messageID: admittedObject.messageID || admittedObject.id || body.messageID,
    providerID: modelSpec?.providerID,
    modelID: modelSpec?.modelID,
    admitted: true
  };
}

async function runOpenCodeCommand(sessionID, projectPath, payload = {}) {
  if (!sessionID) throw new Error("No active Code session.");
  const command = String(payload.command || "").replace(/^\//, "");
  const body = {
    messageID: payload.messageID || undefined,
    agent: payload.agent || "build",
    model: payload.model || undefined,
    command,
    arguments: payload.arguments || payload.args || "",
    variant: payload.variant || undefined,
    parts: Array.isArray(payload.parts) ? payload.parts : undefined
  };
  const data = await openCodeFetch(
    `/session/${encodeURIComponent(sessionID)}/command?${openCodeQuery(projectPath)}`,
    openCodeJsonOptions("POST", body)
  );
  return unwrapOpenCodeData(data);
}

async function runOpenCodeShell(sessionID, projectPath, payload = {}) {
  if (!sessionID) throw new Error("No active Code session.");
  const modelSpec = payload.model ? normalizeAgentModel(payload.model) : null;
  const data = await openCodeFetch(
    `/session/${encodeURIComponent(sessionID)}/shell?${openCodeQuery(projectPath)}`,
    openCodeJsonOptions("POST", {
      messageID: payload.messageID || undefined,
      agent: payload.agent || "build",
      model: openCodeModelRef(modelSpec) || payload.modelRef || undefined,
      command: String(payload.command || payload.shell || "")
    })
  );
  return unwrapOpenCodeData(data);
}

async function writeJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function defaultProgressEntry(status = "ready") {
  return {
    completed: status === "mastered",
    completedAt: status === "mastered" ? new Date().toISOString() : undefined,
    status,
    runAttempts: 0,
    checkAttempts: 0,
    hintCount: 0,
    masteryScore: status === "mastered" ? 100 : 0,
    timeSpentSeconds: 0
  };
}

function migrateProgressEntry(entry) {
  if (!entry || typeof entry !== "object") return defaultProgressEntry("ready");
  const status = entry.status || (entry.completed ? "mastered" : "ready");
  return {
    ...defaultProgressEntry(status),
    ...entry,
    completed: Boolean(entry.completed || status === "mastered" || status === "passed_check"),
    completedAt: entry.completedAt || (entry.completed || status === "mastered" ? new Date().toISOString() : undefined),
    status: status === "passed_check" ? "mastered" : status,
    runAttempts: Number(entry.runAttempts || 0),
    checkAttempts: Number(entry.checkAttempts || 0),
    hintCount: Number(entry.hintCount || 0),
    masteryScore: Number(entry.masteryScore ?? (entry.completed ? 100 : 0)),
    timeSpentSeconds: Number(entry.timeSpentSeconds || 0)
  };
}

function migrateProgressMap(progress = {}) {
  return Object.fromEntries(
    Object.entries(progress || {}).map(([lessonId, entry]) => [lessonId, migrateProgressEntry(entry)])
  );
}

async function loadProgress() {
  return migrateProgressMap(await readJson(progressStorePath(), {}));
}

async function saveProgress(progress) {
  await writeJson(progressStorePath(), migrateProgressMap(progress));
  return true;
}

function compactOutput(value = "") {
  return String(value || "").trim().slice(-3000);
}

function learningStatusReducer(event, currentState = {}) {
  const now = new Date().toISOString();
  const state = migrateProgressEntry(currentState);
  const output = compactOutput(event.output || event.error || "");
  const durationSeconds = Number(event.durationSeconds || 0);
  const next = {
    ...state,
    timeSpentSeconds: state.timeSpentSeconds + Math.max(0, durationSeconds)
  };
  if (event.verb === "created" || event.verb === "opened") {
    if (!["mastered", "skipped", "failed_check", "needs_review", "ran", "in_progress"].includes(next.status)) {
      next.status = "ready";
    }
  }
  if (event.verb === "ran") {
    next.status = event.success === false ? "blocked" : "ran";
    next.runAttempts += 1;
    next.lastRunAt = now;
    next.lastOutput = output;
    next.lastError = event.success === false ? output : "";
    next.masteryScore = Math.max(next.masteryScore, event.success === false ? 10 : 25);
  }
  if (event.verb === "checked") {
    next.checkAttempts += 1;
    next.lastCheckAt = now;
    next.lastOutput = output;
    if (event.success) {
      next.status = "mastered";
      next.completed = true;
      next.completedAt = now;
      next.lastError = "";
      next.masteryScore = 100;
    } else {
      next.completed = false;
      next.status = next.checkAttempts >= 3 ? "needs_review" : "failed_check";
      next.lastError = output || "Checkpoint failed.";
      next.masteryScore = Math.min(70, Math.max(next.masteryScore, 35 + next.checkAttempts * 10));
    }
  }
  if (event.verb === "hinted") {
    next.hintCount += 1;
    if (next.status === "ready") next.status = "in_progress";
  }
  if (event.verb === "skipped") {
    next.status = "skipped";
    next.completed = false;
    next.masteryScore = Math.min(next.masteryScore, 40);
    next.lastCheckAt = now;
  }
  return next;
}

async function recordLearningEvent(event = {}) {
  const progress = await loadProgress();
  if (event.lessonId) {
    progress[event.lessonId] = learningStatusReducer(event, progress[event.lessonId]);
  }
  const events = await readJson(progressEventsPath(), []);
  events.push({
    id: `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`,
    timestamp: new Date().toISOString(),
    verb: event.verb,
    lessonId: event.lessonId,
    roadmapId: event.roadmapId,
    result: {
      success: event.success,
      completion: event.verb === "checked" ? Boolean(event.success) : undefined,
      response: compactOutput(event.output || event.error || ""),
      duration: event.durationSeconds || 0
    },
    context: event.context || {}
  });
  await writeJson(progressEventsPath(), events.slice(-500));
  await saveProgress(progress);
  return progress;
}

async function getRoadmaps() {
  const roadmaps = await readJson(roadmapStorePath(), []);
  return Array.isArray(roadmaps)
    ? roadmaps.filter(
        (roadmap) =>
          roadmap &&
          typeof roadmap.id === "string" &&
          typeof roadmap.topic === "string" &&
          Array.isArray(roadmap.modules) &&
          Array.isArray(roadmap.createdLessonIds)
      )
    : [];
}

async function saveRoadmaps(roadmaps) {
  await writeJson(roadmapStorePath(), roadmaps);
}

async function removeRoadmapData(roadmapId) {
  const roadmaps = await getRoadmaps();
  const roadmap = roadmaps.find((item) => item.id === roadmapId);
  if (!roadmap) return { ok: false, removedLessonIds: [] };
  const removedLessonIds = Array.from(new Set(roadmap.createdLessonIds || []));
  await saveRoadmaps(roadmaps.filter((item) => item.id !== roadmapId));
  await Promise.all(
    removedLessonIds.flatMap((lessonId) => [
      fsp.rm(path.join(generatedLessonsDir(), lessonId), { recursive: true, force: true }),
      fsp.rm(userDataPath("lesson-workspaces", lessonId), { recursive: true, force: true })
    ])
  );
  const progress = await loadProgress();
  for (const lessonId of removedLessonIds) delete progress[lessonId];
  await saveProgress(progress);
  const events = await readJson(progressEventsPath(), []);
  if (Array.isArray(events)) {
    await writeJson(
      progressEventsPath(),
      events.filter((event) => event?.roadmapId !== roadmapId && !removedLessonIds.includes(event?.lessonId))
    );
  }
  return { ok: true, removedLessonIds };
}

function lessonIdFor(roadmapId, index) {
  return `${roadmapId}-part-${String(index + 1).padStart(2, "0")}`;
}

function languageProfile(language) {
  const normalized = String(language || "").toLowerCase();
  if (normalized.includes("python")) {
    return {
      label: "Python",
      entryFile: "main.py",
      testFile: "test_part.py",
      checkpointCommand: "python3 test_part.py",
      starterCode(topic, moduleTitle, index) {
        return [
          `TOPIC = ${JSON.stringify(topic)}`,
          "",
          "def answer():",
          `    # Part ${index + 1}: ${moduleTitle}`,
          "    return \"starter value\"",
          "",
          "if __name__ == \"__main__\":",
          "    print(answer())",
          ""
        ].join("\n");
      },
      testCode(_topic, moduleTitle) {
        return [
          "from main import answer",
          "",
          "value = answer()",
          "if not isinstance(value, str) or value.strip() in {\"\", \"starter value\"}:",
          `    raise SystemExit(${JSON.stringify(`Return a real answer for: ${moduleTitle}`)})`,
          "print(\"PASS\")",
          ""
        ].join("\n");
      }
    };
  }
  if (normalized.includes("web") || normalized.includes("html")) {
    return {
      label: "Web: HTML, CSS, JavaScript",
      entryFile: "index.html",
      testFile: "check.js",
      checkpointCommand: "node check.js",
      starterFiles(topic, moduleTitle, index) {
        return {
          "index.html": [
            "<!doctype html>",
            "<html lang=\"en\">",
            "  <head>",
            "    <meta charset=\"UTF-8\" />",
            "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
            `    <title>${moduleTitle}</title>`,
            "    <link rel=\"stylesheet\" href=\"style.css\" />",
            "  </head>",
            "  <body>",
            "    <main>",
            `      <p class=\"eyebrow\">${topic}</p>`,
            `      <h1>${moduleTitle}</h1>`,
            "      <p id=\"result\">Replace this text with your solution.</p>",
            "      <button id=\"runButton\">Run</button>",
            "    </main>",
            "    <script src=\"script.js\"></script>",
            "  </body>",
            "</html>",
            ""
          ].join("\n"),
          "style.css": [
            "body {",
            "  min-height: 100vh;",
            "  margin: 0;",
            "  display: grid;",
            "  place-items: center;",
            "  background: #172026;",
            "  color: #f7f1df;",
            "  font-family: Avenir Next, Segoe UI, sans-serif;",
            "}",
            "",
            "main {",
            "  width: min(460px, calc(100vw - 32px));",
            "  padding: 32px;",
            "  border: 1px solid rgba(255, 255, 255, 0.18);",
            "  border-radius: 8px;",
            "  background: #222d33;",
            "}",
            "",
            ".eyebrow { color: #65d1c3; font-weight: 700; }",
            "button { padding: 10px 14px; border: 0; border-radius: 6px; background: #f1c84b; }",
            ""
          ].join("\n"),
          "script.js": [
            "const result = document.querySelector(\"#result\");",
            "const button = document.querySelector(\"#runButton\");",
            "",
            "button.addEventListener(\"click\", () => {",
            `  result.textContent = ${JSON.stringify(`Part ${index + 1} complete`) };`,
            "});",
            ""
          ].join("\n"),
          "check.js": [
            "const fs = require(\"fs\");",
            "const script = fs.readFileSync(\"script.js\", \"utf8\");",
            "if (script.includes(\"addEventListener\") && !script.includes(\"Replace this text\")) {",
            "  console.log(\"PASS\");",
            "} else {",
            "  console.log(\"Use JavaScript to update the result when the button is clicked.\");",
            "  process.exit(1);",
            "}",
            ""
          ].join("\n")
        };
      }
    };
  }
  if (normalized.includes("javascript") || normalized.includes("node") || /\bjs\b/.test(normalized)) {
    return {
      label: "JavaScript",
      entryFile: "main.js",
      testFile: "check.js",
      checkpointCommand: "node check.js"
    };
  }
  if (normalized.includes("sql") || normalized.includes("database")) {
    return {
      label: "SQL",
      entryFile: "queries.sql",
      testFile: "check.js",
      checkpointCommand: "node check.js"
    };
  }
  return {
    label: `${titleCase(language || "Programming")} guided course`,
    entryFile: "practice.txt",
    testFile: "check.js",
    checkpointCommand: "node check.js",
    genericTextCourse: true,
    starterCode(topic, moduleTitle, index) {
      return [
        `const topic = ${JSON.stringify(topic)};`,
        "",
        "function answer() {",
        `  // Part ${index + 1}: ${moduleTitle}`,
        "  return \"starter value\";",
        "}",
        "",
        "console.log(answer());",
        "",
        "module.exports = { answer };",
        ""
      ].join("\n");
    },
    testCode(_topic, moduleTitle) {
      return [
        "const { answer } = require(\"./main\");",
        "const value = answer();",
        "if (typeof value !== \"string\" || !value.trim() || value === \"starter value\") {",
        `  console.log(${JSON.stringify(`Return a real answer for: ${moduleTitle}`)});`,
        "  process.exit(1);",
        "}",
        "console.log(\"PASS\");",
        ""
      ].join("\n");
    }
  };
}

function buildModules(answers) {
  const topic = titleCase(answers.topic || "Coding");
  const level = answers.level || "beginner";
  const outcome = answers.outcome || "build a practical mini project";
  const pace = answers.pace || "steady";
  const count = pace === "deep" ? 6 : pace === "fast" ? 4 : 5;
  const base = [
    `Create a runnable ${topic} launchpad`,
    `Model the inputs and outputs for ${topic}`,
    `Implement the first ${topic} feature`,
    `Debug a realistic ${topic} failure`,
    `Build a mini project for ${outcome}`,
    `Refactor and explain the finished project`
  ];
  return base.slice(0, count).map((title, index) => ({
    index,
    title,
    goal:
      index === 0
        ? `Learn the beginner mental model for ${topic}.`
        : `Apply ${topic} through a small coding task.`,
    level,
    outcome
  }));
}

function stripJsonFence(content) {
  return String(content || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
}

function parseJsonObject(content) {
  const stripped = stripJsonFence(content);
  try {
    return JSON.parse(stripped);
  } catch {
    const first = stripped.indexOf("{");
    const last = stripped.lastIndexOf("}");
    if (first >= 0 && last > first) {
      return JSON.parse(stripped.slice(first, last + 1));
    }
    throw new Error("Response did not contain valid JSON.");
  }
}

const interviewFieldOrder = ["goal", "experience", "stack", "outcome", "depth", "learningStyle", "constraints"];

const interviewFieldPrompts = {
  goal: {
    question: "What do you want to learn or become capable of doing?",
    helper: "Name the skill, domain, or capability you want.",
    suggestions: ["Learn Python", "Learn JavaScript", "Build web pages"]
  },
  experience: {
    question: "What experience do you already have in this area?",
    helper: "Mention what you have built, studied, or struggled with.",
    suggestions: ["Complete beginner", "Know basic syntax", "Built small projects"]
  },
  stack: {
    question: "Which language, framework, or technology stack do you want to use?",
    helper: "This decides starter files, run commands, and checkpoints.",
    suggestions: ["React + JavaScript", "Python", "HTML CSS JavaScript"]
  },
  outcome: {
    question: "What personal result would make this learning feel successful?",
    helper: "For beginners, this can simply be confidence with fundamentals and small exercises.",
    suggestions: ["Understand the fundamentals", "Build small practice exercises", "Create a simple personal project"]
  },
  depth: {
    question: "How much time can you invest and how deeply do you want to learn this topic?",
    helper: "Say fast, steady, deep, or give a rough weekly time.",
    suggestions: ["Fast 1 week", "Steady 2-3 weeks", "Deep 1 month"]
  },
  learningStyle: {
    question: "Do you prefer project-based, theory-first, guided practice, or challenge-based learning?",
    helper: "This shapes how each lesson explains and tests the skill.",
    suggestions: ["Project-based", "Guided practice", "Challenge-based"]
  },
  constraints: {
    question: "Is there anything I should consider while shaping your learning path?",
    helper: "Mention time, pace, device setup, school needs, personal goals, or anything you want to avoid.",
    suggestions: ["Personal development", "Slow and beginner friendly", "Practice-first path"]
  }
};

const agentPrompts = {
  interviewAgent: [
    "You are InterviewAgent for a personal coding learning IDE.",
    "Goal: Ask exactly one question at a time to prepare a beginner-friendly learning roadmap.",
    "Required field order: goal, experience, stack, outcome, depth, learningStyle, constraints.",
    "Behavior rules:",
    "- Ask only the next missing field.",
    "- Never skip a required field.",
    "- Never ask a later field before earlier fields are answered.",
    "- If the learner is beginner, new, from zero, no experience, or wants to learn completely, keep the question beginner-friendly.",
    "- Do not suggest jobs, interviews, REST APIs, apps, freelancing, portfolio, automation, or advanced projects unless the learner explicitly asks.",
    "- If the learner wants to learn a language, keep the flow focused on language fundamentals.",
    "- Use simple language.",
    "- Return JSON only.",
    "Output JSON: {complete:false,nextField:'',question:'',helper:'',suggestions:[]}."
  ].join("\n"),
  beginnerSafetyValidator: [
    "You are BeginnerSafetyValidator.",
    "Validate whether the next interview question is safe and appropriate for a beginner coding learner.",
    "Reject if it pushes projects too early, mentions REST APIs before fundamentals, mentions apps, automation, jobs, interviews, freelancing, or portfolio without user request, assumes variables/conditions/loops/functions/files, or confuses language learning with software building.",
    "Good beginner suggestions: Learn complete fundamentals, Practice each core topic, Beginner-to-intermediate path, Slow guided lessons, Examples first, exercises after, Learn by writing small programs.",
    "Return JSON only: {accepted:true,issues:[],correctedQuestion:{nextField:'',question:'',helper:'',suggestions:[]}}."
  ].join("\n"),
  trackMatcher: [
    "You are TrackMatcher for a personal coding learning IDE.",
    "Supported tracks: Python, JavaScript, HTML, CSS, SQL, MySQL, PHP, Java, C, C++, C#, R, Kotlin, TypeScript, Node.js, React, Angular, Vue, Django, PostgreSQL, MongoDB, NumPy, SciPy, Pandas, Bash, Git, Swift, Go, DSA.",
    "If the learner asks for a base language, choose the base language first.",
    "For beginner language learning, do not choose a framework first.",
    "Do not invent unsupported tracks.",
    "Return JSON only: {matched:true,track:'',confidence:0,reason:'',alternatives:[]}."
  ].join("\n"),
  roadmapGenerator: [
    "You are RoadmapGenerator for a personal coding learning IDE.",
    "Goal: Generate a prerequisite-aware, beginner-friendly, zero-to-intermediate roadmap.",
    "Use W3Schools-style tutorial order as the reference structure.",
    "Do not copy W3Schools text, examples, wording, or exercises.",
    "Generate original lesson tasks.",
    "If the learner is beginner, start from absolute zero.",
    "Every module must build on previous modules.",
    "No vague modules. No repeated same exercise. No advanced projects before prerequisites.",
    "No REST APIs, apps, frameworks, portfolio, job prep, or interview prep unless explicitly requested.",
    "Beginner language order: setup/running code, syntax/output, comments, variables, data types, operators, strings, conditions, loops, collections/arrays, functions, objects/classes where relevant, errors/debugging, files/DOM/database topics where relevant, review, capstone.",
    "Each module must include title, objective, task, artifact, validation, estimatedMinutes, skillsIntroduced, prerequisites, difficulty, required.",
    "Return JSON only using shape: {topic, prerequisites, milestones:[{milestone, modules:[{title, objective, task, artifact, validation, estimatedHours, estimatedMinutes, skillsIntroduced, prerequisites, difficulty, required}], checkpoint, miniProject}]}."
  ].join("\n"),
  roadmapCritic: [
    "You are RoadmapCritic.",
    "Reject roadmaps that start too advanced, use vague titles, repeat the same exercise, start functions before variables/conditions/loops, suggest projects too early, mismatch selected track, skip prerequisites, lack validation/checkpoints, lack real artifacts, or include job/interview/portfolio/freelancing content without explicit request.",
    "Return JSON only: {accepted:false,score:0,issues:[{issue:'',severity:'low|medium|high',fix:''}],correctedRoadmap:{}}."
  ].join("\n"),
  lessonGenerator: [
    "You are LessonGenerator for a personal coding learning IDE.",
    "Generate beginner-friendly files for one coding lesson folder.",
    "No bare TODO-only starter files. Starter file must be meaningful and partially complete. Solution file must fully solve the task. Check file must test the actual required artifact.",
    "README explains purpose only. GUIDE teaches the concept without giving away the full solution. TASK gives exact instructions. CHECKPOINT explains validation.",
    "Code must be runnable locally. File names must match selected track.",
    "Return JSON only with folderName and files."
  ].join("\n"),
  lessonCritic: [
    "You are LessonCritic.",
    "Reject if starter is empty/TODO-only, solution does not solve the task, check does not test the artifact, content mismatches module, guide reveals full solution, code is too advanced, file names mismatch track, or validation cannot run locally.",
    "Return JSON only: {accepted:false,issues:[{issue:'',severity:'low|medium|high',fix:''}],correctedLesson:{}}."
  ].join("\n"),
  statusEngine: [
    "You are StatusEngine for a personal coding learning IDE.",
    "Statuses: locked, ready, in_progress, ran, failed_check, passed_check, skipped, needs_review, mastered, blocked.",
    "New lessons start locked. First available lesson becomes ready. Opening marks ready. Editing marks in_progress. Running marks ran. Failed check marks failed_check. Multiple failed checks marks needs_review. Passed check marks mastered. Skipping marks skipped and unlocks next but does not count as mastery. Completion requires all required lessons mastered.",
    "Return JSON only: {event:'',previousStatus:'',nextStatus:'',userMessage:'',nextAction:''}."
  ].join("\n"),
  orchestrator: [
    "You are LearningIDEOrchestrator.",
    "Pipeline: InterviewAgent, BeginnerSafetyValidator, TrackMatcher, RoadmapGenerator, RoadmapCritic, LessonGenerator, LessonCritic, StatusEngine.",
    "Global rules: Personal development first. Beginner learners receive zero-to-intermediate fundamentals first. Use W3Schools-style tutorial order only as curriculum reference. Do not copy W3Schools content. Do not jump to projects too early. Do not suggest REST APIs, apps, frameworks, jobs, interviews, freelancing, or portfolio unless explicitly requested. Ask one interview question at a time. Every roadmap module has a real task, artifact, and validation. Every lesson has README, GUIDE, TASK, CHECKPOINT, starter, solution, and runnable check. Validate before saving. If validation fails, correct automatically.",
    "Failure cases to guard against: beginner language roadmap starts with API/app/project; interview asks project too early; vague modules; empty starter; checkpoint only checks file existence; solution revealed in README; JS learner gets React before JS fundamentals; Python learner gets Django before Python; repeated same task; skipped lessons counted completed; unsupported track invented; missing prerequisites; non-runnable validation; no clear artifact; interview jumps to advanced outcome.",
    "Return the result for the current pipeline step only."
  ].join("\n")
};

const w3schoolsTrackRegistry = [
  {
    id: "python",
    label: "Python",
    aliases: ["python", "python 3", "py"],
    sourceUrl: "https://www.w3schools.com/python/",
    exerciseUrl: "https://www.w3schools.com/python/python_exercises.asp",
    profileLanguage: "Python",
    topicKinds: ["print", "variables", "strings_numbers", "input", "conditions", "loops", "lists", "dictionaries", "sets_tuples", "functions", "errors", "files", "classes", "capstone"]
  },
  {
    id: "javascript",
    label: "JavaScript",
    aliases: ["javascript", "js", "plain javascript", "ecmascript"],
    sourceUrl: "https://www.w3schools.com/js/",
    exerciseUrl: "https://www.w3schools.com/js/js_exercises.asp",
    profileLanguage: "JavaScript",
    topicKinds: ["console", "comments", "variables", "operators_types", "strings_numbers", "conditions", "string_methods", "arrays_loops", "array_methods", "functions", "objects", "classes", "dom_events_model", "async_practice", "debugging", "capstone"]
  },
  {
    id: "html",
    label: "HTML",
    aliases: ["html", "html5"],
    sourceUrl: "https://www.w3schools.com/html/",
    exerciseUrl: "https://www.w3schools.com/html/html_exercises.asp",
    profileLanguage: "Web",
    topicKinds: ["html_structure", "html_sections", "web_tables_forms", "web_media", "web_accessibility", "web_capstone"]
  },
  {
    id: "css",
    label: "CSS",
    aliases: ["css", "css3"],
    sourceUrl: "https://www.w3schools.com/css/",
    exerciseUrl: "https://www.w3schools.com/css/css_exercises.asp",
    profileLanguage: "Web",
    topicKinds: ["html_structure", "css_selectors", "box_model", "flexbox", "css_grid", "responsive", "css_transitions", "web_capstone"]
  },
  {
    id: "web",
    label: "HTML, CSS, JavaScript",
    aliases: ["web", "web development", "frontend", "front end", "html css javascript", "website"],
    sourceUrl: "https://www.w3schools.com/where_to_start.asp",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "Web",
    topicKinds: ["html_structure", "html_sections", "css_selectors", "box_model", "flexbox", "responsive", "dom_text", "form_input", "web_debugging", "web_capstone"]
  },
  {
    id: "sql",
    label: "SQL",
    aliases: ["sql", "database", "databases"],
    sourceUrl: "https://www.w3schools.com/sql/",
    exerciseUrl: "https://www.w3schools.com/sql/sql_exercises.asp",
    profileLanguage: "SQL",
    topicKinds: ["sql_select", "sql_where_order", "sql_insert_update", "sql_aggregate", "sql_join", "sql_capstone"]
  },
  {
    id: "mysql",
    label: "MySQL",
    aliases: ["mysql"],
    sourceUrl: "https://www.w3schools.com/mysql/",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "SQL",
    topicKinds: ["sql_select", "sql_where_order", "sql_insert_update", "sql_aggregate", "sql_join", "sql_capstone"]
  },
  {
    id: "postgresql",
    label: "PostgreSQL",
    aliases: ["postgres", "postgresql"],
    sourceUrl: "https://www.w3schools.com/postgresql/",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "SQL",
    topicKinds: ["sql_select", "sql_where_order", "sql_insert_update", "sql_aggregate", "sql_join", "sql_capstone"]
  },
  {
    id: "dsa",
    label: "DSA",
    aliases: ["dsa", "data structures", "algorithms", "data structures and algorithms"],
    sourceUrl: "https://www.w3schools.com/dsa/",
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: "JavaScript",
    topicKinds: ["dsa_trace_array", "dsa_linear_search", "dsa_frequency", "dsa_two_pointers", "dsa_stack", "dsa_complexity", "dsa_debugging", "dsa_capstone"]
  },
  ...[
    ["typescript", "TypeScript", "https://www.w3schools.com/typescript/", ["typescript", "ts"]],
    ["nodejs", "Node.js", "https://www.w3schools.com/nodejs/", ["node", "node.js", "nodejs"]],
    ["react", "React", "https://www.w3schools.com/react/", ["react", "reactjs", "react.js"]],
    ["angular", "Angular", "https://www.w3schools.com/angular/", ["angular", "angularjs"]],
    ["vue", "Vue", "https://www.w3schools.com/vue/", ["vue", "vuejs", "vue.js"]],
    ["django", "Django", "https://www.w3schools.com/django/", ["django"]],
    ["php", "PHP", "https://www.w3schools.com/php/", ["php"]],
    ["java", "Java", "https://www.w3schools.com/java/", ["java"]],
    ["c", "C", "https://www.w3schools.com/c/", ["c language", "c programming"]],
    ["cpp", "C++", "https://www.w3schools.com/cpp/", ["c++", "cpp"]],
    ["csharp", "C#", "https://www.w3schools.com/cs/", ["c#", "c sharp", "csharp"]],
    ["r", "R", "https://www.w3schools.com/r/", ["r", "r programming"]],
    ["kotlin", "Kotlin", "https://www.w3schools.com/kotlin/", ["kotlin"]],
    ["rust", "Rust", "https://www.w3schools.com/rust/", ["rust"]],
    ["swift", "Swift", "https://www.w3schools.com/swift/", ["swift"]],
    ["go", "Go", "https://www.w3schools.com/go/", ["go", "golang"]],
    ["bash", "Bash", "https://www.w3schools.com/bash/", ["bash", "shell", "shell scripting"]],
    ["git", "Git", "https://www.w3schools.com/git/", ["git"]],
    ["json", "JSON", "https://www.w3schools.com/js/js_json_intro.asp", ["json"]],
    ["xml", "XML", "https://www.w3schools.com/xml/", ["xml"]],
    ["mongodb", "MongoDB", "https://www.w3schools.com/mongodb/", ["mongodb", "mongo"]],
    ["numpy", "NumPy", "https://www.w3schools.com/python/numpy/", ["numpy"]],
    ["pandas", "Pandas", "https://www.w3schools.com/python/pandas/", ["pandas"]],
    ["scipy", "SciPy", "https://www.w3schools.com/python/scipy/", ["scipy"]],
    ["data_science", "Data Science", "https://www.w3schools.com/datascience/", ["data science"]]
  ].map(([id, label, sourceUrl, aliases]) => ({
    id,
    label,
    aliases,
    sourceUrl,
    exerciseUrl: "https://www.w3schools.com/exercises/",
    profileLanguage: label,
    topicKinds: ["console", "comments", "variables", "strings_numbers", "conditions", "arrays_loops", "functions", "objects", "debugging", "capstone"]
  }))
];

function w3TrackText(answers = {}) {
  return `${answers.goal || ""} ${answers.stack || ""} ${answers.language || ""} ${answers.outcome || ""}`.toLowerCase();
}

function matchW3SchoolsTrack(answers = {}) {
  const text = w3TrackText(answers);
  const normalizedStack = String(answers.stack || answers.language || "").toLowerCase().trim();
  if (normalizedStack === "c") return w3schoolsTrackRegistry.find((track) => track.id === "c") || null;
  if (/\b(learn|study|practice|use)\s+c\b|\bc\s+(programming|language)\b/.test(text)) {
    return w3schoolsTrackRegistry.find((track) => track.id === "c") || null;
  }
  const exact = w3schoolsTrackRegistry.find((track) =>
    track.aliases.some((alias) => normalizedStack === alias || normalizedStack === track.label.toLowerCase())
  );
  if (exact) return exact;
  return w3schoolsTrackRegistry.find((track) => track.aliases.some((alias) => {
    const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`(^|\\b)${escaped}(\\b|$)`, "i").test(text);
  })) || null;
}

function closestW3SchoolsTracks(answers = {}) {
  const text = w3TrackText(answers);
  const preferred = ["python", "javascript", "web", "sql", "java", "cpp"];
  const scored = w3schoolsTrackRegistry.map((track) => {
    let score = preferred.includes(track.id) ? 1 : 0;
    for (const alias of track.aliases) {
      if (text.includes(alias)) score += 5;
      for (const word of alias.split(/\W+/).filter(Boolean)) {
        if (word.length > 1 && text.includes(word)) score += 1;
      }
    }
    return { track, score };
  });
  return scored
    .sort((a, b) => b.score - a.score || preferred.indexOf(a.track.id) - preferred.indexOf(b.track.id))
    .map((item) => item.track)
    .slice(0, 4);
}

function learningTimePlan(depth = "") {
  const value = String(depth || "").toLowerCase();
  const hourMatch = value.match(/(\d+(?:\.\d+)?)\s*(hour|hr|h)/);
  const weekMatch = value.match(/(\d+)\s*(week|wk)/);
  const weeklyMinutes = hourMatch ? Math.round(Number(hourMatch[1]) * 60) : /fast|short|quick|1 week/.test(value) ? 180 : /deep|month|full|intermediate/.test(value) ? 420 : 240;
  const targetWeeks = weekMatch ? Number(weekMatch[1]) : /fast|short|quick|1 week/.test(value) ? 1 : /deep|month|full|intermediate/.test(value) ? 4 : /slow/.test(value) ? 5 : 3;
  const pace = /fast|short|quick|1 week/.test(value) ? "fast" : /deep|month|full|intermediate/.test(value) ? "deep" : /slow/.test(value) ? "slow" : "steady";
  const maxLessons = pace === "fast" ? 7 : pace === "deep" ? 18 : pace === "slow" ? 14 : 12;
  return {
    pace,
    weeklyMinutes,
    targetWeeks,
    maxLessons,
    minutesPerLesson: pace === "slow" ? 35 : pace === "deep" ? 55 : 45,
    depthLabel: pace === "deep" ? "beginner-to-intermediate" : pace === "fast" ? "compact fundamentals" : "beginner fundamentals"
  };
}

function canonicalInterviewField(field) {
  const normalized = String(field || "").trim();
  const aliases = {
    topic: "goal",
    level: "experience",
    language: "stack",
    pace: "depth",
    style: "learningStyle"
  };
  return aliases[normalized] || normalized;
}

function normalizeAnswerText(answer) {
  return String(answer || "").trim().replace(/\s+/g, " ");
}

function confidenceForAnswer(field, answer) {
  const value = normalizeAnswerText(answer).toLowerCase();
  if (!value || isVagueAnswer(field, value)) return 0.2;
  if (field === "experience" && /beginner|no experience|new|advanced|professional|years|built|project/.test(value)) return 0.9;
  if (field === "stack" && matchW3SchoolsTrack({ stack: value })) return 0.94;
  if (value.split(/\s+/).length >= 4) return 0.85;
  return 0.7;
}

function inferredIntentFromAnswers(answers) {
  const text = `${answers.goal || ""} ${answers.stack || ""} ${answers.outcome || ""} ${answers.constraints || ""}`.toLowerCase();
  const intents = [];
  const track = matchW3SchoolsTrack(answers);
  if (track) intents.push(`${track.label} W3Schools track`);
  if (/interview|leetcode|coding round/.test(text)) intents.push("Interview practice");
  else if (/dsa|algorithm/.test(text)) intents.push("DSA foundations");
  if (/beginner|new|no experience|start/.test(`${answers.experience || ""}`.toLowerCase())) intents.push("Beginner-safe path");
  return intents;
}

function isVagueAnswer(field, answer) {
  const value = normalizeAnswerText(answer).toLowerCase();
  if (!value) return true;
  const weak = new Set(["yes", "no", "ok", "okay", "idk", "don't know", "not sure", "anything", "something", "coding", "programming"]);
  if (weak.has(value)) return true;
  if (field === "stack" && matchW3SchoolsTrack({ stack: value })) return false;
  if (value.length < 3) return true;
  if (field === "goal" && value.split(/\s+/).length < 2) return true;
  if (field === "outcome" && value.split(/\s+/).length < 2) return true;
  return false;
}

function hasPythonIntent(answers) {
  return /python/.test(`${answers.goal || ""} ${answers.stack || ""}`.toLowerCase());
}

function hasJavaScriptIntent(answers) {
  return /\b(js|javascript|node)\b/.test(`${answers.goal || ""} ${answers.stack || ""}`.toLowerCase());
}

function hasBeginnerIntent(answers) {
  return /beginner|complete beginner|new|no experience|started|starting|need to learn|first.*learn|learn.*completely|from zero|from scratch|zero knowledge/.test(
    `${answers.goal || ""} ${answers.experience || ""} ${answers.stack || ""}`.toLowerCase()
  );
}

function isBeginnerLanguageCourse(answers) {
  const track = matchW3SchoolsTrack(answers);
  if (!track) return false;
  if (/react|angular|vue|nodejs|django|mongodb|numpy|pandas|scipy|data_science/.test(track.id)) return false;
  return hasBeginnerIntent(answers);
}

function shouldForceLocalInterviewPrompt(field, answers) {
  return isBeginnerLanguageCourse(answers) && ["outcome", "depth", "learningStyle", "constraints"].includes(field);
}

function adaptiveFieldPrompt(field, answers, isClarification = false) {
  const base = interviewFieldPrompts[field];
  const python = hasPythonIntent(answers);
  const javascript = hasJavaScriptIntent(answers);
  const beginner = hasBeginnerIntent(answers);
  const track = matchW3SchoolsTrack(answers);
  if (field === "stack" && python) {
    return {
      question: isClarification
        ? "Can you confirm the Python setup you want to learn with?"
        : "I heard Python in your goal. Should this roadmap use Python 3?",
      helper: "For beginners, Python 3 basics is the right starting path.",
      suggestions: ["Python 3 basics", "Python console programs", "Choose the best Python path"]
    };
  }
  if (field === "stack" && javascript) {
    return {
      question: isClarification
        ? "Can you confirm the JavaScript setup you want to learn with?"
        : "I heard JavaScript in your goal. Should this roadmap start with plain JavaScript in Node?",
      helper: "For beginners, plain JavaScript first is better than jumping into frameworks.",
      suggestions: ["Plain JavaScript basics", "JavaScript in Node", "Browser JavaScript later"]
    };
  }
  if (field === "stack" && track) {
    return {
      question: `I found a W3Schools ${track.label} track. Should this roadmap use that?`,
      helper: "This keeps the course order beginner-safe and tutorial-based.",
      suggestions: [`${track.label} beginner track`, `${track.label} fundamentals`, "Use this W3Schools track"]
    };
  }
  if (field === "stack") {
    const closest = closestW3SchoolsTracks(answers);
    return {
      question: "Which W3Schools-supported track should I use?",
      helper: "I only build catalog-backed paths, so choose the closest real tutorial track.",
      suggestions: closest.map((item) => item.label)
    };
  }
  if (field === "outcome" && python && beginner) {
    return {
      question: "What first Python result would feel successful for you?",
      helper: "For a beginner, this can be fundamentals and small programs, not a big project yet.",
      suggestions: ["Learn Python fundamentals", "Write simple console programs", "Build small practice exercises"]
    };
  }
  if (field === "outcome" && javascript && beginner) {
    return {
      question: "For your JavaScript course, what result should we aim for first?",
      helper: "For a beginner, we will follow the language fundamentals before apps, APIs, Node, or frameworks.",
      suggestions: ["Complete JavaScript fundamentals", "Practice every core topic", "Reach beginner-to-intermediate JavaScript"]
    };
  }
  if (field === "outcome" && beginner) {
    return {
      question: `For your ${track?.label || "coding"} course, what result should we aim for first?`,
      helper: "For a beginner, we will focus on fundamentals and small exercises before projects.",
      suggestions: [
        `Complete ${track?.label || "language"} fundamentals`,
        "Practice every core topic",
        "Reach beginner-to-intermediate level"
      ]
    };
  }
  if (field === "depth" && isBeginnerLanguageCourse(answers)) {
    return {
      question: `How much time should your ${track?.label || "language"} course cover?`,
      helper: "This controls how many W3Schools-style topics I include and how small each lesson should be.",
      suggestions: ["Fast basics in 1 week", "Steady beginner course", "Deep beginner-to-intermediate course"]
    };
  }
  if (field === "learningStyle" && isBeginnerLanguageCourse(answers)) {
    return {
      question: "How do you want to practice while learning the language?",
      helper: "This changes lesson style, not the safe beginner topic order.",
      suggestions: ["Guided examples first", "Small exercises after each topic", "Explain then practice"]
    };
  }
  if (field === "constraints" && isBeginnerLanguageCourse(answers)) {
    return {
      question: "Any constraint for this personal learning course?",
      helper: "Mention pace, device setup, or anything you want to avoid.",
      suggestions: ["Personal development only", "Slow and beginner friendly", "No job or interview focus"]
    };
  }
  return {
    question: isClarification ? `Can you make that more specific? ${base.question}` : base.question,
    helper: isClarification ? "A clear answer lets me build a useful path." : base.helper,
    suggestions: base.suggestions
  };
}

function normalizeInterviewState(transcript = []) {
  const answers = {};
  const raw = {};
  const vague = {};
  for (const item of transcript) {
    const field = canonicalInterviewField(item?.field);
    if (!interviewFieldOrder.includes(field)) continue;
    const rawAnswer = normalizeAnswerText(item.rawAnswer || item.answer);
    const normalizedAnswer = normalizeAnswerText(item.normalizedAnswer || item.answer);
    if (!rawAnswer && !normalizedAnswer) continue;
    raw[field] = rawAnswer;
    const unsupportedStack = field === "stack" && !matchW3SchoolsTrack({ ...answers, stack: normalizedAnswer || rawAnswer });
    if (isVagueAnswer(field, normalizedAnswer || rawAnswer) || unsupportedStack) {
      vague[field] = true;
      delete answers[field];
      continue;
    }
    vague[field] = false;
    answers[field] = normalizedAnswer || rawAnswer;
  }
  answers.__raw = raw;
  answers.__vague = vague;
  if (!answers.stack) {
    const inferredTrack = matchW3SchoolsTrack(answers);
    if (inferredTrack) {
      answers.__inferredStack = inferredTrack.label;
      answers.stack = inferredTrack.label;
    }
  }
  const track = matchW3SchoolsTrack(answers);
  if (track) answers.__w3schoolsTrack = track;
  answers.topic = answers.goal;
  answers.level = answers.experience;
  answers.language = answers.stack;
  answers.pace = answers.depth;
  return answers;
}

function getNextInterviewField(transcript = []) {
  const answers = normalizeInterviewState(transcript);
  return interviewFieldOrder.find((field) => !answers[field] || answers.__vague?.[field]) || null;
}

function buildInterviewPrompt(field, transcript = [], mode = "fallback", overrides = {}) {
  const answers = normalizeInterviewState(transcript);
  const completedFields = interviewFieldOrder.filter((item) => answers[item] && !answers.__vague?.[item]);
  const fieldConfidence = Object.fromEntries(
    completedFields.map((item) => [item, confidenceForAnswer(item, answers[item])])
  );
  const diagnosticRecommended =
    Boolean(answers.experience && confidenceForAnswer("experience", answers.experience) < 0.85) ||
    /not sure|maybe|choose|best path/.test(`${answers.stack || ""} ${answers.outcome || ""}`.toLowerCase());
  if (!field) {
    return {
      complete: true,
      mode,
      fieldOrder: interviewFieldOrder,
      completedFields,
      fieldConfidence,
      inferredIntent: inferredIntentFromAnswers(answers),
      diagnostic: {
        recommended: diagnosticRecommended,
        reason: diagnosticRecommended ? "Some answers are uncertain, so a tiny diagnostic can improve placement." : ""
      },
      w3schoolsTrack: answers.__w3schoolsTrack
        ? {
            label: answers.__w3schoolsTrack.label,
            sourceUrl: answers.__w3schoolsTrack.sourceUrl,
            exerciseUrl: answers.__w3schoolsTrack.exerciseUrl
          }
        : null,
      summary: {
        goal: answers.goal,
        topic: answers.goal,
        experience: answers.experience,
        level: answers.experience,
        stack: answers.stack,
        language: answers.stack,
        outcome: answers.outcome,
        depth: answers.depth,
        pace: answers.depth,
        learningStyle: answers.learningStyle,
        constraints: answers.constraints,
        w3schoolsTrack: answers.__w3schoolsTrack
          ? {
              label: answers.__w3schoolsTrack.label,
              sourceUrl: answers.__w3schoolsTrack.sourceUrl,
              exerciseUrl: answers.__w3schoolsTrack.exerciseUrl
            }
          : null
      }
    };
  }
  const isClarification = Boolean(answers.__vague?.[field]);
  const adaptive = adaptiveFieldPrompt(field, answers, isClarification);
  const forceLocal = shouldForceLocalInterviewPrompt(field, answers);
  return {
    complete: false,
    mode,
    nextField: field,
    field,
    fieldOrder: interviewFieldOrder,
    completedFields,
    fieldConfidence,
    inferredIntent: inferredIntentFromAnswers(answers),
    diagnostic: {
      recommended: diagnosticRecommended,
      reason: diagnosticRecommended ? "A tiny diagnostic may improve your starting point." : ""
    },
    w3schoolsTrack: answers.__w3schoolsTrack
      ? {
          label: answers.__w3schoolsTrack.label,
          sourceUrl: answers.__w3schoolsTrack.sourceUrl,
          exerciseUrl: answers.__w3schoolsTrack.exerciseUrl
        }
      : null,
    question: forceLocal ? adaptive.question : overrides.question || adaptive.question,
    helper: forceLocal ? adaptive.helper : overrides.helper || adaptive.helper,
    suggestions: forceLocal ? adaptive.suggestions : overrides.suggestions || adaptive.suggestions
  };
}

function fallbackInterviewQuestion(transcript = []) {
  return buildInterviewPrompt(getNextInterviewField(transcript), transcript, "fallback");
}

function validateBeginnerInterviewQuestion(prompt, transcript = []) {
  const answers = normalizeInterviewState(transcript);
  if (!prompt?.field || !shouldForceLocalInterviewPrompt(prompt.field, answers)) return prompt;
  return buildInterviewPrompt(prompt.field, transcript, prompt.mode || "fallback");
}

async function ollamaChatJson(model, system, prompt) {
  const data = await ollamaFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      format: "json",
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    })
  });
  return parseJsonObject(data.message?.content || "{}");
}

function validateInterviewReply(value, transcript = []) {
  const nextField = getNextInterviewField(transcript);
  if (!nextField) return buildInterviewPrompt(null, transcript, "ollama");
  if (!value || typeof value !== "object") return fallbackInterviewQuestion(transcript);
  const proposedField = canonicalInterviewField(value.nextField || value.field);
  if (proposedField !== nextField || !value.question) {
    return fallbackInterviewQuestion(transcript);
  }
  return validateBeginnerInterviewQuestion(buildInterviewPrompt(nextField, transcript, "ollama", {
    question: String(value.question),
    helper: String(value.helper || interviewFieldPrompts[nextField].helper),
    suggestions: Array.isArray(value.suggestions) ? value.suggestions : []
  }), transcript);
}

function classifyGoal(answers) {
  const text = `${answers.goal || ""} ${answers.outcome || ""} ${answers.constraints || ""}`.toLowerCase();
  if (/interview|dsa|leetcode|coding round/.test(text)) return { goalType: "InterviewPrep", confidence: 0.88 };
  if (/portfolio|resume|showcase/.test(text)) return { goalType: "PortfolioProject", confidence: 0.86 };
  if (/school|college|course|class|assignment/.test(text)) return { goalType: "SchoolCourse", confidence: 0.82 };
  if (/certification|certificate|exam/.test(text)) return { goalType: "Certification", confidence: 0.82 };
  if (/startup|saas|business|mvp/.test(text)) return { goalType: "StartupProject", confidence: 0.8 };
  if (/work|job|career|professional/.test(text)) return { goalType: "CareerSkill", confidence: 0.78 };
  return { goalType: "HobbyLearning", confidence: 0.66 };
}

function analyzeSkillGap(answers) {
  const experience = String(answers.experience || "").toLowerCase();
  const actualLevel = /advanced|professional|production|years/.test(experience)
    ? "intermediate"
    : /basic|syntax|small|some|little/.test(experience)
      ? "novice"
      : "beginner";
  const stack = String(answers.stack || "").toLowerCase();
  const missingPrerequisites = [];
  if (actualLevel === "beginner") missingPrerequisites.push("editor navigation", "running code locally");
  if (/react/.test(stack)) missingPrerequisites.push("JavaScript fundamentals", "HTML and CSS structure");
  if (/dsa|algorithm/.test(`${answers.goal} ${answers.outcome}`.toLowerCase())) missingPrerequisites.push("loops and functions", "arrays and strings");
  if (/python/.test(stack)) missingPrerequisites.push("running Python files", "reading console output");
  return {
    actualLevel,
    missingPrerequisites: Array.from(new Set(missingPrerequisites)).slice(0, 5),
    estimatedDifficulty: actualLevel === "beginner" ? "guided" : "moderate"
  };
}

function designCapstone(answers, goalType) {
  const text = `${answers.goal || ""} ${answers.outcome || ""} ${answers.stack || ""}`.toLowerCase();
  if (/react/.test(text)) return { capstone: "Interactive Portfolio Website", skillsRequired: ["components", "state", "routing-ready structure", "responsive UI"] };
  if (/interview|leetcode|coding round/.test(text)) return { capstone: "Interview Problem Set With Explanations", skillsRequired: ["problem patterns", "complexity analysis", "debugging traces"] };
  if (/dsa|algorithm/.test(text)) return { capstone: "DSA Foundations Practice Pack", skillsRequired: ["arrays", "loops", "maps", "two pointers", "stacks", "complexity"] };
  if (/sql|mysql|postgres|database/.test(text)) return { capstone: "SQL Query Practice Pack", skillsRequired: ["select", "filtering", "sorting", "aggregates", "joins"] };
  if (/python/.test(text) && /beginner|fundamental|basic|start|learn/.test(text)) {
    return { capstone: "Python Fundamentals Practice Pack", skillsRequired: ["print", "variables", "input", "conditions", "loops", "lists", "functions"] };
  }
  if (/javascript|node|js/.test(text) && /beginner|fundamental|basic|start|learn|practice/.test(text)) {
    return { capstone: "JavaScript Fundamentals Practice Pack", skillsRequired: ["console output", "variables", "strings", "conditions", "arrays", "loops", "functions", "objects"] };
  }
  if (/python|automation/.test(text) && /automation|work|toolkit|script/.test(text)) return { capstone: "Workplace Automation Toolkit", skillsRequired: ["scripts", "files", "functions", "error handling"] };
  if (goalType === "StartupProject") return { capstone: "Clickable MVP Prototype", skillsRequired: ["feature slicing", "data flow", "validation"] };
  return { capstone: titleCase(answers.outcome || "Practical Mini Project"), skillsRequired: ["setup", "core implementation", "debugging", "presentation"] };
}

function chooseLanguage(answers) {
  const track = matchW3SchoolsTrack(answers);
  if (track) return track.profileLanguage || track.label;
  const stack = String(answers.stack || answers.language || "").toLowerCase();
  if (/python/.test(stack)) return "Python";
  if (/sql|mysql|postgres|database/.test(stack)) return "SQL";
  if (/react|web|html|css|browser/.test(stack)) return "Web";
  if (/javascript|node|\bjs\b/.test(stack)) return "JavaScript";
  return titleCase(answers.stack || answers.language || "JavaScript");
}

function toSkills(values) {
  if (Array.isArray(values)) return values.map(String).filter(Boolean).slice(0, 6);
  return String(values || "")
    .split(/[,|]/)
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 6);
}

function moduleFrom(
  title,
  objective,
  task,
  artifact,
  validation,
  estimatedHours = 1.5,
  meta = {}
) {
  return {
    kind: meta.kind || "",
    title,
    objective,
    task,
    artifact,
    validation,
    estimatedHours,
    skillsIntroduced: toSkills(meta.skillsIntroduced || title),
    skillsPracticed: toSkills(meta.skillsPracticed || meta.skillsIntroduced || title),
    prerequisites: toSkills(meta.prerequisites),
    difficulty: meta.difficulty || "guided",
    remediation: meta.remediation || `Review ${title.toLowerCase()} with a smaller example before retrying.`
  };
}

function pythonModule(kind, title, objective, task, artifact, validation, estimatedHours = 1, meta = {}) {
  return {
    kind,
    ...moduleFrom(title, objective, task, artifact, validation, estimatedHours, {
    skillsIntroduced: meta.skillsIntroduced || kind,
    skillsPracticed: meta.skillsPracticed || kind,
    prerequisites: meta.prerequisites || [],
    difficulty: meta.difficulty || (kind === "capstone" ? "capstone" : "intro"),
    remediation: meta.remediation || `Open GUIDE.md and practice the ${kind} example again with one changed value.`
    })
  };
}

function w3TopicSpec(track, kind, target, index) {
  const language = track.label;
  const generic = {
    console: [`Run your first ${language} example`, `Start the W3Schools ${language} path with visible output.`, `Create the smallest ${language} exercise that shows your name, topic, and reason for learning.`, `${language} first output exercise`, "The answer includes visible output for name, topic, and reason", ["program structure", "output"]],
    comments: [`Write readable ${language} syntax and comments`, "Practice basic syntax and comments before adding logic.", "Write three simple statements and add comments that explain what each statement does.", "A commented syntax exercise", "The answer includes comments and multiple statements", ["syntax", "comments"]],
    variables: [`Store values in ${language} variables`, "Use variables to keep text and numbers.", "Create values for learner name, topic, and practice days, then output a summary.", "A variable-based learning summary", "The answer defines at least three named values", ["variables"]],
    strings_numbers: `Combine ${language} strings and numbers`,
    conditions: `Choose behavior with ${language} conditions`,
    arrays_loops: `Repeat work with ${language} collections and loops`,
    functions: `Create reusable ${language} logic with functions`,
    objects: `Group related ${language} data`,
    debugging: `Debug a beginner ${language} mistake`,
    capstone: `Assemble the ${target}`
  };
  const specs = {
    print: ["Print your first Python learning card", "Follow the W3Schools Python start by producing visible output.", "Create a Python file that prints your name, learning goal, and one reason you want Python.", "A console learning card printed from a dedicated Python file", "The output includes name, goal, and reason", ["print", "output"]],
    input: ["Prepare a beginner input prompt", "Practice the W3Schools input idea with a safe simulated answer.", "Create a prompt_message variable and a sample_answer variable, then print the simulated user response.", "A safe input prompt simulation", "The file mentions input and prints a sample answer", ["input"]],
    lists: ["Update a Python list", "Practice the W3Schools list idea by storing several values.", "Start with a list of skills, append one new skill, and print the final list.", "An updated skills list", "The file uses append and prints the added skill", ["lists"]],
    dictionaries: ["Store learner details in a dictionary", "Use key/value pairs after practicing lists.", "Create a learner dictionary with name, goal, and skills, then print each value.", "A learner profile dictionary", "The file defines a dictionary and reads at least three keys", ["dictionaries"]],
    sets_tuples: ["Compare tuples and sets", "Practice fixed ordered values and unique values.", "Create a tuple of fixed goals and a set of unique skills, then print both.", "Tuple and set practice output", "The file defines a tuple and a set", ["tuples", "sets"]],
    errors: ["Handle a beginner Python error", "Use try/except to keep a small program from crashing.", "Convert a text value to a number safely and print a friendly fallback message when conversion fails.", "A safe conversion script", "The file uses try and except", ["errors", "exceptions"]],
    files: ["Write and read a small text file", "Practice basic file handling after learning strings and collections.", "Write a learning note to notes.txt, then read it back and print it.", "A file read/write exercise", "The file uses open or pathlib and creates notes.txt", ["files"]],
    classes: ["Create a tiny Python class", "Use a class to group data and behavior near the end of the fundamentals path.", "Create a Learner class with name and goal, then add a summary method.", "A learner class with a method", "The file defines a class and calls a method", ["classes"]],
    console: generic.console,
    comments: generic.comments,
    variables: generic.variables,
    operators_types: [`Practice ${language} operators and data types`, "Use arithmetic, comparison, boolean, string, and number values.", "Create values with different types, calculate a total, and print type information.", "A data-type and operator report", "The answer uses arithmetic, a comparison, and type vocabulary", ["operators", "data types"]],
    strings_numbers: [typeof generic.strings_numbers === "string" ? generic.strings_numbers : `Combine ${language} strings and numbers`, "Practice strings, numbers, and simple calculations.", "Calculate weekly practice minutes and print a readable sentence with the result.", "A practice-time calculator output", "The output contains a calculated weekly total", ["strings", "numbers"]],
    string_methods: ["Use JavaScript string methods", "Practice common string methods before arrays and objects.", "Create a goal string, uppercase it, slice one word, and check whether it includes JavaScript.", "A string-method practice output", "The file uses toUpperCase, slice, and includes", ["string methods"]],
    conditions: [typeof generic.conditions === "string" ? generic.conditions : `Choose behavior with ${language} conditions`, "Use conditionals to make a simple decision.", "Print a beginner message when confidence is low and a challenge message when confidence is high.", "A confidence-based recommendation", "The answer uses if/else and prints one recommendation", ["conditions"]],
    loops: ["Repeat practice tasks with a loop", "Use a loop to process several practice tasks.", "Create three practice tasks and print each one with a number.", "A numbered practice checklist", "The answer uses a loop and prints at least three tasks", ["loops"]],
    arrays_loops: [typeof generic.arrays_loops === "string" ? generic.arrays_loops : `Repeat work with ${language} collections and loops`, "Use an array or collection and a loop to process several tasks.", "Create three practice tasks and print each one with a number.", "A numbered practice checklist", "The answer uses a collection and loop", ["collections", "loops"]],
    array_methods: ["Use JavaScript array methods", "Practice push, map, and filter on simple arrays.", "Start with a skills array, push one new skill, create uppercase labels, and filter long skill names.", "An array-method practice output", "The file uses push, map, and filter", ["array methods"]],
    functions: [typeof generic.functions === "string" ? generic.functions : `Create reusable ${language} logic with functions`, "Use a function only after practicing values and loops.", "Write a function that returns a formatted learner summary from name, goal, and skills.", "A reusable learner summary function", "The answer defines and calls a function", ["functions"]],
    objects: [typeof generic.objects === "string" ? generic.objects : `Group related ${language} data`, "Use an object, record, map, class, or struct-style value to keep related values together.", "Create a learner profile with name, goal, skills, and confidence, then print a readable summary.", "A learner profile data structure", "The answer stores related profile fields and prints them", ["structured data"]],
    debugging: [typeof generic.debugging === "string" ? generic.debugging : `Debug a beginner ${language} mistake`, "Practice reading a small error and fixing the smallest broken piece.", "Fix a broken beginner practice file so it prints the expected learning summary.", "A fixed beginner debugging exercise", "The answer explains or fixes the beginner bug", ["debugging"]],
    html_structure: ["Build a tiny HTML document", "Start the W3Schools HTML path with document structure and visible content.", "Create a page with a heading, paragraph, and list of learning goals.", "A readable HTML document", "The page includes h1, p, and at least three li elements", ["HTML structure"]],
    html_sections: ["Add links and sections", "Use semantic sections and links to organize content.", "Add header, main, section, and a link to a learning resource.", "A structured page with navigation", "The page includes header, main, section, and an anchor link", ["semantic HTML", "links"]],
    web_tables_forms: ["Practice HTML forms and tables", "Use simple form/table structure after basic HTML sections.", "Add a small form or table that captures a learner goal.", "A form or table practice page", "The page includes form/table structure", ["forms", "tables"]],
    web_media: ["Add beginner-friendly media markup", "Practice image/media structure without overloading the page.", "Add an image or media placeholder with useful alt text.", "A media-ready HTML page", "The page includes image/media markup and alt text", ["images", "media"]],
    web_accessibility: ["Make the page easier to read and navigate", "Practice labels, alt text, and semantic structure.", "Improve labels, headings, and text alternatives in the page.", "An accessible beginner page", "The page includes semantic labels or alt text", ["accessibility"]],
    css_selectors: ["Style text and colors with CSS selectors", "Use CSS selectors, spacing, and color.", "Style the heading, paragraphs, list, and link so the page is readable.", "A styled learning page", "CSS changes typography, spacing, and color", ["CSS selectors"]],
    box_model: ["Create a card layout with the box model", "Use margin, padding, border, and width.", "Turn one section into a clean card with spacing and a border.", "A card-style content block", "CSS uses padding, margin, border, and max-width", ["box model"]],
    flexbox: ["Arrange content with flexbox", "Use flexbox to align items in a row or column.", "Create a small skill row using display flex and gap.", "A flexbox skill row", "CSS uses display:flex and gap", ["flexbox"]],
    css_grid: ["Arrange content with CSS grid", "Use grid after practicing box model and flexbox.", "Create a two-column practice layout using CSS grid.", "A CSS grid practice layout", "CSS uses display:grid and grid-template-columns", ["CSS grid"]],
    responsive: ["Make the page responsive", "Use viewport width and a media query.", "Add responsive CSS so the card and text fit on narrow screens.", "A responsive page layout", "CSS includes a media query and mobile-safe width", ["responsive CSS"]],
    css_transitions: ["Add a small CSS transition", "Practice a simple visual state change after responsive layout.", "Add a hover transition to a button or link.", "A transition practice style", "CSS includes transition and hover", ["transitions"]],
    dom_text: ["Change page text with JavaScript", "Use DOM selection to update visible content.", "Add a button that changes a status message when clicked.", "An interactive status button", "The button updates visible page text", ["DOM selection", "events"]],
    form_input: ["Read a form input", "Use an input value to personalize the page.", "Add an input and button that prints a personalized greeting on the page.", "A personalized greeting form", "JavaScript reads an input value and updates the DOM", ["forms", "input value"]],
    web_debugging: ["Debug a broken web interaction", "Practice finding a selector or event mistake.", "Fix a broken button interaction so it updates the page correctly.", "A fixed DOM interaction", "The button selector and click handler work", ["web debugging"]],
    web_capstone: [`Assemble the ${target}`, "Combine HTML, CSS, responsive layout, and JavaScript interaction.", `Build the ${target} with sections, styling, responsive behavior, and one form or button interaction.`, target, "The page has semantic HTML, CSS layout, responsive styling, and JavaScript interaction", ["HTML", "CSS", "responsive design", "DOM"]],
    sql_select: ["Select columns from a table", "Use SELECT and FROM to read data.", "Write queries that select all columns and specific columns from a learners table.", "Basic SELECT queries", "The file includes SELECT and FROM", ["SELECT", "FROM"]],
    sql_where_order: ["Filter and sort query results", "Use WHERE and ORDER BY.", "Write a query that filters learners by topic and sorts by practice minutes.", "Filtered and sorted query", "The file includes WHERE and ORDER BY", ["WHERE", "ORDER BY"]],
    sql_insert_update: ["Insert and update practice rows", "Use INSERT INTO and UPDATE safely.", "Write one INSERT query and one UPDATE query for a practice table.", "Insert/update query set", "The file includes INSERT INTO and UPDATE", ["INSERT", "UPDATE"]],
    sql_aggregate: ["Count and group practice data", "Use aggregate functions and GROUP BY.", "Write queries that count learners by topic and calculate total practice minutes.", "Aggregate query set", "The file includes COUNT, SUM, and GROUP BY", ["COUNT", "SUM", "GROUP BY"]],
    sql_join: ["Join learners with lessons", "Use INNER JOIN to combine related tables.", "Write a query that joins learners and lessons by topic or learner id.", "A join query", "The file includes INNER JOIN and ON", ["JOIN"]],
    sql_capstone: [`Assemble the ${target}`, "Combine SELECT, filters, sorting, aggregates, and joins.", `Create a small ${target} with six labeled queries for a learning progress database.`, target, "The file includes SELECT, WHERE, ORDER BY, GROUP BY, JOIN, and aggregate functions", ["SQL review"]],
    dsa_trace_array: ["Trace an array by hand in code", "Print each array value and its index.", "Create an array and log every index/value pair.", "An array trace output", "The output includes every index and value", ["arrays", "loops"]],
    dsa_linear_search: ["Find a target with linear search", "Use a loop and condition to search.", "Return the index of a target value or -1 when missing.", "A linear search function", "The function handles found and missing targets", ["linear search"]],
    dsa_frequency: ["Count repeated values with a frequency map", "Use an object/map to count values.", "Count how many times each string appears in an array.", "A frequency counter", "The result includes correct counts", ["hash map"]],
    dsa_two_pointers: ["Find a pair with two pointers", "Use sorted arrays and two moving indexes.", "Return true when two numbers add to a target in a sorted array.", "A two-pointer pair finder", "The function handles found and missing pairs", ["two pointers"]],
    dsa_stack: ["Check a string with a stack", "Use an array as a stack.", "Validate simple balanced parentheses using push and pop.", "A parentheses checker", "The function returns true for balanced input and false otherwise", ["stack"]],
    dsa_complexity: ["Explain time complexity", "Attach Big O reasoning to a working solution.", "Write a linear search function and export a short complexity explanation.", "A solution with Big O explanation", "The explanation mentions O(n) and why", ["time complexity"]],
    dsa_debugging: ["Debug a failing algorithm test", "Practice reading test failures and fixing logic.", "Fix a function that returns the wrong maximum number from an array.", "A fixed max-number function", "The function passes positive and negative number cases", ["algorithm debugging"]],
    dsa_capstone: [`Assemble the ${target}`, "Solve and explain multiple beginner problem-solving patterns.", "Create four solved problems with input, output, tests, and plain-English explanation.", target, "Each problem has a working solution and explanation", ["DSA review"]],
    capstone: [typeof generic.capstone === "string" ? generic.capstone : `Assemble the ${target}`, `Combine the W3Schools-style ${language} fundamentals into one final practice artifact.`, `Create a small ${target} that demonstrates output, values, branching, repetition, reusable logic, and a final explanation.`, target, "The artifact demonstrates the core course topics", ["capstone"]]
  };
  const spec = specs[kind] || specs.console;
  return moduleFrom(spec[0], spec[1], spec[2], spec[3], spec[4], Math.max(0.75, (track.timePlan?.minutesPerLesson || 45) / 60), {
    kind,
    skillsIntroduced: spec[5],
    prerequisites: index === 0 ? [] : ["previous W3Schools topic"],
    difficulty: kind.includes("capstone") || kind === "capstone" ? "capstone" : index < 3 ? "intro" : index < 8 ? "guided" : "practice",
    remediation: `Review the ${track.label} W3Schools topic order, then redo this lesson with one smaller example.`
  });
}

function buildW3SchoolsCourseMilestones(answers, skillGap, capstone) {
  const baseTrack = matchW3SchoolsTrack(answers);
  if (!baseTrack) return null;
  const timePlan = learningTimePlan(answers.depth || answers.pace);
  const target = capstone.capstone || `${baseTrack.label} Fundamentals Practice Pack`;
  const allKinds = baseTrack.topicKinds.length ? baseTrack.topicKinds : ["console", "comments", "variables", "strings_numbers", "conditions", "arrays_loops", "functions", "objects", "debugging", "capstone"];
  const limit = Math.min(allKinds.length, timePlan.maxLessons);
  let selectedKinds = allKinds.slice(0, limit);
  const capstoneKind = allKinds.find((kind) => /capstone/.test(kind)) || "capstone";
  if (!selectedKinds.includes(capstoneKind)) selectedKinds = [...selectedKinds.slice(0, Math.max(1, limit - 1)), capstoneKind];
  const track = { ...baseTrack, timePlan };
  const modules = selectedKinds.map((kind, index) => ({
    ...w3TopicSpec(track, kind, target, index),
    w3schoolsTopic: kind,
    sourceUrl: baseTrack.sourceUrl,
    exerciseUrl: baseTrack.exerciseUrl,
    estimatedMinutes: timePlan.minutesPerLesson
  }));
  const groupSize = timePlan.pace === "slow" ? 2 : 3;
  const milestones = [];
  for (let index = 0; index < modules.length; index += groupSize) {
    const group = modules.slice(index, index + groupSize);
    const first = group[0];
    milestones.push({
      milestone: `${baseTrack.label} topics ${index + 1}-${index + group.length}`,
      modules: group,
      checkpoint: `Complete ${group.map((item) => item.title).join(", ")}.`,
      miniProject: index + group.length >= modules.length ? target : first.artifact
    });
  }
  return { track: baseTrack, timePlan, milestones };
}

function pythonBeginnerMilestones(answers, capstone) {
  const target = capstone.capstone || "Python Fundamentals Practice Pack";
  return [
    {
      milestone: "Start Python with visible output",
      modules: [
        pythonModule(
          "print",
          "Print your first Python learning card",
          "Use print statements to display text clearly.",
          "Create a Python file that prints your name, your learning goal, and one reason you want Python.",
          "A console learning card printed from a dedicated Python file",
          "The output includes name, goal, and reason"
        ),
        pythonModule(
          "variables",
          "Store beginner Python facts in variables",
          "Use variables to store text and numbers before printing them.",
          "Create separate variables for name, topic, days_per_week, and print a clean summary.",
          "A variable-based learning summary",
          "The file defines at least three variables and prints them"
        )
      ],
      checkpoint: "The learner can run Python and explain print plus variables.",
      miniProject: "Learning profile card"
    },
    {
      milestone: "Make Python respond to values",
      modules: [
        pythonModule(
          "strings_numbers",
          "Combine strings and numbers safely",
          "Practice f-strings, numbers, and simple calculations.",
          "Calculate weekly practice minutes and print a sentence using an f-string.",
          "A practice-time calculator output",
          "The output contains a calculated weekly total"
        ),
        pythonModule(
          "input",
          "Prepare a beginner input prompt",
          "Learn how Python asks for information with input while keeping the checkpoint safe.",
          "Create a prompt_message variable and a sample_answer variable, then print the simulated user response.",
          "A safe input prompt simulation",
          "The file mentions input and prints a sample answer"
        ),
        pythonModule(
          "conditions",
          "Choose messages with if and else",
          "Use conditionals to make a decision in code.",
          "Print a beginner message when confidence is low and a challenge message when confidence is high.",
          "A confidence-based recommendation",
          "The file uses if/else and prints one recommendation"
        )
      ],
      checkpoint: "The learner can combine values and branch with if/else.",
      miniProject: "Practice planner"
    },
    {
      milestone: "Repeat work and organize data",
      modules: [
        pythonModule(
          "loops",
          "Repeat practice tasks with a loop",
          "Use a for loop to process several practice tasks.",
          "Create a list of three Python practice tasks and print each one with a number.",
          "A numbered practice checklist",
          "The file uses a for loop and prints at least three tasks"
        ),
        pythonModule(
          "lists",
          "Update a Python list",
          "Store multiple values and add a new item.",
          "Start with a list of skills, append one new skill, and print the final list.",
          "An updated skills list",
          "The file uses append and prints the added skill"
        )
      ],
      checkpoint: "The learner can repeat work and manage a small list.",
      miniProject: "Skill tracker"
    },
    {
      milestone: "Use Python data collections",
      modules: [
        pythonModule(
          "dictionaries",
          "Store learner details in a dictionary",
          "Use key/value pairs after practicing lists.",
          "Create a learner dictionary with name, goal, and skills, then print each value.",
          "A learner profile dictionary",
          "The file defines a dictionary and reads at least three keys",
          1.5,
          { prerequisites: ["lists"] }
        ),
        pythonModule(
          "sets_tuples",
          "Compare tuples and sets",
          "Practice fixed ordered values and unique values.",
          "Create a tuple of fixed goals and a set of unique skills, then print both.",
          "Tuple and set practice output",
          "The file defines a tuple and a set",
          1.5,
          { prerequisites: ["lists"] }
        )
      ],
      checkpoint: "The learner can use Python lists, dictionaries, tuples, and sets.",
      miniProject: "Collection practice pack"
    },
    {
      milestone: "Handle real Python program structure",
      modules: [
        pythonModule(
          "errors",
          "Handle a beginner Python error",
          "Use try/except to keep a small program from crashing.",
          "Convert a text value to a number safely and print a friendly fallback message when conversion fails.",
          "A safe conversion script",
          "The file uses try and except",
          1.5,
          { prerequisites: ["conditions"] }
        ),
        pythonModule(
          "files",
          "Write and read a small text file",
          "Practice basic file handling after learning strings and collections.",
          "Write a learning note to notes.txt, then read it back and print it.",
          "A file read/write exercise",
          "The file uses open or pathlib and creates notes.txt",
          1.5,
          { prerequisites: ["strings and numbers", "lists"] }
        ),
        pythonModule(
          "classes",
          "Create a tiny Python class",
          "Use a class to group data and behavior at the end of the fundamentals path.",
          "Create a Learner class with name and goal, then add a summary method.",
          "A learner class with a method",
          "The file defines a class and calls a method",
          2,
          { prerequisites: ["functions", "dictionaries"], difficulty: "practice" }
        )
      ],
      checkpoint: "The learner can handle errors, files, and a small class.",
      miniProject: "Program structure practice"
    },
    {
      milestone: `Build the ${target}`,
      modules: [
        pythonModule(
          "functions",
          "Create a reusable summary function",
          "Use a function only after practicing the basics.",
          "Write a function that returns a formatted learner summary from name, goal, and skills.",
          "A reusable learner summary function",
          "The file defines and calls a function that returns useful text",
          1.5
        ),
        pythonModule(
          "capstone",
          `Assemble the ${target}`,
          "Combine print, variables, conditions, loops, lists, and a function.",
          `Create a small command-line ${target} that prints a profile, checklist, and next step.`,
          `A complete ${target}`,
          "The program uses a function, a list, a loop, and a conditional",
          2
        )
      ],
      checkpoint: `${target} demonstrates beginner Python fundamentals.`,
      miniProject: target
    }
  ];
}

function isPythonBeginnerPath(answers, skillGap) {
  return hasPythonIntent(answers) && (hasBeginnerIntent(answers) || skillGap.actualLevel === "beginner");
}

function beginnerJavaScriptMilestones(capstone) {
  const target = capstone.capstone || "JavaScript Fundamentals Practice Pack";
  return [
    {
      milestone: "Start JavaScript from zero",
      modules: [
        moduleFrom("Print your first JavaScript learning card", "Use console.log to display clear output.", "Create a file that prints your name, learning goal, and one reason you want JavaScript.", "A console learning card", "The output includes name, goal, and reason", 1, { kind: "console", skillsIntroduced: ["console output"], difficulty: "intro" }),
        moduleFrom("Write readable JavaScript syntax and comments", "Use statements, semicolons, and comments to explain code.", "Create three JavaScript statements and add comments that explain each step.", "A commented JavaScript starter file", "The file contains comments and multiple statements", 1, { kind: "comments", skillsIntroduced: ["syntax", "comments"], prerequisites: ["console output"], difficulty: "intro" }),
        moduleFrom("Store facts in JavaScript variables", "Use const and let to store text and numbers before printing them.", "Create variables for learnerName, topic, daysPerWeek, then print a clean summary.", "A variable-based learning summary", "The file defines at least three variables and prints them", 1, { kind: "variables", skillsIntroduced: ["variables"], prerequisites: ["console output"], difficulty: "intro" })
      ],
      checkpoint: "The learner can run JavaScript and explain output plus variables.",
      miniProject: "Console learning profile"
    },
    {
      milestone: "Work with values and decisions",
      modules: [
        moduleFrom("Practice JavaScript operators and data types", "Use arithmetic, comparison, boolean, string, and number values.", "Create values with different types, calculate a total, and print typeof results.", "A data-type and operator report", "The file uses typeof, arithmetic, and a comparison", 1.5, { kind: "operators_types", skillsIntroduced: ["operators", "data types"], prerequisites: ["variables"] }),
        moduleFrom("Combine strings and numbers", "Practice template strings, numbers, and simple calculations.", "Calculate weekly practice minutes and print the total using a template string.", "A practice-time calculator output", "The output contains a calculated weekly total", 1, { kind: "strings_numbers", skillsIntroduced: ["strings and numbers"], prerequisites: ["variables"] }),
        moduleFrom("Choose messages with if and else", "Use conditionals to make a simple decision.", "Print a beginner message when confidence is low and a challenge message when confidence is high.", "A confidence-based recommendation", "The file uses if/else and prints one recommendation", 1, { kind: "conditions", skillsIntroduced: ["conditions"], prerequisites: ["variables"] })
      ],
      checkpoint: "The learner can calculate and branch safely.",
      miniProject: "Practice planner"
    },
    {
      milestone: "Repeat work and organize values",
      modules: [
        moduleFrom("Use JavaScript string methods", "Practice common string methods before arrays and objects.", "Create a goal string, uppercase it, slice one word, and check whether it includes JavaScript.", "A string-method practice output", "The file uses toUpperCase, slice, and includes", 1.5, { kind: "string_methods", skillsIntroduced: ["string methods"], prerequisites: ["strings and numbers"] }),
        moduleFrom("Repeat practice tasks with a loop", "Use an array and forEach loop to process several tasks.", "Create an array of three JavaScript practice tasks and print each one with a number.", "A numbered practice checklist", "The file uses an array and loop to print at least three tasks", 1, { kind: "arrays_loops", skillsIntroduced: ["arrays", "loops"], prerequisites: ["conditions"] }),
        moduleFrom("Use JavaScript array methods", "Practice push, map, and filter on simple arrays.", "Start with a skills array, push one new skill, create uppercase labels, and filter long skill names.", "An array-method practice output", "The file uses push, map, and filter", 1.5, { kind: "array_methods", skillsIntroduced: ["array methods"], prerequisites: ["arrays", "loops"] })
      ],
      checkpoint: "The learner can repeat work and update arrays.",
      miniProject: "Skill tracker"
    },
    {
      milestone: "Create reusable JavaScript pieces",
      modules: [
        moduleFrom("Create a reusable summary function", "Use a function only after practicing values and arrays.", "Write a function that returns a formatted learner summary from name, goal, and skills.", "A reusable learner summary function", "The file defines and calls a function that returns useful text", 1.5, { kind: "functions", skillsIntroduced: ["functions"], prerequisites: ["arrays", "loops"] }),
        moduleFrom("Group learner data in an object", "Use an object to keep related values together.", "Create a learner object with name, goal, skills, and confidence, then print a readable summary.", "A learner profile object", "The file defines an object with at least three fields and reads them", 1.5, { kind: "objects", skillsIntroduced: ["objects"], prerequisites: ["functions"] }),
        moduleFrom("Create a tiny JavaScript class", "Use a class after objects and functions.", "Create a Learner class with a constructor and summary method.", "A learner class with a method", "The file defines a class, constructor, and method", 2, { kind: "classes", skillsIntroduced: ["classes"], prerequisites: ["objects"], difficulty: "practice" })
      ],
      checkpoint: "The learner can use functions and objects for small programs.",
      miniProject: "Learner profile object"
    },
    {
      milestone: "Connect JavaScript to browser-style behavior",
      modules: [
        moduleFrom("Model DOM selection and events", "Practice the same DOM/event ideas used in W3Schools browser examples.", "Create a small object that represents a button click and returns the updated status text.", "A DOM/event mental-model exercise", "The file mentions querySelector, addEventListener, and textContent", 1.5, { kind: "dom_events_model", skillsIntroduced: ["DOM", "events"], prerequisites: ["functions", "objects"] }),
        moduleFrom("Practice async promise flow", "Understand promise-style asynchronous steps before using real fetch.", "Create a Promise that resolves to a learning message and print it with async/await.", "An async/await practice output", "The file uses Promise, async, and await", 2, { kind: "async_practice", skillsIntroduced: ["async", "promises"], prerequisites: ["functions"], difficulty: "practice" })
      ],
      checkpoint: "The learner understands DOM/event vocabulary and async flow.",
      miniProject: "Browser behavior mental model"
    },
    {
      milestone: `Build the ${target}`,
      modules: [
        moduleFrom("Debug a broken JavaScript practice file", "Practice reading an error and fixing a small beginner bug.", "Fix a broken variable/function call so the file prints the expected learning summary.", "A fixed beginner debugging exercise", "The file runs without ReferenceError and prints the summary", 1.5, { kind: "debugging", skillsIntroduced: ["debugging"], prerequisites: ["functions", "objects"], difficulty: "practice" }),
        moduleFrom(`Assemble the ${target}`, "Combine output, variables, conditions, arrays, loops, functions, and objects.", `Create a small console ${target} that prints a profile, checklist, and next step.`, target, "The program uses an object, function, array, loop, and conditional", 2, { kind: "capstone", skillsPracticed: ["variables", "conditions", "arrays", "loops", "functions", "objects"], difficulty: "capstone" })
      ],
      checkpoint: `${target} demonstrates beginner JavaScript fundamentals.`,
      miniProject: target
    }
  ];
}

function beginnerWebMilestones(capstone) {
  const target = capstone.capstone || "Beginner Web Profile Page";
  return [
    {
      milestone: "Start web pages from zero",
      modules: [
        moduleFrom("Build a tiny HTML document", "Use HTML structure to place meaningful content on a page.", "Create a page with a heading, paragraph, and list of learning goals.", "A readable HTML document", "The page includes h1, p, and at least three li elements", 1, { kind: "html_structure", skillsIntroduced: ["HTML structure"], difficulty: "intro" }),
        moduleFrom("Add links and sections", "Use semantic sections and links to organize content.", "Add header, main, section, and a link to a learning resource.", "A structured page with navigation", "The page includes header, main, section, and an anchor link", 1, { kind: "html_sections", skillsIntroduced: ["semantic HTML", "links"], prerequisites: ["HTML structure"], difficulty: "intro" })
      ],
      checkpoint: "The learner can create and style a simple web page.",
      miniProject: "HTML learning page"
    },
    {
      milestone: "Style layouts with CSS",
      modules: [
        moduleFrom("Style text and colors with CSS selectors", "Use CSS selectors, spacing, and color.", "Style the heading, paragraphs, list, and link so the page is readable.", "A styled learning page", "CSS changes typography, spacing, and color", 1, { kind: "css_selectors", skillsIntroduced: ["CSS selectors"], prerequisites: ["semantic HTML"] }),
        moduleFrom("Create a card layout with the box model", "Use margin, padding, border, and width.", "Turn one section into a clean card with spacing and a border.", "A card-style content block", "CSS uses padding, margin, border, and max-width", 1, { kind: "box_model", skillsIntroduced: ["box model"], prerequisites: ["CSS selectors"] }),
        moduleFrom("Arrange content with flexbox", "Use flexbox to align items in a row or column.", "Create a small skill row using display flex and gap.", "A flexbox skill row", "CSS uses display:flex and gap", 1.5, { kind: "flexbox", skillsIntroduced: ["flexbox"], prerequisites: ["box model"] })
      ],
      checkpoint: "The learner can style readable page sections and simple layouts.",
      miniProject: "Styled profile card"
    },
    {
      milestone: "Make pages responsive and interactive",
      modules: [
        moduleFrom("Make the page responsive", "Use viewport width and a media query.", "Add responsive CSS so the card and text fit on narrow screens.", "A responsive page layout", "CSS includes a media query and mobile-safe width", 1.5, { kind: "responsive", skillsIntroduced: ["responsive CSS"], prerequisites: ["flexbox"] }),
        moduleFrom("Change page text with JavaScript", "Use DOM selection to update visible content.", "Add a button that changes a status message when clicked.", "An interactive status button", "The button updates visible page text", 1.5, { kind: "dom_text", skillsIntroduced: ["DOM selection", "events"], prerequisites: ["HTML structure", "CSS selectors"] }),
        moduleFrom("Read a form input", "Use an input value to personalize the page.", "Add an input and button that prints a personalized greeting on the page.", "A personalized greeting form", "JavaScript reads an input value and updates the DOM", 2, { kind: "form_input", skillsIntroduced: ["forms", "input value"], prerequisites: ["DOM selection", "events"] })
      ],
      checkpoint: "The learner can create responsive and interactive browser pages.",
      miniProject: "Interactive learning card"
    },
    {
      milestone: `Build the ${target}`,
      modules: [
        moduleFrom("Debug a broken web interaction", "Practice finding a selector or event mistake.", "Fix a broken button interaction so it updates the page correctly.", "A fixed DOM interaction", "The button selector and click handler work", 1.5, { kind: "web_debugging", skillsIntroduced: ["debugging"], prerequisites: ["DOM selection", "events"], difficulty: "practice" }),
        moduleFrom(`Assemble the ${target}`, "Combine HTML, CSS, responsive layout, and JavaScript interaction.", `Build the ${target} with sections, styling, responsive behavior, and one form or button interaction.`, target, "The page has semantic HTML, CSS layout, responsive styling, and JavaScript interaction", 2.5, { kind: "web_capstone", skillsPracticed: ["HTML", "CSS", "responsive design", "DOM", "events"], difficulty: "capstone" })
      ],
      checkpoint: `${target} is complete enough to preview.`,
      miniProject: target
    }
  ];
}

function beginnerDsaMilestones(capstone) {
  const target = capstone.capstone || "DSA Foundations Practice Pack";
  return [
    {
      milestone: "Trace simple data before solving problems",
      modules: [
        moduleFrom("Trace an array by hand in code", "Print each array value and its index.", "Create an array and log every index/value pair.", "An array trace output", "The output includes every index and value", 1, { kind: "dsa_trace_array", skillsIntroduced: ["arrays", "loops"], difficulty: "intro" }),
        moduleFrom("Find a target with linear search", "Use a loop and condition to search.", "Return the index of a target value or -1 when missing.", "A linear search function", "The function handles found and missing targets", 1.5, { kind: "dsa_linear_search", skillsIntroduced: ["linear search"], prerequisites: ["arrays", "loops"] })
      ],
      checkpoint: "The learner can trace arrays and write a simple search.",
      miniProject: "Array search notebook"
    },
    {
      milestone: "Learn core problem-solving patterns",
      modules: [
        moduleFrom("Count repeated values with a frequency map", "Use an object/map to count values.", "Count how many times each string appears in an array.", "A frequency counter", "The result includes correct counts", 1.5, { kind: "dsa_frequency", skillsIntroduced: ["hash map"], prerequisites: ["arrays", "loops"] }),
        moduleFrom("Find a pair with two pointers", "Use sorted arrays and two moving indexes.", "Return true when two numbers add to a target in a sorted array.", "A two-pointer pair finder", "The function handles found and missing pairs", 1.5, { kind: "dsa_two_pointers", skillsIntroduced: ["two pointers"], prerequisites: ["arrays", "conditions"] }),
        moduleFrom("Check a string with a stack", "Use an array as a stack.", "Validate simple balanced parentheses using push and pop.", "A parentheses checker", "The function returns true for balanced input and false otherwise", 2, { kind: "dsa_stack", skillsIntroduced: ["stack"], prerequisites: ["arrays", "conditions"] })
      ],
      checkpoint: "The learner can solve beginner array, map, two-pointer, and stack problems.",
      miniProject: "Problem pattern notebook"
    },
    {
      milestone: "Move toward intermediate reasoning",
      modules: [
        moduleFrom("Explain time complexity", "Attach Big O reasoning to a working solution.", "Write a linear search function and export a short complexity explanation.", "A solution with Big O explanation", "The explanation mentions O(n) and why", 1.5, { kind: "dsa_complexity", skillsIntroduced: ["time complexity"], prerequisites: ["linear search"] }),
        moduleFrom("Debug a failing algorithm test", "Practice reading test failures and fixing logic.", "Fix a function that returns the wrong maximum number from an array.", "A fixed max-number function", "The function passes positive and negative number cases", 1.5, { kind: "dsa_debugging", skillsIntroduced: ["algorithm debugging"], prerequisites: ["arrays", "conditions"], difficulty: "practice" }),
        moduleFrom(`Assemble the ${target}`, "Solve and explain multiple beginner problem-solving patterns.", "Create four solved problems with input, output, tests, and plain-English explanation.", target, "Each problem has a working solution and explanation", 2.5, { kind: "dsa_capstone", skillsPracticed: ["arrays", "linear search", "hash map", "two pointers", "stack", "complexity"], difficulty: "capstone" })
      ],
      checkpoint: `${target} includes working beginner DSA patterns.`,
      miniProject: target
    }
  ];
}

function beginnerSqlMilestones(capstone) {
  const target = capstone.capstone || "SQL Query Practice Pack";
  return [
    {
      milestone: "Start SQL with readable queries",
      modules: [
        moduleFrom("Select columns from a table", "Use SELECT and FROM to read data.", "Write queries that select all columns and specific columns from a learners table.", "Basic SELECT queries", "The file includes SELECT and FROM", 1, { kind: "sql_select", skillsIntroduced: ["SELECT", "FROM"], difficulty: "intro" }),
        moduleFrom("Filter and sort query results", "Use WHERE and ORDER BY.", "Write a query that filters learners by topic and sorts by practice minutes.", "Filtered and sorted query", "The file includes WHERE and ORDER BY", 1, { kind: "sql_where_order", skillsIntroduced: ["WHERE", "ORDER BY"], prerequisites: ["SELECT"] })
      ],
      checkpoint: "The learner can read, filter, and sort rows.",
      miniProject: "Learning table queries"
    },
    {
      milestone: "Modify and summarize data",
      modules: [
        moduleFrom("Insert and update practice rows", "Use INSERT INTO and UPDATE safely.", "Write one INSERT query and one UPDATE query for a practice table.", "Insert/update query set", "The file includes INSERT INTO and UPDATE", 1.5, { kind: "sql_insert_update", skillsIntroduced: ["INSERT", "UPDATE"], prerequisites: ["SELECT"] }),
        moduleFrom("Count and group practice data", "Use aggregate functions and GROUP BY.", "Write queries that count learners by topic and calculate total practice minutes.", "Aggregate query set", "The file includes COUNT, SUM, and GROUP BY", 1.5, { kind: "sql_aggregate", skillsIntroduced: ["COUNT", "SUM", "GROUP BY"], prerequisites: ["WHERE"] })
      ],
      checkpoint: "The learner can modify rows and summarize data.",
      miniProject: "Practice progress summary"
    },
    {
      milestone: `Build the ${target}`,
      modules: [
        moduleFrom("Join learners with lessons", "Use INNER JOIN to combine related tables.", "Write a query that joins learners and lessons by topic or learner id.", "A join query", "The file includes INNER JOIN and ON", 1.5, { kind: "sql_join", skillsIntroduced: ["JOIN"], prerequisites: ["SELECT", "WHERE"] }),
        moduleFrom(`Assemble the ${target}`, "Combine SELECT, filters, sorting, aggregates, and joins.", `Create a small ${target} with six labeled queries for a learning progress database.`, target, "The file includes SELECT, WHERE, ORDER BY, GROUP BY, JOIN, and aggregate functions", 2, { kind: "sql_capstone", skillsPracticed: ["SELECT", "WHERE", "ORDER BY", "GROUP BY", "JOIN", "aggregates"], difficulty: "capstone" })
      ],
      checkpoint: `${target} demonstrates beginner SQL foundations.`,
      miniProject: target
    }
  ];
}

function genericLanguageMilestones(answers, capstone) {
  const language = titleCase(answers.stack || answers.language || answers.goal || "Programming");
  const target = `${language} Fundamentals Practice Pack`;
  return [
    {
      milestone: `Start ${language} from zero`,
      modules: [
        moduleFrom(`Run your first ${language} file`, `Learn how a ${language} program starts and prints output.`, `Create the smallest runnable ${language} file and print your name, goal, and reason.`, "A first runnable file with visible output", "The program prints name, goal, and reason", 1, { kind: "console", skillsIntroduced: ["program structure", "output"], difficulty: "intro" }),
        moduleFrom(`Store values in ${language} variables`, "Use variables to keep text and numbers.", "Create variables for name, topic, and practice days, then print a summary.", "A variable-based summary", "The program defines at least three variables and prints them", 1, { kind: "variables", skillsIntroduced: ["variables"], prerequisites: ["output"], difficulty: "intro" })
      ],
      checkpoint: `The learner can run ${language} and use basic variables.`,
      miniProject: "Learning profile"
    },
    {
      milestone: `Control values in ${language}`,
      modules: [
        moduleFrom("Calculate with numbers and strings", "Combine text, numbers, and simple arithmetic.", "Calculate weekly practice time and print a readable sentence.", "A practice-time calculator", "The output includes a calculated total", 1, { kind: "strings_numbers", skillsIntroduced: ["strings", "numbers"], prerequisites: ["variables"] }),
        moduleFrom("Choose behavior with conditionals", "Use if/else to choose a message.", "Print a beginner message for low confidence and a challenge message for high confidence.", "A conditional recommendation", "The program uses if/else and prints one branch", 1, { kind: "conditions", skillsIntroduced: ["conditions"], prerequisites: ["variables"] })
      ],
      checkpoint: "The learner can calculate and branch.",
      miniProject: "Practice planner"
    },
    {
      milestone: `Organize repeated work in ${language}`,
      modules: [
        moduleFrom("Repeat tasks with a loop", "Use a loop to process several items.", "Print three practice tasks with numbers.", "A numbered checklist", "The program uses a loop and prints at least three items", 1, { kind: "arrays_loops", skillsIntroduced: ["loops", "collections"], prerequisites: ["conditions"] }),
        moduleFrom("Create reusable logic with a function", "Use a function after practicing the basics.", "Write a function that returns a formatted learner summary.", "A reusable summary function", "The program defines and calls a function", 1.5, { kind: "functions", skillsIntroduced: ["functions"], prerequisites: ["loops"] })
      ],
      checkpoint: "The learner can loop and write reusable logic.",
      miniProject: "Summary helper"
    },
    {
      milestone: `Build the ${target}`,
      modules: [
        moduleFrom("Group related data", "Use a record/object/struct-style value to keep related fields together.", "Create a learner profile with name, goal, skills, and confidence.", "A learner profile data structure", "The program stores related profile fields and prints them", 1.5, { kind: "objects", skillsIntroduced: ["structured data"], prerequisites: ["functions"] }),
        moduleFrom(`Assemble the ${target}`, `Combine output, variables, calculations, conditionals, loops, functions, and structured data.`, `Create a console ${target} that prints a profile, checklist, and next step.`, target, "The program demonstrates each beginner language concept", 2, { kind: "capstone", skillsPracticed: ["output", "variables", "conditions", "loops", "functions", "structured data"], difficulty: "capstone" })
      ],
      checkpoint: `${target} demonstrates beginner-to-intermediate foundations.`,
      miniProject: target
    }
  ];
}

function localMilestones(answers, goalType, skillGap, capstone) {
  const w3Course = buildW3SchoolsCourseMilestones(answers, skillGap, capstone);
  if (w3Course) return w3Course.milestones;
  if (isPythonBeginnerPath(answers, skillGap)) return pythonBeginnerMilestones(answers, capstone);
  const text = `${answers.goal || ""} ${answers.stack || ""} ${answers.outcome || ""}`.toLowerCase();
  if (skillGap.actualLevel === "beginner" && /sql|mysql|postgres|database/.test(text)) return beginnerSqlMilestones(capstone);
  if (skillGap.actualLevel === "beginner" && /dsa|algorithm|interview|leetcode/.test(text)) return beginnerDsaMilestones(capstone);
  if (skillGap.actualLevel === "beginner" && /web|html|css|browser/.test(text)) return beginnerWebMilestones(capstone);
  if (skillGap.actualLevel === "beginner" && /javascript|node|js/.test(text)) return beginnerJavaScriptMilestones(capstone);
  if (skillGap.actualLevel === "beginner") return genericLanguageMilestones(answers, capstone);
  const goal = answers.goal || "coding";
  const stack = answers.stack || "JavaScript";
  const project = capstone.capstone;
  const deep = /deep|month|advanced|full/.test(String(answers.depth || "").toLowerCase());
  const milestones = [
    {
      milestone: `Prepare ${stack} workspace for ${goal}`,
      modules: [
        moduleFrom(
          `Create the ${stack} launchpad`,
          `Set up a tiny working environment for ${goal}.`,
          `Create a runnable starter that prints or renders the project name and one learner goal.`,
          "A working launchpad file with a named learning goal",
          "The run command shows the project name and goal"
        ),
        moduleFrom(
          `Map inputs and outputs for ${project}`,
          "Define what the final project must accept, show, or solve.",
          `Write a small data model for ${project} and render or print it clearly.`,
          "A visible project data model",
          "The artifact includes at least two meaningful fields"
        )
      ],
      checkpoint: `Workspace can run and describe ${project}.`,
      miniProject: "Project launchpad"
    },
    {
      milestone: `Build core ${goal} skills`,
      modules: [
        moduleFrom(
          `Implement the first ${project} feature`,
          "Build one concrete feature that moves toward the capstone.",
          `Implement the first user-visible behavior for ${project}.`,
          "A working first feature",
          "The feature changes output based on project data",
          2
        ),
        moduleFrom(
          `Debug a realistic ${stack} mistake`,
          "Practice reading errors and fixing a controlled bug.",
          "Add validation or error handling for one likely beginner mistake.",
          "A safer implementation with one validation path",
          "Invalid input is handled without crashing",
          1.5
        )
      ],
      checkpoint: "Core feature works and one error path is handled.",
      miniProject: "Core feature slice"
    },
    {
      milestone: `Finish and review ${project}`,
      modules: [
        moduleFrom(
          `Assemble the ${project} capstone`,
          "Combine previous pieces into the final practical result.",
          `Create the smallest complete version of ${project}.`,
          `A complete ${project}`,
          "The capstone has setup, core behavior, and final output",
          2.5
        ),
        moduleFrom(
          `Refactor and explain ${project}`,
          "Improve clarity and prove understanding.",
          "Rename unclear pieces, simplify one section, and write a short explanation.",
          "Refactored code plus explanation",
          "The explanation mentions what changed and why",
          1.5
        )
      ],
      checkpoint: `${project} is complete enough to demo.`,
      miniProject: project
    }
  ];
  return deep ? milestones : milestones.slice(0, 3);
}

function isVagueModuleTitle(title) {
  return /^(learn basics|understand core concepts|explore topic|introduction|basics)$/i.test(String(title || "").trim());
}

function inferSkillsFromModule(module = {}) {
  const text = `${module.kind || ""} ${module.title || ""} ${module.objective || ""} ${module.task || ""}`.toLowerCase();
  const pairs = [
    ["environment", /setup|workspace|run|terminal|environment/],
    ["print/output", /print|output|console|display/],
    ["variables", /variable|store|value/],
    ["strings and numbers", /string|number|calculation|f-string/],
    ["input", /input|prompt/],
    ["conditions", /condition|if|else|branch/],
    ["loops", /loop|repeat|for |while/],
    ["lists", /list|array|collection/],
    ["functions", /function|def |return/],
    ["debugging", /debug|error|fix|trace/],
    ["dom", /dom|html|css|button|browser/],
    ["arrays and strings", /array|string|dsa|algorithm/]
  ];
  return pairs.filter(([, pattern]) => pattern.test(text)).map(([skill]) => skill);
}

function enrichModuleMetadata(module, index, previousModules = []) {
  const inferred = inferSkillsFromModule(module);
  const practiced = toSkills(module.skillsPracticed).length ? toSkills(module.skillsPracticed) : inferred;
  const introduced = toSkills(module.skillsIntroduced).length ? toSkills(module.skillsIntroduced) : inferred.slice(0, 2);
  const previousSkills = previousModules.flatMap((item) => [
    ...toSkills(item.skillsIntroduced),
    ...toSkills(item.skillsPracticed)
  ]);
  const prerequisites = toSkills(module.prerequisites).length
    ? toSkills(module.prerequisites)
    : Array.from(new Set(previousSkills)).slice(-4);
  const difficulty = module.difficulty || (index === 0 ? "intro" : index < 4 ? "guided" : index < 8 ? "practice" : "capstone");
  return {
    ...module,
    skillsIntroduced: introduced.length ? introduced : [`part ${index + 1} skill`],
    skillsPracticed: practiced.length ? practiced : introduced,
    prerequisites,
    difficulty,
    remediation:
      module.remediation ||
      `Review ${prerequisites[prerequisites.length - 1] || module.title} in GUIDE.md, run the file, then retry the checkpoint.`
  };
}

function normalizeModule(module, index, fallback) {
  const title = isVagueModuleTitle(module?.title) ? fallback.title : String(module?.title || fallback.title);
  return {
    index,
    title,
    goal: String(module?.objective || module?.goal || fallback.objective),
    objective: String(module?.objective || module?.goal || fallback.objective),
    task: String(module?.task || fallback.task),
    artifact: String(module?.artifact || fallback.artifact),
    validation: String(module?.validation || module?.test || fallback.validation),
    estimatedHours: Number(module?.estimatedHours || fallback.estimatedHours || 1.5),
    kind: String(module?.kind || fallback.kind || ""),
    skillsIntroduced: toSkills(module?.skillsIntroduced || fallback.skillsIntroduced || ""),
    skillsPracticed: toSkills(module?.skillsPracticed || fallback.skillsPracticed || ""),
    prerequisites: toSkills(module?.prerequisites || fallback.prerequisites || ""),
    difficulty: module?.difficulty || fallback.difficulty || "guided",
    remediation: String(module?.remediation || fallback.remediation || ""),
    estimatedMinutes: Number(module?.estimatedMinutes || fallback.estimatedMinutes || 0),
    w3schoolsTopic: String(module?.w3schoolsTopic || fallback.w3schoolsTopic || module?.kind || fallback.kind || ""),
    sourceUrl: String(module?.sourceUrl || fallback.sourceUrl || ""),
    exerciseUrl: String(module?.exerciseUrl || fallback.exerciseUrl || ""),
    milestone: fallback.milestone,
    level: fallback.level,
    outcome: fallback.outcome
  };
}

function normalizeRoadmapPlan(plan, answers, goalType, skillGap, capstone) {
  const topic = titleCase(plan?.topic || answers.goal || "Coding");
  const w3Course = buildW3SchoolsCourseMilestones(answers, skillGap, capstone);
  const w3Track = w3Course?.track || matchW3SchoolsTrack(answers);
  const timePlan = w3Course?.timePlan || learningTimePlan(answers.depth || answers.pace);
  const language = chooseLanguage(answers);
  const level = skillGap.actualLevel;
  const outcome = answers.outcome || capstone.capstone;
  const pace = timePlan.pace || answers.depth || "steady";
  const fallbackMilestones = w3Course?.milestones || localMilestones(answers, goalType.goalType, skillGap, capstone);
  const forceBeginnerSafePath = skillGap.actualLevel === "beginner";
  const rawMilestones = forceBeginnerSafePath
    ? fallbackMilestones
    : Array.isArray(plan?.milestones) && plan.milestones.length
      ? plan.milestones
      : fallbackMilestones;
  let moduleIndex = 0;
  const milestones = rawMilestones.map((milestone, milestoneIndex) => {
    const fallbackMilestone = fallbackMilestones[milestoneIndex] || fallbackMilestones[fallbackMilestones.length - 1];
    const rawModules = Array.isArray(milestone?.modules) && milestone.modules.length ? milestone.modules : fallbackMilestone.modules;
    const modules = rawModules.map((module, localIndex) => {
      const fallback = {
        ...(fallbackMilestone.modules[localIndex] || fallbackMilestone.modules[0]),
        milestone: String(milestone?.milestone || fallbackMilestone.milestone),
        level,
        outcome
      };
      return normalizeModule(module, moduleIndex++, fallback);
    });
    return {
      milestone: String(milestone?.milestone || fallbackMilestone.milestone),
      modules,
      checkpoint: String(milestone?.checkpoint || fallbackMilestone.checkpoint),
      miniProject: String(milestone?.miniProject || fallbackMilestone.miniProject)
    };
  });
  const modules = [];
  for (const module of milestones.flatMap((milestone) => milestone.modules)) {
    modules.push(enrichModuleMetadata({ ...module, index: modules.length }, modules.length, modules));
  }
  const modulesByIndex = new Map(modules.map((module) => [module.index, module]));
  milestones.forEach((milestone) => {
    milestone.modules = milestone.modules.map((module) => modulesByIndex.get(module.index) || module);
  });
  return {
    topic,
    level,
    language,
    outcome,
    pace,
    goalType: goalType.goalType,
    skillGap,
    capstone,
    courseSource: w3Track ? "w3schools-style" : "local-template",
    courseTrack: w3Track
      ? {
          id: w3Track.id,
          label: w3Track.label,
          sourceUrl: w3Track.sourceUrl,
          exerciseUrl: w3Track.exerciseUrl
        }
      : null,
    timePlan,
    depthLevel: timePlan.depthLabel,
    topicOrder: modules.map((module) => module.w3schoolsTopic || module.kind || module.title),
    prerequisites: Array.isArray(plan?.prerequisites)
      ? plan.prerequisites.map(String).slice(0, 6)
      : skillGap.missingPrerequisites,
    milestones,
    modules,
    quality: { validated: true, issues: [] }
  };
}

function critiqueAndRepairRoadmap(plan, answers, goalType, skillGap, capstone) {
  const issues = [];
  const repaired = normalizeRoadmapPlan(plan, answers, goalType, skillGap, capstone);
  repaired.modules = repaired.modules.map((module, index) => {
    if (isVagueModuleTitle(module.title)) {
      issues.push(`Vague module title repaired at part ${index + 1}.`);
      return {
        ...module,
        title: `${module.artifact}: implementation part ${index + 1}`
      };
    }
    return module;
  });
  repaired.milestones = repaired.milestones.map((milestone) => ({
    ...milestone,
    modules: milestone.modules.map((module) => repaired.modules.find((item) => item.index === module.index) || module)
  }));
  repaired.quality = {
    validated: issues.length === 0,
    issues
  };
  return repaired;
}

async function generateMilestoneRoadmap(model, answers, goalType, skillGap, capstone) {
  if (!model) return critiqueAndRepairRoadmap(null, answers, goalType, skillGap, capstone);
  try {
    const plan = await ollamaChatJson(
      model,
      [agentPrompts.orchestrator, agentPrompts.trackMatcher, agentPrompts.roadmapGenerator, agentPrompts.roadmapCritic].join("\n\n"),
      JSON.stringify({
        goal: answers.goal,
        experience: answers.experience,
        stack: answers.stack,
        outcome: answers.outcome,
        depth: answers.depth,
        learningStyle: answers.learningStyle,
        constraints: answers.constraints,
        matchedTrack: matchW3SchoolsTrack(answers)?.label || chooseLanguage(answers),
        goalType,
        skillGap,
        capstone
      }, null, 2)
    );
    return critiqueAndRepairRoadmap(plan, answers, goalType, skillGap, capstone);
  } catch {
    return critiqueAndRepairRoadmap(null, answers, goalType, skillGap, capstone);
  }
}

async function generateRoadmapPlanFromOllama(model, transcript, fallbackAnswers) {
  const answers = {
    ...normalizeInterviewState(transcript),
    ...fallbackAnswers
  };
  const goalType = classifyGoal(answers);
  const skillGap = analyzeSkillGap(answers);
  const capstone = designCapstone(answers, goalType.goalType);
  return generateMilestoneRoadmap(model, answers, goalType, skillGap, capstone);
}

function lessonDocs(roadmap, module, profile) {
  const capstone = roadmap.capstone?.capstone || roadmap.outcome;
  return {
    "README.md": [
      `# ${module.title}`,
      "",
      `This lesson exists because your final target is **${capstone}**.`,
      "",
      `Objective: ${module.objective || module.goal}`,
      `Stack: ${profile.label}`,
      roadmap.courseTrack?.sourceUrl ? `Course reference: ${roadmap.courseTrack.sourceUrl}` : "",
      `Artifact: ${module.artifact}`,
      module.estimatedMinutes ? `Estimated time: ${module.estimatedMinutes} minutes` : "",
      `Difficulty: ${module.difficulty || "guided"}`,
      `Skills: ${toSkills(module.skillsPracticed).join(", ") || module.title}`,
      "",
      "Use the guide, build the artifact, then run the checkpoint.",
      ""
    ].join("\n"),
    "GUIDE.md": [
      `# Guide: ${module.title}`,
      "",
      "1. Read the task and artifact requirement.",
      `2. Open \`${profile.entryFile}\` and inspect the starter structure.`,
      `3. Implement the behavior described here: ${module.task}`,
      `4. Confirm the artifact is visible or returned: ${module.artifact}`,
      "5. Run the checkpoint and improve the implementation if it fails.",
      module.remediation ? `6. If the checkpoint fails repeatedly: ${module.remediation}` : "",
      "",
      "Reference the solution file only after you have made a real attempt.",
      ""
    ].join("\n"),
    "TASK.md": [
      `# Task`,
      "",
      module.task,
      "",
      "## Deliverable",
      module.artifact,
      ""
    ].join("\n"),
    "CHECKPOINT.md": [
      `# Checkpoint`,
      "",
      `Validation: ${module.validation}`,
      "",
      `Run: \`${profile.checkpointCommand}\``,
      "",
      `Prerequisites: ${toSkills(module.prerequisites).join(", ") || "none"}`,
      `Remediation: ${module.remediation || "Read GUIDE.md and retry with a smaller change."}`,
      "",
      "The checkpoint passes only when the starter artifact has been completed.",
      ""
    ].join("\n")
  };
}

function jsLessonFiles(_roadmap, module, index) {
  const kind = module.kind || "console";
  const starterByKind = {
    console: [
      "const learnerName = \"Learner\";",
      "const goal = \"learn JavaScript\";",
      "const reason = \"I want to understand code step by step\";",
      "",
      "console.log(\"Name:\", learnerName);",
      "console.log(\"Goal:\", goal);",
      "// Add one more console.log line for the reason.",
      ""
    ],
    comments: [
      "// Step 1: store the learner name.",
      "const learnerName = \"Learner\";",
      "",
      "// Step 2: store the learning topic.",
      "const topic = \"JavaScript\";",
      "",
      "// Step 3: print a readable sentence.",
      "console.log(`${learnerName} is learning ${topic}`);",
      ""
    ],
    variables: [
      "const learnerName = \"Learner\";",
      "const topic = \"JavaScript\";",
      "let daysPerWeek = 3;",
      "",
      "console.log(\"Name:\", learnerName);",
      "console.log(\"Topic:\", topic);",
      "// Print daysPerWeek in a full sentence.",
      ""
    ],
    strings_numbers: [
      "const minutesPerDay = 20;",
      "const daysPerWeek = 3;",
      "const weeklyMinutes = minutesPerDay;",
      "",
      "// Update weeklyMinutes so it multiplies minutesPerDay by daysPerWeek.",
      "console.log(`Weekly practice: ${weeklyMinutes} minutes`);",
      ""
    ],
    operators_types: [
      "const minutesPerDay = 20;",
      "const daysPerWeek = 3;",
      "const weeklyMinutes = minutesPerDay + daysPerWeek;",
      "const enoughPractice = weeklyMinutes > 50;",
      "",
      "// Fix weeklyMinutes so it uses multiplication.",
      "console.log(typeof minutesPerDay);",
      "console.log(typeof enoughPractice);",
      "console.log(`Enough practice: ${enoughPractice}`);",
      ""
    ],
    string_methods: [
      "const goal = \"learn JavaScript fundamentals\";",
      "",
      "const loudGoal = goal;",
      "const firstWord = goal;",
      "const mentionsJavaScript = false;",
      "",
      "// Use toUpperCase(), slice(), and includes().",
      "console.log(loudGoal, firstWord, mentionsJavaScript);",
      ""
    ],
    conditions: [
      "const confidence = 2;",
      "let message = \"\";",
      "",
      "if (confidence >= 4) {",
      "  message = \"Try a challenge exercise\";",
      "} else {",
      "  message = \"Practice one small example\";",
      "}",
      "",
      "console.log(message);",
      ""
    ],
    arrays_loops: [
      "const tasks = [\"print text\", \"store a variable\", \"run the file\"];",
      "",
      "// Print each task with a number using forEach.",
      "tasks.forEach((task, index) => {",
      "  console.log(index + 1, task);",
      "});",
      ""
    ],
    array_methods: [
      "const skills = [\"console\", \"variables\"];",
      "",
      "// Add \"loops\", then create uppercase labels and long skill names.",
      "console.log(skills);",
      ""
    ],
    array_push: [
      "const skills = [\"console output\", \"variables\"];",
      "",
      "// Add \"loops\" to the skills array using push.",
      "console.log(skills);",
      ""
    ],
    functions: [
      "function learnerSummary(name, goal, skills) {",
      "  const skillText = skills.join(\", \");",
      "  return `${name} is learning ${goal}. Skills: ${skillText}`;",
      "}",
      "",
      "const summary = learnerSummary(\"Learner\", \"JavaScript\", [\"console output\", \"variables\"]);",
      "console.log(summary);",
      "",
      "module.exports = { learnerSummary };",
      ""
    ],
    objects: [
      "const learner = {",
      "  name: \"Learner\",",
      "  goal: \"JavaScript fundamentals\",",
      "  skills: [\"console output\", \"variables\", \"conditions\"],",
      "  confidence: 3",
      "};",
      "",
      "console.log(`${learner.name} is learning ${learner.goal}`);",
      "console.log(`Skills: ${learner.skills.join(\", \")}`);",
      "",
      "module.exports = { learner };",
      ""
    ],
    classes: [
      "class Learner {",
      "  constructor(name, goal) {",
      "    this.name = name;",
      "    this.goal = goal;",
      "  }",
      "",
      "  summary() {",
      "    return `${this.name} is learning ${this.goal}`;",
      "  }",
      "}",
      "",
      "const learner = new Learner(\"Learner\", \"JavaScript\");",
      "console.log(learner.summary());",
      "",
      "module.exports = { Learner };",
      ""
    ],
    dom_events_model: [
      "const domPlan = {",
      "  selector: \"#status\",",
      "  event: \"click\",",
      "  property: \"textContent\"",
      "};",
      "",
      "function updateStatusText(plan) {",
      "  return `Use querySelector(${plan.selector}), addEventListener(${plan.event}), and update ${plan.property}`;",
      "}",
      "",
      "console.log(updateStatusText(domPlan));",
      "module.exports = { domPlan, updateStatusText };",
      ""
    ],
    async_practice: [
      "function loadLearningMessage() {",
      "  return Promise.resolve(\"JavaScript async practice loaded\");",
      "}",
      "",
      "async function showMessage() {",
      "  const message = await loadLearningMessage();",
      "  console.log(message);",
      "  return message;",
      "}",
      "",
      "showMessage();",
      "module.exports = { loadLearningMessage, showMessage };",
      ""
    ],
    debugging: [
      "const learnerName = \"Learner\";",
      "const goal = \"JavaScript fundamentals\";",
      "",
      "function buildSummary(name, topic) {",
      "  return `${name} is practicing ${topic}`;",
      "}",
      "",
      "// Fix the variable name in this call so the file runs.",
      "console.log(buildSummary(studentName, goal));",
      ""
    ],
    capstone: [
      "const learner = {",
      "  name: \"Learner\",",
      "  goal: \"JavaScript fundamentals\",",
      "  skills: [\"console output\", \"variables\", \"conditions\", \"arrays\", \"loops\"],",
      "  confidence: 3",
      "};",
      "",
      "function nextStep(confidence) {",
      "  if (confidence >= 4) {",
      "    return \"Build a small project\";",
      "  }",
      "  return \"Review fundamentals and practice again\";",
      "}",
      "",
      "console.log(\"JavaScript Practice Pack\");",
      "console.log(\"Name:\", learner.name);",
      "learner.skills.forEach((skill) => {",
      "  console.log(\"Skill:\", skill);",
      "});",
      "console.log(\"Next:\", nextStep(learner.confidence));",
      "",
      "module.exports = { learner, nextStep };",
      ""
    ],
    dsa_trace_array: [
      "const values = [4, 7, 2];",
      "",
      "values.forEach((value, index) => {",
      "  console.log(index, value);",
      "});",
      ""
    ],
    dsa_linear_search: [
      "function findIndex(values, target) {",
      "  for (let index = 0; index < values.length; index += 1) {",
      "    if (values[index] === target) {",
      "      return index;",
      "    }",
      "  }",
      "  return -1;",
      "}",
      "",
      "module.exports = { findIndex };",
      ""
    ],
    dsa_frequency: [
      "function countValues(items) {",
      "  const counts = {};",
      "  for (const item of items) {",
      "    counts[item] = (counts[item] || 0) + 1;",
      "  }",
      "  return counts;",
      "}",
      "",
      "module.exports = { countValues };",
      ""
    ],
    dsa_two_pointers: [
      "function hasPairWithSum(numbers, target) {",
      "  let left = 0;",
      "  let right = numbers.length - 1;",
      "  while (left < right) {",
      "    const sum = numbers[left] + numbers[right];",
      "    if (sum === target) return true;",
      "    if (sum < target) left += 1;",
      "    else right -= 1;",
      "  }",
      "  return false;",
      "}",
      "",
      "module.exports = { hasPairWithSum };",
      ""
    ],
    dsa_stack: [
      "function isBalanced(text) {",
      "  const stack = [];",
      "  for (const char of text) {",
      "    if (char === \"(\") stack.push(char);",
      "    if (char === \")\") {",
      "      if (stack.length === 0) return false;",
      "      stack.pop();",
      "    }",
      "  }",
      "  return stack.length === 0;",
      "}",
      "",
      "module.exports = { isBalanced };",
      ""
    ],
    dsa_complexity: [
      "function findIndex(values, target) {",
      "  for (let index = 0; index < values.length; index += 1) {",
      "    if (values[index] === target) return index;",
      "  }",
      "  return -1;",
      "}",
      "",
      "const complexity = \"O(n) because the loop may inspect every item once\";",
      "module.exports = { findIndex, complexity };",
      ""
    ],
    dsa_debugging: [
      "function maxNumber(values) {",
      "  let max = 0;",
      "  for (const value of values) {",
      "    if (value > max) max = value;",
      "  }",
      "  return max;",
      "}",
      "",
      "module.exports = { maxNumber };",
      ""
    ],
    dsa_capstone: [
      "function findIndex(values, target) {",
      "  return values.indexOf(target);",
      "}",
      "",
      "function countValues(items) {",
      "  const counts = {};",
      "  for (const item of items) counts[item] = (counts[item] || 0) + 1;",
      "  return counts;",
      "}",
      "",
      "function hasPairWithSum(numbers, target) {",
      "  let left = 0;",
      "  let right = numbers.length - 1;",
      "  while (left < right) {",
      "    const sum = numbers[left] + numbers[right];",
      "    if (sum === target) return true;",
      "    if (sum < target) left += 1;",
      "    else right -= 1;",
      "  }",
      "  return false;",
      "}",
      "",
      "const explanations = [\"linear search is O(n)\", \"frequency map counts repeated values\", \"two pointers move inward on sorted data\"];",
      "module.exports = { findIndex, countValues, hasPairWithSum, explanations };",
      ""
    ]
  };
  const solutionByKind = {
    console: [
      "const learnerName = \"Learner\";",
      "const goal = \"learn JavaScript\";",
      "const reason = \"I want to understand code step by step\";",
      "",
      "console.log(\"Name:\", learnerName);",
      "console.log(\"Goal:\", goal);",
      "console.log(\"Reason:\", reason);",
      ""
    ],
    comments: starterByKind.comments,
    variables: [
      "const learnerName = \"Learner\";",
      "const topic = \"JavaScript\";",
      "let daysPerWeek = 3;",
      "",
      "console.log(\"Name:\", learnerName);",
      "console.log(\"Topic:\", topic);",
      "console.log(`Practice days per week: ${daysPerWeek}`);",
      ""
    ],
    strings_numbers: [
      "const minutesPerDay = 20;",
      "const daysPerWeek = 3;",
      "const weeklyMinutes = minutesPerDay * daysPerWeek;",
      "",
      "console.log(`Weekly practice: ${weeklyMinutes} minutes`);",
      ""
    ],
    operators_types: [
      "const minutesPerDay = 20;",
      "const daysPerWeek = 3;",
      "const weeklyMinutes = minutesPerDay * daysPerWeek;",
      "const enoughPractice = weeklyMinutes > 50;",
      "",
      "console.log(typeof minutesPerDay);",
      "console.log(typeof enoughPractice);",
      "console.log(`Enough practice: ${enoughPractice}`);",
      ""
    ],
    string_methods: [
      "const goal = \"learn JavaScript fundamentals\";",
      "",
      "const loudGoal = goal.toUpperCase();",
      "const firstWord = goal.slice(0, 5);",
      "const mentionsJavaScript = goal.includes(\"JavaScript\");",
      "",
      "console.log(loudGoal, firstWord, mentionsJavaScript);",
      ""
    ],
    conditions: starterByKind.conditions,
    arrays_loops: starterByKind.arrays_loops,
    array_push: [
      "const skills = [\"console output\", \"variables\"];",
      "",
      "skills.push(\"loops\");",
      "console.log(skills);",
      ""
    ],
    array_methods: [
      "const skills = [\"console\", \"variables\"];",
      "",
      "skills.push(\"loops\");",
      "const labels = skills.map((skill) => skill.toUpperCase());",
      "const longSkills = skills.filter((skill) => skill.length > 5);",
      "console.log(labels, longSkills);",
      ""
    ],
    functions: starterByKind.functions,
    objects: starterByKind.objects,
    classes: starterByKind.classes,
    dom_events_model: starterByKind.dom_events_model,
    async_practice: starterByKind.async_practice,
    debugging: [
      "const learnerName = \"Learner\";",
      "const goal = \"JavaScript fundamentals\";",
      "",
      "function buildSummary(name, topic) {",
      "  return `${name} is practicing ${topic}`;",
      "}",
      "",
      "console.log(buildSummary(learnerName, goal));",
      ""
    ],
    capstone: starterByKind.capstone,
    dsa_trace_array: starterByKind.dsa_trace_array,
    dsa_linear_search: starterByKind.dsa_linear_search,
    dsa_frequency: starterByKind.dsa_frequency,
    dsa_two_pointers: starterByKind.dsa_two_pointers,
    dsa_stack: starterByKind.dsa_stack,
    dsa_complexity: starterByKind.dsa_complexity,
    dsa_debugging: [
      "function maxNumber(values) {",
      "  let max = values[0];",
      "  for (const value of values) {",
      "    if (value > max) max = value;",
      "  }",
      "  return max;",
      "}",
      "",
      "module.exports = { maxNumber };",
      ""
    ],
    dsa_capstone: starterByKind.dsa_capstone
  };
  const testByKind = {
    console: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if ((source.match(/console\\.log\\(/g) || []).length < 3) {",
      "  console.log(\"Add three console.log lines: name, goal, and reason.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    comments: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if ((source.match(/\\/\\//g) || []).length < 3 || (source.match(/;/g) || []).length < 3) {",
      "  console.log(\"Add at least three comments and three statements.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    variables: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "[\"learnerName\", \"topic\", \"daysPerWeek\"].forEach((name) => {",
      "  if (!source.includes(name)) {",
      "    console.log(`Define the variable: ${name}`);",
      "    process.exit(1);",
      "  }",
      "});",
      "if ((source.match(/console\\.log\\(/g) || []).length < 3) {",
      "  console.log(\"Print daysPerWeek in a full sentence.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    strings_numbers: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\").replace(/\\s/g, \"\");",
      "if (!source.includes(\"minutesPerDay*daysPerWeek\")) {",
      "  console.log(\"Calculate weeklyMinutes by multiplying minutesPerDay and daysPerWeek.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    operators_types: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\").replace(/\\s/g, \"\");",
      "if (!source.includes(\"minutesPerDay*daysPerWeek\") || !source.includes(\"typeof\") || !source.includes(\">50\")) {",
      "  console.log(\"Use multiplication, typeof, and a comparison.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    string_methods: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "for (const method of [\"toUpperCase\", \"slice\", \"includes\"]) {",
      "  if (!source.includes(method)) { console.log(`Use ${method}().`); process.exit(1); }",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    conditions: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if (!source.includes(\"if\") || !source.includes(\"else\")) {",
      "  console.log(\"Use both if and else.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    arrays_loops: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if (!source.includes(\"tasks\") || !/forEach|for\\s*\\(/.test(source)) {",
      "  console.log(\"Use an array and a loop to print the tasks.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    array_push: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if (!source.includes(\".push(\") || !source.includes(\"loops\")) {",
      "  console.log(\"Use push to add loops to the skills array.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    array_methods: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "for (const method of [\".push(\", \".map(\", \".filter(\"]) {",
      "  if (!source.includes(method)) { console.log(`Use ${method}`); process.exit(1); }",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    functions: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if (!source.includes(\"function learnerSummary\") || !source.includes(\"return\")) {",
      "  console.log(\"Define learnerSummary and return formatted text.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    objects: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if (!source.includes(\"const learner\") || !source.includes(\"skills\") || !source.includes(\"confidence\")) {",
      "  console.log(\"Create a learner object with name, goal, skills, and confidence.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    classes: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if (!source.includes(\"class Learner\") || !source.includes(\"constructor\") || !source.includes(\"summary\")) {",
      "  console.log(\"Define a Learner class with constructor and summary method.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    dom_events_model: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "for (const word of [\"querySelector\", \"addEventListener\", \"textContent\"]) {",
      "  if (!source.includes(word)) { console.log(`Mention ${word}.`); process.exit(1); }",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    async_practice: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "for (const word of [\"Promise\", \"async\", \"await\"]) {",
      "  if (!source.includes(word)) { console.log(`Use ${word}.`); process.exit(1); }",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    debugging: [
      "const result = require(\"child_process\").spawnSync(\"node\", [\"main.js\"], { encoding: \"utf8\" });",
      "if (result.status !== 0 || /ReferenceError/.test(result.stderr)) {",
      "  console.log(\"Fix the broken variable name so main.js runs without ReferenceError.\");",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ],
    capstone: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "[\"const learner\", \"function nextStep\", \"forEach\", \"if\"].forEach((piece) => {",
      "  if (!source.includes(piece)) {",
      "    console.log(`Missing capstone piece: ${piece}`);",
      "    process.exit(1);",
      "  }",
      "});",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_trace_array: [
      "const source = require(\"fs\").readFileSync(\"main.js\", \"utf8\");",
      "if (!source.includes(\"forEach\") || !source.includes(\"index\")) { console.log(\"Trace each value with its index.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_linear_search: [
      "const { findIndex } = require(\"./main\");",
      "if (findIndex([4, 7, 2], 7) !== 1 || findIndex([4, 7, 2], 9) !== -1) { console.log(\"findIndex must return the found index or -1.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_frequency: [
      "const { countValues } = require(\"./main\");",
      "const counts = countValues([\"js\", \"py\", \"js\"]);",
      "if (counts.js !== 2 || counts.py !== 1) { console.log(\"countValues must count repeated values.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_two_pointers: [
      "const { hasPairWithSum } = require(\"./main\");",
      "if (!hasPairWithSum([1, 2, 4, 7], 9) || hasPairWithSum([1, 2, 4, 7], 20)) { console.log(\"hasPairWithSum must handle found and missing pairs.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_stack: [
      "const { isBalanced } = require(\"./main\");",
      "if (!isBalanced(\"(())\") || isBalanced(\"(()\")) { console.log(\"isBalanced must validate parentheses.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_complexity: [
      "const { findIndex, complexity } = require(\"./main\");",
      "if (findIndex([1, 2, 3], 3) !== 2 || !String(complexity).includes(\"O(n)\")) { console.log(\"Export a working search and O(n) explanation.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_debugging: [
      "const { maxNumber } = require(\"./main\");",
      "if (maxNumber([-5, -2, -9]) !== -2 || maxNumber([3, 8, 1]) !== 8) { console.log(\"Fix maxNumber for positive and negative arrays.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ],
    dsa_capstone: [
      "const solution = require(\"./main\");",
      "for (const name of [\"findIndex\", \"countValues\", \"hasPairWithSum\", \"explanations\"]) { if (!(name in solution)) { console.log(`Missing ${name}`); process.exit(1); } }",
      "if (!Array.isArray(solution.explanations) || solution.explanations.length < 3) { console.log(\"Add plain-English explanations.\"); process.exit(1); }",
      "console.log(\"PASS\");",
      ""
    ]
  };
  return {
    "main.js": (starterByKind[kind] || starterByKind.console).join("\n"),
    "solution.js": (solutionByKind[kind] || solutionByKind.console).join("\n"),
    "check.js": (testByKind[kind] || testByKind.console).join("\n")
  };
}

function pythonSafeName(value, fallback) {
  return slugify(value).replace(/-/g, "_").slice(0, 28) || fallback;
}

function pythonTestImport(entryFile) {
  return path.basename(entryFile, ".py");
}

function pythonLessonFiles(_roadmap, module, index, entryFile = "main.py", testFile = "test_part.py") {
  const importName = pythonTestImport(entryFile);
  const kind = module.kind || "artifact";
  const starterByKind = {
    print: [
      "name = \"Learner\"",
      "goal = \"learn Python\"",
      "reason = \"I want to build confidence with code\"",
      "",
      "print(\"Name:\", name)",
      "print(\"Goal:\", goal)",
      "# Add one more print line for the reason.",
      ""
    ],
    variables: [
      "name = \"Learner\"",
      "topic = \"Python\"",
      "days_per_week = 3",
      "",
      "print(\"Name:\", name)",
      "print(\"Topic:\", topic)",
      "# Print days_per_week in a full sentence.",
      ""
    ],
    strings_numbers: [
      "minutes_per_day = 20",
      "days_per_week = 3",
      "weekly_minutes = minutes_per_day",
      "",
      "# Update weekly_minutes so it multiplies minutes_per_day by days_per_week.",
      "print(f\"Weekly practice: {weekly_minutes} minutes\")",
      ""
    ],
    input: [
      "prompt_message = \"What is your Python goal? \"",
      "sample_answer = \"learn Python basics\"",
      "",
      "# Real input looks like this: user_answer = input(prompt_message)",
      "# For this checkpoint, print the safe sample_answer instead.",
      "print(prompt_message + sample_answer)",
      ""
    ],
    conditions: [
      "confidence = 2",
      "",
      "if confidence >= 4:",
      "    message = \"Try a challenge exercise\"",
      "else:",
      "    message = \"Practice one small example\"",
      "",
      "print(message)",
      ""
    ],
    loops: [
      "tasks = [\"print text\", \"store a variable\", \"run the file\"]",
      "",
      "# Print each task with a number using a for loop.",
      "for index, task in enumerate(tasks, start=1):",
      "    print(index, task)",
      ""
    ],
    lists: [
      "skills = [\"print\", \"variables\"]",
      "",
      "# Add \"loops\" to the skills list using append.",
      "print(skills)",
      ""
    ],
    dictionaries: [
      "learner = {",
      "    \"name\": \"Learner\",",
      "    \"goal\": \"Python fundamentals\",",
      "    \"skills\": [\"print\", \"variables\", \"lists\"]",
      "}",
      "",
      "# Print name, goal, and skills from the dictionary.",
      "print(learner[\"name\"])",
      ""
    ],
    sets_tuples: [
      "fixed_goals = (\"run files\", \"write variables\", \"practice loops\")",
      "unique_skills = {\"print\", \"variables\", \"print\"}",
      "",
      "# Print both collections and notice duplicate set values are removed.",
      "print(fixed_goals)",
      "print(unique_skills)",
      ""
    ],
    errors: [
      "practice_minutes = \"twenty\"",
      "",
      "# Use try/except to convert practice_minutes safely.",
      "try:",
      "    minutes = int(practice_minutes)",
      "    print(minutes)",
      "except ValueError:",
      "    print(\"Use a number for practice minutes\")",
      ""
    ],
    files: [
      "note = \"Today I practiced Python fundamentals.\"",
      "",
      "# Write note to notes.txt, then read it back.",
      "with open(\"notes.txt\", \"w\", encoding=\"utf8\") as file:",
      "    file.write(note)",
      "",
      "with open(\"notes.txt\", \"r\", encoding=\"utf8\") as file:",
      "    print(file.read())",
      ""
    ],
    classes: [
      "class Learner:",
      "    def __init__(self, name, goal):",
      "        self.name = name",
      "        self.goal = goal",
      "",
      "    def summary(self):",
      "        return f\"{self.name} is learning {self.goal}\"",
      "",
      "learner = Learner(\"Learner\", \"Python\")",
      "print(learner.summary())",
      ""
    ],
    functions: [
      "def learner_summary(name, goal, skills):",
      "    skill_text = \", \".join(skills)",
      "    return f\"{name} is learning {goal}. Skills: {skill_text}\"",
      "",
      "summary = learner_summary(\"Learner\", \"Python\", [\"print\", \"variables\"])",
      "print(summary)",
      ""
    ],
    capstone: [
      "name = \"Learner\"",
      "goal = \"Python fundamentals\"",
      "skills = [\"print\", \"variables\", \"conditions\", \"loops\", \"lists\"]",
      "confidence = 3",
      "",
      "def next_step(confidence_level):",
      "    if confidence_level >= 4:",
      "        return \"Build a small project\"",
      "    return \"Review fundamentals and practice again\"",
      "",
      "print(\"Python Practice Pack\")",
      "print(\"Name:\", name)",
      "for skill in skills:",
      "    print(\"Skill:\", skill)",
      "print(\"Next:\", next_step(confidence))",
      ""
    ]
  };
  const solutionByKind = {
    print: [
      "name = \"Learner\"",
      "goal = \"learn Python\"",
      "reason = \"I want to build confidence with code\"",
      "",
      "print(\"Name:\", name)",
      "print(\"Goal:\", goal)",
      "print(\"Reason:\", reason)",
      ""
    ],
    variables: [
      "name = \"Learner\"",
      "topic = \"Python\"",
      "days_per_week = 3",
      "",
      "print(\"Name:\", name)",
      "print(\"Topic:\", topic)",
      "print(f\"Practice days per week: {days_per_week}\")",
      ""
    ],
    strings_numbers: [
      "minutes_per_day = 20",
      "days_per_week = 3",
      "weekly_minutes = minutes_per_day * days_per_week",
      "",
      "print(f\"Weekly practice: {weekly_minutes} minutes\")",
      ""
    ],
    input: [
      "prompt_message = \"What is your Python goal? \"",
      "sample_answer = \"learn Python basics\"",
      "",
      "# Real input looks like this: user_answer = input(prompt_message)",
      "print(prompt_message + sample_answer)",
      ""
    ],
    conditions: starterByKind.conditions,
    loops: starterByKind.loops,
    lists: [
      "skills = [\"print\", \"variables\"]",
      "",
      "skills.append(\"loops\")",
      "print(skills)",
      ""
    ],
    dictionaries: starterByKind.dictionaries,
    sets_tuples: starterByKind.sets_tuples,
    errors: starterByKind.errors,
    files: starterByKind.files,
    classes: starterByKind.classes,
    functions: starterByKind.functions,
    capstone: starterByKind.capstone
  };
  const testByKind = {
    print: [
      `import ${importName}`,
      "",
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if source.count(\"print(\") < 3:",
      "    raise SystemExit(\"Add three print lines: name, goal, and reason.\")",
      "print(\"PASS\")",
      ""
    ],
    variables: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "for expected in [\"name\", \"topic\", \"days_per_week\"]:",
      "    if expected not in source:",
      "        raise SystemExit(f\"Define the variable: {expected}\")",
      "if source.count(\"print(\") < 3:",
      "    raise SystemExit(\"Print days_per_week in a sentence.\")",
      "print(\"PASS\")",
      ""
    ],
    strings_numbers: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"minutes_per_day*days_per_week\" not in source.replace(\" \", \"\"):",
      "    raise SystemExit(\"Calculate weekly_minutes by multiplying minutes_per_day and days_per_week.\")",
      "print(\"PASS\")",
      ""
    ],
    input: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"input(\" not in source or \"sample_answer\" not in source:",
      "    raise SystemExit(\"Show input() and use sample_answer so the checkpoint does not hang.\")",
      "if \"print(\" not in source:",
      "    raise SystemExit(\"Print the prompt and sample answer.\")",
      "print(\"PASS\")",
      ""
    ],
    conditions: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"if \" not in source or \"else\" not in source:",
      "    raise SystemExit(\"Use both if and else.\")",
      "print(\"PASS\")",
      ""
    ],
    loops: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"for \" not in source or \"tasks\" not in source:",
      "    raise SystemExit(\"Use a for loop over the tasks list.\")",
      "print(\"PASS\")",
      ""
    ],
    lists: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \".append(\" not in source or \"loops\" not in source:",
      "    raise SystemExit(\"Use append to add loops to the skills list.\")",
      "print(\"PASS\")",
      ""
    ],
    dictionaries: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"learner\" not in source or \"{\" not in source or source.count(\"[\") < 1:",
      "    raise SystemExit(\"Create a learner dictionary and read its values.\")",
      "print(\"PASS\")",
      ""
    ],
    sets_tuples: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"fixed_goals\" not in source or \"unique_skills\" not in source or \"{\" not in source:",
      "    raise SystemExit(\"Create both a tuple and a set.\")",
      "print(\"PASS\")",
      ""
    ],
    errors: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"try:\" not in source or \"except\" not in source:",
      "    raise SystemExit(\"Use try and except for safe conversion.\")",
      "print(\"PASS\")",
      ""
    ],
    files: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"open(\" not in source or \"notes.txt\" not in source:",
      "    raise SystemExit(\"Write and read notes.txt using open().\")",
      "print(\"PASS\")",
      ""
    ],
    classes: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"class Learner\" not in source or \"def summary\" not in source:",
      "    raise SystemExit(\"Define Learner and a summary method.\")",
      "print(\"PASS\")",
      ""
    ],
    functions: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "if \"def learner_summary\" not in source or \"return\" not in source:",
      "    raise SystemExit(\"Define learner_summary and return formatted text.\")",
      "print(\"PASS\")",
      ""
    ],
    capstone: [
      `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
      "for expected in [\"def next_step\", \"for skill in skills\", \"if confidence_level\"]:",
      "    if expected not in source:",
      "        raise SystemExit(f\"Missing capstone piece: {expected}\")",
      "print(\"PASS\")",
      ""
    ]
  };
  const starter = starterByKind[kind] || [
    `print(${JSON.stringify(module.title)})`,
    `print(${JSON.stringify(module.artifact)})`,
    ""
  ];
  const solution = solutionByKind[kind] || starter;
  const test = testByKind[kind] || [
    `source = open(${JSON.stringify(entryFile)}, "r", encoding="utf8").read()`,
    "if len(source.strip()) < 20:",
    "    raise SystemExit(\"Complete the Python exercise.\")",
    "print(\"PASS\")",
    ""
  ];
  return {
    [entryFile]: starter.join("\n"),
    [`solution_${path.basename(entryFile)}`]: solution.join("\n"),
    [testFile]: test.join("\n")
  };
}

function webLessonFiles(_roadmap, module, index) {
  const kind = module.kind || "html_structure";
  const baseHtml = (body) => [
    "<!doctype html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"UTF-8\" />",
    "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
    `    <title>${module.title}</title>`,
    "    <link rel=\"stylesheet\" href=\"style.css\" />",
    "  </head>",
    "  <body>",
    ...body.map((line) => `    ${line}`),
    "    <script src=\"script.js\"></script>",
    "  </body>",
    "</html>",
    ""
  ].join("\n");
  const htmlByKind = {
    html_structure: baseHtml([
      "<main>",
      "  <h1>My Web Learning Page</h1>",
      "  <p>I am learning HTML from the beginning.</p>",
      "  <ul>",
      "    <li>Write HTML</li>",
      "    <li>Preview pages</li>",
      "    <!-- Add one more learning goal li. -->",
      "  </ul>",
      "</main>"
    ]),
    html_sections: baseHtml([
      "<header><h1>Web Learning Notes</h1></header>",
      "<main>",
      "  <section>",
      "    <h2>Goal</h2>",
      "    <p>Learn web development step by step.</p>",
      "    <!-- Add a link to a learning resource. -->",
      "  </section>",
      "</main>"
    ]),
    web_tables_forms: baseHtml([
      "<main>",
      "  <h1>Learning Form</h1>",
      "  <!-- Add a form with an input and label. -->",
      "  <table><tr><th>Topic</th><th>Status</th></tr><tr><td>HTML</td><td>Started</td></tr></table>",
      "</main>"
    ]),
    web_media: baseHtml([
      "<main>",
      "  <h1>Media Practice</h1>",
      "  <!-- Add an image with useful alt text. -->",
      "</main>"
    ]),
    web_accessibility: baseHtml([
      "<main>",
      "  <h1>Accessible Practice Page</h1>",
      "  <label for=\"goalInput\">Learning goal</label>",
      "  <input id=\"goalInput\" />",
      "  <!-- Add helpful alt text or aria-label content. -->",
      "</main>"
    ]),
    css_selectors: baseHtml(["<main class=\"card\"><h1>Styled Page</h1><p>Make this readable.</p><ul><li>HTML</li><li>CSS</li><li>JavaScript</li></ul><a href=\"#\">Learning link</a></main>"]),
    box_model: baseHtml(["<main><section class=\"card\"><h1>Box Model Card</h1><p>Use spacing, border, and width.</p></section></main>"]),
    flexbox: baseHtml(["<main><h1>Skill Row</h1><div class=\"skills\"><span>HTML</span><span>CSS</span><span>JS</span></div></main>"]),
    css_grid: baseHtml(["<main><h1>Grid Practice</h1><div class=\"grid\"><section>HTML</section><section>CSS</section></div></main>"]),
    responsive: baseHtml(["<main class=\"card\"><h1>Responsive Page</h1><p>This card should fit mobile and desktop screens.</p></main>"]),
    css_transitions: baseHtml(["<main><h1>Transition Practice</h1><button>Hover me</button></main>"]),
    dom_text: baseHtml(["<main><h1>Interactive Status</h1><p id=\"status\">Not started</p><button id=\"runButton\">Update status</button></main>"]),
    form_input: baseHtml(["<main><h1>Greeting Form</h1><input id=\"nameInput\" placeholder=\"Your name\" /><button id=\"runButton\">Greet</button><p id=\"message\">Waiting...</p></main>"]),
    web_debugging: baseHtml(["<main><h1>Debug Button</h1><p id=\"status\">Broken</p><button id=\"runButton\">Fix me</button></main>"]),
    web_capstone: baseHtml(["<header><h1>Web Practice Pack</h1></header><main class=\"card\"><section><h2>Profile</h2><p id=\"status\">Ready to learn</p></section><section class=\"skills\"><span>HTML</span><span>CSS</span><span>JavaScript</span></section><input id=\"nameInput\" placeholder=\"Name\" /><button id=\"runButton\">Personalize</button></main>"])
  };
  const cssByKind = {
    html_structure: "body { font-family: system-ui, sans-serif; margin: 32px; }",
    html_sections: "body { font-family: system-ui, sans-serif; margin: 32px; } header, section { margin-bottom: 18px; }",
    web_tables_forms: "body { font-family: system-ui, sans-serif; margin: 32px; } table { border-collapse: collapse; } th, td { border: 1px solid #65d1c3; padding: 8px; }",
    web_media: "body { font-family: system-ui, sans-serif; margin: 32px; } img { max-width: 100%; }",
    web_accessibility: "body { font-family: system-ui, sans-serif; margin: 32px; } label, input { display: block; margin-block: 8px; }",
    css_selectors: "body { margin: 0; font-family: system-ui, sans-serif; }\n.card { max-width: 520px; margin: 48px auto; }\n/* Add color and padding styles. */",
    box_model: "body { font-family: system-ui, sans-serif; background: #101318; color: white; }\n.card { max-width: 420px; }\n/* Add margin, padding, and border. */",
    flexbox: "body { font-family: system-ui, sans-serif; margin: 32px; }\n.skills { }\n/* Use display:flex and gap. */",
    css_grid: "body { font-family: system-ui, sans-serif; margin: 32px; }\n.grid { }\n/* Use display:grid and grid-template-columns. */",
    responsive: "body { margin: 0; font-family: system-ui, sans-serif; }\n.card { margin: 40px auto; padding: 24px; border: 1px solid #65d1c3; }\n/* Add mobile-safe width and a media query. */",
    css_transitions: "body { font-family: system-ui, sans-serif; margin: 32px; }\nbutton { padding: 10px 14px; }\n/* Add transition and button:hover. */",
    dom_text: "body { font-family: system-ui, sans-serif; margin: 32px; } button { padding: 8px 12px; }",
    form_input: "body { font-family: system-ui, sans-serif; margin: 32px; } input, button { padding: 8px 10px; }",
    web_debugging: "body { font-family: system-ui, sans-serif; margin: 32px; }",
    web_capstone: "body { margin: 0; font-family: system-ui, sans-serif; background: #101318; color: #f4f7fb; }\nheader, .card { width: min(680px, calc(100vw - 32px)); margin: 24px auto; }\n.card { padding: 24px; border: 1px solid #65d1c3; }\n.skills { display: flex; flex-wrap: wrap; gap: 8px; }\n.skills span { padding: 6px 10px; background: #1f242d; }\n@media (max-width: 520px) { .card { padding: 16px; } }"
  };
  const jsByKind = {
    dom_text: "// Add a click listener for #runButton and update #status.textContent.\n",
    form_input: "// Add a click listener, read #nameInput.value, and update #message.\n",
    web_debugging: "// Fix the selector typo so the click updates #status.\ndocument.querySelector(\"#runBtn\").addEventListener(\"click\", () => {\n  document.querySelector(\"#status\").textContent = \"Fixed\";\n});\n",
    web_capstone: "// Add a click listener that reads #nameInput and updates #status.\n"
  };
  const solutionJsByKind = {
    ...jsByKind,
    dom_text: "document.querySelector(\"#runButton\").addEventListener(\"click\", () => {\n  document.querySelector(\"#status\").textContent = \"JavaScript updated this text\";\n});\n",
    form_input: "document.querySelector(\"#runButton\").addEventListener(\"click\", () => {\n  const name = document.querySelector(\"#nameInput\").value || \"Learner\";\n  document.querySelector(\"#message\").textContent = `Hello, ${name}!`;\n});\n",
    web_debugging: "document.querySelector(\"#runButton\").addEventListener(\"click\", () => {\n  document.querySelector(\"#status\").textContent = \"Fixed\";\n});\n"
    ,
    web_capstone: "document.querySelector(\"#runButton\").addEventListener(\"click\", () => {\n  const name = document.querySelector(\"#nameInput\").value || \"Learner\";\n  document.querySelector(\"#status\").textContent = `${name} is practicing HTML, CSS, and JavaScript`;\n});\n"
  };
  const solutionCssByKind = {
    css_selectors: "body { margin: 0; font-family: system-ui, sans-serif; background: #101318; color: #f4f7fb; }\n.card { max-width: 520px; margin: 48px auto; padding: 24px; border: 1px solid #65d1c3; }\na { color: #f1c84b; }",
    box_model: "body { font-family: system-ui, sans-serif; background: #101318; color: white; }\n.card { max-width: 420px; margin: 48px auto; padding: 24px; border: 2px solid #65d1c3; }",
    flexbox: "body { font-family: system-ui, sans-serif; margin: 32px; }\n.skills { display: flex; gap: 10px; }\n.skills span { padding: 8px 10px; border: 1px solid #65d1c3; }",
    css_grid: "body { font-family: system-ui, sans-serif; margin: 32px; }\n.grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }\n.grid section { border: 1px solid #65d1c3; padding: 16px; }",
    responsive: "body { margin: 0; font-family: system-ui, sans-serif; }\n.card { width: min(520px, calc(100vw - 32px)); margin: 40px auto; padding: 24px; border: 1px solid #65d1c3; }\n@media (max-width: 520px) { .card { margin-top: 16px; } }",
    css_transitions: "body { font-family: system-ui, sans-serif; margin: 32px; }\nbutton { padding: 10px 14px; transition: background 160ms ease, transform 160ms ease; }\nbutton:hover { background: #f1c84b; transform: translateY(-1px); }",
    web_capstone: cssByKind.web_capstone
  };
  const checkByKind = {
    html_structure: ["const html = require(\"fs\").readFileSync(\"index.html\", \"utf8\");", "if (!html.includes(\"<h1\") || !html.includes(\"<p\") || (html.match(/<li/g) || []).length < 3) { console.log(\"Add h1, p, and at least three li elements.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    html_sections: ["const html = require(\"fs\").readFileSync(\"index.html\", \"utf8\");", "for (const tag of [\"<header\", \"<main\", \"<section\", \"<a \"]) { if (!html.includes(tag)) { console.log(`Add ${tag}`); process.exit(1); } }", "console.log(\"PASS\");", ""],
    web_tables_forms: ["const html = require(\"fs\").readFileSync(\"index.html\", \"utf8\");", "if (!html.includes(\"<form\") || !html.includes(\"<label\") || !html.includes(\"<input\")) { console.log(\"Add a form with a label and input.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    web_media: ["const html = require(\"fs\").readFileSync(\"index.html\", \"utf8\");", "if (!html.includes(\"<img\") || !/alt\\s*=/.test(html)) { console.log(\"Add an image with useful alt text.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    web_accessibility: ["const html = require(\"fs\").readFileSync(\"index.html\", \"utf8\");", "if (!/aria-label\\s*=/.test(html) && !/alt\\s*=/.test(html)) { console.log(\"Add aria-label or useful alt text.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    css_selectors: ["const css = require(\"fs\").readFileSync(\"style.css\", \"utf8\");", "if (!/color\\s*:/.test(css) || !/padding\\s*:/.test(css) || !/font[^:]*:/.test(css)) { console.log(\"Style text, spacing, and color with real CSS declarations.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    box_model: ["const css = require(\"fs\").readFileSync(\"style.css\", \"utf8\");", "for (const prop of [\"padding\", \"margin\", \"border\", \"max-width\"]) { if (!new RegExp(`${prop}\\\\s*:`).test(css)) { console.log(`Use ${prop} as a CSS declaration.`); process.exit(1); } }", "console.log(\"PASS\");", ""],
    flexbox: ["const css = require(\"fs\").readFileSync(\"style.css\", \"utf8\");", "if (!css.includes(\"display: flex\") || !css.includes(\"gap\")) { console.log(\"Use display:flex and gap.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    css_grid: ["const css = require(\"fs\").readFileSync(\"style.css\", \"utf8\");", "if (!css.includes(\"display: grid\") || !css.includes(\"grid-template-columns\")) { console.log(\"Use display:grid and grid-template-columns.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    responsive: ["const css = require(\"fs\").readFileSync(\"style.css\", \"utf8\");", "if (!css.includes(\"@media\") || !css.includes(\"100vw\")) { console.log(\"Add a media query and mobile-safe width.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    css_transitions: ["const css = require(\"fs\").readFileSync(\"style.css\", \"utf8\");", "if (!css.includes(\"transition\") || !css.includes(\":hover\")) { console.log(\"Add a transition and hover state.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    dom_text: ["const js = require(\"fs\").readFileSync(\"script.js\", \"utf8\");", "if (!js.includes(\"addEventListener\") || !js.includes(\"#status\") || !js.includes(\"textContent\")) { console.log(\"Update #status on button click.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    form_input: ["const js = require(\"fs\").readFileSync(\"script.js\", \"utf8\");", "if (!js.includes(\"#nameInput\") || !js.includes(\".value\") || !js.includes(\"#message\")) { console.log(\"Read input value and update #message.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    web_debugging: ["const js = require(\"fs\").readFileSync(\"script.js\", \"utf8\");", "if (!js.includes(\"#runButton\") || !js.includes(\"#status\")) { console.log(\"Fix the selector typo.\"); process.exit(1); }", "console.log(\"PASS\");", ""],
    web_capstone: ["const html = require(\"fs\").readFileSync(\"index.html\", \"utf8\"); const css = require(\"fs\").readFileSync(\"style.css\", \"utf8\"); const js = require(\"fs\").readFileSync(\"script.js\", \"utf8\");", "if (!html.includes(\"<section\") || !css.includes(\"@media\") || !js.includes(\"addEventListener\") || !js.includes(\"#nameInput\")) { console.log(\"Capstone needs sections, responsive CSS, and JS interaction.\"); process.exit(1); }", "console.log(\"PASS\");", ""]
  };
  return {
    "index.html": htmlByKind[kind] || htmlByKind.html_structure,
    "style.css": `${cssByKind[kind] || cssByKind.html_structure}\n`,
    "script.js": jsByKind[kind] || "",
    "solution.html": htmlByKind[kind] || htmlByKind.html_structure,
    "solution.css": `${solutionCssByKind[kind] || cssByKind[kind] || cssByKind.html_structure}\n`,
    "solution.js": solutionJsByKind[kind] || jsByKind[kind] || "",
    "check.js": (checkByKind[kind] || checkByKind.html_structure).join("\n")
  };
}

function genericLanguageLessonFiles(roadmap, module, index, profile) {
  const language = profile.label.replace(/\s+guided course$/i, "");
  const kind = module.kind || "console";
  const prompts = {
    console: `Write the smallest ${language} program that prints your name, learning goal, and reason.`,
    variables: `Write ${language} code that defines variables for name, topic, and practice days, then prints a summary.`,
    strings_numbers: `Write ${language} code that calculates weekly practice minutes and prints a sentence with the result.`,
    conditions: `Write ${language} code that uses if/else to choose between a beginner message and a challenge message.`,
    arrays_loops: `Write ${language} code that stores three practice tasks in a collection and prints each with a loop.`,
    functions: `Write ${language} code with a function that returns a formatted learner summary.`,
    objects: `Write ${language} code that groups learner profile fields in the language's object, record, struct, class, or map style.`,
    capstone: `Combine output, variables, calculations, conditionals, loops, functions, and structured data in a ${language} fundamentals practice pack.`
  };
  const prompt = prompts[kind] || module.task;
  return {
    "practice.txt": [
      `Language: ${language}`,
      `Part ${index + 1}: ${module.title}`,
      "",
      "Write your answer below using the target language syntax.",
      "The app will text-check the required concepts; compile/run support can be added later for this language.",
      "",
      "Required exercise:",
      prompt,
      "",
      "Your code:",
      ""
    ].join("\n"),
    "solution.txt": [
      `Reference shape for ${language}:`,
      "",
      prompt,
      "",
      "Include clear output, named values, and comments explaining each line until you are comfortable.",
      ""
    ].join("\n"),
    "check.js": [
      "const source = require(\"fs\").readFileSync(\"practice.txt\", \"utf8\");",
      "const answer = source.split(\"Your code:\").slice(1).join(\"Your code:\").trim();",
      "if (answer.length < 80) {",
      "  console.log(\"Write a real code attempt under 'Your code:' before checking.\");",
      "  process.exit(1);",
      "}",
      `const required = ${JSON.stringify(toSkills(module.skillsPracticed).slice(0, 3))};`,
      "const lower = answer.toLowerCase();",
      "const missing = required.filter((skill) => !lower.includes(String(skill).split(\" \")[0].toLowerCase()));",
      "if (missing.length) {",
      "  console.log(`Mention or implement these concepts in your code: ${missing.join(\", \")}`);",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ].join("\n")
  };
}

function sqlLessonFiles(_roadmap, module) {
  const kind = module.kind || "sql_select";
  const queryByKind = {
    sql_select: [
      "-- Write SELECT queries for a learners table.",
      "SELECT * FROM learners;",
      "-- Add a query that selects only name and topic.",
      ""
    ],
    sql_where_order: [
      "-- Filter learners by topic and sort by practice_minutes.",
      "SELECT name, topic, practice_minutes",
      "FROM learners",
      "-- Add WHERE and ORDER BY below.",
      ";",
      ""
    ],
    sql_insert_update: [
      "-- Add one INSERT INTO query and one UPDATE query.",
      "INSERT INTO learners (name, topic, practice_minutes)",
      "VALUES ('Learner', 'SQL', 30);",
      "",
      "-- Add UPDATE here.",
      ""
    ],
    sql_aggregate: [
      "-- Count learners by topic and sum practice minutes.",
      "SELECT topic, COUNT(*)",
      "FROM learners",
      "-- Add SUM(practice_minutes) and GROUP BY topic.",
      ";",
      ""
    ],
    sql_join: [
      "-- Join learners and lessons.",
      "SELECT learners.name, lessons.title",
      "FROM learners",
      "-- Add INNER JOIN lessons ON ...",
      ";",
      ""
    ],
    sql_capstone: [
      "-- SQL Query Practice Pack",
      "-- Include labeled queries using SELECT, WHERE, ORDER BY, GROUP BY, JOIN, COUNT, and SUM.",
      "",
      "SELECT * FROM learners;",
      ""
    ]
  };
  const solutionByKind = {
    sql_select: ["SELECT * FROM learners;", "SELECT name, topic FROM learners;", ""],
    sql_where_order: ["SELECT name, topic, practice_minutes", "FROM learners", "WHERE topic = 'SQL'", "ORDER BY practice_minutes DESC;", ""],
    sql_insert_update: ["INSERT INTO learners (name, topic, practice_minutes)", "VALUES ('Learner', 'SQL', 30);", "", "UPDATE learners", "SET practice_minutes = 45", "WHERE name = 'Learner';", ""],
    sql_aggregate: ["SELECT topic, COUNT(*) AS learner_count, SUM(practice_minutes) AS total_minutes", "FROM learners", "GROUP BY topic;", ""],
    sql_join: ["SELECT learners.name, lessons.title", "FROM learners", "INNER JOIN lessons ON learners.topic = lessons.topic;", ""],
    sql_capstone: ["SELECT * FROM learners;", "SELECT * FROM learners WHERE topic = 'SQL' ORDER BY practice_minutes DESC;", "SELECT topic, COUNT(*), SUM(practice_minutes) FROM learners GROUP BY topic;", "SELECT learners.name, lessons.title FROM learners INNER JOIN lessons ON learners.topic = lessons.topic;", ""]
  };
  const checks = {
    sql_select: ["SELECT", "FROM"],
    sql_where_order: ["WHERE", "ORDER BY"],
    sql_insert_update: ["INSERT INTO", "UPDATE"],
    sql_aggregate: ["COUNT", "SUM", "GROUP BY"],
    sql_join: ["INNER JOIN", " ON "],
    sql_capstone: ["SELECT", "WHERE", "ORDER BY", "GROUP BY", "JOIN", "COUNT", "SUM"]
  };
  return {
    "queries.sql": (queryByKind[kind] || queryByKind.sql_select).join("\n"),
    "solution.sql": (solutionByKind[kind] || solutionByKind.sql_select).join("\n"),
    "check.js": [
      "const sql = require(\"fs\").readFileSync(\"queries.sql\", \"utf8\").toUpperCase();",
      `const required = ${JSON.stringify(checks[kind] || checks.sql_select)};`,
      "const missing = required.filter((term) => !sql.includes(term));",
      "if (missing.length) {",
      "  console.log(`Missing SQL concepts: ${missing.join(\", \")}`);",
      "  process.exit(1);",
      "}",
      "console.log(\"PASS\");",
      ""
    ].join("\n")
  };
}

function generateLessonFilesForModule(roadmap, module, index, profile) {
  const docs = lessonDocs(roadmap, module, profile);
  const normalized = String(profile.label || "").toLowerCase();
  if (profile.genericTextCourse) return { ...docs, ...genericLanguageLessonFiles(roadmap, module, index, profile) };
  if (normalized.includes("sql")) return { ...docs, ...sqlLessonFiles(roadmap, module, index, profile) };
  if (normalized.includes("python")) {
    const entryFile = module.entryFile || `part_${String(index + 1).padStart(2, "0")}_${pythonSafeName(module.title, "exercise")}.py`;
    const testFile = module.testFile || `test_part_${String(index + 1).padStart(2, "0")}.py`;
    return { ...docs, ...pythonLessonFiles(roadmap, module, index, entryFile, testFile) };
  }
  if (normalized.includes("web")) return { ...docs, ...webLessonFiles(roadmap, module, index) };
  return { ...docs, ...jsLessonFiles(roadmap, module, index) };
}

async function createGeneratedLesson(roadmap, index) {
  const module = roadmap.modules[index];
  if (!module) return null;
  const profile = languageProfile(roadmap.language);
  const lessonId = lessonIdFor(roadmap.id, index);
  const lessonDir = path.join(generatedLessonsDir(), lessonId);
  const starterDir = path.join(lessonDir, "starter");
  await fsp.mkdir(starterDir, { recursive: true });
  const isPython = String(profile.label || "").toLowerCase().includes("python");
  const entryFile = isPython
    ? `part_${String(index + 1).padStart(2, "0")}_${pythonSafeName(module.title, "exercise")}.py`
    : profile.entryFile;
  const testFile = isPython
    ? `test_part_${String(index + 1).padStart(2, "0")}.py`
    : profile.testFile;
  module.entryFile = entryFile;
  module.testFile = testFile;

  const manifest = {
    id: lessonId,
    order: 1000 + index,
    roadmapId: roadmap.id,
    roadmapIndex: index,
    title: `${roadmap.topic}: ${module.title}`,
    language: profile.label,
    description: `Custom ${roadmap.level} tutorial generated from your goal: ${roadmap.outcome}.`,
    goal: module.objective || module.goal,
    steps: [
      "Read README.md, TASK.md, and CHECKPOINT.md.",
      module.task,
      `Build the artifact: ${module.artifact}.`,
      "Use GUIDE.md when you need implementation direction.",
      "Run Check to validate this lesson."
    ],
    hints: [
      `This part belongs to milestone: ${module.milestone || "current milestone"}.`,
      `Validation target: ${module.validation}.`,
      `Skills: ${toSkills(module.skillsPracticed).join(", ") || module.title}.`,
      roadmap.courseTrack?.sourceUrl ? `W3Schools-style source track: ${roadmap.courseTrack.label} (${roadmap.courseTrack.sourceUrl}).` : "",
      module.estimatedMinutes ? `Estimated time: ${module.estimatedMinutes} minutes.` : "",
      `If stuck: ${module.remediation || "Read GUIDE.md and retry the smallest step."}`,
      "Use the solution file only after trying your own implementation."
    ],
    skillsIntroduced: toSkills(module.skillsIntroduced),
    skillsPracticed: toSkills(module.skillsPracticed),
    prerequisites: toSkills(module.prerequisites),
    difficulty: module.difficulty || "guided",
    remediation: module.remediation || "",
    entryFile,
    checkpoint: {
      command: isPython ? `python3 ${testFile}` : profile.checkpointCommand,
      expectedOutput: "PASS"
    }
  };

  await writeJson(path.join(lessonDir, "lesson.json"), manifest);
  const files = generateLessonFilesForModule(roadmap, module, index, profile);
  await Promise.all(
    Object.entries(files).map(([file, content]) =>
      fsp.writeFile(path.join(starterDir, file), content, "utf8")
    )
  );
  roadmap.createdLessonIds = Array.from(new Set([...(roadmap.createdLessonIds || []), lessonId]));
  roadmap.currentIndex = Math.max(roadmap.currentIndex || 0, index);
  return lessonId;
}

function nextBestLesson(roadmap, lessonId, progress, skipped = false) {
  const currentIndex = (roadmap.createdLessonIds || []).indexOf(lessonId);
  const currentProgress = progress[lessonId] || defaultProgressEntry("ready");
  if (!skipped && !currentProgress.completed && currentProgress.status !== "mastered") {
    return {
      action: currentProgress.status === "needs_review" ? "review" : "retry",
      index: currentIndex,
      reason: nextActionForBackendStatus(currentProgress.status)
    };
  }
  const nextIndex = currentIndex + 1;
  if (nextIndex >= (roadmap.modules || []).length) {
    return { action: "complete", index: nextIndex, reason: "Roadmap has no more modules." };
  }
  return { action: "advance", index: nextIndex, reason: "Next prerequisite is unlocked." };
}

function nextActionForBackendStatus(status) {
  const actions = {
    ready: "Run the lesson before checking.",
    in_progress: "Keep editing and run the file.",
    ran: "Run the checkpoint when output looks correct.",
    failed_check: "Fix the checkpoint failure and retry.",
    needs_review: "Use the remediation guidance before retrying.",
    blocked: "Fix the runtime error before checking.",
    skipped: "Skipped, so the next module can open without mastery credit.",
    mastered: "Mastered, so the next module can open."
  };
  return actions[status] || "Continue with the current lesson.";
}

function inferRunCommand(lesson) {
  const entry = lesson?.entryFile || "";
  const language = String(lesson?.language || "").toLowerCase();
  if (entry.endsWith(".py") || language.includes("python")) return `python3 ${entry || "main.py"}`;
  if (entry.endsWith(".js") || language.includes("javascript")) return `node ${entry || "main.js"}`;
  if (language.includes("web") || entry.endsWith(".html")) return "";
  if (entry.endsWith(".txt")) return "";
  return entry ? `node ${entry}` : "";
}

function runCommand(workspacePath, command) {
  return new Promise((resolve) => {
    if (!command) {
      resolve({
        exitCode: 0,
        stdout: "Preview refreshed. Web lessons run in the Preview panel.",
        stderr: "",
        command: "preview"
      });
      return;
    }
    exec(command, { cwd: workspacePath, timeout: 20000, shell: true }, (error, stdout, stderr) => {
      resolve({
        exitCode: error?.code ?? 0,
        stdout: stdout || "",
        stderr: stderr || "",
        command
      });
    });
  });
}

async function runGuiAgentCommand(projectPath, model, prompt, sender, options = {}) {
  const modelSpec = normalizeAgentModel(model);
  const promptText = String(prompt || "").trim();
  const requestId = options.requestId || `agent-${Date.now().toString(36)}`;
  const permissionMode = options.permissionMode || "full";
  if (!promptText) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Prompt is empty.",
      command: "code gui agent"
    };
  }
  if (!modelSpec) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: "Choose a Code model before running the GUI agent.",
      command: "code session"
    };
  }

  emitAgentEvent(sender, requestId, { type: "status", status: "starting", message: "Starting Code session..." });
  const session = await ensureOpenCodeSession(projectPath, modelSpec, permissionMode);
  emitAgentEvent(sender, requestId, {
    type: "session",
    sessionID: session.id,
    model: modelSpec.label,
    permissionMode
  });
  const eventController = new AbortController();
  streamOpenCodeEvents(sender, requestId, session.id, projectPath, eventController).catch(() => {});
  const beforeMessages = await readOpenCodeMessages(session.id, projectPath);
  const previousAssistantCount = beforeMessages.filter((message) => openCodeMessageRole(message) === "assistant").length;
  const userPrompt = options.planMode
    ? `Plan mode is enabled. First reason about the safest approach, then ask before making destructive changes.\n\n${promptText}`
    : promptText;
  const effectivePrompt = withCodeWorkbenchIdentity(userPrompt);

  const slashMatch = /^\/([a-zA-Z0-9:_-]+)(?:\s+([\s\S]*))?$/.exec(promptText);
  if (slashMatch) {
    const commandName = slashMatch[1];
    const commandArguments = slashMatch[2] || "";
    const commandArgumentsWithIdentity = withCodeWorkbenchIdentity(commandArguments || `Run /${commandName} from Code Workbench.`);
    const commands = await listOpenCodeCommands(projectPath).catch(() => []);
    const commandExists = commands.some((command) => command.name === commandName);
    if (commandExists) {
      await runOpenCodeCommand(session.id, projectPath, {
        agent: "build",
        model: modelSpec.label,
        command: commandName,
        arguments: commandArgumentsWithIdentity
      });
    } else {
      await sendOpenCodePrompt(session.id, projectPath, {
        agent: "build",
        modelRef: openCodeModelRef(modelSpec),
        system: codeWorkbenchIdentity,
        parts: [{ type: "text", text: effectivePrompt }]
      });
    }
  } else {
    await sendOpenCodePrompt(session.id, projectPath, {
      agent: "build",
      modelRef: openCodeModelRef(modelSpec),
      system: codeWorkbenchIdentity,
      parts: [{ type: "text", text: effectivePrompt }]
    });
  }
  emitAgentEvent(sender, requestId, { type: "status", status: "running", message: "Code is working..." });

  let lastText = "";
  let lastToolSignature = "";
  let lastTools = [];
  let lastPermissionSignature = "";
  let lastChangeAt = Date.now();
  const startedAt = Date.now();
  while (Date.now() - startedAt < 180000) {
    await wait(700);
    const messages = await readOpenCodeMessages(session.id, projectPath);
    const text = bestAssistantText(messages, previousAssistantCount);
    if (text !== lastText) {
      lastText = text;
      lastChangeAt = Date.now();
      emitAgentEvent(sender, requestId, {
        type: "text",
        sessionID: session.id,
        text: lastText
      });
    }

    const tools = collectOpenCodeTools(messages, previousAssistantCount);
    lastTools = tools;
    const toolSignature = JSON.stringify(tools.map((tool) => [tool.id, tool.type, tool.status, tool.title]));
    if (tools.length && toolSignature !== lastToolSignature) {
      lastToolSignature = toolSignature;
      emitAgentEvent(sender, requestId, {
        type: "tools",
        sessionID: session.id,
        tools
      });
    }

    const permissions = await readOpenCodePermissions(session.id, projectPath);
    const permissionSignature = JSON.stringify(permissions.map((permission) => permission.id || permission.requestID || permission.permissionID || permission.permission));
    if (permissions.length && permissionSignature !== lastPermissionSignature) {
      lastPermissionSignature = permissionSignature;
      emitAgentEvent(sender, requestId, {
        type: "permissions",
        sessionID: session.id,
        permissions
      });
    }

    const statusMap = await readOpenCodeSessionStatus(projectPath);
    const status = statusMap?.[session.id]?.type || statusMap?.[session.id]?.status || "";
    const stableFor = Date.now() - lastChangeAt;
    const latestMessage = latestAssistantMessage(messages, previousAssistantCount);
    const finishReason = latestMessage?.info?.finish || latestMessage?.finish || latestMessage?.message?.finish || "";
    const hasText = Boolean(lastText.trim());
    const canFinishWithText = hasText && (status === "idle" || stableFor > 10000);
    const canFinishToolOnly = !hasText && tools.length && status === "idle" && stableFor > 10000 && finishReason !== "tool-calls";
    if (canFinishWithText || canFinishToolOnly) {
      const messageID = latestMessage?.info?.id || latestMessage?.id || latestMessage?.message?.id;
      const diff = await readOpenCodeDiff(session.id, projectPath, messageID);
      if (diff.length) {
        emitAgentEvent(sender, requestId, {
          type: "diff",
          sessionID: session.id,
          messageID,
          diff
        });
      }
      emitAgentEvent(sender, requestId, { type: "status", status: "done", message: "Code finished." });
      eventController.abort();
      return {
        exitCode: 0,
        stdout: lastText || `Code completed with ${tools.length} tool ${tools.length === 1 ? "step" : "steps"}.`,
        stderr: "",
        command: `code session ${session.id} (${modelSpec.label})`,
        sessionID: session.id,
        messageID,
        diff,
        tools,
        providerID: modelSpec.providerID,
        modelID: modelSpec.modelID
      };
    }
  }

  eventController.abort();
  emitAgentEvent(sender, requestId, {
    type: "status",
    status: lastText ? "done" : "timeout",
    message: lastText ? "Code finished." : "Code timed out."
  });
  return {
    exitCode: lastText || lastTools.length ? 0 : 1,
    stdout: lastText || (lastTools.length ? `Code completed with ${lastTools.length} tool ${lastTools.length === 1 ? "step" : "steps"}.` : ""),
    stderr: lastText || lastTools.length ? "" : "Code session timed out before an assistant response was available.",
    command: `code session ${session.id} (${modelSpec.label})`,
    sessionID: session.id,
    tools: lastTools,
    providerID: modelSpec.providerID,
    modelID: modelSpec.modelID
  };
}

async function listFiles(base, current = "") {
  const dir = safeJoin(base, current);
  const entries = await fsp.readdir(dir, { withFileTypes: true });
  const heavyDirectories = new Set(["build", "coverage", "dist", "node_modules"]);
  const result = [];
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const relativePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (heavyDirectories.has(entry.name)) {
        result.push({
          name: entry.name,
          path: relativePath,
          type: "directory",
          children: []
        });
        continue;
      }
      result.push({
        name: entry.name,
        path: relativePath,
        type: "directory",
        children: await listFiles(base, relativePath)
      });
    } else {
      result.push({ name: entry.name, path: relativePath, type: "file" });
    }
  }
  return result.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const workspaceIgnoredDirs = new Set([
  ".git",
  ".next",
  ".turbo",
  ".vite",
  "build",
  "coverage",
  "dist",
  "node_modules"
]);

function globToRegExp(pattern) {
  const escaped = pattern.trim().replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function patternMatches(relativePath, patternText) {
  const patterns = String(patternText || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!patterns.length) return true;
  return patterns.some((pattern) => globToRegExp(pattern).test(relativePath));
}

async function walkWorkspaceFiles(base, current = "", files = []) {
  const dir = safeJoin(base, current);
  let entries = [];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    const relativePath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      if (workspaceIgnoredDirs.has(entry.name)) continue;
      await walkWorkspaceFiles(base, relativePath, files);
      continue;
    }
    if (entry.isFile()) files.push(relativePath);
  }
  return files;
}

async function searchWorkspace(base, payload = {}) {
  const query = String(payload.query || "").trim();
  if (!query) return [];
  const include = payload.include || "";
  const exclude = payload.exclude || "";
  const flags = payload.matchCase ? "g" : "gi";
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const source = payload.regex ? query : escaped;
  const word = payload.wholeWord ? `\\b(?:${source})\\b` : source;
  let matcher;
  try {
    matcher = new RegExp(word, flags);
  } catch {
    matcher = new RegExp(escaped, flags);
  }
  const files = await walkWorkspaceFiles(base);
  const results = [];
  for (const relativePath of files) {
    if (!patternMatches(relativePath, include)) continue;
    if (exclude && patternMatches(relativePath, exclude)) continue;
    const fullPath = safeJoin(base, relativePath);
    const stat = await fsp.stat(fullPath);
    if (stat.size > 1024 * 1024) continue;
    let content = "";
    try {
      content = await fsp.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      matcher.lastIndex = 0;
      const match = matcher.exec(lines[index]);
      if (!match) continue;
      results.push({
        path: relativePath,
        line: index + 1,
        column: match.index + 1,
        preview: lines[index].trim()
      });
      if (results.length >= 500) return results;
    }
  }
  return results;
}

async function symbolSearch(base, query = "") {
  const needle = String(query || "").trim().toLowerCase();
  const files = await walkWorkspaceFiles(base);
  const symbols = [];
  const symbolPattern = /^\s*(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|const|let|var)\s+([A-Za-z_$][\w$]*)|^\s*([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?(?:\([^)]*\)\s*=>|function\b)/;
  for (const relativePath of files) {
    if (!/\.(js|jsx|ts|tsx|mjs|cjs|py|java|c|cpp|cs|go|rs|php|rb)$/.test(relativePath)) continue;
    const fullPath = safeJoin(base, relativePath);
    const stat = await fsp.stat(fullPath);
    if (stat.size > 1024 * 1024) continue;
    let content = "";
    try {
      content = await fsp.readFile(fullPath, "utf8");
    } catch {
      continue;
    }
    content.split(/\r?\n/).forEach((line, index) => {
      const match = symbolPattern.exec(line);
      const name = match?.[1] || match?.[2];
      if (!name) return;
      if (needle && !name.toLowerCase().includes(needle)) return;
      symbols.push({
        name,
        path: relativePath,
        line: index + 1,
        preview: line.trim()
      });
    });
    if (symbols.length >= 300) break;
  }
  return symbols;
}

async function gitStatus(workspacePath) {
  const status = await runCommand(workspacePath, "git status --short --branch");
  const branchLine = `${status.stdout || ""}${status.stderr || ""}`.split(/\r?\n/)[0] || "";
  const branch = branchLine.replace(/^##\s*/, "").split("...")[0] || "no branch";
  const changes = `${status.stdout || ""}`
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || "M",
      path: line.slice(3).trim()
    }));
  return {
    ok: status.exitCode === 0,
    branch,
    changes,
    message: status.exitCode === 0 ? "" : (status.stderr || status.stdout || "Not a git repository.")
  };
}

async function getLessons() {
  const entries = await fsp.readdir(lessonsDir, { withFileTypes: true });
  const lessons = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(lessonsDir, entry.name, "lesson.json");
    const manifest = await readJson(manifestPath, null);
    if (manifest) lessons.push({ ...manifest, id: entry.name, sourceDir: path.join(lessonsDir, entry.name) });
  }
  const generatedDir = generatedLessonsDir();
  if (fs.existsSync(generatedDir)) {
    const generatedEntries = await fsp.readdir(generatedDir, { withFileTypes: true });
    for (const entry of generatedEntries) {
      if (!entry.isDirectory()) continue;
      const sourceDir = path.join(generatedDir, entry.name);
      const manifest = await readJson(path.join(sourceDir, "lesson.json"), null);
      if (manifest) lessons.push({ ...manifest, id: entry.name, sourceDir });
    }
  }
  return lessons.sort((a, b) => a.order - b.order);
}

ipcMain.handle("lessons:list", getLessons);

ipcMain.handle("lessons:open", async (_event, lessonId) => {
  const lessons = await getLessons();
  const lesson = lessons.find((item) => item.id === lessonId) || lessons[0];
  if (!lesson) throw new Error("No lessons are available.");
  const source = path.join(lesson.sourceDir || path.join(lessonsDir, lesson.id), "starter");
  const workspacePath = userDataPath("lesson-workspaces", lesson.id);
  await copyDirIfMissing(source, workspacePath);
  await recordLearningEvent({
    verb: "opened",
    lessonId: lesson.id,
    roadmapId: lesson.roadmapId,
    context: { title: lesson.title, status: "ready" }
  });
  return { lesson, workspacePath };
});

ipcMain.handle("lessons:run", async (_event, lessonId, workspacePath) => {
  const lessons = await getLessons();
  const lesson = lessons.find((item) => item.id === lessonId);
  if (!lesson) {
    return { exitCode: 1, stdout: "", stderr: "Lesson was not found.", command: "" };
  }
  const started = Date.now();
  const result = await runCommand(workspacePath, inferRunCommand(lesson));
  const progress = await recordLearningEvent({
    verb: "ran",
    lessonId,
    roadmapId: lesson.roadmapId,
    success: result.exitCode === 0,
    output: `${result.stdout || ""}${result.stderr || ""}`,
    durationSeconds: Math.round((Date.now() - started) / 1000),
    context: { command: result.command, entryFile: lesson.entryFile }
  });
  return { ...result, progress };
});

ipcMain.handle("lessons:checkpoint", async (_event, lessonId, workspacePath) => {
  const lessons = await getLessons();
  const lesson = lessons.find((item) => item.id === lessonId);
  const manifest = lesson
    ? await readJson(path.join(lesson.sourceDir || path.join(lessonsDir, lessonId), "lesson.json"), null)
    : null;
  if (!manifest?.checkpoint?.command) {
    return {
      passed: false,
      output: "This lesson has no checkpoint command yet.",
      exitCode: 1,
      stdout: "",
      stderr: "This lesson has no checkpoint command yet.",
      command: ""
    };
  }
  const result = await runCommand(workspacePath, manifest.checkpoint.command);
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const expected = manifest.checkpoint.expectedOutput || "";
  const passed = result.exitCode === 0 && (!expected || output.includes(expected));
  const progress = await recordLearningEvent({
    verb: "checked",
    lessonId,
    roadmapId: lesson?.roadmapId,
    success: passed,
    output: output || (passed ? "Checkpoint passed." : "Checkpoint failed."),
    context: {
      command: manifest.checkpoint.command,
      expectedOutput: expected,
      lessonTitle: lesson?.title
    }
  });
  return {
    ...result,
    passed,
    output: output || (passed ? "Checkpoint passed." : "Checkpoint failed."),
    progress
  };
});

ipcMain.handle("roadmaps:list", getRoadmaps);

ipcMain.handle("roadmaps:remove", async (_event, roadmapId) => removeRoadmapData(roadmapId));

ipcMain.handle("roadmaps:interviewStart", async (_event, payload = {}) => {
  if (!payload.model) return fallbackInterviewQuestion([]);
  try {
    const reply = await ollamaChatJson(
      payload.model,
      [
        agentPrompts.interviewAgent,
        agentPrompts.beginnerSafetyValidator,
        "The first field is goal."
      ].join(" "),
      JSON.stringify({
        knownAnswers: {
          goal: "",
          experience: "",
          stack: "",
          outcome: "",
          depth: "",
          learningStyle: "",
          constraints: ""
        },
        lastUserMessage: ""
      }, null, 2)
    );
    return validateInterviewReply(reply, []);
  } catch {
    return fallbackInterviewQuestion([]);
  }
});

ipcMain.handle("roadmaps:interviewReply", async (_event, payload = {}) => {
  const transcript = Array.isArray(payload.transcript) ? payload.transcript : [];
  if (!payload.model) return fallbackInterviewQuestion(transcript);
  try {
    const nextField = getNextInterviewField(transcript);
    if (!nextField) return buildInterviewPrompt(null, transcript, "ollama");
    const reply = await ollamaChatJson(
      payload.model,
      [
        agentPrompts.interviewAgent,
        agentPrompts.beginnerSafetyValidator,
        `The next missing field is ${nextField}.`,
        "Never ask any other field.",
        "If the latest answer was vague, ask for clarification for the same field.",
        "Never mark complete; the app will mark complete when every required field is valid."
      ].join(" "),
      JSON.stringify({
        knownAnswers: normalizeInterviewState(transcript),
        lastUserMessage: transcript[transcript.length - 1]?.answer || "",
        transcript
      }, null, 2)
    );
    return validateInterviewReply(reply, transcript);
  } catch {
    return fallbackInterviewQuestion(transcript);
  }
});

ipcMain.handle("roadmaps:createFromInterview", async (_event, payload = {}) => {
  const transcript = Array.isArray(payload.transcript) ? payload.transcript : [];
  const fallbackAnswers = normalizeInterviewState(transcript);
  const plan = await generateRoadmapPlanFromOllama(payload.model, transcript, fallbackAnswers);
  const roadmaps = await getRoadmaps();
  const id = `${slugify(plan.topic)}-${Date.now().toString(36)}`;
  const roadmap = {
    id,
    topic: plan.topic,
    level: plan.level,
    language: plan.language,
    outcome: plan.outcome,
    pace: plan.pace,
    goalType: plan.goalType,
    skillGap: plan.skillGap,
    capstone: plan.capstone,
    courseSource: plan.courseSource,
    courseTrack: plan.courseTrack,
    timePlan: plan.timePlan,
    depthLevel: plan.depthLevel,
    topicOrder: plan.topicOrder,
    prerequisites: plan.prerequisites,
    milestones: plan.milestones,
    quality: plan.quality,
    currentIndex: 0,
    createdAt: new Date().toISOString(),
    createdLessonIds: [],
    skippedLessonIds: [],
    modules: plan.modules
  };
  const firstLessonId = await createGeneratedLesson(roadmap, 0);
  roadmaps.push(roadmap);
  await saveRoadmaps(roadmaps);
  await recordLearningEvent({
    verb: "created",
    lessonId: firstLessonId,
    roadmapId: id,
    context: { topic: roadmap.topic, moduleCount: roadmap.modules.length }
  });
  return { roadmap, lessonId: firstLessonId };
});

ipcMain.handle("roadmaps:create", async (_event, answers) => {
  const roadmaps = await getRoadmaps();
  const normalizedAnswers = {
    goal: answers.goal || answers.topic || "Coding",
    experience: answers.experience || answers.level || "beginner",
    stack: answers.stack || answers.language || "JavaScript",
    outcome: answers.outcome || "build a practical mini project",
    depth: answers.depth || answers.pace || "steady",
    learningStyle: answers.learningStyle || "guided practice",
    constraints: answers.constraints || "personal interest"
  };
  const goalType = classifyGoal(normalizedAnswers);
  const skillGap = analyzeSkillGap(normalizedAnswers);
  const capstone = designCapstone(normalizedAnswers, goalType.goalType);
  const plan = critiqueAndRepairRoadmap(null, normalizedAnswers, goalType, skillGap, capstone);
  const id = `${slugify(plan.topic)}-${Date.now().toString(36)}`;
  const roadmap = {
    id,
    topic: plan.topic,
    level: plan.level,
    language: plan.language,
    outcome: plan.outcome,
    pace: plan.pace,
    goalType: plan.goalType,
    skillGap: plan.skillGap,
    capstone: plan.capstone,
    courseSource: plan.courseSource,
    courseTrack: plan.courseTrack,
    timePlan: plan.timePlan,
    depthLevel: plan.depthLevel,
    topicOrder: plan.topicOrder,
    prerequisites: plan.prerequisites,
    milestones: plan.milestones,
    quality: plan.quality,
    currentIndex: 0,
    createdAt: new Date().toISOString(),
    createdLessonIds: [],
    skippedLessonIds: [],
    modules: plan.modules
  };
  const firstLessonId = await createGeneratedLesson(roadmap, 0);
  roadmaps.push(roadmap);
  await saveRoadmaps(roadmaps);
  await recordLearningEvent({
    verb: "created",
    lessonId: firstLessonId,
    roadmapId: id,
    context: { topic: roadmap.topic, moduleCount: roadmap.modules.length }
  });
  return { roadmap, lessonId: firstLessonId };
});

ipcMain.handle("roadmaps:advance", async (_event, lessonId, skipped = false) => {
  const roadmaps = await getRoadmaps();
  const roadmap = roadmaps.find((item) => (item.createdLessonIds || []).includes(lessonId));
  if (!roadmap) return { done: true };
  const currentIndex = roadmap.createdLessonIds.indexOf(lessonId);
  if (skipped) {
    roadmap.skippedLessonIds = Array.from(new Set([...(roadmap.skippedLessonIds || []), lessonId]));
    await recordLearningEvent({
      verb: "skipped",
      lessonId,
      roadmapId: roadmap.id,
      context: { currentIndex }
    });
  }
  const progress = await loadProgress();
  const decision = nextBestLesson(roadmap, lessonId, progress, skipped);
  if (decision.action === "retry" || decision.action === "review") {
    await saveRoadmaps(roadmaps);
    return { done: false, roadmap, lessonId, action: decision.action, reason: decision.reason };
  }
  const nextIndex = decision.index;
  if (decision.action === "complete" || nextIndex >= roadmap.modules.length) {
    const progress = await loadProgress();
    const requiredLessonIds = roadmap.createdLessonIds.filter((id) => !(roadmap.skippedLessonIds || []).includes(id));
    const mastered = requiredLessonIds.every((id) => progress[id]?.status === "mastered" || progress[id]?.completed);
    if (mastered) roadmap.completedAt = roadmap.completedAt || new Date().toISOString();
    await saveRoadmaps(roadmaps);
    return { done: true, roadmap };
  }
  const nextLessonId = await createGeneratedLesson(roadmap, nextIndex);
  await recordLearningEvent({
    verb: "created",
    lessonId: nextLessonId,
    roadmapId: roadmap.id,
    context: { previousLessonId: lessonId, nextIndex }
  });
  await saveRoadmaps(roadmaps);
  return { done: false, roadmap, lessonId: nextLessonId };
});

ipcMain.handle("files:list", (_event, workspacePath) => listFiles(workspacePath));

ipcMain.handle("project:default", async () => defaultProjectPath);

ipcMain.handle("project:open", async () => {
  const result = await dialog.showOpenDialog({
    title: "Open project folder",
    defaultPath: os.homedir(),
    properties: ["openDirectory", "createDirectory"]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return result.filePaths[0];
});

ipcMain.handle("files:read", async (_event, workspacePath, relativePath) => {
  return fsp.readFile(safeJoin(workspacePath, relativePath), "utf8");
});

ipcMain.handle("files:write", async (_event, workspacePath, relativePath, content) => {
  const target = safeJoin(workspacePath, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, "utf8");
  return true;
});

ipcMain.handle("files:createFile", async (_event, workspacePath, relativePath, content = "") => {
  const target = safeJoin(workspacePath, relativePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.writeFile(target, content, { encoding: "utf8", flag: "wx" });
  return true;
});

ipcMain.handle("files:createFolder", async (_event, workspacePath, relativePath) => {
  await fsp.mkdir(safeJoin(workspacePath, relativePath), { recursive: true });
  return true;
});

ipcMain.handle("files:delete", async (_event, workspacePath, relativePath) => {
  await fsp.rm(safeJoin(workspacePath, relativePath), { recursive: true, force: true });
  return true;
});

ipcMain.handle("files:rename", async (_event, workspacePath, fromPath, toPath) => {
  await fsp.mkdir(path.dirname(safeJoin(workspacePath, toPath)), { recursive: true });
  await fsp.rename(safeJoin(workspacePath, fromPath), safeJoin(workspacePath, toPath));
  return true;
});

ipcMain.handle("files:duplicate", async (_event, workspacePath, fromPath, toPath) => {
  const source = safeJoin(workspacePath, fromPath);
  const target = safeJoin(workspacePath, toPath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  await fsp.cp(source, target, { recursive: true, errorOnExist: true, force: false });
  return true;
});

ipcMain.handle("workspace:search", (_event, workspacePath, payload) => searchWorkspace(workspacePath, payload));

ipcMain.handle("workspace:symbols", (_event, workspacePath, query) => symbolSearch(workspacePath, query));

ipcMain.handle("git:status", (_event, workspacePath) => gitStatus(workspacePath));

ipcMain.handle("git:command", async (_event, workspacePath, command) => {
  const allowed = new Set(["fetch", "pull", "push", "status"]);
  if (!allowed.has(command)) {
    return { exitCode: 1, stdout: "", stderr: "Unsupported git command.", command: `git ${command}` };
  }
  return runCommand(workspacePath, `git ${command}`);
});

ipcMain.handle("progress:load", loadProgress);

ipcMain.handle("progress:save", async (_event, progress) => {
  return saveProgress(progress);
});

ipcMain.handle("progress:record", async (_event, event) => recordLearningEvent(event));

ipcMain.handle("opencode:info", async () => {
  const command = opencodeCommand("--version");
  const result = await runCommand(rootDir, command);
  return {
    installed: result.exitCode === 0,
    version: result.stdout.trim() || result.stderr.trim(),
    bin: opencodeBin(),
    command: "opencode"
  };
});

ipcMain.handle("opencode:models", async (_event, provider) => {
  const command = opencodeCommand(`models${provider ? ` ${provider}` : ""}`);
  const result = await runCommand(rootDir, command);
  return {
    ...result,
    models: `${result.stdout || ""}${result.stderr || ""}`
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  };
});

ipcMain.handle("opencode:providers", async () => [
  { id: "ollama", label: "Ollama Local", kind: "local", command: "/models ollama" },
  { id: "ollama-cloud", label: "Ollama Cloud", kind: "cloud", command: "/connect Ollama Cloud" },
  { id: "opencode", label: "Code Zen", kind: "cloud", command: "/connect Code Zen" },
  { id: "openrouter", label: "OpenRouter", kind: "cloud", command: "/connect OpenRouter" },
  { id: "z-ai", label: "Z.AI", kind: "cloud", command: "/connect Z.AI" },
  { id: "zenmux", label: "ZenMux", kind: "cloud", command: "/connect ZenMux" },
  { id: "lmstudio", label: "LM Studio", kind: "local", command: "/connect LM Studio" },
  { id: "llama.cpp", label: "llama.cpp", kind: "local", command: "/connect llama.cpp" },
  { id: "github-copilot", label: "GitHub Copilot", kind: "cloud", command: "/connect GitHub Copilot" },
  { id: "anthropic", label: "Anthropic", kind: "cloud", command: "/connect Anthropic" },
  { id: "openai", label: "OpenAI", kind: "cloud", command: "/connect OpenAI" },
  { id: "google-vertex", label: "Google Vertex AI", kind: "cloud", command: "/connect Google Vertex AI" }
]);

ipcMain.handle("opencode:syncOllama", async (_event, payload = {}) => {
  const projectPath = payload.projectPath || rootDir;
  const models = Array.isArray(payload.models) ? payload.models.filter(Boolean) : [];
  const configPath = path.join(projectPath, "opencode.json");
  const existing = await readJson(configPath, {});
  const modelMap = Object.fromEntries(
    models.map((model) => [
      model,
      {
        name: model,
        limit: {
          context: 32768,
          output: 8192
        }
      }
    ])
  );
  const next = {
    "$schema": "https://opencode.ai/config.json",
    ...existing,
    provider: {
      ...(existing.provider || {}),
      ollama: {
        ...(existing.provider?.ollama || {}),
        npm: "@ai-sdk/openai-compatible",
        name: "Ollama (local)",
        options: {
          ...(existing.provider?.ollama?.options || {}),
          baseURL: "http://localhost:11434/v1"
        },
        models: {
          ...(existing.provider?.ollama?.models || {}),
          ...modelMap
        }
      }
    },
    model: existing.model || (models[0] ? `ollama/${models[0]}` : undefined),
    small_model: existing.small_model || (models[0] ? `ollama/${models[0]}` : undefined)
  };
  if (!next.model) delete next.model;
  if (!next.small_model) delete next.small_model;
  await writeJson(configPath, next);
  return {
    ok: true,
    path: configPath,
    modelCount: models.length,
    defaultModel: next.model || ""
  };
});

ipcMain.handle("opencode:command", async (_event, payload = {}) => {
  const projectPath = payload.projectPath || rootDir;
  if (payload.mode === "run") {
    return runGuiAgentCommand(projectPath, payload.model || "", payload.prompt || "", _event.sender, payload);
  }
  return {
    exitCode: 0,
    stdout: opencodeCommand(`${payload.model ? ` --model ${JSON.stringify(payload.model)}` : ""} ${JSON.stringify(projectPath)}`),
    stderr: "",
    command: "opencode command preview"
  };
});

ipcMain.handle("opencode:sessions", async (_event, payload = {}) => {
  return listOpenCodeSessions(payload.projectPath || rootDir);
});

ipcMain.handle("opencode:sessionList", async (_event, payload = {}) => {
  return listOpenCodeSessions(payload.projectPath || rootDir);
});

ipcMain.handle("opencode:sessionGet", async (_event, payload = {}) => {
  return getOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:session", async (_event, payload = {}) => {
  return getOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:sessionCreate", async (_event, payload = {}) => {
  return createOpenCodeSessionFromPayload(payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:sessionStart", async (_event, payload = {}) => {
  return createOpenCodeSessionFromPayload(payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:sessionFork", async (_event, payload = {}) => {
  return forkOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:sessionUpdate", async (_event, payload = {}) => {
  return updateOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir, payload.update || payload);
});

ipcMain.handle("opencode:sessionDelete", async (_event, payload = {}) => {
  return deleteOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:commands", async (_event, payload = {}) => {
  return listOpenCodeCommands(payload.projectPath || rootDir);
});

ipcMain.handle("opencode:providerState", async (_event, payload = {}) => {
  return readOpenCodeProviderState(payload.projectPath || rootDir);
});

ipcMain.handle("opencode:providerAuth", async (_event, payload = {}) => {
  return readOpenCodeProviderAuth(payload.projectPath || rootDir);
});

ipcMain.handle("opencode:providerAuthorize", async (_event, payload = {}) => {
  return authorizeOpenCodeProvider(
    payload.providerID,
    payload.method || 0,
    payload.inputs || {},
    payload.projectPath || rootDir
  );
});

ipcMain.handle("opencode:providerCallback", async (_event, payload = {}) => {
  return callbackOpenCodeProvider(
    payload.providerID,
    payload.method || 0,
    payload.code || "",
    payload.projectPath || rootDir
  );
});

ipcMain.handle("opencode:providerApiKey", async (_event, payload = {}) => {
  return saveOpenCodeProviderApiKey(payload.providerID, payload.key || "", payload.projectPath || rootDir);
});

ipcMain.handle("opencode:messages", async (_event, payload = {}) => {
  return readOpenCodeMessages(payload.sessionID, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:sessionMessages", async (_event, payload = {}) => {
  return readOpenCodeMessages(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:abort", async (_event, payload = {}) => {
  return abortOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:sessionAbort", async (_event, payload = {}) => {
  return abortOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:eventStreamStart", async (_event, payload = {}) => {
  return startOpenCodeEventStream(_event.sender, payload);
});

ipcMain.handle("opencode:eventsStart", async (_event, payload = {}) => {
  return startOpenCodeEventStream(_event.sender, payload);
});

ipcMain.handle("opencode:eventStreamStop", async (_event, payload = {}) => {
  return stopOpenCodeEventStream(payload.streamID || payload.requestId || payload);
});

ipcMain.handle("opencode:eventsStop", async (_event, payload = {}) => {
  return stopOpenCodeEventStream(payload.streamID || payload.requestId || payload);
});

ipcMain.handle("opencode:permissions", async (_event, payload = {}) => {
  return readOpenCodePermissions(payload.sessionID, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:permissionList", async (_event, payload = {}) => {
  return readOpenCodePermissions(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:permissionReply", async (_event, payload = {}) => {
  return replyOpenCodePermission(
    payload.sessionID,
    payload.requestID || payload.permissionID || payload.id,
    payload.reply || payload.response || "once",
    payload.projectPath || rootDir,
    payload.message
  );
});

ipcMain.handle("opencode:diff", async (_event, payload = {}) => {
  return readOpenCodeDiff(payload.sessionID || payload.id, payload.projectPath || rootDir, payload.messageID);
});

ipcMain.handle("opencode:sessionDiff", async (_event, payload = {}) => {
  return readOpenCodeDiff(payload.sessionID || payload.id, payload.projectPath || rootDir, payload.messageID);
});

ipcMain.handle("opencode:todo", async (_event, payload = {}) => {
  return readOpenCodeTodo(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:sessionTodo", async (_event, payload = {}) => {
  return readOpenCodeTodo(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:prompt", async (_event, payload = {}) => {
  return runGuiAgentCommand(
    payload.projectPath || rootDir,
    payload.model || payload.modelRef || "",
    payload.prompt || payload.text || "",
    _event.sender,
    {
      requestId: payload.requestId,
      permissionMode: payload.permissionMode,
      planMode: payload.planMode
    }
  );
});

ipcMain.handle("opencode:sessionPrompt", async (_event, payload = {}) => {
  return runGuiAgentCommand(
    payload.projectPath || rootDir,
    payload.model || payload.modelRef || "",
    payload.prompt || payload.text || "",
    _event.sender,
    {
      requestId: payload.requestId,
      permissionMode: payload.permissionMode,
      planMode: payload.planMode
    }
  );
});

ipcMain.handle("opencode:sessionCommand", async (_event, payload = {}) => {
  const sessionID = payload.sessionID || payload.id;
  if (!sessionID) {
    return { exitCode: 1, stdout: "", stderr: "No active Code session.", command: payload.command || "" };
  }
  const result = await runOpenCodeCommand(sessionID, payload.projectPath || rootDir, payload);
  const text = latestAssistantText([result], 0) || JSON.stringify(result, null, 2);
  return { exitCode: 0, stdout: text, stderr: "", command: `/${payload.command || ""}` };
});

ipcMain.handle("opencode:commandList", async (_event, payload = {}) => {
  return listOpenCodeCommands(payload.projectPath || rootDir);
});

ipcMain.handle("opencode:commandRun", async (_event, payload = {}) => {
  return runOpenCodeCommand(payload.sessionID || payload.id, payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:shell", async (_event, payload = {}) => {
  return runOpenCodeShell(payload.sessionID || payload.id, payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:shellRun", async (_event, payload = {}) => {
  return runOpenCodeShell(payload.sessionID || payload.id, payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:revert", async (_event, payload = {}) => {
  return revertOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:sessionRevert", async (_event, payload = {}) => {
  return revertOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir, payload);
});

ipcMain.handle("opencode:unrevert", async (_event, payload = {}) => {
  return unrevertOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

ipcMain.handle("opencode:sessionUnrevert", async (_event, payload = {}) => {
  return unrevertOpenCodeSession(payload.sessionID || payload.id, payload.projectPath || rootDir);
});

async function ollamaFetch(route, options = {}) {
  const response = await fetch(`http://localhost:11434${route}`, options);
  if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
  return response.json();
}

ipcMain.handle("ollama:status", async () => {
  try {
    await ollamaFetch("/api/tags");
    return { online: true };
  } catch (error) {
    return { online: false, message: "Ollama is not reachable at localhost:11434." };
  }
});

ipcMain.handle("ollama:models", async () => {
  try {
    const data = await ollamaFetch("/api/tags");
    return (data.models || []).map((model) => model.name);
  } catch {
    return [];
  }
});

ipcMain.handle("ollama:chat", async (_event, payload) => {
  const system = [
    "You are a patient local coding tutor inside a beginner IDE.",
    "Give concise, practical guidance.",
    "Do not claim to edit files or run shell commands.",
    "Prefer hints and explanations over complete answers unless the user asks for a fix."
  ].join(" ");
  const prompt = [
    `Task: ${payload.task}`,
    payload.lessonTitle ? `Lesson: ${payload.lessonTitle}` : "",
    payload.lessonGoal ? `Goal: ${payload.lessonGoal}` : "",
    payload.filePath ? `File: ${payload.filePath}` : "",
    payload.code ? `Code:\n${payload.code}` : "",
    payload.terminal ? `Terminal output:\n${payload.terminal}` : "",
    payload.question ? `Question:\n${payload.question}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  const data = await ollamaFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: payload.model,
      stream: false,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt }
      ]
    })
  });
  return data.message?.content || "Ollama returned an empty response.";
});

ipcMain.handle("terminal:start", (event, workspacePath) => {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const shell = process.env.SHELL || (process.platform === "win32" ? "powershell.exe" : "bash");
  const cwd = workspacePath && fs.existsSync(workspacePath) ? workspacePath : os.homedir();
  if (pty) {
    const term = pty.spawn(shell, [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: process.env
    });
    term.onData((data) => event.sender.send("terminal:data", id, data));
    term.onExit(() => {
      terminals.delete(id);
      event.sender.send("terminal:exit", id);
    });
    terminals.set(id, term);
    return { id, mode: "pty" };
  }
  event.sender.send("terminal:data", id, "node-pty is unavailable. Terminal is disabled.\r\n");
  return { id, mode: "disabled" };
});

ipcMain.on("terminal:write", (_event, terminalId, data) => {
  terminals.get(terminalId)?.write(data);
});

ipcMain.on("terminal:resize", (_event, terminalId, cols, rows) => {
  terminals.get(terminalId)?.resize(cols, rows);
});

ipcMain.on("terminal:stop", (_event, terminalId) => {
  terminals.get(terminalId)?.kill();
  terminals.delete(terminalId);
});
