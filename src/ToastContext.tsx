import React, { createContext, useContext, useState, useCallback } from "react";
import { X, AlertCircle, CheckCircle2, Info } from "lucide-react";

export type ToastType = "info" | "success" | "warn" | "danger" | "error";

type Toast = {
  id: string;
  message: string;
  type: ToastType;
};

type ToastContextType = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = "info") => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div style={{
        position: "fixed",
        bottom: "20px",
        right: "20px",
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: "10px",
        pointerEvents: "none"
      }}>
        {toasts.map((toast) => (
          <div key={toast.id} style={{
            pointerEvents: "auto",
            background: "#1e1e1e",
            color: "#ccc",
            padding: "12px 16px",
            borderRadius: "6px",
            borderLeft: `4px solid ${
              toast.type === "success" ? "#4ade80" :
              toast.type === "danger" || toast.type === "error" ? "#f87171" :
              toast.type === "warn" ? "#fbbf24" : "#60a5fa"
            }`,
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
            display: "flex",
            alignItems: "center",
            gap: "12px",
            minWidth: "280px",
            maxWidth: "450px",
            animation: "slideIn 0.2s ease-out"
          }}>
            {toast.type === "success" && <CheckCircle2 size={16} color="#4ade80" />}
            {(toast.type === "danger" || toast.type === "error") && <AlertCircle size={16} color="#f87171" />}
            {toast.type === "warn" && <AlertCircle size={16} color="#fbbf24" />}
            {toast.type === "info" && <Info size={16} color="#60a5fa" />}
            <div style={{ flex: 1, fontSize: "13px" }}>{toast.message}</div>
            <button onClick={() => setToasts(prev => prev.filter(t => t.id !== toast.id))} style={{
              background: "transparent",
              border: "none",
              color: "#666",
              cursor: "pointer",
              padding: "2px"
            }}>
              <X size={14} />
            </button>
          </div>
        ))}
        <style>{`
          @keyframes slideIn {
            from { transform: translateX(100%); opacity: 0; }
            to { transform: translateX(0); opacity: 1; }
          }
        `}</style>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error("useToast must be used within ToastProvider");
  return context;
}
