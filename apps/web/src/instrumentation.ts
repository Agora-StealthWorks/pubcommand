export async function register() {
  if (process.env.NEXT_PHASE === "phase-production-build") return;
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 16) throw new Error("AUTH_SECRET must be at least 16 characters.");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  if (!process.env.ROOT_DOMAIN) throw new Error("ROOT_DOMAIN is required.");
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobRunner } = await import("./lib/jobs/runner");
    startJobRunner();
    const { startServerSampler } = await import("./features/usage/record");
    startServerSampler();
  }
}
