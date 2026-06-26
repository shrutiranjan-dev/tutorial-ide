const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

const files = {
  app: read("src/App.tsx"),
  runtime: read("src/agentRuntime.ts"),
  main: read("electron/main.cjs"),
  preload: read("electron/preload.cjs"),
  toolCard: read("src/components/agent/ToolActivityCard.tsx"),
  diffCard: read("src/components/agent/DiffChangeCard.tsx"),
  permissions: read("src/components/agent/PermissionRequestCard.tsx"),
  docs: read("docs/OPENCODE_PARITY_MATRIX.md")
};

const checks = [
  ["parity matrix", files.docs, "GUI Parity Execution Matrix"],
  ["event stream text", files.main, "type: \"text\""],
  ["event stream permissions", files.main, "type: \"permissions\""],
  ["event stream questions", files.main, "question.asked"],
  ["event stream diff", files.main, "type: \"diff\""],
  ["runtime text event", files.runtime, "assistantText"],
  ["runtime permission replied", files.runtime, "permissionResponded"],
  ["runtime question event", files.runtime, "question.asked"],
  ["runtime patch splitting", files.runtime, "diffFilesFromPatchText"],
  ["runtime tool details", files.runtime, "Error:"],
  ["session compact control", files.app, "compactAgentSession"],
  ["session delete control", files.app, "deleteAgentSession"],
  ["provider credentials", files.app, "deleteProviderCredential"],
  ["mcp server create", files.app, "mcpServerCreate"],
  ["mcp oauth", files.app, "mcpServerOauthStart"],
  ["engine pty controls", files.app, "createEnginePty"],
  ["diagnostics refresh", files.app, "refreshDiagnostics"],
  ["workspace context skills", files.app, "Registered skills"],
  ["workspace context diagnostics", files.app, "Engine diagnostics"],
  ["tool card duration", files.toolCard, "Duration"],
  ["tool card error", files.toolCard, "agent-tool-activity-card__meta--error"],
  ["diff change card", files.diffCard, "DiffChangeCard"],
  ["permission card metadata", files.permissions, "agent-permission-request-card__kind"],
  ["preload pty", files.preload, "opencode:ptyCreate"],
  ["preload diagnostics", files.preload, "opencode:formatterStatus"]
];

const failures = checks.filter(([, source, needle]) => !source.includes(needle));

console.log(`OpenCode GUI parity checks: ${checks.length}`);
if (failures.length) {
  console.error("\nMissing expected GUI parity markers:");
  for (const [name, , needle] of failures) {
    console.error(`  - ${name}: ${needle}`);
  }
  process.exit(1);
}

console.log("OpenCode GUI parity markers are present.");
