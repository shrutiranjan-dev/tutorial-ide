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
    commandList: (payload) => ipcRenderer.invoke("opencode:commandList", payload),
    commandRun: (payload) => ipcRenderer.invoke("opencode:commandRun", payload),
    providerState: (payload) => ipcRenderer.invoke("opencode:providerState", payload),
    providerAuth: (payload) => ipcRenderer.invoke("opencode:providerAuth", payload),
    providerAuthorize: (payload) => ipcRenderer.invoke("opencode:providerAuthorize", payload),
    providerCallback: (payload) => ipcRenderer.invoke("opencode:providerCallback", payload),
    providerApiKey: (payload) => ipcRenderer.invoke("opencode:providerApiKey", payload),
    authList: (payload) => ipcRenderer.invoke("opencode:authList", payload),
    authGet: (payload) => ipcRenderer.invoke("opencode:authGet", payload),
    authCreate: (payload) => ipcRenderer.invoke("opencode:authCreate", payload),
    authUpdate: (payload) => ipcRenderer.invoke("opencode:authUpdate", payload),
    authDelete: (payload) => ipcRenderer.invoke("opencode:authDelete", payload),
    authActivate: (payload) => ipcRenderer.invoke("opencode:authActivate", payload),
    catalogModels: (payload) => ipcRenderer.invoke("opencode:catalogModels", payload),
    catalogModel: (payload) => ipcRenderer.invoke("opencode:catalogModel", payload),
    command: (payload) => ipcRenderer.invoke("opencode:command", payload),
    sendPrompt: (payload) => ipcRenderer.invoke("opencode:prompt", payload),
    sessionPrompt: (payload) => ipcRenderer.invoke("opencode:sessionPrompt", payload),
    shell: (payload) => ipcRenderer.invoke("opencode:shell", payload),
    shellRun: (payload) => ipcRenderer.invoke("opencode:shellRun", payload),
    sessions: (payload) => ipcRenderer.invoke("opencode:sessions", payload),
    sessionList: (payload) => ipcRenderer.invoke("opencode:sessionList", payload),
    startSession: (payload) => ipcRenderer.invoke("opencode:sessionStart", payload),
    sessionCreate: (payload) => ipcRenderer.invoke("opencode:sessionCreate", payload),
    session: (payload) => ipcRenderer.invoke("opencode:session", payload),
    sessionGet: (payload) => ipcRenderer.invoke("opencode:sessionGet", payload),
    getSession: (payload) => ipcRenderer.invoke("opencode:session", payload),
    sessionUpdate: (payload) => ipcRenderer.invoke("opencode:sessionUpdate", payload),
    updateSession: (payload) => ipcRenderer.invoke("opencode:sessionUpdate", payload),
    sessionFork: (payload) => ipcRenderer.invoke("opencode:sessionFork", payload),
    fork: (payload) => ipcRenderer.invoke("opencode:sessionFork", payload),
    sessionDelete: (payload) => ipcRenderer.invoke("opencode:sessionDelete", payload),
    deleteSession: (payload) => ipcRenderer.invoke("opencode:sessionDelete", payload),
    messages: (payload) => ipcRenderer.invoke("opencode:messages", payload),
    sessionMessages: (payload) => ipcRenderer.invoke("opencode:sessionMessages", payload),
    abort: (payload) => ipcRenderer.invoke("opencode:abort", payload),
    sessionAbort: (payload) => ipcRenderer.invoke("opencode:sessionAbort", payload),
    eventsStart: (payload) => ipcRenderer.invoke("opencode:eventsStart", payload),
    startEvents: (payload) => ipcRenderer.invoke("opencode:eventsStart", payload),
    eventStreamStart: (payload) => ipcRenderer.invoke("opencode:eventStreamStart", payload),
    eventsStop: (payload) => ipcRenderer.invoke("opencode:eventsStop", payload),
    stopEvents: (payload) => ipcRenderer.invoke("opencode:eventsStop", payload),
    eventStreamStop: (payload) => ipcRenderer.invoke("opencode:eventStreamStop", payload),
    permissions: (payload) => ipcRenderer.invoke("opencode:permissions", payload),
    permissionList: (payload) => ipcRenderer.invoke("opencode:permissions", payload),
    permissionListRaw: (payload) => ipcRenderer.invoke("opencode:permissionList", payload),
    permissionReply: (payload) => ipcRenderer.invoke("opencode:permissionReply", payload),
    todo: (payload) => ipcRenderer.invoke("opencode:todo", payload),
    sessionTodo: (payload) => ipcRenderer.invoke("opencode:sessionTodo", payload),
    sessionContext: (payload) => ipcRenderer.invoke("opencode:sessionContext", payload),
    sessionWait: (payload) => ipcRenderer.invoke("opencode:sessionWait", payload),
    diff: (payload) => ipcRenderer.invoke("opencode:diff", payload),
    sessionDiff: (payload) => ipcRenderer.invoke("opencode:sessionDiff", payload),
    sessionCommand: (payload) => ipcRenderer.invoke("opencode:sessionCommand", payload),
    revert: (payload) => ipcRenderer.invoke("opencode:revert", payload),
    sessionRevert: (payload) => ipcRenderer.invoke("opencode:sessionRevert", payload),
    unrevert: (payload) => ipcRenderer.invoke("opencode:unrevert", payload),
    sessionUnrevert: (payload) => ipcRenderer.invoke("opencode:sessionUnrevert", payload),
    sessionCompact: (payload) => ipcRenderer.invoke("opencode:sessionCompact", payload),
    revertStage: (payload) => ipcRenderer.invoke("opencode:revertStage", payload),
    revertClear: (payload) => ipcRenderer.invoke("opencode:revertClear", payload),
    revertCommit: (payload) => ipcRenderer.invoke("opencode:revertCommit", payload),
    modelDetail: (payload) => ipcRenderer.invoke("opencode:modelDetail", payload),
    providerDetail: (payload) => ipcRenderer.invoke("opencode:providerDetail", payload),
    sessionSwitchModel: (payload) => ipcRenderer.invoke("opencode:sessionSwitchModel", payload),
    sessionSwitchAgent: (payload) => ipcRenderer.invoke("opencode:sessionSwitchAgent", payload),
    agents: (payload) => ipcRenderer.invoke("opencode:agents", payload),
    integrations: (payload) => ipcRenderer.invoke("opencode:providers", payload),
    oauthAttemptPoll: (payload) => ipcRenderer.invoke("opencode:oauthAttemptPoll", payload),
    oauthAttemptCancel: (payload) => ipcRenderer.invoke("opencode:oauthAttemptCancel", payload),
    credentials: (payload) => ipcRenderer.invoke("opencode:credentials", payload),
    credentialUpdate: (payload) => ipcRenderer.invoke("opencode:credentialUpdate", payload),
    credentialDelete: (payload) => ipcRenderer.invoke("opencode:credentialDelete", payload),
    // Q&A methods
    questionRequests: (payload) => ipcRenderer.invoke("opencode:questionRequests", payload),
    sessionQuestions: (payload) => ipcRenderer.invoke("opencode:sessionQuestions", payload),
    questionReply: (payload) => ipcRenderer.invoke("opencode:questionReply", payload),
    questionReject: (payload) => ipcRenderer.invoke("opencode:questionReject", payload),
    // Skills method
    skills: (payload) => ipcRenderer.invoke("opencode:skills", payload),
    // References method
    references: (payload) => ipcRenderer.invoke("opencode:references", payload),
    // Saved permissions methods
    savedPermissions: (payload) => ipcRenderer.invoke("opencode:savedPermissions", payload),
    deleteSavedPermission: (payload) => ipcRenderer.invoke("opencode:deleteSavedPermission", payload),
    health: (payload) => ipcRenderer.invoke("opencode:health", payload),
    location: (payload) => ipcRenderer.invoke("opencode:location", payload),
    // Config methods
    readConfig: (payload) => ipcRenderer.invoke("opencode:readConfig", payload),
    writeConfig: (payload) => ipcRenderer.invoke("opencode:writeConfig", payload),
    engineConfig: (payload) => ipcRenderer.invoke("opencode:engineConfig", payload),
    engineConfigUpdate: (payload) => ipcRenderer.invoke("opencode:engineConfigUpdate", payload),
    engineProviderConfig: (payload) => ipcRenderer.invoke("opencode:engineProviderConfig", payload),
    globalConfig: (payload) => ipcRenderer.invoke("opencode:globalConfig", payload),
    writeGlobalConfig: (payload) => ipcRenderer.invoke("opencode:writeGlobalConfig", payload),
    // MCP Config methods
    readMCPConfig: (payload) => ipcRenderer.invoke("opencode:readMCPConfig", payload),
    writeMCPConfig: (payload) => ipcRenderer.invoke("opencode:writeMCPConfig", payload),
    mcpConnect: (payload) => ipcRenderer.invoke("opencode:mcpConnect", payload),
    mcpDisconnect: (payload) => ipcRenderer.invoke("opencode:mcpDisconnect", payload),
    mcpPromptList: (payload) => ipcRenderer.invoke("opencode:mcpPromptList", payload),
    mcpPromptRender: (payload) => ipcRenderer.invoke("opencode:mcpPromptRender", payload),
    mcpResourceList: (payload) => ipcRenderer.invoke("opencode:mcpResourceList", payload),
    mcpResourceRead: (payload) => ipcRenderer.invoke("opencode:mcpResourceRead", payload),
    mcpServerList: (payload) => ipcRenderer.invoke("opencode:mcpServerList", payload),
    mcpServerCreate: (payload) => ipcRenderer.invoke("opencode:mcpServerCreate", payload),
    mcpServerOauthStart: (payload) => ipcRenderer.invoke("opencode:mcpServerOauthStart", payload),
    mcpServerOauthCallback: (payload) => ipcRenderer.invoke("opencode:mcpServerOauthCallback", payload),
    mcpServerOauthDelete: (payload) => ipcRenderer.invoke("opencode:mcpServerOauthDelete", payload),
    formatterStatus: (payload) => ipcRenderer.invoke("opencode:formatterStatus", payload),
    lspStatus: (payload) => ipcRenderer.invoke("opencode:lspStatus", payload),
    fsTree: (payload) => ipcRenderer.invoke("opencode:fsTree", payload),
    fsFile: (payload) => ipcRenderer.invoke("opencode:fsFile", payload),
    fsSearch: (payload) => ipcRenderer.invoke("opencode:fsSearch", payload),
    fsGrep: (payload) => ipcRenderer.invoke("opencode:fsGrep", payload),
    vcsGet: (payload) => ipcRenderer.invoke("opencode:vcsGet", payload),
    vcsStatus: (payload) => ipcRenderer.invoke("opencode:vcsStatus", payload),
    vcsDiff: (payload) => ipcRenderer.invoke("opencode:vcsDiff", payload),
    vcsStage: (payload) => ipcRenderer.invoke("opencode:vcsStage", payload),
    vcsUnstage: (payload) => ipcRenderer.invoke("opencode:vcsUnstage", payload),
    vcsPatch: (payload) => ipcRenderer.invoke("opencode:vcsPatch", payload),
    vcsApply: (payload) => ipcRenderer.invoke("opencode:vcsApply", payload),
    ptyCreate: (payload) => ipcRenderer.invoke("opencode:ptyCreate", payload),
    ptyList: (payload) => ipcRenderer.invoke("opencode:ptyList", payload),
    ptyGet: (payload) => ipcRenderer.invoke("opencode:ptyGet", payload),
    ptyUpdate: (payload) => ipcRenderer.invoke("opencode:ptyUpdate", payload),
    ptyDelete: (payload) => ipcRenderer.invoke("opencode:ptyDelete", payload),
    // Project copy methods
    copyProject: (payload) => ipcRenderer.invoke("opencode:copyProject", payload),
    listProjects: (payload) => ipcRenderer.invoke("opencode:listProjects", payload),
    projectList: (payload) => ipcRenderer.invoke("opencode:projectList", payload),
    projectGet: (payload) => ipcRenderer.invoke("opencode:projectGet", payload),
    projectUpdate: (payload) => ipcRenderer.invoke("opencode:projectUpdate", payload),
    workspaceList: (payload) => ipcRenderer.invoke("opencode:workspaceList", payload),
    workspaceGet: (payload) => ipcRenderer.invoke("opencode:workspaceGet", payload),
    workspaceCreate: (payload) => ipcRenderer.invoke("opencode:workspaceCreate", payload),
    workspaceUpdate: (payload) => ipcRenderer.invoke("opencode:workspaceUpdate", payload),
    workspaceDelete: (payload) => ipcRenderer.invoke("opencode:workspaceDelete", payload),
    workspaceStatus: (payload) => ipcRenderer.invoke("opencode:workspaceStatus", payload),
    workspaceSync: (payload) => ipcRenderer.invoke("opencode:workspaceSync", payload),
    workspaceWarp: (payload) => ipcRenderer.invoke("opencode:workspaceWarp", payload),
    // CLI method
    cli: (payload) => ipcRenderer.invoke("opencode:cli", payload),
    // MCP Integrations method
    mcpIntegrations: (payload) => ipcRenderer.invoke("opencode:mcpIntegrations", payload),
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
    readRange: (workspacePath, relativePath, offset, length) =>
      ipcRenderer.invoke("files:readRange", workspacePath, relativePath, offset, length),
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
    getEnginePTYToken: (payload) => ipcRenderer.invoke("terminal:engineToken", payload),
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
