import type {
  CommandResult,
  AgentCommandInfo,
  AgentDiffFile,
  AgentDiffPayload,
  AgentEventStream,
  AgentEventStreamPayload,
  AgentPermissionRequest,
  AgentPermissionReplyPayload,
  AgentProjectPayload,
  AgentPromptPayload,
  AgentProviderApiKeyPayload,
  AgentProviderAuthMap,
  AgentProviderAuthorization,
  AgentProviderAuthorizePayload,
  AgentProviderCallbackPayload,
  AgentProviderState,
  AgentRuntimeEvent,
  AgentSessionCommandPayload,
  AgentSessionDetail,
  AgentSessionForkPayload,
  AgentSessionPayload,
  AgentSessionStartPayload,
  AgentSessionStartResult,
  AgentSessionSummary,
  AgentSessionUpdatePayload,
  AgentShellPayload,
  AgentTodoItem,
  AgentTodoPayload,
  AgentRevertPayload,
  FileNode,
  ProgressEvent,
  ProgressMap,
  TutorialIdeBridge
} from "./types";

type ChatPayload = {
  model: string;
  task: string;
  filePath?: string;
  code?: string;
  terminal?: string;
  question?: string;
};

declare global {
  interface Window {
    tutorialIde?: TutorialIdeBridge;
  }
}

export {};
