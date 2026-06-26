import { useId } from "react";
import type { AgentTodoItem } from "../../types";
import { safeClassToken, safeRecord, safeString } from "./safeRender";

export type TodoListPanelProps = {
  todos: AgentTodoItem[];
  title?: string;
  emptyLabel?: string;
  className?: string;
  onTodoClick?: (todo: AgentTodoItem) => void;
};

function normalizedTodoStatus(status: unknown) {
  const text = safeString(status, "pending").toLowerCase();
  if (text === "done" || text === "complete" || text === "completed") return "completed";
  if (text === "active" || text === "in-progress") return "in_progress";
  return text || "pending";
}

function todoLabel(todo: AgentTodoItem) {
  const metadata = safeRecord(todo.metadata);
  return safeString(todo.content || todo.title || metadata.text || metadata.content, "Untitled todo");
}

export function TodoListPanel({ todos, title = "Todos", emptyLabel = "No todos yet.", className = "", onTodoClick }: TodoListPanelProps) {
  const titleId = useId();
  const total = todos.length;
  const completed = todos.filter((todo) => normalizedTodoStatus(todo.status) === "completed").length;
  const rootClass = ["agent-todo-list-panel", className].filter(Boolean).join(" ");

  return (
    <section className={rootClass} aria-labelledby={titleId}>
      <div className="agent-todo-list-panel__header">
        <strong id={titleId} className="agent-todo-list-panel__title">{safeString(title, "Todos")}</strong>
        <span className="agent-todo-list-panel__summary" role="status" aria-live="polite">
          {completed}/{total}
        </span>
      </div>
      {todos.length ? (
        <ol className="agent-todo-list-panel__items">
          {todos.map((todo, index) => {
            const status = normalizedTodoStatus(todo.status);
            const statusClass = safeClassToken(status, "pending");
            const priority = safeString(todo.priority);
            const label = todoLabel(todo);
            const key = safeString(todo.id, `todo-${index}`);
            const content = (
              <>
                <span className="agent-todo-list-panel__item-status" data-status={statusClass}>{status.replace(/_/g, " ")}</span>
                <span className="agent-todo-list-panel__item-text">{label}</span>
                {priority ? <span className={`agent-todo-list-panel__item-priority agent-todo-list-panel__item-priority--${safeClassToken(priority)}`}>{priority}</span> : null}
              </>
            );

            return (
              <li key={key} className={`agent-todo-list-panel__item agent-todo-list-panel__item--${statusClass}`}>
                {onTodoClick ? (
                  <button className="agent-todo-list-panel__item-button" type="button" onClick={() => onTodoClick(todo)}>
                    {content}
                  </button>
                ) : (
                  <div className="agent-todo-list-panel__item-content">{content}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <small className="agent-todo-list-panel__empty">{safeString(emptyLabel, "No todos yet.")}</small>
      )}
    </section>
  );
}
