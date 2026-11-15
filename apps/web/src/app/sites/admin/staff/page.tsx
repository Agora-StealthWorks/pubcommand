import { PLATFORM_ROLES } from "@pubcommand/core";
import { rawPrisma } from "@pubcommand/db";
import { Button, Input } from "@pubcommand/ui";
import { TableScroll } from "@/components/table-scroll";
import { Flash, PageHeader } from "@/components/ui";
import { disableStaff, inviteStaff } from "@/server/platform-actions";

export default async function StaffPage({ searchParams }: { searchParams: Promise<{ error?: string; notice?: string }> }) {
  const query = await searchParams;
  const staff = await rawPrisma().platformStaff.findMany({ include: { user: true }, orderBy: { createdAt: "asc" } });
  return (
    <div>
      <PageHeader title="Staff" description="Only a super admin can invite or remove staff, and only from this console. Every staff member must enroll TOTP before the console opens." />
      <Flash error={query.error} notice={query.notice} />
      <form action={inviteStaff} className="pc-form-row mb-6">
        <Input name="email" type="email" required placeholder="person@onenationfinancial.com" className="md:max-w-xs" />
        <select name="role" className="pc-control w-full md:w-auto">
          {PLATFORM_ROLES.map((role) => <option key={role}>{role}</option>)}
        </select>
        <Button type="submit" className="w-full md:w-auto">Save staff</Button>
      </form>
      <TableScroll>
      <table className="w-full min-w-[36rem] border-collapse text-sm">
        <thead className="text-left text-xs uppercase text-muted">
          <tr><th className="px-3 py-2">Email</th><th>Role</th><th>2FA</th><th></th></tr>
        </thead>
        <tbody>
          {staff.map((row) => (
            <tr key={row.id} className="border-t border-line">
              <td className="pc-break px-3 py-2">{row.user.email}</td>
              <td>{row.disabledAt ? "removed" : row.role}</td>
              <td>{row.totpConfirmedAt ? "enrolled" : "pending"}</td>
              <td>
                {row.disabledAt ? null : (
                  <form action={disableStaff}>
                    <input type="hidden" name="userId" value={row.userId} />
                    <button className="inline-flex min-h-11 items-center text-sm font-semibold text-[#b42318]">Remove</button>
                  </form>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
    </div>
  );
}
