import {
  formatPlanLimit,
  formatPlanPrice,
  isUnlimitedPlanLimit,
  planPriceInput,
} from "@pubcommand/core";
import { Button, Input, Label } from "@pubcommand/ui";

type FormAction = (formData: FormData) => void | Promise<void>;

export type PlanRow = {
  id: string;
  key: string;
  name: string;
  seatLimit: number;
  brandLimit: number;
  workspaceLimit: number;
  monthlyPriceCents: number;
  archived: boolean;
  moduleIds: string[];
  organizationCount: number;
};

type ModuleChoice = { id: string; name: string };

function LimitFields({
  id,
  label,
  name,
  unlimitedName,
  defaultValue,
  unlimited,
}: {
  id: string;
  label: string;
  name: string;
  unlimitedName: string;
  defaultValue: number;
  unlimited: boolean;
}) {
  return (
    <div className="min-w-0">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} name={name} type="number" min={1} inputMode="numeric" defaultValue={unlimited ? "" : defaultValue} className="mt-1" />
      <label className="mt-2 flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" name={unlimitedName} value="1" defaultChecked={unlimited} className="h-5 w-5" />
        Unlimited
      </label>
    </div>
  );
}

function ModuleChoices({ modules, selected, idPrefix }: { modules: ModuleChoice[]; selected: string[]; idPrefix: string }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-ink">Included apps</legend>
      <p className="mt-1 text-sm text-muted">Settings stays on every plan. Price is display only and is not charged.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {modules.map((module) => (
          <label key={module.id} htmlFor={`${idPrefix}-${module.id}`} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-line bg-white px-3 text-sm">
            <input
              id={`${idPrefix}-${module.id}`}
              type="checkbox"
              name="moduleId"
              value={module.id}
              defaultChecked={selected.includes(module.id)}
              className="h-5 w-5"
            />
            {module.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function PlanFields({
  idPrefix,
  modules,
  values,
}: {
  idPrefix: string;
  modules: ModuleChoice[];
  values?: PlanRow;
}) {
  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor={`${idPrefix}-name`}>Name</Label>
        <Input id={`${idPrefix}-name`} name="name" required defaultValue={values?.name ?? ""} className="mt-1" />
      </div>
      <LimitFields
        id={`${idPrefix}-seats`}
        label="Seat limit"
        name="seatLimit"
        unlimitedName="seatUnlimited"
        defaultValue={values?.seatLimit ?? 5}
        unlimited={values ? isUnlimitedPlanLimit(values.seatLimit) : false}
      />
      <LimitFields
        id={`${idPrefix}-brands`}
        label="Brand limit"
        name="brandLimit"
        unlimitedName="brandUnlimited"
        defaultValue={values?.brandLimit ?? 1}
        unlimited={values ? isUnlimitedPlanLimit(values.brandLimit) : false}
      />
      <LimitFields
        id={`${idPrefix}-workspaces`}
        label="Workspace limit"
        name="workspaceLimit"
        unlimitedName="workspaceUnlimited"
        defaultValue={values?.workspaceLimit ?? 2}
        unlimited={values ? isUnlimitedPlanLimit(values.workspaceLimit) : false}
      />
      <div>
        <Label htmlFor={`${idPrefix}-price`}>Display price (USD / month)</Label>
        <Input
          id={`${idPrefix}-price`}
          name="monthlyPrice"
          inputMode="decimal"
          defaultValue={planPriceInput(values?.monthlyPriceCents ?? 0)}
          className="mt-1"
        />
      </div>
      <ModuleChoices modules={modules} selected={values?.moduleIds ?? []} idPrefix={idPrefix} />
    </div>
  );
}

export function PlansConsole({
  plans,
  modules,
  organizations,
  canEdit,
  canModules,
  actions,
}: {
  plans: PlanRow[];
  modules: ModuleChoice[];
  organizations: { id: string; name: string }[];
  canEdit: boolean;
  canModules: boolean;
  actions?: {
    create?: FormAction;
    update?: FormAction;
    archive?: FormAction;
    assign?: FormAction;
    toggleModule?: FormAction;
  };
}) {
  return (
    <div className="min-w-0 space-y-4">
      {plans.length === 0 ? <p className="rounded-lg border border-line bg-white p-4 text-sm">No plans yet.</p> : null}
      <ul className="space-y-4">
        {plans.map((plan) => (
          <li key={plan.id} className="min-w-0 rounded-lg border border-line bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-lg font-semibold">{plan.name}</h2>
              {plan.archived ? <span className="rounded-full bg-canvas px-2 py-1 text-xs font-semibold text-muted">Archived</span> : null}
            </div>
            <p className="pc-break mt-1 text-sm text-muted">
              {formatPlanLimit(plan.seatLimit)} seats · {formatPlanLimit(plan.brandLimit)} brands · {formatPlanLimit(plan.workspaceLimit)} workspaces · {formatPlanPrice(plan.monthlyPriceCents)} / month
            </p>
            <p className="pc-break mt-1 text-sm text-muted">{plan.moduleIds.length > 0 ? plan.moduleIds.join(", ") : "No modules"}</p>
            <p className="mt-1 text-sm text-muted">
              {plan.organizationCount === 1 ? "1 organization" : `${plan.organizationCount} organizations`} · {plan.key}
            </p>
            {canEdit ? (
              <div className="mt-3 space-y-3">
                <details>
                  <summary className="inline-flex min-h-11 min-w-11 cursor-pointer items-center px-3 text-sm font-semibold text-accent">Edit</summary>
                  <form action={actions?.update} className="mt-3 space-y-4">
                    <input type="hidden" name="planId" value={plan.id} />
                    <PlanFields idPrefix={plan.id} modules={modules} values={plan} />
                    <Button type={actions?.update ? "submit" : "button"} className="w-full sm:w-auto">Save plan</Button>
                  </form>
                </details>
                <form action={actions?.archive}>
                  <input type="hidden" name="planId" value={plan.id} />
                  <input type="hidden" name="archived" value={plan.archived ? "0" : "1"} />
                  <Button type={actions?.archive ? "submit" : "button"} variant="secondary" className="w-full sm:w-auto">
                    {plan.archived ? "Restore" : "Archive"}
                  </Button>
                </form>
              </div>
            ) : null}
            {canModules && !canEdit ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {modules.map((module) => {
                  const enabled = plan.moduleIds.includes(module.id);
                  return (
                    <form key={module.id} action={actions?.toggleModule}>
                      <input type="hidden" name="planId" value={plan.id} />
                      <input type="hidden" name="moduleId" value={module.id} />
                      <input type="hidden" name="enabled" value={enabled ? "0" : "1"} />
                      <button type={actions?.toggleModule ? "submit" : "button"} className="inline-flex min-h-11 items-center rounded-full border border-line px-3 text-sm">
                        {module.name}: {enabled ? "on" : "off"}
                      </button>
                    </form>
                  );
                })}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canEdit ? (
        <form action={actions?.create} className="space-y-4 rounded-lg border border-line bg-white p-4">
          <h2 className="text-lg font-semibold">New plan</h2>
          <PlanFields idPrefix="new-plan" modules={modules} />
          <Button type={actions?.create ? "submit" : "button"} className="w-full sm:w-auto">Create plan</Button>
        </form>
      ) : null}
      {canEdit && organizations.length > 0 && plans.some((plan) => !plan.archived) ? (
        <form action={actions?.assign} className="pc-form-row rounded-lg border border-line bg-white p-4">
          <select name="organizationId" aria-label="Organization" className="pc-control w-full">
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>{organization.name}</option>
            ))}
          </select>
          <select name="planId" aria-label="Plan to assign" className="pc-control w-full">
            {plans.filter((plan) => !plan.archived).map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name}</option>
            ))}
          </select>
          <Button type={actions?.assign ? "submit" : "button"} className="w-full sm:w-auto">Assign plan</Button>
        </form>
      ) : null}
    </div>
  );
}
