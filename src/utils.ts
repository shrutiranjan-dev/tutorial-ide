export function languageFromPath(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  switch (extension) {
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "ts":
    case "tsx":
      return "typescript";
    case "py":
      return "python";
    case "html":
      return "html";
    case "css":
      return "css";
    case "json":
      return "json";
    case "md":
      return "markdown";
    default:
      return "plaintext";
  }
}

export function compactTerminalOutput(output: string) {
  return output.split(/\r?\n/).slice(-80).join("\n").trim();
}

export function extensionIcon(path: string) {
  const extension = path.split(".").pop()?.toLowerCase();
  if (extension === "py") return "PY";
  if (extension === "js") return "JS";
  if (extension === "html") return "HT";
  if (extension === "css") return "CS";
  if (extension === "json") return "{}";
  return "--";
}
