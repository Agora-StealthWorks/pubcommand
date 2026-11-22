/**
 * Run the OxfordHub import from a staged folder (see stage-oxfordhub.mts and
 * src/features/console/oxfordhub-import.ts).
 *
 *   cd apps/web && DATABASE_URL=… node <tsx cli> scripts/import-oxfordhub.mts <staged dir> [--apply]
 */
import { rawPrisma } from "@pubcommand/db";
import { importOxfordHub } from "../src/features/console/oxfordhub-import";

const dir = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
if (!dir) throw new Error("Usage: import-oxfordhub.mts <staged dir> [--apply]");
await importOxfordHub({ dir, apply: process.argv.includes("--apply"), onLine: (line) => console.log(line) });
await rawPrisma().$disconnect();
