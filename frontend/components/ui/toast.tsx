"use client";

import * as React from "react";
import * as ToastPrimitives from "@radix-ui/react-toast";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const ToastProvider = ToastPrimitives.Provider;

const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Viewport
    ref={ref}
    className={cn(
      "fixed bottom-3 right-3 z-[90] flex w-[min(92vw,360px)] flex-col gap-2 outline-none",
      className,
    )}
    {...props}
  />
));
ToastViewport.displayName = ToastPrimitives.Viewport.displayName;

type ToastProps = React.ComponentPropsWithoutRef<typeof ToastPrimitives.Root> & {
  variant?: "default" | "destructive";
};

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Root>,
  ToastProps
>(({ className, variant = "default", ...props }, ref) => (
  <ToastPrimitives.Root
    ref={ref}
    className={cn(
      "relative grid gap-1 border-2 border-black bg-[#EBE7DF] p-3 shadow-[6px_6px_0_0_rgba(0,0,0,0.08)]",
      variant === "destructive" ? "border-red-800/60" : "border-black",
      className,
    )}
    {...props}
  />
));
Toast.displayName = ToastPrimitives.Root.displayName;

const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Title
    ref={ref}
    className={cn("text-[10px] font-black uppercase tracking-[0.2em] text-black", className)}
    {...props}
  />
));
ToastTitle.displayName = ToastPrimitives.Title.displayName;

const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Description
    ref={ref}
    className={cn("text-[10px] font-bold uppercase tracking-wide text-black/60", className)}
    {...props}
  />
));
ToastDescription.displayName = ToastPrimitives.Description.displayName;

const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitives.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitives.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitives.Close
    ref={ref}
    className={cn(
      "absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center border border-black/20 bg-white/40 text-black hover:bg-black/5",
      "focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF]",
      className,
    )}
    toast-close=""
    aria-label="Zamknij"
    {...props}
  >
    <X className="h-3.5 w-3.5" aria-hidden />
  </ToastPrimitives.Close>
));
ToastClose.displayName = ToastPrimitives.Close.displayName;

export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastTitle,
  ToastDescription,
  ToastClose,
};

