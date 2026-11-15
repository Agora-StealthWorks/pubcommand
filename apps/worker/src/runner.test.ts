import { describe, expect, it } from "vitest";
import { createRunnerState } from "./runner";

describe("worker runner", () => {
  it("boots ready without attaching a queue", () => {
    const state = createRunnerState("unset");
    expect(state.status).toBe("ready");
    expect(state.queue).toBe("not_attached");
    expect(state.jobs.some((job) => job.name === "example.ping")).toBe(true);
  });
});
