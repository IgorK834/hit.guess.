"use client";

import * as React from "react";

export type ToastVariant = "default" | "destructive";

export type ToastPayload = {
  id: string;
  title?: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastContextValue = {
  toasts: ToastPayload[];
  toast: (t: Omit<ToastPayload, "id">) => void;
  dismiss: (id: string) => void;
};

const ToastContext = React.createContext<ToastContextValue | null>(null);

function uid(): string {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<ToastPayload[]>([]);

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = React.useCallback(
    (t: Omit<ToastPayload, "id">) => {
      const id = uid();
      const payload: ToastPayload = {
        id,
        duration: 2500,
        variant: "default",
        ...t,
      };
      setToasts((prev) => [...prev, payload]);
      const ms = payload.duration ?? 2500;
      window.setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const value = React.useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss]);
  return React.createElement(ToastContext.Provider, { value }, children);
}

export function useToast() {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast must be used within <ToastProvider />");
  }
  return ctx;
}

