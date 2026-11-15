import { describe, expect, it } from "vitest";
import { readS3Config, storagePrefix } from "./storage";

describe("storagePrefix", () => {
  it("builds the per-org prefix and an object key", () => {
    expect(storagePrefix({ organizationId: "org_1" })).toBe("org/org_1/");
    expect(
      storagePrefix({
        organizationId: "org_1",
        brandId: "brand_1",
        workspaceId: "ws_1",
        moduleId: "forms",
        objectKey: "exports/leads.csv",
      }),
    ).toBe("org/org_1/brand/brand_1/workspace/ws_1/forms/exports/leads.csv");
  });

  it("rejects a workspace key without a brand", () => {
    expect(() => storagePrefix({ organizationId: "org_1", workspaceId: "ws_1" })).toThrow(/brandId/);
  });
});

describe("readS3Config", () => {
  it("returns null until every bucket variable is present", () => {
    expect(readS3Config({})).toBeNull();
    expect(readS3Config({ S3_ENDPOINT: "https://storage.example" })).toBeNull();
    expect(
      readS3Config({
        S3_ENDPOINT: "https://storage.example",
        S3_BUCKET: "bucket",
        S3_ACCESS_KEY_ID: "key",
        S3_SECRET_ACCESS_KEY: "secret",
        S3_REGION: "auto",
      })?.bucket,
    ).toBe("bucket");
  });
});
