const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const mainPath = path.join(root, "electron", "main.cjs");
const preloadPath = path.join(root, "electron", "preload.cjs");

const main = fs.readFileSync(mainPath, "utf8");
const preload = fs.readFileSync(preloadPath, "utf8");

const handlers = [
  ...main.matchAll(/ipcMain\.handle\("([^"]+)"/g)
]
  .map((match) => match[1])
  .filter((channel) => channel.startsWith("opencode:"))
  .sort();

const invokes = [
  ...preload.matchAll(/ipcRenderer\.invoke\("([^"]+)"/g)
]
  .map((match) => match[1])
  .filter((channel) => channel.startsWith("opencode:"))
  .sort();

const handlerSet = new Set(handlers);
const invokeSet = new Set(invokes);
const missingFromPreload = handlers.filter((channel) => !invokeSet.has(channel));
const missingHandlers = invokes.filter((channel) => !handlerSet.has(channel));

console.log(`OpenCode bridge handlers: ${handlers.length}`);
console.log(`OpenCode preload invokes: ${invokes.length}`);

if (missingFromPreload.length) {
  console.error("\nMissing from preload:");
  for (const channel of missingFromPreload) console.error(`  ${channel}`);
}

if (missingHandlers.length) {
  console.error("\nPreload invokes without main handler:");
  for (const channel of missingHandlers) console.error(`  ${channel}`);
}

if (missingFromPreload.length || missingHandlers.length) {
  process.exit(1);
}

console.log("OpenCode bridge coverage is complete.");
