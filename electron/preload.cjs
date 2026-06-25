const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tutorialIde", {
  project: {
    default: () => ipcRenderer.invoke("project:default"),
    open: () => ipcRenderer.invoke("project:open")
  },
  opencode: {
    info: () => ipcRenderer.invoke("opencode:info"),
    providers: () => ipcRenderer.invoke("opencode:providers"),
    models: (provider) => ipcRenderer.invoke("opencode:models", provider),
    syncOllama: (payload) => ipcRenderer.invoke("opencode:syncOllama", payload),
    commands: (payload) => ipcRenderer.invoke("opencode:commands", payload),
    providerState: (payload) => ipcRenderer.invoke("opencode:providerState", payload),
    providerAuth: (payload) => ipcRenderer.invoke("opencode:providerAuth", payload),
    providerAuthorize: (payload) => ipcRenderer.invoke("opencode:providerAuthorize", payload),
    providerCallback: (payload) => ipcRenderer.invoke("opencode:providerCallback", payload),
    providerApiKey: (payload) => ipcRenderer.invoke("opencode:providerApiKey", payload),
    command: (payload) => ipcRenderer.invoke("opencode:command", payload),
    sendPrompt: (payload) => ipcRenderer.invoke("opencode:prompt", payload),
    shell: (payload) => ipcRenderer.invoke("opencode:shell", payload),
    sessions: (payload) => ipcRenderer.invoke("opencode:sessions", payload),
    startSession: (payload) => ipcRenderer.invoke("opencode:sessionStart", payload),
    session: (payload) => ipcRenderer.invoke("opencode:session", payload),
    getSession: (payload) => ipcRenderer.invoke("opencode:session", payload),
    sessionUpdate: (payload) => ipcRenderer.invoke("opencode:sessionUpdate", payload),
    updateSession: (payload) => ipcRenderer.invoke("opencode:sessionUpdate", payload),
    sessionFork: (payload) => ipcRenderer.invoke("opencode:sessionFork", payload),
    fork: (payload) => ipcRenderer.invoke("opencode:sessionFork", payload),
    sessionDelete: (payload) => ipcRenderer.invoke("opencode:sessionDelete", payload),
    deleteSession: (payload) => ipcRenderer.invoke("opencode:sessionDelete", payload),
    messages: (payload) => ipcRenderer.invoke("opencode:messages", payload),
    abort: (payload) => ipcRenderer.invoke("opencode:abort", payload),
    eventsStart: (payload) => ipcRenderer.invoke("opencode:eventsStart", payload),
    startEvents: (payload) => ipcRenderer.invoke("opencode:eventsStart", payload),
    eventsStop: (payload) => ipcRenderer.invoke("opencode:eventsStop", payload),
    stopEvents: (payload) => ipcRenderer.invoke("opencode:eventsStop", payload),
    permissions: (payload) => ipcRenderer.invoke("opencode:permissions", payload),
    permissionList: (payload) => ipcRenderer.invoke("opencode:permissions", payload),
    permissionReply: (payload) => ipcRenderer.invoke("opencode:permissionReply", payload),
    todo: (payload) => ipcRenderer.invoke("opencode:todo", payload),
    diff: (payload) => ipcRenderer.invoke("opencode:diff", payload),
    sessionCommand: (payload) => ipcRenderer.invoke("opencode:sessionCommand", payload),
    revert: (payload) => ipcRenderer.invoke("opencode:revert", payload),
    unrevert: (payload) => ipcRenderer.invoke("opencode:unrevert", payload),
    onEvent: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("opencode:event", listener);
      return () => ipcRenderer.removeListener("opencode:event", listener);
    }
  },
  lessons: {
    list: () => ipcRenderer.invoke("lessons:list"),
    open: (lessonId) => ipcRenderer.invoke("lessons:open", lessonId),
    run: (lessonId, workspacePath) => ipcRenderer.invoke("lessons:run", lessonId, workspacePath),
    checkpoint: (lessonId, workspacePath) =>
      ipcRenderer.invoke("lessons:checkpoint", lessonId, workspacePath)
  },
  roadmaps: {
    list: () => ipcRenderer.invoke("roadmaps:list"),
    create: (answers) => ipcRenderer.invoke("roadmaps:create", answers),
    interviewStart: (payload) => ipcRenderer.invoke("roadmaps:interviewStart", payload),
    interviewReply: (payload) => ipcRenderer.invoke("roadmaps:interviewReply", payload),
    createFromInterview: (payload) => ipcRenderer.invoke("roadmaps:createFromInterview", payload),
    advance: (lessonId, skipped) => ipcRenderer.invoke("roadmaps:advance", lessonId, skipped),
    remove: (roadmapId) => ipcRenderer.invoke("roadmaps:remove", roadmapId)
  },
  files: {
    list: (workspacePath) => ipcRenderer.invoke("files:list", workspacePath),
    read: (workspacePath, relativePath) =>
      ipcRenderer.invoke("files:read", workspacePath, relativePath),
    write: (workspacePath, relativePath, content) =>
      ipcRenderer.invoke("files:write", workspacePath, relativePath, content),
    createFile: (workspacePath, relativePath, content) =>
      ipcRenderer.invoke("files:createFile", workspacePath, relativePath, content),
    createFolder: (workspacePath, relativePath) =>
      ipcRenderer.invoke("files:createFolder", workspacePath, relativePath),
    delete: (workspacePath, relativePath) =>
      ipcRenderer.invoke("files:delete", workspacePath, relativePath),
    rename: (workspacePath, fromPath, toPath) =>
      ipcRenderer.invoke("files:rename", workspacePath, fromPath, toPath),
    duplicate: (workspacePath, fromPath, toPath) =>
      ipcRenderer.invoke("files:duplicate", workspacePath, fromPath, toPath)
  },
  workspace: {
    search: (workspacePath, payload) => ipcRenderer.invoke("workspace:search", workspacePath, payload),
    symbols: (workspacePath, query) => ipcRenderer.invoke("workspace:symbols", workspacePath, query)
  },
  git: {
    status: (workspacePath) => ipcRenderer.invoke("git:status", workspacePath),
    command: (workspacePath, command) => ipcRenderer.invoke("git:command", workspacePath, command)
  },
  progress: {
    load: () => ipcRenderer.invoke("progress:load"),
    save: (progress) => ipcRenderer.invoke("progress:save", progress),
    record: (event) => ipcRenderer.invoke("progress:record", event)
  },
  ollama: {
    status: () => ipcRenderer.invoke("ollama:status"),
    models: () => ipcRenderer.invoke("ollama:models"),
    chat: (payload) => ipcRenderer.invoke("ollama:chat", payload)
  },
  terminal: {
    start: (workspacePath) => ipcRenderer.invoke("terminal:start", workspacePath),
    write: (terminalId, data) => ipcRenderer.send("terminal:write", terminalId, data),
    resize: (terminalId, cols, rows) =>
      ipcRenderer.send("terminal:resize", terminalId, cols, rows),
    stop: (terminalId) => ipcRenderer.send("terminal:stop", terminalId),
    onData: (callback) => {
      const listener = (_event, terminalId, data) => callback(terminalId, data);
      ipcRenderer.on("terminal:data", listener);
      return () => ipcRenderer.removeListener("terminal:data", listener);
    },
    onExit: (callback) => {
      const listener = (_event, terminalId) => callback(terminalId);
      ipcRenderer.on("terminal:exit", listener);
      return () => ipcRenderer.removeListener("terminal:exit", listener);
    }
  }
});
