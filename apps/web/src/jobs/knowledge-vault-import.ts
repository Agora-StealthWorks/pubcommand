import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { readS3Config } from "@pubcommand/core";
import { unzipSync } from "fflate";
import { importBrainVault } from "@/features/console/brain-vault-import";
import { defineJob } from "@/lib/jobs/types";
import { s3Delete, s3Get, s3Put } from "@/lib/s3";

/** Bucket keys: staff (or Claude) drop a vault zip and a request; the job imports and writes a report. */
export const VAULT_IMPORT_PREFIX = "platform/brain-vault";
const REQUEST_KEY = `${VAULT_IMPORT_PREFIX}/request.json`;
const ZIP_KEY = `${VAULT_IMPORT_PREFIX}/vault.zip`;
const REPORT_KEY = `${VAULT_IMPORT_PREFIX}/report.json`;

type VaultImportRequest = { apply?: boolean; org?: string | null };

/**
 * Brain vault import, run inside the app (it needs the database). Idle unless
 * platform/brain-vault/request.json is in the bucket. Then it unpacks
 * platform/brain-vault/vault.zip, runs importBrainVault (dry run unless the
 * request says apply), writes platform/brain-vault/report.json, and removes the
 * request (and the zip after a real import). See features/console/brain-vault-import.ts.
 */
export const knowledgeVaultImport = defineJob({
  name: "knowledge.vault-import",
  description: "Import a brain vault zip dropped in the platform bucket (idle when there is none).",
  schedule: "*/5 * * * *",
  timeoutMs: 40 * 60_000,
  async run() {
    const config = readS3Config();
    if (!config) return { idle: "no bucket configured" };
    const requestBytes = await s3Get(config, REQUEST_KEY);
    if (!requestBytes) return { idle: true };
    const request = JSON.parse(Buffer.from(requestBytes).toString("utf8")) as VaultImportRequest;
    const startedAt = new Date().toISOString();
    // Take the request first so a second server or slot does not run it too.
    await s3Delete(config, REQUEST_KEY);
    const dir = join(tmpdir(), `brain-vault-${Date.now()}`);
    try {
      const zip = await s3Get(config, ZIP_KEY);
      if (!zip) throw new Error(`No ${ZIP_KEY} in the bucket.`);
      const files = unzipSync(zip);
      let count = 0;
      for (const [name, data] of Object.entries(files)) {
        if (name.endsWith("/")) continue;
        const target = normalize(join(dir, name));
        if (!target.startsWith(`${dir}${sep}`)) continue; // never write outside the folder
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
        count += 1;
      }
      const result = await importBrainVault({ dir, orgSlug: request.org ?? null, apply: request.apply === true });
      await s3Put(config, REPORT_KEY, Buffer.from(JSON.stringify({ ok: true, startedAt, finishedAt: new Date().toISOString(), files: count, ...result }, null, 2)), "application/json");
      if (result.applied) await s3Delete(config, ZIP_KEY);
      return { files: count, applied: result.applied, lines: result.lines.length };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await s3Put(config, REPORT_KEY, Buffer.from(JSON.stringify({ ok: false, startedAt, finishedAt: new Date().toISOString(), error: message }, null, 2)), "application/json").catch(() => undefined);
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});
