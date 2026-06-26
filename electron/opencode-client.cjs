const path = require("path");

class CodeEngineError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "CodeEngineError";
    this.status = details.status;
    this.route = details.route;
    this.body = details.body;
  }
}

function unwrapData(value) {
  if (value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, "data")) {
    return value.data;
  }
  return value;
}

function asArray(value) {
  const data = unwrapData(value);
  return Array.isArray(data) ? data : [];
}

function createCodeEngineClient({ ensureServer, rootDir }) {
  if (typeof ensureServer !== "function") {
    throw new TypeError("createCodeEngineClient requires an ensureServer function.");
  }
  const resolveDirectory = (projectPath) => path.resolve(projectPath || rootDir);

  const client = {
    directoryQuery(projectPath) {
      return `directory=${encodeURIComponent(resolveDirectory(projectPath))}`;
    },

    query(projectPath, params = {}) {
      const query = new URLSearchParams();
      query.set("directory", resolveDirectory(projectPath));
      for (const [key, value] of Object.entries(params || {})) {
        if (value === undefined || value === null || value === "") continue;
        query.set(key, String(value));
      }
      return query.toString();
    },

    json(method, body) {
      return {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
      };
    },

    unwrapData,
    asArray,

    async request(route, options = {}) {
      const server = await ensureServer();
      const response = await fetch(`${server.url}${route}`, options);
      const text = await response.text();
      if (!response.ok) {
        const body = text.slice(0, 3000);
        throw new CodeEngineError(`Code server returned ${response.status} for ${route}.\n${body}`, {
          status: response.status,
          route,
          body
        });
      }
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        return text;
      }
    },

    async first(candidates) {
      let lastError;
      for (const candidate of candidates || []) {
        try {
          return await client.request(candidate.route, candidate.options || {});
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError || new CodeEngineError("No Code engine endpoint candidates were provided.");
    },

    session: {
      async context(sessionID, projectPath) {
        if (!sessionID) return { ok: false, error: "Missing sessionID", context: null };
        const id = encodeURIComponent(sessionID);
        try {
          const data = await client.first([
            { route: `/api/session/${id}/context?${client.query(projectPath)}` },
            { route: `/session/${id}/context?${client.query(projectPath)}` }
          ]);
          return { ok: true, context: unwrapData(data) || data || null };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error), context: null };
        }
      },

      async diff(sessionID, projectPath, payload = {}) {
        if (!sessionID) return { ok: false, error: "Missing sessionID", diff: [] };
        const id = encodeURIComponent(sessionID);
        const data = await client.first([
          { route: `/api/session/${id}/diff?${client.query(projectPath, { messageID: payload.messageID })}` },
          { route: `/session/${id}/diff?${client.query(projectPath, { messageID: payload.messageID })}` }
        ]);
        const diff = unwrapData(data);
        return { ok: true, source: "engine", diff: Array.isArray(diff) ? diff : asArray(diff), raw: diff || data };
      },

      async todo(sessionID, projectPath) {
        if (!sessionID) return { ok: false, error: "Missing sessionID", todos: [] };
        const id = encodeURIComponent(sessionID);
        const data = await client.first([
          { route: `/api/session/${id}/todo?${client.query(projectPath)}` },
          { route: `/session/${id}/todo?${client.query(projectPath)}` }
        ]);
        const todos = asArray(data);
        return { ok: true, source: "engine", todos, raw: unwrapData(data) || data };
      },

      async wait(sessionID, projectPath, payload = {}) {
        if (!sessionID) return { ok: false, error: "Missing sessionID" };
        const id = encodeURIComponent(sessionID);
        const data = await client.first([
          {
            route: `/api/session/${id}/wait?${client.query(projectPath)}`,
            options: client.json("POST", {
              timeout: payload.timeout,
              timeoutMS: payload.timeoutMS,
              after: payload.after
            })
          },
          {
            route: `/session/${id}/wait?${client.query(projectPath)}`,
            options: client.json("POST", {
              timeout: payload.timeout,
              timeoutMS: payload.timeoutMS,
              after: payload.after
            })
          }
        ]);
        return { ok: true, source: "engine", result: unwrapData(data) || data };
      }
    },

    config: {
      async project(projectPath) {
        try {
          const data = await client.first([
            { route: `/api/config?${client.query(projectPath)}` },
            { route: `/config?${client.query(projectPath)}` }
          ]);
          return { ok: true, source: "engine", config: unwrapData(data) || data || {} };
        } catch (error) {
          return { ok: false, source: "engine", error: error instanceof Error ? error.message : String(error) };
        }
      },

      async updateProject(projectPath, config) {
        try {
          const data = await client.first([
            { route: `/api/config?${client.query(projectPath)}`, options: client.json("PATCH", config || {}) },
            { route: `/config?${client.query(projectPath)}`, options: client.json("PATCH", config || {}) }
          ]);
          return { ok: true, source: "engine", config: unwrapData(data) || data || config || {} };
        } catch (error) {
          return { ok: false, source: "engine", error: error instanceof Error ? error.message : String(error) };
        }
      },

      async global(projectPath) {
        try {
          const data = await client.first([
            { route: "/global/config" },
            { route: "/api/global/config" }
          ]);
          return { ok: true, config: unwrapData(data) || data || {} };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      },

      async writeGlobal(projectPath, config) {
        try {
          const data = await client.first([
            { route: "/global/config", options: client.json("PATCH", config || {}) },
            { route: "/api/global/config", options: client.json("PATCH", config || {}) }
          ]);
          return { ok: true, config: unwrapData(data) || data || config || {} };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    },

    auth: {
      async list(projectPath) {
        const data = await client.first([
          { route: `/api/auth?${client.query(projectPath)}` },
          { route: `/auth?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", accounts: asArray(data), raw: unwrapData(data) || data };
      },

      async get(projectPath, accountID) {
        if (!accountID) return { ok: false, source: "engine", error: "Missing auth account id." };
        const id = encodeURIComponent(accountID);
        const data = await client.first([
          { route: `/api/auth/${id}?${client.query(projectPath)}` },
          { route: `/auth/${id}?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", account: unwrapData(data) || data };
      },

      async create(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/auth?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/auth?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: true, source: "engine", account: unwrapData(data) || data };
      },

      async update(projectPath, accountID, payload = {}) {
        if (!accountID) return { ok: false, source: "engine", error: "Missing auth account id." };
        const id = encodeURIComponent(accountID);
        const data = await client.first([
          { route: `/api/auth/${id}?${client.query(projectPath)}`, options: client.json("PATCH", payload) },
          { route: `/auth/${id}?${client.query(projectPath)}`, options: client.json("PATCH", payload) }
        ]);
        return { ok: true, source: "engine", account: unwrapData(data) || data };
      },

      async delete(projectPath, accountID) {
        if (!accountID) return { ok: false, source: "engine", error: "Missing auth account id." };
        const id = encodeURIComponent(accountID);
        const data = await client.first([
          { route: `/api/auth/${id}?${client.query(projectPath)}`, options: { method: "DELETE" } },
          { route: `/auth/${id}?${client.query(projectPath)}`, options: { method: "DELETE" } }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      },

      async activate(projectPath, accountID) {
        if (!accountID) return { ok: false, source: "engine", error: "Missing auth account id." };
        const id = encodeURIComponent(accountID);
        const data = await client.first([
          { route: `/api/auth/${id}/activate?${client.query(projectPath)}`, options: client.json("POST", {}) },
          { route: `/auth/${id}/activate?${client.query(projectPath)}`, options: client.json("POST", {}) }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      }
    },

    catalog: {
      async models(projectPath) {
        const data = await client.first([
          { route: `/api/catalog/model?${client.query(projectPath)}` },
          { route: `/api/model?${client.query(projectPath)}` },
          { route: `/model?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", models: asArray(data), raw: unwrapData(data) || data };
      },

      async model(projectPath, providerID, modelID) {
        if (!providerID || !modelID) return { ok: false, source: "engine", error: "Missing providerID or modelID." };
        const provider = encodeURIComponent(providerID);
        const model = encodeURIComponent(modelID);
        const data = await client.first([
          { route: `/api/catalog/model/${provider}/${model}?${client.query(projectPath)}` },
          { route: `/api/model/${provider}/${model}?${client.query(projectPath)}` },
          { route: `/api/model/${encodeURIComponent(`${providerID}/${modelID}`)}?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", model: unwrapData(data) || data };
      }
    },

    events: {
      async subscribe(projectPath, options = {}) {
        const server = await ensureServer();
        const route = `/api/event?${client.query(projectPath)}`;
        return fetch(`${server.url}${route}`, {
          signal: options.signal,
          headers: { Accept: "text/event-stream" }
        });
      }
    },

    system: {
      async formatterStatus(projectPath) {
        try {
          const data = await client.first([
            { route: `/api/formatter?${client.query(projectPath)}` },
            { route: `/formatter?${client.query(projectPath)}` }
          ]);
          return { ok: true, source: "engine", formatter: unwrapData(data) || data || [] };
        } catch (error) {
          return { ok: false, source: "engine", error: error instanceof Error ? error.message : String(error), formatter: [] };
        }
      },

      async lspStatus(projectPath) {
        try {
          const data = await client.first([
            { route: `/api/lsp?${client.query(projectPath)}` },
            { route: `/lsp?${client.query(projectPath)}` }
          ]);
          return { ok: true, source: "engine", lsp: unwrapData(data) || data || [] };
        } catch (error) {
          return { ok: false, source: "engine", error: error instanceof Error ? error.message : String(error), lsp: [] };
        }
      }
    },

    fs: {
      async tree(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/fs/tree?${client.query(projectPath, { path: payload.path || "." })}` },
          { route: `/fs/tree?${client.query(projectPath, { path: payload.path || "." })}` }
        ]);
        return { ok: true, source: "engine", tree: unwrapData(data) || data };
      },

      async file(projectPath, payload = {}) {
        const filePath = payload.path || payload.file || "";
        if (!filePath) return { ok: false, source: "engine", error: "Missing file path.", content: "" };
        const data = await client.first([
          { route: `/api/fs/file?${client.query(projectPath, { path: filePath })}` },
          { route: `/fs/file?${client.query(projectPath, { path: filePath })}` }
        ]);
        const content = unwrapData(data);
        return {
          ok: true,
          source: "engine",
          path: filePath,
          content: typeof content === "string" ? content : (content?.content || content?.text || ""),
          result: content || data
        };
      },

      async search(projectPath, payload = {}) {
        const body = {
          query: payload.query || payload.pattern || "",
          type: payload.type,
          limit: payload.limit || 200
        };
        const data = await client.first([
          { route: `/api/fs/search?${client.query(projectPath)}`, options: client.json("POST", body) },
          { route: `/fs/search?${client.query(projectPath)}`, options: client.json("POST", body) }
        ]);
        const result = unwrapData(data);
        return { ok: true, source: "engine", results: Array.isArray(result) ? result : asArray(result), raw: result || data };
      },

      async grep(projectPath, payload = {}) {
        const body = {
          pattern: payload.pattern || payload.query || "",
          include: payload.include || undefined,
          limit: payload.limit || 500
        };
        const data = await client.first([
          { route: `/api/fs/grep?${client.query(projectPath)}`, options: client.json("POST", body) },
          { route: `/fs/grep?${client.query(projectPath)}`, options: client.json("POST", body) }
        ]);
        const result = unwrapData(data);
        return { ok: true, source: "engine", results: Array.isArray(result) ? result : asArray(result), raw: result || data };
      }
    },

    mcp: {
      async promptList(projectPath) {
        const data = await client.first([
          { route: `/api/mcp/prompt?${client.query(projectPath)}` },
          { route: `/mcp/prompt?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", prompts: asArray(data), raw: unwrapData(data) || data };
      },

      async promptRender(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/mcp/prompt/render?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/mcp/prompt/render?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: true, source: "engine", prompt: unwrapData(data) || data };
      },

      async resourceList(projectPath) {
        const data = await client.first([
          { route: `/api/mcp/resource?${client.query(projectPath)}` },
          { route: `/mcp/resource?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", resources: asArray(data), raw: unwrapData(data) || data };
      },

      async resourceRead(projectPath, payload = {}) {
        const params = {
          uri: payload.uri,
          url: payload.url,
          name: payload.name,
          server: payload.server
        };
        const data = await client.first([
          { route: `/api/mcp/resource/read?${client.query(projectPath, params)}` },
          { route: `/mcp/resource/read?${client.query(projectPath, params)}` }
        ]);
        return { ok: true, source: "engine", resource: unwrapData(data) || data };
      },

      async serverList(projectPath) {
        const data = await client.first([
          { route: `/api/mcp/server?${client.query(projectPath)}` },
          { route: `/mcp/server?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", servers: asArray(data), raw: unwrapData(data) || data };
      },

      async serverCreate(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/mcp/server?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/mcp/server?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: true, source: "engine", server: unwrapData(data) || data };
      },

      async serverOauthStart(projectPath, name, payload = {}) {
        if (!name) return { ok: false, source: "engine", error: "Missing MCP server name." };
        const encodedName = encodeURIComponent(name);
        const data = await client.first([
          { route: `/api/mcp/server/${encodedName}/oauth?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/mcp/server/${encodedName}/oauth?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: true, source: "engine", result: unwrapData(data) || data };
      },

      async serverOauthCallback(projectPath, name, payload = {}) {
        if (!name) return { ok: false, source: "engine", error: "Missing MCP server name." };
        const encodedName = encodeURIComponent(name);
        const data = await client.first([
          { route: `/api/mcp/server/${encodedName}/oauth/callback?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/mcp/server/${encodedName}/oauth/callback?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: true, source: "engine", result: unwrapData(data) || data };
      },

      async serverOauthDelete(projectPath, name) {
        if (!name) return { ok: false, source: "engine", error: "Missing MCP server name." };
        const encodedName = encodeURIComponent(name);
        const data = await client.first([
          { route: `/api/mcp/server/${encodedName}/oauth?${client.query(projectPath)}`, options: { method: "DELETE" } },
          { route: `/mcp/server/${encodedName}/oauth?${client.query(projectPath)}`, options: { method: "DELETE" } }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      },

      async connection(projectPath, name, connect = true) {
        if (!name) return { ok: false, error: "Missing MCP server name" };
        const encodedName = encodeURIComponent(name);
        const action = connect ? "connect" : "disconnect";
        try {
          const data = await client.first([
            {
              route: `/mcp/${encodedName}/${action}?${client.query(projectPath)}`,
              options: client.json("POST", {})
            },
            {
              route: `/api/mcp/${encodedName}/${action}?${client.query(projectPath)}`,
              options: client.json("POST", {})
            },
            {
              route: `/api/mcp/server/${encodedName}/${connect ? "oauth" : "oauth"}?${client.query(projectPath)}`,
              options: connect ? client.json("POST", {}) : { method: "DELETE" }
            }
          ]);
          return { ok: unwrapData(data) !== false, result: unwrapData(data) || data };
        } catch (error) {
          return { ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    },

    permission: {
      async list(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/permission?${client.query(projectPath, { sessionID: payload.sessionID })}` },
          { route: `/permission?${client.query(projectPath, { sessionID: payload.sessionID })}` },
          { route: `/api/permission/request?${client.query(projectPath, { sessionID: payload.sessionID })}` }
        ]);
        return { ok: true, source: "engine", permissions: asArray(data), raw: unwrapData(data) || data };
      },

      async reply(projectPath, permissionID, payload = {}) {
        if (!permissionID) return { ok: false, source: "engine", error: "Missing permission id." };
        const id = encodeURIComponent(permissionID);
        const data = await client.first([
          { route: `/api/permission/${id}/reply?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/permission/${id}/reply?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      }
    },

    question: {
      async list(projectPath) {
        const data = await client.first([
          { route: `/api/question?${client.query(projectPath)}` },
          { route: `/api/question/request?${client.query(projectPath)}` },
          { route: `/question?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", questions: asArray(data), raw: unwrapData(data) || data };
      },

      async reply(projectPath, questionID, payload = {}) {
        if (!questionID) return { ok: false, source: "engine", error: "Missing question id." };
        const id = encodeURIComponent(questionID);
        const data = await client.first([
          { route: `/api/question/${id}/reply?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/question/${id}/reply?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      },

      async reject(projectPath, questionID, payload = {}) {
        if (!questionID) return { ok: false, source: "engine", error: "Missing question id." };
        const id = encodeURIComponent(questionID);
        const data = await client.first([
          { route: `/api/question/${id}/reject?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/question/${id}/reject?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      }
    },

    vcs: {
      async get(projectPath) {
        const data = await client.first([
          { route: `/api/vcs?${client.query(projectPath)}` },
          { route: `/vcs?${client.query(projectPath)}` }
        ]);
        const status = unwrapData(data) || data;
        return { ok: true, source: "engine", status, changes: Array.isArray(status) ? status : status?.changes };
      },

      async status(projectPath) {
        const data = await client.first([
          { route: `/api/vcs/status?${client.query(projectPath)}` },
          { route: `/vcs/status?${client.query(projectPath)}` }
        ]);
        const status = asArray(data);
        return { ok: true, source: "engine", status, changes: status };
      },

      async diff(projectPath, payload = {}) {
        const params = {
          mode: payload.mode,
          context: payload.context,
          format: payload.format
        };
        const query = client.query(projectPath, params);
        const wantsRaw = Boolean(payload.raw || payload.format === "raw" || payload.format === "patch");
        const structuredCandidates = [
          { route: `/api/vcs/diff?${query}` },
          { route: `/vcs/diff?${query}` }
        ];
        const rawCandidates = [
          { route: `/api/vcs/diff/raw?${client.query(projectPath)}` },
          { route: `/vcs/diff/raw?${client.query(projectPath)}` }
        ];
        const data = await client.first(wantsRaw ? rawCandidates.concat(structuredCandidates) : structuredCandidates.concat(rawCandidates));
        const diff = unwrapData(data);
        return {
          ok: true,
          source: "engine",
          diff,
          files: Array.isArray(diff) ? diff : undefined,
          patch: typeof diff === "string" ? diff : undefined
        };
      },

      async stage(projectPath, payload = {}, staged = true) {
        const files = Array.isArray(payload.files)
          ? payload.files
          : Array.isArray(payload.paths)
            ? payload.paths
            : [payload.file || payload.path].filter(Boolean);
        const action = staged ? "stage" : "unstage";
        const data = await client.first([
          {
            route: `/api/vcs/${action}?${client.query(projectPath)}`,
            options: client.json("POST", { files, paths: files })
          },
          {
            route: `/vcs/${action}?${client.query(projectPath)}`,
            options: client.json("POST", { files, paths: files })
          }
        ]);
        return { ok: true, source: "engine", result: unwrapData(data) || data };
      },

      async applyPatch(projectPath, payload = {}) {
        const patch = String(payload.patch || payload.diff || "");
        if (!patch.trim()) return { ok: false, source: "engine", error: "No patch content provided." };
        const body = {
          patch,
          diff: patch,
          check: Boolean(payload.check),
          staged: Boolean(payload.staged)
        };
        const data = await client.first([
          {
            route: `/api/vcs/patch?${client.query(projectPath)}`,
            options: client.json("POST", body)
          },
          {
            route: `/api/vcs/apply?${client.query(projectPath)}`,
            options: client.json("POST", body)
          },
          {
            route: `/vcs/patch?${client.query(projectPath)}`,
            options: client.json("POST", body)
          },
          {
            route: `/vcs/apply?${client.query(projectPath)}`,
            options: client.json("POST", body)
          }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      }
    },

    project: {
      async list(projectPath) {
        const data = await client.first([
          { route: `/api/project?${client.query(projectPath)}` },
          { route: `/project?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", projects: asArray(data), raw: unwrapData(data) || data };
      },

      async get(projectPath, projectID) {
        if (!projectID) return { ok: false, source: "engine", error: "Missing project id." };
        const id = encodeURIComponent(projectID);
        const data = await client.first([
          { route: `/api/project/${id}?${client.query(projectPath)}` },
          { route: `/project/${id}?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", project: unwrapData(data) || data };
      },

      async update(projectPath, projectID, payload = {}) {
        if (!projectID) return { ok: false, source: "engine", error: "Missing project id." };
        const id = encodeURIComponent(projectID);
        const data = await client.first([
          { route: `/api/project/${id}?${client.query(projectPath)}`, options: client.json("PATCH", payload) },
          { route: `/project/${id}?${client.query(projectPath)}`, options: client.json("PATCH", payload) }
        ]);
        return { ok: true, source: "engine", project: unwrapData(data) || data };
      }
    },

    workspace: {
      async list(projectPath) {
        const data = await client.first([
          { route: `/api/workspace?${client.query(projectPath)}` },
          { route: `/workspace?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", workspaces: asArray(data), raw: unwrapData(data) || data };
      },

      async get(projectPath, workspaceID) {
        if (!workspaceID) return { ok: false, source: "engine", error: "Missing workspace id." };
        const id = encodeURIComponent(workspaceID);
        const data = await client.first([
          { route: `/api/workspace/${id}?${client.query(projectPath)}` },
          { route: `/workspace/${id}?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", workspace: unwrapData(data) || data };
      },

      async create(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/workspace?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/workspace?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: true, source: "engine", workspace: unwrapData(data) || data };
      },

      async update(projectPath, workspaceID, payload = {}) {
        if (!workspaceID) return { ok: false, source: "engine", error: "Missing workspace id." };
        const id = encodeURIComponent(workspaceID);
        const data = await client.first([
          { route: `/api/workspace/${id}?${client.query(projectPath)}`, options: client.json("PATCH", payload) },
          { route: `/workspace/${id}?${client.query(projectPath)}`, options: client.json("PATCH", payload) }
        ]);
        return { ok: true, source: "engine", workspace: unwrapData(data) || data };
      },

      async delete(projectPath, workspaceID) {
        if (!workspaceID) return { ok: false, source: "engine", error: "Missing workspace id." };
        const id = encodeURIComponent(workspaceID);
        const data = await client.first([
          { route: `/api/workspace/${id}?${client.query(projectPath)}`, options: { method: "DELETE" } },
          { route: `/workspace/${id}?${client.query(projectPath)}`, options: { method: "DELETE" } }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      },

      async status(projectPath) {
        const data = await client.first([
          { route: `/api/workspace/status?${client.query(projectPath)}` },
          { route: `/workspace/status?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", status: unwrapData(data) || data };
      },

      async sync(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/workspace/sync?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/workspace/sync?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      },

      async warp(projectPath, payload = {}) {
        const data = await client.first([
          { route: `/api/workspace/warp?${client.query(projectPath)}`, options: client.json("POST", payload) },
          { route: `/workspace/warp?${client.query(projectPath)}`, options: client.json("POST", payload) }
        ]);
        return { ok: true, source: "engine", workspace: unwrapData(data) || data };
      }
    },

    pty: {
      async create(projectPath, payload = {}) {
        const data = await client.first([
          {
            route: `/api/pty?${client.query(projectPath)}`,
            options: client.json("POST", {
              command: payload.command,
              cwd: payload.cwd,
              shell: payload.shell,
              title: payload.title,
              size: payload.size
            })
          },
          {
            route: `/pty?${client.query(projectPath)}`,
            options: client.json("POST", {
              command: payload.command,
              cwd: payload.cwd,
              shell: payload.shell,
              title: payload.title,
              size: payload.size
            })
          }
        ]);
        return { ok: true, source: "engine", pty: unwrapData(data) || data };
      },

      async list(projectPath) {
        const data = await client.first([
          { route: `/api/pty?${client.query(projectPath)}` },
          { route: `/pty?${client.query(projectPath)}` }
        ]);
        const ptys = asArray(data);
        return { ok: true, source: "engine", ptys, terminals: ptys };
      },

      async get(projectPath, ptyID) {
        if (!ptyID) return { ok: false, source: "engine", error: "Missing PTY id." };
        const data = await client.first([
          { route: `/api/pty/${encodeURIComponent(ptyID)}?${client.query(projectPath)}` },
          { route: `/pty/${encodeURIComponent(ptyID)}?${client.query(projectPath)}` }
        ]);
        return { ok: true, source: "engine", pty: unwrapData(data) || data };
      },

      async update(projectPath, ptyID, payload = {}) {
        if (!ptyID) return { ok: false, source: "engine", error: "Missing PTY id." };
        const data = await client.first([
          {
            route: `/api/pty/${encodeURIComponent(ptyID)}?${client.query(projectPath)}`,
            options: client.json("PATCH", {
              title: payload.title,
              size: payload.size,
              columns: payload.columns,
              rows: payload.rows
            })
          },
          {
            route: `/pty/${encodeURIComponent(ptyID)}?${client.query(projectPath)}`,
            options: client.json("PATCH", {
              title: payload.title,
              size: payload.size,
              columns: payload.columns,
              rows: payload.rows
            })
          }
        ]);
        return { ok: true, source: "engine", pty: unwrapData(data) || data };
      },

      async delete(projectPath, ptyID) {
        if (!ptyID) return { ok: false, source: "engine", error: "Missing PTY id." };
        const data = await client.first([
          { route: `/api/pty/${encodeURIComponent(ptyID)}?${client.query(projectPath)}`, options: { method: "DELETE" } },
          { route: `/pty/${encodeURIComponent(ptyID)}?${client.query(projectPath)}`, options: { method: "DELETE" } }
        ]);
        return { ok: unwrapData(data) !== false, source: "engine", result: unwrapData(data) || data };
      }
    }
  };

  return client;
}

module.exports = {
  CodeEngineError,
  createCodeEngineClient,
  unwrapData,
  asArray
};
