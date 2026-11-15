import { createServer } from "node:http";
import { probeRedis } from "./redis";
import { createRunnerState } from "./runner";

const redis = await probeRedis();
const state = createRunnerState(redis);
const port = Number(process.env.PORT ?? 3001);

createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, service: "worker", ...state }));
    return;
  }
  response.writeHead(404);
  response.end();
}).listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      msg: "worker ready",
      port,
      queue: state.queue,
      redis: state.redis,
      jobs: state.jobs.length,
    }),
  );
});
