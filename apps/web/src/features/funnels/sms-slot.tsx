import type { LoadedFunnel } from "./public";
import type { SmsFormRow } from "./sms-data";
import { SmsOptinForm } from "./sms-view";

export type SmsQuery = { sms_done?: string; sms_form?: string; sms_error?: string };

/** One of the funnel's SMS forms by id, or null. */
export function smsFormFor(loaded: Pick<LoadedFunnel, "smsForms">, id: string | null | undefined): SmsFormRow | null {
  return id ? loaded.smsForms.find((form) => form.id === id) ?? null : null;
}

/** An SMS form placed on a public page, with its own thank-you / error state from the query. */
export function SmsSlot({ loaded, form, base, back, query }: { loaded: LoadedFunnel; form: SmsFormRow; base: string; back: string; query: SmsQuery }) {
  const action = `${base || `/l/${loaded.funnel.slug}`}/sms`;
  const error = query.sms_form === form.id && typeof query.sms_error === "string" ? query.sms_error.slice(0, 200) : null;
  return <SmsOptinForm form={form} action={action} back={back} done={query.sms_done === form.id} error={error} />;
}
