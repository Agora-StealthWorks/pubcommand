import { Button, Input, Label } from "@pubcommand/ui";

type FormAction = (formData: FormData) => void | Promise<void>;

/** From name, From address and Reply-to. Blank fields fall back to the next level (publication → brand → organization). */
export function SenderForm({
  id,
  action,
  hidden,
  value,
  placeholders,
  submitLabel = "Save sender",
}: {
  id: string;
  action: FormAction;
  hidden?: Record<string, string>;
  value: { fromName: string | null; fromAddress: string | null; replyTo: string | null };
  placeholders?: { fromName?: string; fromAddress?: string; replyTo?: string };
  submitLabel?: string;
}) {
  return (
    <form action={action} className="space-y-3">
      {Object.entries(hidden ?? {}).map(([name, val]) => (
        <input key={name} type="hidden" name={name} value={val} />
      ))}
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0">
          <Label htmlFor={`${id}-from-name`}>From name</Label>
          <Input id={`${id}-from-name`} name="fromName" maxLength={80} defaultValue={value.fromName ?? ""} placeholder={placeholders?.fromName ?? "e.g. Liberty Letters"} />
        </div>
        <div className="min-w-0">
          <Label htmlFor={`${id}-from-address`}>From address</Label>
          <Input id={`${id}-from-address`} name="fromAddress" type="email" maxLength={254} defaultValue={value.fromAddress ?? ""} placeholder={placeholders?.fromAddress ?? "news@yourdomain.com"} />
        </div>
        <div className="min-w-0 sm:col-span-2">
          <Label htmlFor={`${id}-reply-to`}>Reply-to</Label>
          <Input id={`${id}-reply-to`} name="replyTo" type="email" maxLength={254} defaultValue={value.replyTo ?? ""} placeholder={placeholders?.replyTo ?? "help@yourdomain.com"} />
        </div>
      </div>
      <Button type="submit" variant="secondary" className="w-full sm:w-auto">
        {submitLabel}
      </Button>
    </form>
  );
}
