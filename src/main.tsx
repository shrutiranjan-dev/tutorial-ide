import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import { App } from "./App";
import { ToastProvider } from "./ToastContext";

type RootErrorBoundaryState = {
  error?: Error;
  info?: React.ErrorInfo;
};

class RootErrorBoundary extends React.Component<React.PropsWithChildren, RootErrorBoundaryState> {
  state: RootErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ error, info });
    console.error("Renderer crashed:", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="renderer-fatal">
          <section>
            <strong>Code Workbench hit a renderer error.</strong>
            <p>{this.state.error.message}</p>
            <pre>{this.state.info?.componentStack || this.state.error.stack}</pre>
            <button type="button" onClick={() => window.location.reload()}>Reload workbench</button>
          </section>
        </main>
      );
    }
    return this.props.children;
  }
}

window.addEventListener("error", (event) => {
  console.error("Uncaught renderer error:", event.error || event.message);
});

window.addEventListener("unhandledrejection", (event) => {
  console.error("Unhandled renderer rejection:", event.reason);
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <ToastProvider>
        <App />
      </ToastProvider>
    </RootErrorBoundary>
  </React.StrictMode>
);
