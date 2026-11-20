import { rawPrisma } from "../src/client";
import { ensureBuiltInMemberRolesForAll } from "../src/roles";

// Create-only: adds the built-in User and Editor roles to organizations that lack them.
const created = await ensureBuiltInMemberRolesForAll();
console.log(JSON.stringify({ ok: true, rolesCreated: created }));
await rawPrisma().$disconnect();
