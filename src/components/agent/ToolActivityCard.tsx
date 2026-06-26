import type { AgentToolPart } from "../../types";
import { safeClassToken, safeJsonPreview, safeRecord, safeString } from "./safeRender";

export type ToolActivityCardProps = {
  tool: AgentToolPart;
  defaultOpen?: boolean;
  className?: string;
};

function toolCategory(type: string) {
  if (type.includes("bash") || type.includes("shell") || type.includes("terminal")) return "Terminal";
  if (type.includes("edit") || type.includes("write") || type.includes("patch")) return "Edit";
  if (type.includes("grep") || type.includes("glob") || type.includes("list") || type.includes("read")) return "Context";
  if (type.includes("web")) return "Web";
  if (type.includes("task") || type.includes("agent")) return "Subtask";
  if (type.includes("todo")) return "Todo";
  return "Tool";
}

function durationLabel(value: unknown, timing: Record<string, unknown>) {
  const direct = safeString(value);
  if (direct) return direct;
  const start = Number(timing.start || timing.created || timing.startedAt || 0);
  const end = Number(timing.end || timing.completed || timing.completedAt || 0);
  if (Number.isFinite(start) && Number.isFinite(end) && start > 0 && end >= start) {
    return `${Math.max(1, Math.round(end - start))} ms`;
  }
  return "";
}

function lineRangeLabel(display: Record<string, unknown>, metadata: Record<string, unknown>) {
  const lineStart = safeString(display.lineStart || metadata.lineStart || metadata.offset);
  const lineEnd = safeString(display.lineEnd || metadata.lineEnd);
  const totalLines = safeString(display.totalLines || metadata.totalLines);
  if (lineStart && lineEnd && totalLines) return `${lineStart}-${lineEnd} / ${totalLines}`;
  if (lineStart && lineEnd) return `${lineStart}-${lineEnd}`;
  return "";
}

export function ToolActivityCard({ tool, defaultOpen, className = "" }: ToolActivityCardProps) {
  const type = safeString(tool.type, "tool");
  const raw = safeRecord(tool.raw);
  const state = safeRecord(raw.state);
  const status = safeString(tool.status || raw.status || state.status, "pending");
  const detail = safeString(tool.detail);
  const input = safeRecord(raw.input || state.input);
  const output = safeRecord(raw.output || state.output);
  const metadata = safeRecord(raw.metadata || state.metadata || raw.meta);
  const display = safeRecord(metadata.display);
  const timing = safeRecord(raw.time || raw.timing || metadata.timing);
  const command = safeString(raw.command || raw.cmd || input.command || metadata.command);
  const cwd = safeString(raw.cwd || input.cwd || input.directory || metadata.cwd || metadata.directory);
  const path = safeString(raw.path || raw.file || raw.filePath || input.path || input.filePath || input.file || metadata.filepath || metadata.path || display.path);
  const outputPath = safeString(raw.outputPath || output.outputPath || metadata.outputPath);
  const exitCode = safeString(raw.exitCode || raw.code || output.exitCode || output.code || metadata.exitCode || metadata.code);
  const truncated = safeString(raw.truncated || output.truncated || metadata.truncated || display.truncated);
  const lines = lineRangeLabel(display, metadata);
  const attachments = Array.isArray(raw.attachments) ? raw.attachments : Array.isArray(output.attachments) ? output.attachments : [];
  const duration = durationLabel(
    raw.duration || raw.durationMs || raw.durationMS || timing.duration || timing.durationMs || timing.durationMS || metadata.duration || metadata.durationMs,
    timing
  );
  const error = safeString(raw.error || raw.stderr || output.error || metadata.error);
  const stateOutput = typeof state.output === "string" ? state.output : "";
  const rawOutput = typeof raw.output === "string" ? raw.output : "";
  const outputText = safeString(raw.stdout || rawOutput || stateOutput || output.stdout || output.stderr || output.text || output.content || output.result || metadata.preview, "", 1600);
  const inputPreview = Object.keys(input).length ? safeJsonPreview(input, "", 1200) : "";
  const title = safeString(tool.title || raw.title || state.title || command || path, "Code step");
  const category = toolCategory(type.toLowerCase());
  const statusClass = safeClassToken(status, "pending");
  const typeClass = safeClassToken(type, "tool");
  const rootClass = ["agent-tool-activity-card", `agent-tool-activity-card--${typeClass}`, className].filter(Boolean).join(" ");
  const metaRows = [
    path ? { label: "Path", value: path } : null,
    cwd ? { label: "CWD", value: cwd } : null,
    command ? { label: "Command", value: command } : null,
    exitCode ? { label: "Exit", value: exitCode } : null,
    duration ? { label: "Duration", value: duration } : null,
    outputPath ? { label: "Full output", value: outputPath } : null,
    lines ? { label: "Lines", value: lines } : null,
    truncated ? { label: "Truncated", value: truncated } : null,
    attachments.length ? { label: "Attachments", value: String(attachments.length) } : null
  ].filter((row): row is { label: string; value: string } => Boolean(row));

  return (
    <details className={rootClass} open={defaultOpen} data-tool-type={typeClass} data-status={statusClass}>
      <summary className="agent-tool-activity-card__summary">
        <span className="agent-tool-activity-card__category">{category}</span>
        <strong className="agent-tool-activity-card__title">{title}</strong>
        <span className={`agent-tool-activity-card__status agent-status agent-status--${statusClass}`} role="status" aria-live="polite">
          {status}
        </span>
      </summary>
      <div className="agent-tool-activity-card__body">
        {metaRows.length ? (
          <div className="agent-tool-activity-card__meta-grid">
            {metaRows.map((row) => (
              <div key={row.label} className="agent-tool-activity-card__meta">
                <span className="agent-tool-activity-card__meta-label">{row.label}</span>
                <code className="agent-tool-activity-card__meta-value">{row.value}</code>
              </div>
            ))}
          </div>
        ) : null}
        {error ? (
          <div className="agent-tool-activity-card__meta agent-tool-activity-card__meta--error">
            <span className="agent-tool-activity-card__meta-label">Error</span>
            <code className="agent-tool-activity-card__meta-value">{error}</code>
          </div>
        ) : null}
        {!detail && outputText ? (
          <pre className="agent-tool-activity-card__detail">{outputText}</pre>
        ) : null}
        {detail ? (
          <pre className="agent-tool-activity-card__detail">{detail}</pre>
        ) : !outputText && inputPreview ? (
          <details className="agent-tool-activity-card__input">
            <summary>Input arguments</summary>
            <pre className="agent-tool-activity-card__detail">{inputPreview}</pre>
          </details>
        ) : !outputText ? (
          <small className="agent-tool-activity-card__empty">No extra output.</small>
        ) : null}
      </div>
    </details>
  );
}
