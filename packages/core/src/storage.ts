const SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;

function assertSegment(label: string, value: string): void {
  if (!SEGMENT.test(value)) throw new Error(`Invalid storage ${label}`);
}

/**
 * Per-org object key prefix. Phase 1 documents and builds the key only.
 * Objects live at:
 * org/{organizationId}/brand/{brandId}/workspace/{workspaceId}/{moduleId}/{object}
 */
export function storagePrefix(input: {
  organizationId: string;
  brandId?: string | null;
  workspaceId?: string | null;
  moduleId?: string | null;
  objectKey?: string | null;
}): string {
  assertSegment("organizationId", input.organizationId);
  const parts = ["org", input.organizationId];
  if (input.brandId) {
    assertSegment("brandId", input.brandId);
    parts.push("brand", input.brandId);
  }
  if (input.workspaceId) {
    if (!input.brandId) throw new Error("workspace storage keys require a brandId");
    assertSegment("workspaceId", input.workspaceId);
    parts.push("workspace", input.workspaceId);
  }
  if (input.moduleId) {
    assertSegment("moduleId", input.moduleId);
    parts.push(input.moduleId);
  }
  if (input.objectKey) {
    const objectParts = input.objectKey.split("/").filter((part) => part.length > 0);
    if (objectParts.length === 0) throw new Error("Invalid storage objectKey");
    for (const part of objectParts) assertSegment("objectKey", part);
    parts.push(...objectParts);
    return parts.join("/");
  }
  return `${parts.join("/")}/`;
}

export type S3Config = {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
};

export function readS3Config(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const endpoint = env.S3_ENDPOINT?.trim() ?? "";
  const bucket = env.S3_BUCKET?.trim() ?? "";
  const accessKeyId = env.S3_ACCESS_KEY_ID?.trim() ?? "";
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY?.trim() ?? "";
  const region = env.S3_REGION?.trim() ?? "";
  if (!endpoint && !bucket && !accessKeyId && !secretAccessKey && !region) return null;
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey || !region) return null;
  return { endpoint, bucket, accessKeyId, secretAccessKey, region };
}
