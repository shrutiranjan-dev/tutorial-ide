import { useCallback, useEffect, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import {
  Bot,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CirclePlay,
  Eye,
  FastForward,
  Code2,
  FolderOpen,
  GraduationCap,
  Layers3,
  Lightbulb,
  MessageSquareText,
  PanelRight,
  RefreshCw,
  Save,
  Send,
  Sparkles,
  TerminalSquare,
  Trash2,
  Wand2,
  X
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type {
  CommandResult,
  FileNode,
  InterviewPrompt,
  InterviewTurn,
  LearningStatus,
  Lesson,
  OpenTab,
  ProgressEntry,
  ProgressEvent,
  ProgressMap,
  Roadmap,
  TutorMessage
} from "./types";
import { compactTerminalOutput, extensionIcon, languageFromPath } from "./utils";

const api = window.tutorialIde;

function uid() {
  return Math.random().toString(16).slice(2);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function formatCommandResult(label: string, result: CommandResult) {
  const body = `${result.stdout || ""}${result.stderr || ""}`.trim() || "No output.";
  const status = result.exitCode === 0 ? "OK" : `EXIT ${result.exitCode}`;
  return `\r\n$ ${result.command || label}\r\n[${label} ${status}]\r\n${body}\r\n`;
}

function progressFor(progress: ProgressMap, lessonId?: string) {
  return lessonId ? progress[lessonId] : undefined;
}

function lessonStatus(progress: ProgressMap, item?: Lesson | null): LearningStatus {
  return progressFor(progress, item?.id)?.status || "ready";
}

function statusLabel(status: LearningStatus) {
  const labels: Record<LearningStatus, string> = {
    locked: "Locked",
    ready: "Ready",
    in_progress: "Working",
    ran: "Ran",
    failed_check: "Failed",
    passed_check: "Passed",
    skipped: "Skipped",
    needs_review: "Review",
    mastered: "Mastered",
    blocked: "Blocked"
  };
  return labels[status];
}

function nextActionForStatus(status: LearningStatus) {
  const actions: Record<LearningStatus, string> = {
    locked: "Complete the prerequisite lesson first.",
    ready: "Open the guide, build the artifact, then run the file.",
    in_progress: "Keep editing, then run the file.",
    ran: "Run Check when the output looks right.",
    failed_check: "Read the checkpoint output and fix the smallest failing piece.",
    passed_check: "Checkpoint passed. The next part is ready.",
    skipped: "Skipped lessons do not count as mastered. Review later if needed.",
    needs_review: "Use the remediation step before retrying Check.",
    mastered: "Mastered. Continue to the next part.",
    blocked: "Resolve the blocking error before continuing."
  };
  return actions[status];
}

export function App() {
  const [activeActivity, setActiveActivity] = useState<"explorer" | "lessons" | "tutor" | "run" | "preview">("explorer");
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [roadmaps, setRoadmaps] = useState<Roadmap[]>([]);
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [workspacePath, setWorkspacePath] = useState("");
  const [files, setFiles] = useState<FileNode[]>([]);
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState("");
  const [progress, setProgress] = useState<ProgressMap>({});
  const [ollamaOnline, setOllamaOnline] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [selectedModel, setSelectedModel] = useState("");
  const [terminalOutput, setTerminalOutput] = useState("");
  const [checkpointOutput, setCheckpointOutput] = useState("");
  const [advanceNotice, setAdvanceNotice] = useState("");
  const [previewVersion, setPreviewVersion] = useState(0);
  const [selectedCode, setSelectedCode] = useState("");
  const [commandEvent, setCommandEvent] = useState<{ id: string; text: string } | null>(null);
  const [runState, setRunState] = useState<"idle" | "running" | "checking">("idle");
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [tutorWidth, setTutorWidth] = useState(370);
  const [bottomHeight, setBottomHeight] = useState(330);
  const [roadmapHeight, setRoadmapHeight] = useState(430);
  const [tutorialHeight, setTutorialHeight] = useState(120);

  const activeTab = tabs.find((tab) => tab.path === activePath) || null;
  const dirtyCount = tabs.filter((tab) => tab.content !== tab.savedContent).length;
  const activeRoadmap = roadmaps.find((item) => item.id === lesson?.roadmapId) || null;
  const visibleLessons = lessons.filter(
    (item) => !item.roadmapId || item.roadmapId === activeRoadmap?.id || item.id === lesson?.id
  );
  const isBusy = runState !== "idle";
  const currentStatus = lessonStatus(progress, lesson);
  const currentProgress = progressFor(progress, lesson?.id);

  useEffect(() => {
    const normalizeLayout = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      setSidebarWidth((value) => clamp(value, width < 1180 ? 220 : 260, Math.max(230, Math.min(430, width * 0.28))));
      setTutorWidth((value) => clamp(value, width < 1180 ? 280 : 320, Math.max(290, Math.min(520, width * 0.3))));
      setBottomHeight((value) => clamp(value, height < 760 ? 210 : 260, Math.max(220, Math.min(460, height * 0.42))));
      setRoadmapHeight((value) => clamp(value, 180, Math.max(260, height - 260)));
      setTutorialHeight((value) => clamp(value, 64, Math.max(120, height - 320)));
    };
    normalizeLayout();
    window.addEventListener("resize", normalizeLayout);
    return () => window.removeEventListener("resize", normalizeLayout);
  }, []);

  const startResize = (type: "sidebar" | "tutor" | "bottom" | "roadmapSection" | "tutorialSection") => (event: ReactMouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startRoadmapHeight = roadmapHeight;
    const startTutorialHeight = tutorialHeight;
    const move = (moveEvent: MouseEvent) => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      if (type === "sidebar") {
        setSidebarWidth(clamp(moveEvent.clientX - 48, width < 1180 ? 220 : 260, Math.max(230, Math.min(430, width * 0.28))));
      }
      if (type === "tutor") {
        setTutorWidth(clamp(width - moveEvent.clientX, width < 1180 ? 280 : 320, Math.max(290, Math.min(520, width * 0.3))));
      }
      if (type === "bottom") {
        setBottomHeight(clamp(height - moveEvent.clientY - 25, height < 760 ? 210 : 260, Math.max(220, Math.min(460, height * 0.42))));
      }
      if (type === "roadmapSection") {
        setRoadmapHeight(clamp(startRoadmapHeight + moveEvent.clientY - startY, 180, Math.max(260, height - 260)));
      }
      if (type === "tutorialSection") {
        setTutorialHeight(clamp(startTutorialHeight + moveEvent.clientY - startY, 64, Math.max(120, height - 320)));
      }
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      window.dispatchEvent(new Event("resize"));
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
  };

  const refreshFiles = useCallback(async (workspace: string) => {
    setFiles(await api.files.list(workspace));
  }, []);

  const refreshLessons = useCallback(async () => {
    const [loadedLessons, loadedRoadmaps] = await Promise.all([
      api.lessons.list(),
      api.roadmaps.list()
    ]);
    setLessons(loadedLessons);
    setRoadmaps(loadedRoadmaps);
    return loadedLessons;
  }, []);

  const openLesson = useCallback(
    async (lessonId?: string) => {
      const opened = await api.lessons.open(lessonId);
      setLesson(opened.lesson);
      setWorkspacePath(opened.workspacePath);
      await refreshFiles(opened.workspacePath);
      const entryContent = await api.files.read(opened.workspacePath, opened.lesson.entryFile);
      setTabs([{ path: opened.lesson.entryFile, content: entryContent, savedContent: entryContent }]);
      setActivePath(opened.lesson.entryFile);
      setCheckpointOutput("");
      setAdvanceNotice("");
      setCommandEvent(null);
      setPreviewVersion((value) => value + 1);
      setProgress(await api.progress.load());
    },
    [refreshFiles]
  );

  useEffect(() => {
    async function boot() {
      const [loadedLessons, loadedProgress, status, loadedRoadmaps] = await Promise.all([
        api.lessons.list(),
        api.progress.load(),
        api.ollama.status(),
        api.roadmaps.list()
      ]);
      setLessons(loadedLessons);
      setRoadmaps(loadedRoadmaps);
      setProgress(loadedProgress);
      setOllamaOnline(status.online);
      if (status.online) {
        const loadedModels = await api.ollama.models();
        setModels(loadedModels);
        setSelectedModel(loadedModels[0] || "");
      }
      if (loadedLessons[0]) {
        await openLesson(loadedLessons[0].id);
      } else {
        setLesson(null);
        setWorkspacePath("");
        setFiles([]);
        setTabs([]);
        setActivePath("");
      }
    }
    boot().catch((error) => console.error(error));
  }, [openLesson]);

  const openFile = useCallback(
    async (path: string) => {
      if (!workspacePath) return;
      const existing = tabs.find((tab) => tab.path === path);
      if (existing) {
        setActivePath(path);
        return;
      }
      const content = await api.files.read(workspacePath, path);
      setTabs((current) => [...current, { path, content, savedContent: content }]);
      setActivePath(path);
    },
    [tabs, workspacePath]
  );

  const saveActive = useCallback(async () => {
    if (!workspacePath || !activeTab) return;
    await api.files.write(workspacePath, activeTab.path, activeTab.content);
    setTabs((current) =>
      current.map((tab) =>
        tab.path === activeTab.path ? { ...tab, savedContent: tab.content } : tab
      )
    );
    setPreviewVersion((value) => value + 1);
  }, [activeTab, workspacePath]);

  const saveAll = useCallback(async () => {
    if (!workspacePath) return;
    const dirtyTabs = tabs.filter((tab) => tab.content !== tab.savedContent);
    await Promise.all(
      dirtyTabs.map((tab) => api.files.write(workspacePath, tab.path, tab.content))
    );
    if (dirtyTabs.length) {
      setTabs((current) =>
        current.map((tab) => ({ ...tab, savedContent: tab.content }))
      );
      setPreviewVersion((value) => value + 1);
    }
  }, [tabs, workspacePath]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        saveActive();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [saveActive]);

  const appendCommandOutput = (label: string, result: CommandResult) => {
    const text = formatCommandResult(label, result);
    setCommandEvent({ id: uid(), text });
    setTerminalOutput((current) => `${current}${text}`.slice(-16000));
    setCheckpointOutput(`${label}: ${result.exitCode === 0 ? "Passed" : "Failed"}\n${`${result.stdout || ""}${result.stderr || ""}`.trim() || "No output."}`);
  };

  const runLesson = async () => {
    if (!lesson || !workspacePath || isBusy) return;
    setRunState("running");
    setCheckpointOutput("Running current file...");
    try {
      await saveAll();
      const result = await api.lessons.run(lesson.id, workspacePath);
      appendCommandOutput("Run", result);
      if (result.progress) setProgress(result.progress);
      setPreviewVersion((value) => value + 1);
    } finally {
      setRunState("idle");
    }
  };

  const runCheckpoint = async () => {
    if (!lesson || !workspacePath || isBusy) return;
    setRunState("checking");
    setCheckpointOutput("Running checkpoint...");
    try {
      await saveAll();
      const result = await api.lessons.checkpoint(lesson.id, workspacePath);
      appendCommandOutput("Check", result);
      if (result.progress) setProgress(result.progress);
      if (result.passed) {
        if (lesson.roadmapId) {
          await advanceRoadmap(false, "Test passed. Opening the next tutorial part...");
        }
      } else {
        setIsGuideOpen(true);
      }
    } finally {
      setRunState("idle");
    }
  };

  const advanceRoadmap = async (skipped: boolean, notice?: string) => {
    if (!lesson?.roadmapId) return;
    setAdvanceNotice(notice || (skipped ? "Skipped. Creating the next tutorial part..." : ""));
    const result = await api.roadmaps.advance(lesson.id, skipped);
    await refreshLessons();
    setRoadmaps(await api.roadmaps.list());
    setProgress(await api.progress.load());
    if (result.lessonId) {
      await openLesson(result.lessonId);
      setAdvanceNotice(skipped ? "Skipped test and opened the next part." : "Next tutorial part created.");
    } else if (result.done) {
      setAdvanceNotice("Roadmap complete. Nice work.");
    }
  };

  const createRoadmapFromInterview = async (transcript: InterviewTurn[]) => {
    const result = await api.roadmaps.createFromInterview({ model: selectedModel, transcript });
    await refreshLessons();
    setRoadmaps(await api.roadmaps.list());
    setProgress(await api.progress.load());
    await openLesson(result.lessonId);
  };

  const updateActiveContent = (content: string | undefined) => {
    setTabs((current) =>
      current.map((tab) => (tab.path === activePath ? { ...tab, content: content || "" } : tab))
    );
  };

  const openRoadmap = async (roadmap: Roadmap) => {
    const lessonId =
      roadmap.createdLessonIds[roadmap.currentIndex] ||
      roadmap.createdLessonIds[roadmap.createdLessonIds.length - 1];
    if (lessonId) await openLesson(lessonId);
  };

  const clearWorkspaceState = () => {
    setLesson(null);
    setWorkspacePath("");
    setFiles([]);
    setTabs([]);
    setActivePath("");
    setCheckpointOutput("");
    setAdvanceNotice("");
    setTerminalOutput("");
    setCommandEvent(null);
    setSelectedCode("");
    setPreviewVersion((value) => value + 1);
  };

  const removeRoadmap = async (roadmap: Roadmap) => {
    const confirmed = window.confirm(
      `Remove "${roadmap.topic}" and delete its generated lesson files/workspaces?`
    );
    if (!confirmed) return;
    const wasActive = roadmap.id === lesson?.roadmapId;
    const removal = await api.roadmaps.remove(roadmap.id);
    if (!removal.ok) {
      window.alert("Roadmap could not be removed. It may already be gone.");
      return;
    }
    const [loadedLessons, loadedRoadmaps, loadedProgress] = await Promise.all([
      api.lessons.list(),
      api.roadmaps.list(),
      api.progress.load()
    ]);
    setLessons(loadedLessons);
    setRoadmaps(loadedRoadmaps);
    setProgress(loadedProgress);
    if (wasActive) {
      const nextLesson = loadedLessons.find((item) => item.roadmapId !== roadmap.id);
      if (nextLesson) await openLesson(nextLesson.id);
      else clearWorkspaceState();
    }
  };

  return (
    <div
      className="app-shell"
      style={
        {
          "--sidebar-width": `${sidebarWidth}px`,
          "--tutor-width": `${tutorWidth}px`,
          "--bottom-height": `${bottomHeight}px`,
          "--roadmap-height": `${roadmapHeight}px`,
          "--tutorial-height": `${tutorialHeight}px`
        } as CSSProperties
      }
    >
      <aside className="activity-bar">
        <button
          className={`activity-button ${activeActivity === "explorer" ? "active" : ""}`}
          title="Explorer"
          onClick={() => setActiveActivity("explorer")}
        >
          <FolderOpen size={20} />
        </button>
        <button
          className={`activity-button ${activeActivity === "lessons" ? "active" : ""}`}
          title="Lessons"
          onClick={() => setActiveActivity("lessons")}
        >
          <GraduationCap size={20} />
        </button>
        <button
          className={`activity-button ${activeActivity === "preview" ? "active" : ""}`}
          title="Preview"
          onClick={() => setActiveActivity("preview")}
        >
          <Eye size={20} />
        </button>
        <button
          className={`activity-button ${activeActivity === "tutor" ? "active" : ""}`}
          title="Tutor"
          onClick={() => setActiveActivity("tutor")}
        >
          <Bot size={20} />
        </button>
        <button
          className={`activity-button ${activeActivity === "run" ? "active" : ""}`}
          title="Run"
          onClick={() => setActiveActivity("run")}
        >
          <CirclePlay size={20} />
        </button>
      </aside>

      <aside className="sidebar">
        <div className="workspace-title">
          <div>
            <span>Learning Workspace</span>
            <strong>{lesson?.title || "Loading"}</strong>
          </div>
          <Code2 size={18} />
        </div>

        <section className="panel-block roadmap-panel">
          <div className="panel-heading">Create Roadmap</div>
          <RoadmapInterviewPanel
            model={selectedModel}
            online={ollamaOnline}
            onCreate={createRoadmapFromInterview}
          />
        </section>
        <div className="resize-handle horizontal sidebar-section-resize" onMouseDown={startResize("roadmapSection")} />

        {roadmaps.length ? (
          <section className="panel-block">
            <div className="panel-heading">Roadmaps</div>
            <div className="roadmap-list">
              {roadmaps.map((item) => (
                <div
                  className={`roadmap-row ${item.id === activeRoadmap?.id ? "selected" : ""}`}
                  key={item.id}
                >
                  <button className="roadmap-open" onClick={() => openRoadmap(item)}>
                    <Layers3 size={15} />
                    <div>
                      <strong>{item.topic}</strong>
                      <small>
                        {item.courseTrack?.label ? `${item.courseTrack.label} · ` : ""}
                        {item.createdLessonIds.length}/{item.modules.length} parts ready
                      </small>
                      {item.timePlan?.depthLabel ? <small>{item.timePlan.depthLabel}</small> : null}
                    </div>
                  </button>
                  <button
                    className="roadmap-delete"
                    title="Remove roadmap and generated files"
                    onClick={(event) => {
                      event.stopPropagation();
                      removeRoadmap(item).catch(console.error);
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="panel-block sidebar-section tutorial-panel">
          <div className="sidebar-section-header">Tutorial Parts</div>
          {visibleLessons.length ? (
            <div className="lesson-list">
              {visibleLessons.map((item) => (
                <button
                  className={`lesson-row ${lesson?.id === item.id ? "selected" : ""}`}
                  key={item.id}
                  onClick={() => openLesson(item.id)}
                >
                  <span>
                    {progress[item.id]?.completed ? (
                      <CheckCircle2 size={15} />
                    ) : item.roadmapIndex !== undefined ? (
                      item.roadmapIndex + 1
                    ) : (
                      item.order
                    )}
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {activeRoadmap?.courseTrack?.label || (item.roadmapId ? "custom roadmap" : item.language)}
                      {activeRoadmap?.modules[item.roadmapIndex || 0]?.estimatedMinutes
                        ? ` · ${activeRoadmap.modules[item.roadmapIndex || 0].estimatedMinutes} min`
                        : ""}
                    </small>
                    <em className={`lesson-status-chip status-${lessonStatus(progress, item)}`}>
                      {statusLabel(lessonStatus(progress, item))}
                    </em>
                  </div>
                </button>
              ))}
            </div>
          ) : (
            <div className="sidebar-empty-state">
              <strong>No tutorial parts yet</strong>
              <span>Create a roadmap to generate the first lesson part.</span>
            </div>
          )}
        </section>
        <div className="resize-handle horizontal sidebar-section-resize" onMouseDown={startResize("tutorialSection")} />

        <section className="panel-block sidebar-section explorer">
          <div className="sidebar-section-header">Files</div>
          {files.length ? (
            <FileTree nodes={files} activePath={activePath} onOpen={openFile} />
          ) : (
            <div className="sidebar-empty-state">
              <strong>No files yet</strong>
              <span>Open or create a lesson to populate this workspace.</span>
            </div>
          )}
        </section>
      </aside>
      <div className="resize-handle vertical left-resize" onMouseDown={startResize("sidebar")} />

      <main className={`workbench ${activeActivity === "preview" ? "preview-mode" : ""}`}>
        <div className="top-strip">
          <div className="lesson-brief">
            <strong>{lesson?.goal}</strong>
            <span>{lesson?.description}</span>
          </div>
          <div className="top-actions">
            <button className="icon-button" title="Save" onClick={saveActive}>
              <Save size={17} />
            </button>
            <button className="run-button guide-top-button" onClick={() => setIsGuideOpen(true)}>
              <BookOpen size={16} />
              Guide
            </button>
            <button className="run-button secondary" disabled={isBusy} onClick={runLesson}>
              <CirclePlay size={16} />
              {runState === "running" ? "Running" : "Run"}
            </button>
            <button className="run-button" disabled={isBusy} onClick={runCheckpoint}>
              <CheckCircle2 size={16} />
              {runState === "checking" ? "Checking" : "Check"}
            </button>
          </div>
        </div>

        <div className={`editor-grid ${activeActivity === "preview" ? "preview-grid" : ""}`}>
          {activeActivity === "preview" ? (
            <PreviewPanel
              workspacePath={workspacePath}
              lesson={lesson}
              activeTab={activeTab}
              previewVersion={previewVersion}
              fullSize
            />
          ) : (
            <section className="editor-pane">
              <div className="tabs">
                {tabs.length ? (
                  tabs.map((tab) => (
                    <button
                      key={tab.path}
                      className={`tab ${tab.path === activePath ? "active" : ""}`}
                      onClick={() => setActivePath(tab.path)}
                    >
                      <span>{extensionIcon(tab.path)}</span>
                      {tab.path}
                      {tab.content !== tab.savedContent ? <b /> : null}
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
                  onMount={(editor, monacoInstance) => {
                    configureEditor(editor, monacoInstance);
                    editor.onDidChangeCursorSelection(() => {
                      const selection = editor.getSelection();
                      const model = editor.getModel();
                      setSelectedCode(selection && model ? model.getValueInRange(selection).trim() : "");
                    });
                  }}
                  options={{
                    minimap: { enabled: false },
                    fontSize: 14,
                    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo, monospace",
                    lineHeight: 22,
                    padding: { top: 18, bottom: 18 },
                    smoothScrolling: true,
                    cursorSmoothCaretAnimation: "on",
                    wordWrap: "on"
                  }}
                />
              ) : (
                <EmptyEditor />
              )}
            </section>
          )}

          {activeActivity !== "preview" ? (
            <>
              <div className="resize-handle vertical right-resize" onMouseDown={startResize("tutor")} />

              <TutorPanel
                lesson={lesson}
                activeTab={activeTab}
                selectedModel={selectedModel}
                setSelectedModel={setSelectedModel}
                models={models}
                online={ollamaOnline}
                terminalOutput={terminalOutput}
                selectedCode={selectedCode}
                progressEntry={currentProgress}
                lessonStatus={currentStatus}
                onTutorEvent={async (event) => setProgress(await api.progress.record(event))}
              />
            </>
          ) : null}
        </div>

        {activeActivity !== "preview" ? (
          <>
            <div className="resize-handle horizontal bottom-resize" onMouseDown={startResize("bottom")} />

            <div className="bottom-grid">
              <TerminalPanel
                workspacePath={workspacePath}
                terminalOutput={terminalOutput}
                setTerminalOutput={setTerminalOutput}
                commandEvent={commandEvent}
              />
            </div>
          </>
        ) : null}
      </main>

      <GuideDrawer
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        lesson={lesson}
        checkpointOutput={checkpointOutput}
        advanceNotice={advanceNotice}
        activeRoadmap={activeRoadmap}
        progressEntry={currentProgress}
        lessonStatus={currentStatus}
        onSkip={() => advanceRoadmap(true)}
      />

      <footer className="status-bar">
        <span>{workspacePath || "No workspace"}</span>
        <span className={`status-pill status-${currentStatus}`}>{statusLabel(currentStatus)}</span>
        <span>{nextActionForStatus(currentStatus)}</span>
        <span>{activePath ? languageFromPath(activePath) : "no file"}</span>
        <span>{dirtyCount ? `${dirtyCount} unsaved` : "saved"}</span>
        <span className={ollamaOnline ? "ok" : "warn"}>
          {ollamaOnline ? `Ollama ${selectedModel || "online"}` : "Ollama offline"}
        </span>
      </footer>
    </div>
  );
}

const configureEditor: OnMount = (editor, monacoInstance) => {
  editor.addCommand(monacoInstance.KeyMod.CtrlCmd | monacoInstance.KeyCode.KeyS, () => undefined);
};

function EmptyEditor() {
  return (
    <div className="editor-empty">
      <div>
        <Code2 size={34} />
        <strong>No tutorial file is open</strong>
        <span>Create a roadmap on the left. The first generated lesson will open here.</span>
      </div>
    </div>
  );
}

function RoadmapInterviewPanel({
  model,
  online,
  onCreate
}: {
  model: string;
  online: boolean;
  onCreate: (transcript: InterviewTurn[]) => Promise<void>;
}) {
  const [prompt, setPrompt] = useState<InterviewPrompt | null>(null);
  const [transcript, setTranscript] = useState<InterviewTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const start = useCallback(async () => {
    setBusy(true);
    try {
      const nextPrompt = await api.roadmaps.interviewStart({ model: online ? model : undefined });
      setPrompt(nextPrompt);
    } finally {
      setBusy(false);
    }
  }, [model, online]);

  useEffect(() => {
    start().catch(console.error);
  }, [start]);

  const submit = async (value = draft) => {
    const cleanValue = value.trim();
    if (cleanValue.length <= 1 || busy || !prompt?.field || !prompt.question) return;
    const nextTranscript = [
      ...transcript,
      {
        field: prompt.nextField || prompt.field || "goal",
        question: prompt.question || "",
        answer: cleanValue,
        rawAnswer: cleanValue,
        normalizedAnswer: cleanValue.trim()
      }
    ];
    setTranscript(nextTranscript);
    setDraft("");
    setBusy(true);
    try {
      const nextPrompt = await api.roadmaps.interviewReply({
        model: online ? model : undefined,
        transcript: nextTranscript
      });
      setPrompt(nextPrompt);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setTranscript([]);
    setDraft("");
    start().catch(console.error);
  };

  const create = async () => {
    if (!transcript.length || busy) return;
    setBusy(true);
    try {
      await onCreate(transcript);
      setTranscript([]);
      setDraft("");
      await start();
    } finally {
      setBusy(false);
    }
  };

  const stepCount = prompt?.fieldOrder?.length || 7;
  const activeStep = prompt?.complete
    ? stepCount
    : Math.min(stepCount, (prompt?.completedFields?.length || 0) + 1);
  const statusText = prompt?.complete ? "Ready" : busy ? "Thinking" : online && model ? "Adaptive" : "Fallback";

  return (
    <div className="roadmap-builder">
      <div className="agent-card">
        <div className="agent-header">
          <div className="agent-identity">
            <span className="agent-avatar">
              <Bot size={15} />
            </span>
            <div>
              <strong>Roadmap mentor</strong>
              <small>{online ? "Local Ollama learning plan" : "Offline learning plan"}</small>
            </div>
          </div>
          <div className={`agent-status ${online ? "online" : "offline"}`}>
            <span>{statusText}</span>
          </div>
        </div>

        <div className="agent-model-line">
          <span>{online && model ? model : "Ollama offline"}</span>
          {prompt?.w3schoolsTrack ? (
            <small>
              W3Schools: {prompt.w3schoolsTrack.label}
              {" · "}
              <a href={prompt.w3schoolsTrack.sourceUrl} onClick={(event) => event.preventDefault()}>
                source matched
              </a>
            </small>
          ) : prompt?.inferredIntent?.length ? <small>{prompt.inferredIntent.join(" / ")}</small> : null}
        </div>
      </div>

      <div className="interview-thread">
        {transcript.length ? (
          <div className="agent-history">
            {transcript.map((item, index) => (
              <div className="interview-pair" key={`${item.field}-${item.answer}`}>
                <span>{index + 1}</span>
                <div>
                  <small>{item.question}</small>
                  <strong>{item.answer}</strong>
                  {prompt?.fieldConfidence?.[item.field] ? (
                    <em>{Math.round((prompt.fieldConfidence[item.field] || 0) * 100)}% confidence</em>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className={`agent-question ${prompt?.complete ? "complete" : ""}`}>
          <div className="agent-question-label">
            <span>{prompt?.complete ? "Roadmap brief" : `Question ${transcript.length + 1}`}</span>
            {busy ? <small>Generating...</small> : null}
          </div>
          <div>
            <strong>
              {prompt?.complete
                ? "Ready to create your roadmap."
                : busy
                  ? "Thinking..."
                  : prompt?.question || "Preparing question..."}
            </strong>
            <span>
              {prompt?.complete
                ? prompt.summary?.goal || prompt.summary?.topic || "I have enough to build the first tutorial."
                : prompt?.helper || "One short answer is enough."}
            </span>
            {prompt?.diagnostic?.recommended ? <em>{prompt.diagnostic.reason}</em> : null}
          </div>
        </div>
      </div>

      {!prompt?.complete ? (
        <div className="suggestion-row">
          {(prompt?.suggestions || []).map((suggestion) => (
          <button key={suggestion} disabled={busy} onClick={() => submit(suggestion)}>
            {suggestion}
          </button>
        ))}
        </div>
      ) : null}

      {!prompt?.complete ? (
        <div className="agent-composer">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="Answer in one sentence"
          />
        </div>
      ) : null}

      <div className="builder-actions">
        <button
          disabled={busy || (!prompt?.complete && draft.trim().length <= 1)}
          onClick={() => (prompt?.complete ? create() : submit())}
        >
          {busy ? "Working..." : prompt?.complete ? "Create roadmap" : "Send"}
        </button>
        <button disabled={busy} onClick={reset}>
          Start over
        </button>
      </div>

      <div className="agent-progress" aria-label="Interview progress">
        {Array.from({ length: stepCount }).map((_, index) => (
          <span
            className={index < activeStep ? "active" : ""}
            key={index}
          />
        ))}
      </div>
    </div>
  );
}

function FileTree({
  nodes,
  activePath,
  onOpen
}: {
  nodes: FileNode[];
  activePath: string;
  onOpen: (path: string) => void;
}) {
  const [openDirs, setOpenDirs] = useState<Record<string, boolean>>({});
  return (
    <div className="file-tree">
      {nodes.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          activePath={activePath}
          openDirs={openDirs}
          setOpenDirs={setOpenDirs}
          onOpen={onOpen}
        />
      ))}
    </div>
  );
}

function FileTreeNode({
  node,
  activePath,
  openDirs,
  setOpenDirs,
  onOpen
}: {
  node: FileNode;
  activePath: string;
  openDirs: Record<string, boolean>;
  setOpenDirs: (value: Record<string, boolean>) => void;
  onOpen: (path: string) => void;
}) {
  if (node.type === "directory") {
    const isOpen = openDirs[node.path] ?? true;
    return (
      <div>
        <button
          className="file-row directory"
          onClick={() => setOpenDirs({ ...openDirs, [node.path]: !isOpen })}
        >
          {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          {node.name}
        </button>
        {isOpen ? (
          <div className="file-children">
            {node.children?.map((child) => (
              <FileTreeNode
                key={child.path}
                node={child}
                activePath={activePath}
                openDirs={openDirs}
                setOpenDirs={setOpenDirs}
                onOpen={onOpen}
              />
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <button
      className={`file-row ${activePath === node.path ? "active" : ""}`}
      onClick={() => onOpen(node.path)}
    >
      <span>{extensionIcon(node.path)}</span>
      {node.name}
    </button>
  );
}

function TutorPanel({
  lesson,
  activeTab,
  selectedModel,
  setSelectedModel,
  models,
  online,
  terminalOutput,
  selectedCode,
  progressEntry,
  lessonStatus,
  onTutorEvent
}: {
  lesson: Lesson | null;
  activeTab: OpenTab | null;
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  models: string[];
  online: boolean;
  terminalOutput: string;
  selectedCode: string;
  progressEntry?: ProgressEntry;
  lessonStatus: LearningStatus;
  onTutorEvent: (event: ProgressEvent) => Promise<void>;
}) {
  const [messages, setMessages] = useState<TutorMessage[]>([
    {
      id: "hello",
      role: "assistant",
      content: "Pick a model, select code or run a checkpoint, and I can explain what is happening."
    }
  ]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const askTutor = async (task: string, extraQuestion = question) => {
    if (!online || !selectedModel || !lesson) return;
    setBusy(true);
    if (/hint/i.test(task)) {
      await onTutorEvent({
        verb: "hinted",
        lessonId: lesson.id,
        roadmapId: lesson.roadmapId,
        context: { task, status: lessonStatus }
      });
    }
    const code = selectedCode || activeTab?.content || "";
    const userMessage = `${task}${extraQuestion ? `: ${extraQuestion}` : ""}`;
    setMessages((current) => [...current, { id: uid(), role: "user", content: userMessage }]);
    try {
      const response = await api.ollama.chat({
        model: selectedModel,
        task,
        lessonTitle: lesson.title,
        lessonGoal: lesson.goal,
        filePath: activeTab?.path,
        code,
        terminal: task.includes("error") || task.includes("Review") ? compactTerminalOutput(terminalOutput) : "",
        question: extraQuestion
      });
      setMessages((current) => [...current, { id: uid(), role: "assistant", content: response }]);
      setQuestion("");
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: uid(),
          role: "system",
          content: error instanceof Error ? error.message : "The tutor request failed."
        }
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="tutor-pane">
      <div className="tutor-header">
        <div className="pane-title">
          <div>
            <span>Local Tutor</span>
            <strong>{online ? "Ollama connected" : "Waiting for Ollama"}</strong>
          </div>
          <PanelRight size={18} />
        </div>
        <select
          className="model-select"
          value={selectedModel}
          onChange={(event) => setSelectedModel(event.target.value)}
          disabled={!models.length}
        >
          {models.length ? (
            models.map((model) => <option key={model}>{model}</option>)
          ) : (
            <option>No local models found</option>
          )}
        </select>
        <div className="context-chips">
          <span>{activeTab?.path || "No file"}</span>
          <span>{selectedCode ? "Selection" : "Whole file"}</span>
          <span>{terminalOutput ? "Terminal context" : "No terminal output"}</span>
          <span className={`status-${lessonStatus}`}>{statusLabel(lessonStatus)}</span>
          {progressEntry?.lastError ? <span>Last error captured</span> : null}
          {lesson?.skillsPracticed?.length ? <span>{lesson.skillsPracticed.slice(0, 2).join(", ")}</span> : null}
        </div>
      </div>
      <div className="quick-actions tutor-actions">
        <button disabled={!online || busy} onClick={() => askTutor("Explain this code")}>
          <Sparkles size={15} />
          Explain
        </button>
        <button disabled={!online || busy} onClick={() => askTutor("Give a small hint")}>
          <Lightbulb size={15} />
          Hint
        </button>
        <button disabled={!online || busy} onClick={() => askTutor("Explain this error")}>
          <CircleAlert size={15} />
          Error
        </button>
        <button disabled={!online || busy} onClick={() => askTutor("Review this code")}>
          <Wand2 size={15} />
          Review
        </button>
      </div>
      <div className="messages tutor-messages">
        {messages.map((message) => (
          <div className={`message ${message.role}`} key={message.id}>
            {message.content}
          </div>
        ))}
        {busy ? <div className="message system">Thinking locally...</div> : null}
      </div>
      <div className="ask-row tutor-input">
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask about this lesson"
          onKeyDown={(event) => {
            if (event.key === "Enter") askTutor("Answer my coding question");
          }}
        />
        <button disabled={!question.trim() || busy || !online} onClick={() => askTutor("Answer my coding question")}>
          <Send size={16} />
        </button>
      </div>
    </aside>
  );
}

function TerminalPanel({
  workspacePath,
  terminalOutput,
  setTerminalOutput,
  commandEvent
}: {
  workspacePath: string;
  terminalOutput: string;
  setTerminalOutput: (value: string | ((current: string) => string)) => void;
  commandEvent: { id: string; text: string } | null;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef("");

  useEffect(() => {
    if (!hostRef.current) return;
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: "JetBrains Mono, ui-monospace, monospace",
      fontSize: 13,
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
    term.writeln(workspacePath ? "Starting lesson terminal..." : "Starting terminal in home folder...");

    api.terminal.start(workspacePath).then(({ id }) => {
      idRef.current = id;
      fit.fit();
      api.terminal.resize(id, term.cols, term.rows);
    });

    const dataDispose = api.terminal.onData((id, data) => {
      if (id !== idRef.current) return;
      term.write(data);
      setTerminalOutput((current) => `${current}${data}`.slice(-12000));
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
    terminalRef.current.write(commandEvent.text);
    fitRef.current?.fit();
  }, [commandEvent]);

  return (
    <section className="bottom-pane terminal-pane">
      <div className="pane-header">
        <span>
          <TerminalSquare size={16} />
          Terminal
        </span>
        <small>{terminalOutput ? "output captured" : "ready"}</small>
      </div>
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}

function PreviewPanel({
  workspacePath,
  lesson,
  activeTab,
  previewVersion,
  fullSize = false
}: {
  workspacePath: string;
  lesson: Lesson | null;
  activeTab: OpenTab | null;
  previewVersion: number;
  fullSize?: boolean;
}) {
  const [srcDoc, setSrcDoc] = useState("");
  const isWebLesson = lesson?.language.toLowerCase().includes("web");

  useEffect(() => {
    async function buildPreview() {
      if (!workspacePath || !isWebLesson) {
        setSrcDoc("");
        return;
      }
      const [html, css, js] = await Promise.all([
        api.files.read(workspacePath, "index.html").catch(() => ""),
        api.files.read(workspacePath, "style.css").catch(() => ""),
        api.files.read(workspacePath, "script.js").catch(() => "")
      ]);
      setSrcDoc(`${html}\n<style>${css}</style>\n<script>${js}<\/script>`);
    }
    buildPreview();
  }, [workspacePath, isWebLesson, activeTab?.savedContent, previewVersion]);

  const emptyMessage = !lesson
    ? "Create or open a web lesson to preview it."
    : !isWebLesson
      ? "Preview is available for web lessons."
      : "Save or run the lesson to refresh the preview.";

  return (
    <section className={fullSize ? "preview-workspace" : "bottom-pane preview-pane"}>
      <div className={fullSize ? "preview-toolbar" : "pane-header"}>
        <div>
          <span>
            <RefreshCw size={16} />
            Preview
          </span>
          {fullSize ? <strong>{lesson?.title || "No web lesson open"}</strong> : null}
        </div>
        <small>{isWebLesson ? "HTML/CSS/JS" : "web lessons only"}</small>
      </div>
      {srcDoc ? (
        <iframe title="Live preview" srcDoc={srcDoc} sandbox="allow-scripts" />
      ) : (
        <div className="preview-empty">
          <Eye size={34} />
          <strong>No preview available</strong>
          <span>{emptyMessage}</span>
        </div>
      )}
    </section>
  );
}

function GuideDrawer({
  isOpen,
  onClose,
  lesson,
  checkpointOutput,
  advanceNotice,
  activeRoadmap,
  progressEntry,
  lessonStatus,
  onSkip
}: {
  isOpen: boolean;
  onClose: () => void;
  lesson: Lesson | null;
  checkpointOutput: string;
  advanceNotice: string;
  activeRoadmap: Roadmap | null;
  progressEntry?: ProgressEntry;
  lessonStatus: LearningStatus;
  onSkip: () => void;
}) {
  const partNumber = lesson?.roadmapIndex !== undefined ? lesson.roadmapIndex + 1 : null;
  const totalParts = activeRoadmap?.modules.length || 0;
  const currentModule = lesson?.roadmapIndex !== undefined ? activeRoadmap?.modules[lesson.roadmapIndex] : undefined;
  if (!isOpen) return null;
  return (
    <div className="guide-drawer-backdrop" onMouseDown={onClose}>
      <aside className="guide-drawer" aria-label="Lesson guide" onMouseDown={(event) => event.stopPropagation()}>
        <div className="guide-drawer-header">
          <div>
            <span>
              <MessageSquareText size={16} />
              Guide
            </span>
            <strong>{lesson?.title || "No tutorial open"}</strong>
            <div className="guide-status-line">
              <b className={`status-pill status-${lessonStatus}`}>{statusLabel(lessonStatus)}</b>
              <small>{nextActionForStatus(lessonStatus)}</small>
            </div>
          </div>
          <div className="guide-drawer-meta">
            <small>{partNumber ? `part ${partNumber}/${totalParts}` : "checkpoint"}</small>
            <button className="drawer-close" title="Close guide" onClick={onClose}>
              <X size={17} />
            </button>
          </div>
        </div>
        <div className="guide-drawer-body">
          {lesson ? (
            <div className="guide-summary-card">
              <span>Current objective</span>
              <strong>{lesson.goal}</strong>
              <p>{lesson.description}</p>
              <div className="guide-metrics">
                <b>Runs {progressEntry?.runAttempts || 0}</b>
                <b>Checks {progressEntry?.checkAttempts || 0}</b>
                <b>Hints {progressEntry?.hintCount || 0}</b>
                <b>Mastery {progressEntry?.masteryScore || 0}%</b>
                {currentModule?.estimatedMinutes ? <b>{currentModule.estimatedMinutes} min</b> : null}
              </div>
              {activeRoadmap?.courseTrack ? (
                <div className="checkpoint-advice">
                  <strong>Course track</strong>
                  <span>
                    {activeRoadmap.courseTrack.label}
                    {currentModule?.w3schoolsTopic ? ` · ${currentModule.w3schoolsTopic.replace(/_/g, " ")}` : ""}
                  </span>
                </div>
              ) : null}
              {lesson.skillsPracticed?.length ? (
                <div className="guide-chip-row">
                  {lesson.skillsPracticed.map((skill) => <span key={skill}>{skill}</span>)}
                </div>
              ) : null}
            </div>
          ) : null}
          {lesson?.steps.length ? (
            <ol>
              {lesson.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          ) : (
            <div className="empty-pane">Create or open a tutorial to see the guide.</div>
          )}
          {lesson?.roadmapId ? (
            <div className="roadmap-controls">
              <button onClick={onSkip}>
                <FastForward size={15} />
                Skip test and open next
              </button>
            </div>
          ) : null}
          {advanceNotice ? <div className="advance-notice">{advanceNotice}</div> : null}
          {progressEntry?.lastError && !checkpointOutput ? (
            <div className="checkpoint-advice">
              <strong>Last checkpoint issue</strong>
              <span>{progressEntry.lastError}</span>
            </div>
          ) : null}
          {lessonStatus === "needs_review" && lesson?.remediation ? (
            <div className="checkpoint-advice">
              <strong>Review path</strong>
              <span>{lesson.remediation}</span>
            </div>
          ) : null}
          {checkpointOutput ? (
            <pre>{checkpointOutput}</pre>
          ) : (
            <div className="empty-pane">Use Check when your code is ready.</div>
          )}
        </div>
      </aside>
    </div>
  );
}
