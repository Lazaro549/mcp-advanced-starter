import path from "node:path";
import {
  CONCURRENCY_LEVELS,
  baseMetadata,
  measureConcurrentRequests,
  postInitialize,
  startHttpServer,
  stopProcess,
  writeJson,
  type Metrics,
} from "./benchmark-utils.js";

const WORKLOAD = "Concurrent MCP initialize requests against the stateful Streamable HTTP server; no external model calls.";
const RESULTS_PATH = path.resolve(import.meta.dirname, "results/concurrency-results.json");

interface ConcurrencyResult {
  concurrency: number;
  metrics: Metrics;
}

async function main(): Promise<void> {
  const server = await startHttpServer(false, 3102);
  const results: ConcurrencyResult[] = [];

  try {
    for (const concurrency of CONCURRENCY_LEVELS) {
      let requestId = concurrency * 1_000;
      const metrics = await measureConcurrentRequests(concurrency, async () => {
        const response = await postInitialize(server.url, requestId++);
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId) {
          await fetch(server.url, {
            method: "DELETE",
            headers: { "Mcp-Session-Id": sessionId },
            signal: AbortSignal.timeout(10_000),
          });
        }
      });
      results.push({ concurrency, metrics });
      console.log(`${concurrency} concurrent requests: ${metrics.requestsPerSecond.toFixed(2)} requests/sec, ${metrics.errorRate * 100}% errors`);
    }
  } finally {
    await stopProcess(server.process);
  }

  await writeJson(RESULTS_PATH, {
    metadata: baseMetadata(
      {
        transport: "stateful Streamable HTTP",
        concurrencyLevels: CONCURRENCY_LEVELS,
        percentileMethod: "nearest-rank (ceil(p/100 * n) - 1, clamped)",
      },
      CONCURRENCY_LEVELS.reduce((sum, level) => sum + level, 0),
      WORKLOAD
    ),
    results,
  });

  console.log(JSON.stringify({ resultsPath: RESULTS_PATH, results }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Concurrency benchmark failed:", error);
  process.exitCode = 1;
});
