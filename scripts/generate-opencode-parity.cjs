const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const upstreamApiPath = path.join(root, "vendor", "code", "specs", "v2", "api.html");
const mainPath = path.join(root, "electron", "main.cjs");
const clientPath = path.join(root, "electron", "opencode-client.cjs");
const preloadPath = path.join(root, "electron", "preload.cjs");
const typesPath = path.join(root, "src", "types.ts");
const outPath = path.join(root, "docs", "OPENCODE_PARITY_MATRIX.md");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function parseUpstreamApi(html) {
  const rows = [];
  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((match) => decodeHtml(match[1]));
    if (cells.length < 5) continue;
    const [operation, input, context, route, purpose] = cells;
    if (!operation || !route.includes("/api/")) continue;
    const [method, ...routeParts] = route.split(/\s+/);
    rows.push({
      operation,
      input,
      context,
      method,
      route: routeParts.join(" "),
      purpose
    });
  }
  return rows;
}

function normalizeRoute(route) {
  return String(route || "")
    .replace(/\\`/g, "`")
    .replace(/\$\{[^}]+\}/g, ":id")
    .replace(/\?.*$/, "")
    .replace(/\/:[A-Za-z0-9_]+/g, "/:id")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .trim();
}

function routeFamily(route) {
  const parts = normalizeRoute(route).split("/").filter(Boolean);
  return parts[0] === "api" ? parts[1] || "" : parts[0] || "";
}

