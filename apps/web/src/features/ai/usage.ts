import { tenantDb } from "@pubcommand/db";

/** Record tokens for one AI call so cost is visible per org and app. Never throws. */
export async function logAiUsage(input: {
  organizationId: string;
  moduleId: string;
  feature: string;
  actorId: string | null;
  usage: { model: string; inputTokens: number; outputTokens: number };
}): Promise<void> {
  await tenantDb(input.organizationId)
    .aiUsageLog.create({
      data: {
        organizationId: input.organizationId,
        moduleId: input.moduleId,
        feature: input.feature,
        model: input.usage.model,
        inputTokens: input.usage.inputTokens,
        outputTokens: input.usage.outputTokens,
        createdById: input.actorId,
      },
    })
    .catch((error) => console.error("[ai-usage] could not log usage", error));
}
