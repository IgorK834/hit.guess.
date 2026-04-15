export default function Loading() {
  return (
    <div className="flex h-[100dvh] w-full items-center justify-center bg-[#EBE7DF] text-black">
      <div className="flex items-center gap-3">
        <div
          aria-label="Loading"
          className="h-6 w-6 animate-spin rounded-full border-2 border-black/20"
          style={{ borderTopColor: "#0000FF" }}
        />
        <span className="font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-black/60">
          Loading…
        </span>
      </div>
    </div>
  );
}

