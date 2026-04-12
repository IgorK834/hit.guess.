"use client";

const ACCENT = "#0000FF";

type CategoryPillsProps = {
  categories: readonly string[];
  selected: string;
  onSelect: (category: string) => void;
};

export function CategoryPills({ categories, selected, onSelect }: CategoryPillsProps) {
  return (
    <div className="flex flex-wrap gap-2">
      {categories.map((category) => {
        const isOn = selected === category;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onSelect(category)}
            className={[
              "rounded-full border-2 px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:ring-offset-[#EBE7DF]",
              isOn
                ? "text-white"
                : "border-black/25 bg-transparent text-black hover:border-black/50",
            ].join(" ")}
            style={
              isOn
                ? { borderColor: ACCENT, backgroundColor: ACCENT }
                : { borderColor: "rgba(0,0,0,0.25)" }
            }
          >
            {category}
          </button>
        );
      })}
    </div>
  );
}
