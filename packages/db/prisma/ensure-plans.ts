import { rawPrisma } from "../src/client";
import { ensureDefaultPlans } from "../src/plans";

const result = await ensureDefaultPlans();
console.log(JSON.stringify({ ok: true, created: result.created }));
await rawPrisma().$disconnect();
