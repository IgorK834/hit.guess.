"use client";

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
              "rounded-full border px-4 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
              isOn
                ? "border-black bg-black text-white"
                : "border-black/25 bg-transparent text-black hover:border-black/50",
            ].join(" ")}
          >
            {category}
          </button>
        );
      })}
    </div>
  );
}
