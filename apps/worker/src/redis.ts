import { Redis } from "ioredis";

export type RedisProbe = "unset" | "ready" | "unreachable";

export async function probeRedis(url = process.env.REDIS_URL): Promise<RedisProbe> {
  if (!url) return "unset";
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    connectTimeout: 2000,
    lazyConnect: true,
    enableOfflineQueue: false,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    return pong === "PONG" ? "ready" : "unreachable";
  } catch {
    return "unreachable";
  } finally {
    client.disconnect();
  }
}
