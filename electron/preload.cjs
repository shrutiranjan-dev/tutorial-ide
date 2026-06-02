const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("tutorialIde", {
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
      ipcRenderer.invoke("files:write", workspacePath, relativePath, content)
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
