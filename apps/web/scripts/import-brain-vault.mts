/**
 * Run the brain vault import from a folder (see src/features/console/brain-vault-import.ts).
 *
 *   cd apps/web && DATABASE_URL=… node <tsx cli> scripts/import-brain-vault.mts <vault dir> [--org <slug>] [--apply]
 */
import { rawPrisma } from "@pubcommand/db";
import { importBrainVault } from "../src/features/console/brain-vault-import";

const args = process.argv.slice(2);
const org = args.includes("--org") ? args[args.indexOf("--org") + 1] : undefined;
const dir = args.find((arg, i) => !arg.startsWith("--") && args[i - 1] !== "--org");
if (!dir) throw new Error("Usage: import-brain-vault.mts <vault dir> [--org <slug>] [--apply]");
await importBrainVault({ dir, orgSlug: org, apply: args.includes("--apply"), onLine: (line) => console.log(line) });
await rawPrisma().$disconnect();
