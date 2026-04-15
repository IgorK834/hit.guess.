"use client";

import * as React from "react";

import { useToast } from "@/hooks/use-toast";
import { Toast, ToastClose, ToastDescription, ToastTitle, ToastViewport } from "@/components/ui/toast";

export function Toaster() {
  const { toasts, dismiss } = useToast();

  return (
    <>
      {toasts.map((t) => (
        <Toast
          key={t.id}
          variant={t.variant}
          onOpenChange={(open) => {
            if (!open) dismiss(t.id);
          }}
        >
          <div className="grid gap-0.5">
            {t.title ? <ToastTitle>{t.title}</ToastTitle> : null}
            {t.description ? <ToastDescription>{t.description}</ToastDescription> : null}
          </div>
          <ToastClose />
        </Toast>
      ))}
      <ToastViewport />
    </>
  );
}

