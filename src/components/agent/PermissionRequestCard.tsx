import type { AgentPermissionReply, AgentPermissionRequest } from "../../types";
import { safeClassToken, safeRecord, safeString } from "./safeRender";

export type PermissionRequestCardProps = {
  permission: AgentPermissionRequest;
  onReply: (reply: AgentPermissionReply, permission: AgentPermissionRequest) => void;
  disabled?: boolean;
  className?: string;
};

export function permissionRequestKey(permission: AgentPermissionRequest) {
  return safeString(permission.id || permission.requestID || permission.permissionID || permission.permission, "permission").slice(0, 120);
}

export function PermissionRequestCard({ permission, onReply, disabled = false, className = "" }: PermissionRequestCardProps) {
  const metadata = safeRecord(permission.metadata);
  const target = safeString(metadata.command || metadata.path || metadata.file || metadata.pattern || metadata.resource || metadata.uri || metadata.url);
  const action = safeString(metadata.action || metadata.tool || permission.permission, "tool action");
  const title = safeString(permission.title || permission.permission, "Permission requested");
  const message = safeString(permission.message || target, "Code needs approval to continue this action.");
  const requestId = permissionRequestKey(permission);
  const permissionClass = safeClassToken(permission.permission || title, "permission");
  const rootClass = ["agent-permission-request-card", `agent-permission-request-card--${permissionClass}`, className].filter(Boolean).join(" ");

  return (
    <section className={rootClass} data-permission-id={requestId} aria-labelledby={`${requestId}-title`}>
      <div className="agent-permission-request-card__content">
        <strong id={`${requestId}-title`} className="agent-permission-request-card__title">{title}</strong>
        <small className="agent-permission-request-card__kind">{action}</small>
        <span className="agent-permission-request-card__message">{message}</span>
        {target && message !== target ? <code className="agent-permission-request-card__target">{target}</code> : null}
      </div>
      <div className="agent-permission-request-card__actions" role="group" aria-label="Permission response">
        <button className="agent-permission-request-card__button agent-permission-request-card__button--allow-once" type="button" disabled={disabled} onClick={() => onReply("once", permission)}>
          Allow once
        </button>
        <button className="agent-permission-request-card__button agent-permission-request-card__button--allow-always" type="button" disabled={disabled} onClick={() => onReply("always", permission)}>
          Always allow
        </button>
        <button className="agent-permission-request-card__button agent-permission-request-card__button--deny" type="button" disabled={disabled} onClick={() => onReply("reject", permission)}>
          Deny
        </button>
      </div>
    </section>
  );
}
