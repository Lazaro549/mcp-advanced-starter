import path from "node:path";
import {
  ITERATIONS,
  baseMetadata,
  measureRequests,
  postInitialize,
  runStdioInitialize,
  startHttpServer,
  stopProcess,
  writeJson,
  type Metrics,
} from "./benchmark-utils.js";

const WORKLOAD = "One MCP initialize request per measured operation; no external model calls.";
const RESULTS_PATH = path.resolve(import.meta.dirname, "results/transport-results.json");

interface TransportResult {
  transport: string;
  metrics: Metrics;
}

async function measureHttpTransport(stateless: boolean, port: number): Promise<TransportResult> {
  const server = await startHttpServer(stateless, port);
  let requestId = 0;
  try {
    const metrics = await measureRequests(ITERATIONS, async () => {
      const response = await postInitialize(server.url, requestId++);
      if (!stateless) {
        const sessionId = response.headers.get("mcp-session-id");
        if (sessionId) {
          await fetch(server.url, {
            method: "DELETE",
            headers: { "Mcp-Session-Id": sessionId },
            signal: AbortSignal.timeout(10_000),
          });
        }
      }
    });
    return { transport: stateless ? "stateless HTTP" : "stateful HTTP", metrics };
  } finally {
    await stopProcess(server.process);
  }
}

async function main(): Promise<void> {
  const results: TransportResult[] = [];
  let stdioRequestId = 0;
  results.push({
    transport: "stdio",
    metrics: await measureRequests(ITERATIONS, () => runStdioInitialize(stdioRequestId++)),
  });
  results.push(await measureHttpTransport(false, 3100));
  results.push(await measureHttpTransport(true, 3101));

  await writeJson(RESULTS_PATH, {
    metadata: baseMetadata(
      {
        transports: ["stdio", "stateful HTTP", "stateless HTTP"],
        ports: { stateful: 3100, stateless: 3101 },
        percentileMethod: "nearest-rank (ceil(p/100 * n) - 1, clamped)",
      },
      ITERATIONS,
      WORKLOAD
    ),
    results,
  });

  console.log(JSON.stringify({ resultsPath: RESULTS_PATH, results }, null, 2));
}

main().catch((error: unknown) => {
  console.error("Transport benchmark failed:", error);
  process.exitCode = 1;
});
