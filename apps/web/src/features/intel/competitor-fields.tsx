import { Input, Label, Textarea } from "@pubcommand/ui";

export type CompetitorValues = {
  name?: string;
  products?: string[];
  websites?: string[];
  senderAddresses?: string[];
  senderDomains?: string[];
  notes?: string | null;
  tags?: string[];
};

export function CompetitorFields({ values = {}, idPrefix = "competitor" }: { values?: CompetitorValues; idPrefix?: string }) {
  const id = (name: string) => `${idPrefix}-${name}`;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="min-w-0 sm:col-span-2">
        <Label htmlFor={id("name")}>Publisher name</Label>
        <Input id={id("name")} name="name" required maxLength={160} defaultValue={values.name ?? ""} placeholder="The competing publisher" className="mt-1" />
      </div>
      <div className="min-w-0">
        <Label htmlFor={id("senders")}>Sender addresses and domains</Label>
        <Textarea
          id={id("senders")}
          name="senders"
          rows={4}
          defaultValue={[...(values.senderAddresses ?? []), ...(values.senderDomains ?? [])].join("\n")}
          placeholder={"editor@publisher.example\nmail.publisher.example"}
          className="mt-1"
        />
        <p className="mt-1 text-xs text-muted">One per line. A domain also matches its subdomains.</p>
      </div>
      <div className="min-w-0">
        <Label htmlFor={id("websites")}>Websites</Label>
        <Textarea id={id("websites")} name="websites" rows={4} defaultValue={(values.websites ?? []).join("\n")} placeholder="publisher.example" className="mt-1" />
        <p className="mt-1 text-xs text-muted">Mail from these domains matches too.</p>
      </div>
      <div className="min-w-0">
        <Label htmlFor={id("products")}>Brands and products</Label>
        <Textarea id={id("products")} name="products" rows={3} defaultValue={(values.products ?? []).join("\n")} placeholder="Their newsletters, services and products" className="mt-1" />
      </div>
      <div className="min-w-0">
        <Label htmlFor={id("tags")}>Tags</Label>
        <Input id={id("tags")} name="tags" defaultValue={(values.tags ?? []).join(", ")} placeholder="direct, affiliate" className="mt-1" />
        <Label htmlFor={id("notes")} className="mt-3 block">
          Notes
        </Label>
        <Textarea id={id("notes")} name="notes" rows={2} defaultValue={values.notes ?? ""} className="mt-1" />
      </div>
    </div>
  );
}
