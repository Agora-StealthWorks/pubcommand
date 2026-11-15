import { PLATFORM_ROLES } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { Button, Input } from "@pubcommand/ui";
import { Flash, PageHeader } from "@/components/ui";
import { disableStaff, inviteStaff } from "@/server/platform-actions";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const staff = await rawPrisma().platformStaff.findMany({ include: { user: true }, orderBy: { createdAt: "asc" } });
  return (
    <div>
      <PageHeader title="Staff" description="Only a super admin can invite or remove staff, and only from this console. Every staff member must enroll TOTP before the console opens." />
      <Flash error={query.error} notice={query.notice} />
      <form action={inviteStaff} className="mb-6 flex flex-wrap gap-2">
        <Input name="email" type="email" required placeholder="person@onenationfinancial.com" className="max-w-xs" />
        <select name="role" className="h-10 rounded-md border border-line bg-white px-2 text-sm">
          {PLATFORM_ROLES.map((role) => <option key={role}>{role}</option>)}
        </select>
        <Button type="submit">Save staff</Button>
      </form>
      <table className="w-full border-collapse rounded-lg border border-line bg-white text-sm">
        <thead className="text-left text-xs uppercase text-muted">
          <tr><th className="px-3 py-2">Email</th><th>Role</th><th>2FA</th><th></th></tr>
        </thead>
        <tbody>
          {staff.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="px-3 py-2">{row.user.email}</td>
              <td>{row.disabledAt ? "removed" : row.role}</td>
              <td>{row.totpConfirmedAt ? "enrolled" : "pending"}</td>
              <td>
                {row.disabledAt ? null : (
                  <form action={disableStaff}>
                    <input type="hidden" name="userId" value={row.userId} />
                    <button className="text-sm font-semibold text-[#b42318]">Remove</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
