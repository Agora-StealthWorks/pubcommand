import { ensureSuperadmin } from "../src/superadmin";

const result = await ensureSuperadmin();
console.log(
  JSON.stringify({
    ok: true,
    email: result.email,
    createdStaff: result.createdStaff,
  }),
);