function extractRoutes(source) {
  const routes = new Set();
  const routePattern = /[`'"]((?:\/api|\/session|\/permission|\/provider|\/auth|\/config|\/global|\/mcp|\/vcs|\/sync|\/command|\/model|\/pty|\/project|\/workspace|\/fs|\/formatter|\/lsp)[^`'"]*)[`'"]/g;
  for (const match of source.matchAll(routePattern)) {
    const route = normalizeRoute(match[1]);
    if (route) routes.add(route);
  }
  return routes;
}

function extractChannels(source, pattern) {
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter((channel) => channel.startsWith("opencode:"))
    .sort();
}

function extractTypeMethods(source) {
  const body = source.match(/opencode:\s*\{([\s\S]*?)\n\s*\};/)?.[1] || "";
  return [...body.matchAll(/^\s*([A-Za-z0-9_]+):\s*\(/gm)].map((match) => match[1]).sort();
}

function familyBridgeNames(family, operation) {
  const op = operation.toLowerCase();
  const map = {
    agent: ["agents"],
    auth: ["providerAuthorize", "providerCallback", "providerApiKey", "credentials", "credentialUpdate", "credentialDelete", "authList", "authGet", "authCreate", "authUpdate", "authDelete", "authActivate"],
    catalog: ["modelDetail", "models", "catalogModels", "catalogModel"],
    command: ["commands", "commandList", "commandRun", "command"],
    config: ["readConfig", "writeConfig", "engineConfig", "engineConfigUpdate"],
    event: ["eventsStart", "eventStreamStart"],
    formatter: ["formatterStatus"],
    fs: ["fsTree", "fsFile", "fsSearch", "fsGrep"],
    lsp: ["lspStatus"],
    mcp: ["readMCPConfig", "writeMCPConfig", "mcpConnect", "mcpDisconnect", "mcpIntegrations", "mcpPromptList", "mcpPromptRender", "mcpResourceList", "mcpResourceRead", "mcpServerList", "mcpServerCreate", "mcpServerOauthStart", "mcpServerOauthCallback", "mcpServerOauthDelete"],
    permission: ["permissions", "permissionList", "permissionReply", "savedPermissions", "deleteSavedPermission"],
    project: ["copyProject", "listProjects", "projectList", "projectGet", "projectUpdate"],
    provider: ["providerState", "providerDetail", "providers", "integrations"],
    pty: ["ptyCreate", "ptyList", "ptyGet", "ptyUpdate", "ptyDelete"],
    question: ["questionRequests", "sessionQuestions", "questionReply", "questionReject"],
    session: [
      "sessions",
      "sessionList",
      "session",
      "getSession",
      "startSession",
      "sessionCreate",
      "messages",
      "sessionMessages",
      "sessionPrompt",
      "sessionContext",
      "sessionCompact",
      "sessionSwitchModel",
      "sessionSwitchAgent",
      "sessionWait",
      "revert",
      "unrevert",
      "abort",
      "todo"
    ],
    skill: ["skills"],
    vcs: ["vcsGet", "vcsStatus", "vcsDiff", "vcsStage", "vcsUnstage", "vcsPatch", "vcsApply"],
    workspace: ["listProjects", "copyProject", "projectList", "projectGet", "projectUpdate", "workspaceList", "workspaceGet", "workspaceCreate", "workspaceUpdate", "workspaceDelete", "workspaceStatus", "workspaceSync", "workspaceWarp"]
  };
  const names = map[family] || [];
  if (op.includes("model")) return [...new Set([...names, "models", "modelDetail", "sessionSwitchModel"])];
  if (op.includes("agent")) return [...new Set([...names, "agents", "sessionSwitchAgent"])];
  return names;
}

function operationToStatus(row, currentRoutes, preloadMethods) {
  const route = normalizeRoute(row.route);
  const family = routeFamily(route);
  const routeDone = currentRoutes.has(route);
  const familyRoutes = [...currentRoutes].filter((item) => routeFamily(item) === family);
  const bridgeNames = familyBridgeNames(family, row.operation);
  const bridgeHits = bridgeNames.filter((name) => preloadMethods.has(name));

  if (routeDone) {
    return {
      status: "done",
      reason: "Exact route is present in Electron engine bridge.",
      bridgeHits
    };
  }
  if (bridgeHits.length && familyRoutes.length) {
    return {
      status: "partial",
      reason: `Family bridge exists, but exact route ${row.method} ${row.route} is not directly mapped.`,
      bridgeHits
    };
  }
  if (bridgeHits.length) {
    return {
      status: "partial",
      reason: "Related GUI bridge exists, but the upstream route was not found in main process calls.",
      bridgeHits
    };
  }
  return {
    status: "missing",
    reason: "No matching route or related preload bridge was found.",
    bridgeHits: []
  };
}

function markdownTable(rows) {
  const lines = [
    "| Status | Operation | HTTP | GUI bridge | Notes |",
    "|---|---|---|---|---|"
  ];
  for (const row of rows) {
    const bridge = row.bridgeHits.length ? row.bridgeHits.map((hit) => `\`${hit}\``).join(", ") : "-";
    lines.push(`| ${row.status} | \`${row.operation}\` | \`${row.method} ${row.route}\` | ${bridge} | ${row.reason.replace(/\|/g, "\\|")} |`);
  }
  return lines.join("\n");
}

function guiParitySection() {
  const rows = [
    ["Event normalization", "Done", "text, tools, permissions, questions, todo, diff, status, and session events normalize into renderer actions."],
    ["Session lifecycle", "Done", "start, resume, fork, wait/refresh, compact, unrevert, delete, retry, continue, and abort are surfaced."],
    ["Permission system", "Done", "permission metadata, tool/action, command/path/resource targets, and replies render safely."],
    ["Diff/edit workflow", "Done", "session and VCS patches split into file cards with open, apply, revert, and fork actions."],
    ["Provider/auth", "Done", "provider status, OAuth/API-key flows, credential visibility, and credential removal are exposed."],
    ["MCP", "Done", "server configure/connect/disconnect/create/OAuth controls plus prompts/resources are exposed."],
    ["Tool timeline", "Done", "tool cards preserve status, duration, command/path, output, and error metadata."],
    ["Terminal/shell", "Done", "local terminal remains primary and OpenCode PTY lifecycle controls are visible."],
    ["Diagnostics", "Done", "formatter and LSP status feed the Problems/Output surfaces."],
    ["Workspace context", "Done", "prompts include current file, selection, open tabs, git, terminal tail, session summary, skills, references, and diagnostics."],
    ["Automated GUI guard", "Done", "`npm run check:gui-parity` checks critical renderer parity markers."]
  ];
  return [
    "## GUI Parity Execution Matrix",
    "",
    "This section tracks product-behavior parity that is not visible from HTTP route coverage alone.",
    "",
    "| Surface | Status | Evidence |",
    "|---|---|---|",
    ...rows.map(([surface, status, evidence]) => `| ${surface} | ${status} | ${evidence.replace(/\|/g, "\\|")} |`),
    ""
  ].join("\n");
}

function main() {
  const html = read(upstreamApiPath);
  const mainSource = read(mainPath);
  const clientSource = read(clientPath);
  const preloadSource = read(preloadPath);
  const typesSource = read(typesPath);
  const upstream = parseUpstreamApi(html);
  const currentRoutes = extractRoutes(`${mainSource}\n${clientSource}`);
  const handlers = extractChannels(mainSource, /ipcMain\.handle\("([^"]+)"/g);
  const invokes = extractChannels(preloadSource, /ipcRenderer\.invoke\("([^"]+)"/g);
  const preloadMethods = new Set(extractTypeMethods(typesSource));
  const rows = upstream.map((row) => ({ ...row, ...operationToStatus(row, currentRoutes, preloadMethods) }));
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] || 0) + 1;
    return acc;
  }, {});
  const generatedAt = new Date().toISOString();
  const markdown = [
    "# OpenCode API Parity Matrix",
    "",
    `Generated: ${generatedAt}`,
    "",
    "This file is generated by `npm run check:parity`. It compares the vendored OpenCode v2 API table in `vendor/code/specs/v2/api.html` with the Electron bridge surface in `electron/main.cjs`, `electron/opencode-client.cjs`, `electron/preload.cjs`, and `src/types.ts`.",
    "",
    "## Summary",
    "",
    `- Upstream operations: ${rows.length}`,
    `- Done: ${counts.done || 0}`,
    `- Partial: ${counts.partial || 0}`,
    `- Missing: ${counts.missing || 0}`,
    `- OpenCode IPC handlers: ${handlers.length}`,
    `- OpenCode preload invokes: ${invokes.length}`,
    `- Detected engine route calls: ${currentRoutes.size}`,
    "",
    "## Matrix",
    "",
    markdownTable(rows),
    "",
    guiParitySection(),
    ""
  ].join("\n");

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, markdown);
  console.log(`Wrote ${path.relative(root, outPath)} (${rows.length} operations).`);
  console.log(`done=${counts.done || 0} partial=${counts.partial || 0} missing=${counts.missing || 0}`);
}

main();
