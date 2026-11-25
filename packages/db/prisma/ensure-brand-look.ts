import { syncAllBrandLooks } from "../src/brand-look";
import { rawPrisma } from "../src/client";

// Brings every form theme and Mini-Blog that uses the brand look up to date with its brand's
// branding. Idempotent (writes only what differs).
const result = await syncAllBrandLooks();
console.log(JSON.stringify({ ok: true, ...result }));
await rawPrisma().$disconnect();
