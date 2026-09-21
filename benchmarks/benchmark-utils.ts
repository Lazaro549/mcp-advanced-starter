import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

export const ITERATIONS = Number(process.env["BENCHMARK_ITERATIONS"] ?? 20);
export const CONCURRENCY_LEVELS = [1, 10, 25, 50, 100];
const REQUEST_TIMEOUT_MS = 10_000;

export interface Metrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  requestsPerSecond: number;
  averageLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minimumLatencyMs: number;
  maximumLatencyMs: number;
  errorRate: number;
  errors: string[];
}

export interface BenchmarkMetadata {
  timestamp: string;
  nodeVersion: string;
  operatingSystem: string;
  cpu: string;
  configuration: Record<string, unknown>;
  iterationCount: number;
  workload: string;
}

export interface HttpServerHandle {
  process: ChildProcess;
  url: URL;
}

export interface JsonRpcResponse {
  result?: unknown;
  error?: unknown;
}

export function projectRoot(): string {
  return path.resolve(import.meta.dirname, "..");
}

export function baseMetadata(configuration: Record<string, unknown>, iterationCount: number, workload: string): BenchmarkMetadata {
  return {
    timestamp: new Date().toISOString(),
    nodeVersion: process.version,
    operatingSystem: `${process.platform} ${os.release()} (${os.arch()})`,
    cpu: os.cpus()[0]?.model ?? "unknown",
    configuration,
    iterationCount,
    workload,
  };
}

export function percentile(values: number[], percentileValue: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)] ?? 0;
}

export function calculateMetrics(startedAt: number, latencies: number[], errors: string[]): Metrics {
  const successfulRequests = latencies.length;
  const totalRequests = successfulRequests + errors.length;
  const elapsedSeconds = Math.max((performance.now() - startedAt) / 1000, Number.EPSILON);
  const totalLatency = latencies.reduce((sum, latency) => sum + latency, 0);

  return {
    totalRequests,
    successfulRequests,
    failedRequests: errors.length,
    requestsPerSecond: totalRequests / elapsedSeconds,
    averageLatencyMs: successfulRequests === 0 ? 0 : totalLatency / successfulRequests,
    p50LatencyMs: percentile(latencies, 50),
    p95LatencyMs: percentile(latencies, 95),
    p99LatencyMs: percentile(latencies, 99),
    minimumLatencyMs: latencies.length === 0 ? 0 : Math.min(...latencies),
    maximumLatencyMs: latencies.length === 0 ? 0 : Math.max(...latencies),
    errorRate: totalRequests === 0 ? 0 : errors.length / totalRequests,
    errors: errors.slice(0, 10),
  };
}

export async function measureRequests(
  count: number,
  operation: () => Promise<void>
): Promise<Metrics> {
  const latencies: number[] = [];
  const errors: string[] = [];
  const startedAt = performance.now();

  for (let index = 0; index < count; index++) {
    const requestStartedAt = performance.now();
    try {
      await operation();
      latencies.push(performance.now() - requestStartedAt);
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  return calculateMetrics(startedAt, latencies, errors);
}

export async function measureConcurrentRequests(
  count: number,
  operation: () => Promise<void>
): Promise<Metrics> {
  const latencies: number[] = [];
  const errors: string[] = [];
  const startedAt = performance.now();

  await Promise.all(
    Array.from({ length: count }, async () => {
      const requestStartedAt = performance.now();
      try {
        await operation();
        latencies.push(performance.now() - requestStartedAt);
      } catch (error: unknown) {
        errors.push(error instanceof Error ? error.message : String(error));
      }
    })
  );

  return calculateMetrics(startedAt, latencies, errors);
}

export function initializeRequest(id: number): Record<string, unknown> {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "devnotes-benchmark", version: "1.0.0" },
    },
  };
}

export async function postInitialize(url: URL, id: number): Promise<Response> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(initializeRequest(id)),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${await response.text()}`);
  }

  const responseText = await response.text();
  const dataLine = responseText.split("\n").find((line) => line.startsWith("data: "));
  const body = JSON.parse(dataLine ? dataLine.slice("data: ".length) : responseText) as JsonRpcResponse;
  if (body.error !== undefined || body.result === undefined) {
    throw new Error(`MCP initialize failed: ${JSON.stringify(body.error ?? body)}`);
  }

  return response;
}

export async function startHttpServer(stateless: boolean, port: number): Promise<HttpServerHandle> {
  const serverProcess = spawn(process.execPath, ["node_modules/tsx/dist/cli.mjs", "src/server/http.ts", ...(stateless ? ["--stateless"] : [])], {
    cwd: projectRoot(),
    env: { ...process.env, MCP_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = new URL(`http://127.0.0.1:${port}/mcp`);
  const output: string[] = [];
  serverProcess.stdout?.on("data", (chunk: Buffer) => output.push(chunk.toString()));
  serverProcess.stderr?.on("data", (chunk: Buffer) => output.push(chunk.toString()));

  for (let attempt = 0; attempt < 100; attempt++) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`HTTP server exited before startup: ${output.join("")}`);
    }
    try {
      await fetch(url, { signal: AbortSignal.timeout(200) });
      return { process: serverProcess, url };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  serverProcess.kill();
  throw new Error(`HTTP server did not start: ${output.join("")}`);
}

export async function stopProcess(serverProcess: ChildProcess): Promise<void> {
  if (serverProcess.exitCode !== null) return;
  serverProcess.kill();
  await new Promise<void>((resolve) => {
    serverProcess.once("exit", () => resolve());
    setTimeout(resolve, 1_000);
  });
}

export async function runStdioInitialize(id: number): Promise<void> {
  const client = new Client(
    { name: "devnotes-stdio-benchmark", version: "1.0.0" },
    { capabilities: {} }
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["node_modules/tsx/dist/cli.mjs", "src/server/stdio.ts"],
    cwd: projectRoot(),
    stderr: "pipe",
    env: { ...process.env, BENCHMARK_REQUEST_ID: String(id) },
  });

  try {
    await Promise.race([
      client.connect(transport),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("stdio initialize timed out")), REQUEST_TIMEOUT_MS)),
    ]);
  } finally {
    await client.close();
  }
}

export async function writeJson(pathname: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(pathname), { recursive: true });
  await writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
