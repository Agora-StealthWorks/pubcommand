import { moduleRegistry } from "@pubcommand/modules";
import type { RedisProbe } from "./redis";

export function createRunnerState(redis: RedisProbe) {
  return {
    status: "ready" as const,
    queue: "not_attached" as const,
    redis,
    jobs: moduleRegistry.jobs(),
  };
}
