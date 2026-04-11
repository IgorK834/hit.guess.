"use client";

import { Check, X } from "lucide-react";

import type { GuessSlot } from "@/hooks/use-game";

type GuessFieldsProps = {
  slots: GuessSlot[];
  activeIndex: number;
};

export function GuessFields({ slots, activeIndex }: GuessFieldsProps) {
  return (
    <div className="flex w-full flex-col gap-0">
      {slots.map((slot, idx) => {
        const isActive = idx === activeIndex && activeIndex >= 0;
        return (
          <div
            key={idx}
            className={[
              "flex min-h-[2.25rem] items-center border-b border-black/15 px-2 transition-colors",
              isActive && slot.variant === "empty"
                ? "bg-[#d9d5cf]"
                : "bg-transparent",
              slot.variant === "correct" ? "border-[#0000FF] bg-[#EBE7DF]" : "",
              slot.variant === "wrong" ? "border-black/25" : "",
              slot.variant === "skip" ? "border-black/20" : "",
            ].join(" ")}
          >
            {slot.variant === "wrong" && (
              <X className="mr-2 h-3.5 w-3.5 shrink-0 text-black/55" aria-hidden />
            )}
            {slot.variant === "correct" && (
              <Check
                className="mr-2 h-3.5 w-3.5 shrink-0"
                style={{ color: "#0000FF" }}
                aria-hidden
              />
            )}
            <span
              className={[
                "truncate text-[11px] font-bold uppercase tracking-wide",
                slot.variant === "empty" ? "text-black/35" : "",
                slot.variant === "wrong" ? "text-black/80" : "",
                slot.variant === "skip" ? "text-black/50" : "",
                slot.variant === "correct" ? "text-black" : "",
              ].join(" ")}
            >
              {slot.line || (slot.variant === "empty" ? "\u00a0" : "")}
            </span>
          </div>
        );
      })}
    </div>
  );
}
