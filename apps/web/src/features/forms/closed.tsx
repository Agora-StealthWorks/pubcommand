import type { ResolvedTheme } from "../../../../../modules/forms/types";
import { FormHeader } from "./renderer";

export function ClosedForm({ title, message, theme, embed = false }: { title: string; message: string; theme: ResolvedTheme; embed?: boolean }) {
  return (
    <div className={embed ? "" : "min-h-screen bg-[#f5f6f8]"}>
      {embed ? null : <FormHeader theme={theme} />}
      <main className="mx-auto max-w-xl px-4 py-10">
        <div className="rounded-xl border border-[#e1e4ea] bg-white p-6 text-center">
          <h1 className="[overflow-wrap:anywhere] text-xl font-semibold text-[#0b1220]">{title}</h1>
          <p className="mt-2 text-sm text-[#3e4a5c]">{message}</p>
        </div>
      </main>
    </div>
  );
}
