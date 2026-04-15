"use client";

import { useEffect } from "react";

type GlobalErrorProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.error("[HIT.GUESS] Unhandled app error", error);
  }, [error]);

  return (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-[#EBE7DF] px-6 text-black">
      <div className="w-full max-w-lg border-2 border-black bg-[#EBE7DF] p-6 shadow-[8px_8px_0_0_rgba(0,0,0,0.08)]">
        <p
          className="text-xs font-black uppercase tracking-[0.2em]"
          style={{ color: "#0000FF" }}
        >
          Coś poszło nie tak
        </p>
        <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-black/60">
          Aplikacja napotkała błąd i nie może kontynuować.
        </p>

        <div className="mt-4 border border-black/10 bg-white/50 p-3 font-mono text-[11px] text-black/80">
          <div className="font-bold">{error.message || "Unknown error"}</div>
          {error.digest ? (
            <div className="mt-1 text-[10px] text-black/50">
              digest: {error.digest}
            </div>
          ) : null}
        </div>

        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={reset}
            className="h-10 w-full text-xs font-black uppercase tracking-wider text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF] sm:w-auto sm:px-6"
            style={{ backgroundColor: "#0000FF" }}
          >
            Spróbuj ponownie
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-10 w-full border border-black/30 bg-[#EBE7DF] text-xs font-black uppercase tracking-wider text-black hover:bg-black/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF] sm:w-auto sm:px-6"
          >
            Odśwież
          </button>
        </div>
      </div>
    </div>
  );
}

