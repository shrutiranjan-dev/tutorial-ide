import type { AgentDiffFile } from "../../types";
import { displayCount, safeClassToken, safeString } from "./safeRender";

export type DiffChangeCardProps = {
  file: AgentDiffFile;
  onOpen?: (file: AgentDiffFile) => void;
  onRevert?: (file: AgentDiffFile) => void;
  onFork?: (file: AgentDiffFile) => void;
  defaultOpen?: boolean;
  maxPreviewLines?: number;
  className?: string;
};

function diffLineKind(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "delete";
  if (line.startsWith("@@")) return "hunk";
  return "context";
}

function diffLineMarker(kind: string) {
  if (kind === "add") return "+";
  if (kind === "delete") return "-";
  if (kind === "hunk") return "@";
  return " ";
}

export function DiffChangeCard({
  file,
  onOpen,
  onRevert,
  onFork,
  defaultOpen,
  maxPreviewLines = 220,
  className = ""
}: DiffChangeCardProps) {
  const path = safeString(file.file || file.path, "changed file");
  const status = safeString(file.status, "modified");
  const statusClass = safeClassToken(status, "modified");
  const additions = displayCount(file.additions);
  const deletions = displayCount(file.deletions);
  const patch = safeString(file.patch);
  const lines = patch ? patch.split(/\r?\n/).slice(0, maxPreviewLines) : [];
  const rootClass = ["agent-diff-change-card", `agent-diff-change-card--${statusClass}`, className].filter(Boolean).join(" ");

  return (
    <details className={rootClass} open={defaultOpen} data-file-status={statusClass}>
      <summary className="agent-diff-change-card__summary">
        <span className="agent-diff-change-card__status">{status}</span>
        <strong className="agent-diff-change-card__path">{path}</strong>
        <span className="agent-diff-change-card__stats" aria-label={`${additions} additions and ${deletions} deletions`}>
          <span className="agent-diff-change-card__additions">+{additions}</span>
          <span className="agent-diff-change-card__deletions">-{deletions}</span>
        </span>
      </summary>
      <div className="agent-diff-change-card__body">
        <div className="agent-diff-change-card__actions" role="group" aria-label={`Actions for ${path}`}>
          {onOpen ? (
            <button className="agent-diff-change-card__button agent-diff-change-card__button--open" type="button" onClick={() => onOpen(file)}>
              Open
            </button>
          ) : null}
          {onRevert ? (
            <button className="agent-diff-change-card__button agent-diff-change-card__button--revert" type="button" onClick={() => onRevert(file)}>
              Revert
            </button>
          ) : null}
          {onFork ? (
            <button className="agent-diff-change-card__button agent-diff-change-card__button--fork" type="button" onClick={() => onFork(file)}>
              Fork
            </button>
          ) : null}
        </div>
        {lines.length ? (
          <pre className="agent-diff-change-card__preview" aria-label={`Patch preview for ${path}`}>
            {lines.map((line, index) => {
              const kind = diffLineKind(line);
              const text = kind === "add" || kind === "delete" ? line.slice(1) : line;
              return (
                <code key={`${index}:${line}`} className={`agent-diff-change-card__line agent-diff-change-card__line--${kind}`}>
                  <span className="agent-diff-change-card__line-marker">{diffLineMarker(kind)}</span>
                  <span className="agent-diff-change-card__line-text">{text}</span>
                </code>
              );
            })}
          </pre>
        ) : (
          <small className="agent-diff-change-card__empty">No patch preview available.</small>
        )}
      </div>
    </details>
  );
}
