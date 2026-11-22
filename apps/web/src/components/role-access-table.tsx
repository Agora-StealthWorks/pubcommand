"use client";

import {
  ROLE_APP_LEVEL_LABELS,
  SELF_LOCKOUT_PERMISSIONS,
  isRoleAppLevel,
  roleAppLevel,
  roleAppLevelPermissions,
  type ClassifiedPermission,
} from "@pubcommand/core";
import { Button } from "@pubcommand/ui";
import { useMemo, useState } from "react";
import type { RoleAccessSection } from "@/lib/role-access";

export type RoleColumn = {
  id: string;
  name: string;
  /** Owner: shown, never editable. */
  locked: boolean;
  /** The signed-in admin's own role (cannot lose user / role management). */
  mine: boolean;
  note?: string;
};

type Props = {
  section: RoleAccessSection;
  roles: RoleColumn[];
  granted: Record<string, string[]>;
  action: (formData: FormData) => void | Promise<void>;
  savedMessage?: string;
};

/** One app's table on Settings → Roles & access: a level per role, and every permission under "Advanced". */
export function RoleAccessTable({ section, roles, granted, action, savedMessage }: Props) {
  const initial = useMemo(() => Object.fromEntries(roles.map((role) => [role.id, [...(granted[role.id] ?? [])].sort()])), [roles, granted]);
  const [state, setState] = useState<Record<string, string[]>>(initial);
  const hasLevels = section.levels.length > 0;
  const [advanced, setAdvanced] = useState(!hasLevels);
  const classified: ClassifiedPermission[] = section.permissions.map((permission) => ({ key: permission.key, moduleId: section.id, access: permission.access }));
  const dirty = roles.some((role) => !role.locked && (state[role.id] ?? []).join() !== (initial[role.id] ?? []).join());

  const setRole = (roleId: string, keys: string[]) => setState((prev) => ({ ...prev, [roleId]: [...new Set(keys)].sort() }));
  const toggle = (roleId: string, key: string, on: boolean) => {
    const current = state[roleId] ?? [];
    setRole(roleId, on ? [...current, key] : current.filter((item) => item !== key));
  };
  const lockedOff = (role: RoleColumn, key: string) => role.mine && SELF_LOCKOUT_PERMISSIONS.includes(key) && (initial[role.id] ?? []).includes(key);
  const groups = [...new Set(section.permissions.map((permission) => permission.group))];

  return (
    <section id={`access-${section.id}`} className="scroll-mt-4 rounded-xl border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold">
          <span aria-hidden className="text-xl">
            {section.icon}
          </span>
          {section.name}
        </h2>
        {hasLevels ? (
          <button
            type="button"
            onClick={() => setAdvanced((value) => !value)}
            aria-expanded={advanced}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-accent"
          >
            {advanced ? "Hide details" : "Advanced: each permission"}
          </button>
        ) : (
          <p className="text-sm text-muted">Admin tools. Tick what each role may do.</p>
        )}
      </div>
      {savedMessage ? <p className="mt-2 rounded-md border border-[#abefc6] bg-[#ecfdf3] px-3 py-2 text-sm text-[#067647]">{savedMessage}</p> : null}
      <form action={action} className="mt-3">
        <input type="hidden" name="section" value={section.id} />
        {roles
          .filter((role) => !role.locked)
          .map((role) => (
            <span key={role.id}>
              <input type="hidden" name="roleId" value={role.id} />
              {(state[role.id] ?? []).map((key) => (
                <input key={key} type="hidden" name="grant" value={`${role.id}|${key}`} />
              ))}
            </span>
          ))}
        <div className="pc-scroll">
          <table className="w-full border-collapse text-sm" style={{ minWidth: `${12 + roles.length * 7.5}rem` }}>
            <thead>
              <tr className="bg-canvas text-left text-xs font-semibold text-muted">
                <th scope="col" className="px-3 py-2 font-semibold">
                  {hasLevels ? "Role" : "Permission"}
                </th>
                {roles.map((role) => (
                  <th key={role.id} scope="col" className="px-2 py-2 align-bottom font-semibold">
                    <span className="block text-ink">{role.name}</span>
                    {role.note ? <span className="block text-[11px] font-normal">{role.note}</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hasLevels ? (
                <tr className="border-t border-line">
                  <th scope="row" className="px-3 py-2 text-left font-semibold">
                    Access
                  </th>
                  {roles.map((role) => {
                    const current = state[role.id] ?? [];
                    const level = roleAppLevel(section.id, (key) => current.includes(key), classified);
                    return (
                      <td key={role.id} className="px-2 py-2">
                        <select
                          aria-label={`${section.name} access for ${role.name}`}
                          className="pc-control w-full min-w-[6.5rem]"
                          value={level}
                          disabled={role.locked}
                          onChange={(event) => {
                            const next = event.target.value;
                            if (!isRoleAppLevel(next)) return;
                            const keep = current.filter((key) => lockedOff(role, key));
                            setRole(role.id, [...roleAppLevelPermissions(section.id, next, classified), ...keep]);
                          }}
                        >
                          {level === "CUSTOM" ? (
                            <option value="CUSTOM" disabled>
                              Custom
                            </option>
                          ) : null}
                          {section.levels.map((option) => (
                            <option key={option} value={option}>
                              {ROLE_APP_LEVEL_LABELS[option]}
                            </option>
                          ))}
                        </select>
                      </td>
                    );
                  })}
                </tr>
              ) : null}
              {advanced
                ? groups.map((group) => (
                    <PermissionRows
                      key={group ?? "all"}
                      group={group}
                      permissions={section.permissions.filter((permission) => permission.group === group)}
                      roles={roles}
                      state={state}
                      toggle={toggle}
                      lockedOff={lockedOff}
                      span={roles.length + 1}
                    />
                  ))
                : null}
            </tbody>
          </table>
        </div>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button type="submit" disabled={!dirty} className="w-full sm:w-auto">
            Save {section.name}
          </Button>
          {dirty ? (
            <span className="text-sm text-[#93370d]">Unsaved changes</span>
          ) : (
            <span className="text-sm text-muted">{hasLevels ? "Change a level, then save." : "Tick boxes, then save."}</span>
          )}
        </div>
      </form>
    </section>
  );
}

function PermissionRows({
  group,
  permissions,
  roles,
  state,
  toggle,
  lockedOff,
  span,
}: {
  group: string | null;
  permissions: RoleAccessSection["permissions"];
  roles: RoleColumn[];
  state: Record<string, string[]>;
  toggle: (roleId: string, key: string, on: boolean) => void;
  lockedOff: (role: RoleColumn, key: string) => boolean;
  span: number;
}) {
  return (
    <>
      {group ? (
        <tr className="border-t border-line bg-canvas">
          <th scope="colgroup" colSpan={span} className="px-3 py-1.5 text-left text-xs font-semibold uppercase tracking-wide text-muted">
            {group}
          </th>
        </tr>
      ) : null}
      {permissions.map((permission) => (
        <tr key={permission.key} className="border-t border-line">
          <th scope="row" className="px-3 py-2 text-left font-normal">
            <span className="pc-break block">{permission.description}</span>
            <code className="text-[11px] text-muted">{permission.key}</code>
          </th>
          {roles.map((role) => {
            const on = (state[role.id] ?? []).includes(permission.key);
            const pinned = lockedOff(role, permission.key);
            return (
              <td key={role.id} className="px-2 py-2">
                <label className="inline-flex min-h-11 min-w-11 items-center justify-center" title={pinned ? "You cannot remove this from your own role." : undefined}>
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-[var(--accent,#2f5bea)]"
                    checked={on}
                    disabled={role.locked || pinned}
                    onChange={(event) => toggle(role.id, permission.key, event.target.checked)}
                    aria-label={`${role.name}: ${permission.description}`}
                  />
                </label>
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
