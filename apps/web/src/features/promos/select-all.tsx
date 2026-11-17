"use client";

/** Ticks or clears every checkbox with this name inside the same form. */
export function SelectAll({ name }: { name: string }) {
  const toggle = (event: React.MouseEvent<HTMLButtonElement>, checked: boolean) => {
    const form = event.currentTarget.closest("form");
    form?.querySelectorAll<HTMLInputElement>(`input[type=checkbox][name="${name}"]`).forEach((box) => {
      if (!box.disabled) box.checked = checked;
    });
  };
  return (
    <span className="inline-flex gap-3 text-sm">
      <button type="button" className="min-h-9 font-semibold text-accent hover:underline" onClick={(e) => toggle(e, true)}>Select all</button>
      <button type="button" className="min-h-9 font-semibold text-accent hover:underline" onClick={(e) => toggle(e, false)}>Clear</button>
    </span>
  );
}
