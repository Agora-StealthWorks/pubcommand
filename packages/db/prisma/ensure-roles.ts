import { rawPrisma } from "../src/client";
import { ensureBuiltInRolesForAll } from "../src/roles";

// Create-only: adds the built-in User and Editor roles to organizations that lack them,
// and any permission the built-in Owner role is missing (never removes anything).
const result = await ensureBuiltInRolesForAll();
console.log(JSON.stringify({ ok: true, ...result }));
await rawPrisma().$disconnect();
