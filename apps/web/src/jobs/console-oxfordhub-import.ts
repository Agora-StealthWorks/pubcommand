import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, normalize, sep } from "node:path";
import { readS3Config } from "@pubcommand/core";
import { importOxfordHub } from "@/features/console/oxfordhub-import";
import { defineJob } from "@/lib/jobs/types";
import { s3Delete, s3Get, s3Put } from "@/lib/s3";

const PREFIX = "platform/oxfordhub";

/**
 * One-off import of the old OxfordHub Promo Analyzer and Packager export into
 * the admin console (features/console/oxfordhub-import.ts). Idle unless
 * platform/oxfordhub/request.json is in the bucket. Downloads every file listed
 * in platform/oxfordhub/manifest.json (one at a time, to disk), runs the import
 * (dry run unless the request says apply), writes platform/oxfordhub/report.json,
 * and deletes the uploaded export after a real import.
 */
export const consoleOxfordhubImport = defineJob({
  name: "console.oxfordhub-import",
  description: "Import the OxfordHub analyzer/Packager export dropped in the platform bucket (idle when there is none).",
  schedule: "*/5 * * * *",
  timeoutMs: 50 * 60_000,
  async run() {
    const config = readS3Config();
    if (!config) return { idle: "no bucket configured" };
    const requestBytes = await s3Get(config, `${PREFIX}/request.json`);
    if (!requestBytes) return { idle: true };
    const request = JSON.parse(Buffer.from(requestBytes).toString("utf8")) as { apply?: boolean };
    await s3Delete(config, `${PREFIX}/request.json`);
    const startedAt = new Date().toISOString();
    const dir = join(tmpdir(), `oxfordhub-${Date.now()}`);
    try {
      const manifestBytes = await s3Get(config, `${PREFIX}/manifest.json`);
      if (!manifestBytes) throw new Error(`No ${PREFIX}/manifest.json in the bucket.`);
      const paths = JSON.parse(Buffer.from(manifestBytes).toString("utf8")) as string[];
      for (const path of paths) {
        const target = normalize(join(dir, path));
        if (!target.startsWith(`${dir}${sep}`)) continue;
        const data = await s3Get(config, `${PREFIX}/data/${path}`);
        if (!data) throw new Error(`Missing ${path} in the bucket.`);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, data);
      }
      const result = await importOxfordHub({ dir, apply: request.apply === true });
      await s3Put(config, `${PREFIX}/report.json`, Buffer.from(JSON.stringify({ ok: true, startedAt, finishedAt: new Date().toISOString(), files: paths.length, ...result }, null, 2)), "application/json");
      if (result.applied) {
        for (const path of paths) await s3Delete(config, `${PREFIX}/data/${path}`).catch(() => undefined);
        await s3Delete(config, `${PREFIX}/manifest.json`);
      }
      return { files: paths.length, applied: result.applied };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await s3Put(config, `${PREFIX}/report.json`, Buffer.from(JSON.stringify({ ok: false, startedAt, finishedAt: new Date().toISOString(), error: message }, null, 2)), "application/json").catch(() => undefined);
      throw error;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
});
