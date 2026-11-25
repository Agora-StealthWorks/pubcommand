import { DEFAULT_IDLE_TIMEOUT_MINUTES, IDLE_TIMEOUT_CHOICES, formatDuration, idleTimeoutLabel, idleTimeoutMinutes } from "@pubcommand/core";
import { Button } from "@pubcommand/ui";
import Link from "next/link";
import { when } from "./parts";
import type { UserUsage } from "./stats";

/** Console → Users → a person: sign-ins, how often they use PubCommand, and their idle sign-out time. */
export function UserUsageSection({ userId, usage, days, canEdit, action }: { userId: string; usage: UserUsage; days: number; canEdit: boolean; action: (formData: FormData) => Promise<void> }) {
  const current = idleTimeoutMinutes(usage.idleTimeoutMinutes);
  const choices = IDLE_TIMEOUT_CHOICES.some((choice) => choice.minutes === current) ? IDLE_TIMEOUT_CHOICES : [...IDLE_TIMEOUT_CHOICES, { minutes: current, label: idleTimeoutLabel(current) }];
  return (
    <section className="rounded-xl border border-line bg-white p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Sign-ins and usage</h2>
        <Link href={`/usage/activity?days=${days}`} className="text-sm text-accent hover:underline">Activity</Link>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-muted">Sign-ins (all time)</dt><dd className="text-lg font-semibold tabular-nums">{usage.loginsAllTime}</dd></div>
        <div><dt className="text-muted">Sign-ins ({days}d)</dt><dd className="text-lg font-semibold tabular-nums">{usage.loginsInRange}</dd></div>
        <div><dt className="text-muted">Days active ({days}d)</dt><dd className="text-lg font-semibold tabular-nums">{usage.activeDays}</dd></div>
        <div><dt className="text-muted">Time in the app ({days}d)</dt><dd className="text-lg font-semibold tabular-nums">{formatDuration(usage.activeSeconds)}</dd></div>
        <div><dt className="text-muted">Made / changed ({days}d)</dt><dd className="text-lg font-semibold tabular-nums">{usage.actions}</dd></div>
        <div><dt className="text-muted">Page views ({days}d)</dt><dd className="text-lg font-semibold tabular-nums">{usage.views}</dd></div>
        <div><dt className="text-muted">Last sign-in</dt><dd>{when(usage.lastLoginAt)}</dd></div>
        <div><dt className="text-muted">Last active</dt><dd>{when(usage.lastActiveAt)}</dd></div>
      </dl>
      {usage.apps.length ? (
        <p className="mt-3 text-sm"><span className="text-muted">Apps:</span> {usage.apps.map((app) => `${app.name} ${formatDuration(app.activeSeconds)}`).join(" · ")}</p>
      ) : null}
      {usage.recentLogins.length ? (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer text-accent">Recent sign-ins</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {usage.recentLogins.map((login) => (
              <li key={login.at} className="pc-break">{when(login.at)} · {login.method.replace(/_/g, " ")} · {login.site}{login.userAgent ? ` · ${login.userAgent.slice(0, 90)}` : ""}</li>
            ))}
          </ul>
        </details>
      ) : null}
      <form action={action} className="mt-4 flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <input type="hidden" name="userId" value={userId} />
        <label className="text-sm">
          <span className="block font-medium">Sign out after inactivity</span>
          <select name="minutes" defaultValue={String(current)} disabled={!canEdit} className="mt-1 min-h-11 rounded-md border border-line bg-white px-3 text-sm">
            {choices.map((choice) => (
              <option key={choice.minutes} value={choice.minutes === DEFAULT_IDLE_TIMEOUT_MINUTES ? "default" : String(choice.minutes)}>{choice.label}</option>
            ))}
          </select>
        </label>
        {canEdit ? <Button type="submit" variant="secondary">Save</Button> : null}
        <p className="w-full text-xs text-muted">Default 12 hours. Takes effect on their next request; open sessions idle longer than this end.</p>
      </form>
    </section>
  );
}
