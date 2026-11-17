"use client";

/**
 * Chips that add or remove a name in a comma-separated text input (by id). Lets other
 * apps pick editors from Publication Setup while still allowing free text.
 */
export function NamePicker({ inputId, names, label }: { inputId: string; names: readonly string[]; label: string }) {
  if (!names.length) return null;
  const toggle = (name: string) => {
    const input = document.getElementById(inputId);
    if (!(input instanceof HTMLInputElement)) return;
    const current = input.value.split(",").map((v) => v.trim()).filter(Boolean);
    const has = current.some((v) => v.toLowerCase() === name.toLowerCase());
    input.value = (has ? current.filter((v) => v.toLowerCase() !== name.toLowerCase()) : [...current, name]).join(", ");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return (
    <div className="mt-1 flex flex-wrap gap-1" aria-label={label}>
      {names.map((name) => (
        <button key={name} type="button" onClick={() => toggle(name)} className="inline-flex min-h-9 items-center rounded-full border border-line bg-white px-2.5 text-xs font-medium text-muted hover:border-accent hover:text-accent">
          + {name}
        </button>
      ))}
    </div>
  );
}
