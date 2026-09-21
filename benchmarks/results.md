# Benchmark Results

This document is populated from the JSON files produced by the benchmark commands. Run both commands before interpreting performance:

```bash
npm run benchmark:transport
npm run benchmark:concurrency
```

The generated files are `benchmarks/results/transport-results.json` and `benchmarks/results/concurrency-results.json`. No measured results are included until the benchmarks have been run on the target machine.

## Benchmark methodology

- Environment details, including Node.js version, operating system, CPU, timestamp, and configuration, are captured in each JSON result.
- The workload is one real MCP `initialize` JSON-RPC request per operation. It avoids external model calls and interactive elicitation.
- Transport benchmarks use the project stdio server as a child process and the project stateful/stateless Streamable HTTP servers as child processes.
- The concurrency benchmark sends initialize requests concurrently to the real stateful Streamable HTTP server at levels 1, 10, 25, 50, and 100.
- Latency percentiles use nearest-rank selection: `ceil(percentile / 100 * sampleCount) - 1`, clamped to the measured sample range.
- Throughput is total requests divided by wall-clock elapsed seconds, including failed requests.
- The stateless route is intentionally measured using one request per fresh transport. The current SDK transport contract does not allow a fresh stateless server/transport to receive a later tool call after initialization.

## Transport benchmark

Measured on 2026-09-21 with Node.js v22.18.0 on Windows 10.0.19045, x64, Intel Core i7-8700K. Each transport completed 20/20 requests successfully.

| Transport | Avg (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Throughput (req/s) | Errors |
|---|---:|---:|---:|---:|---:|---:|
| stdio | 821.21 | 816.75 | 838.65 | 855.86 | 1.22 | 0 |
| stateful HTTP | 6.92 | 4.77 | 10.25 | 39.93 | 144.42 | 0 |
| stateless HTTP | 5.89 | 4.31 | 6.98 | 33.86 | 169.86 | 0 |

## Concurrency benchmark

Measured on 2026-09-21 with Node.js v22.18.0 on Windows 10.0.19045, x64, Intel Core i7-8700K. All 186 requests succeeded.

| Concurrency | Avg (ms) | P50 (ms) | P95 (ms) | P99 (ms) | Throughput (req/s) | Error rate |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 37.57 | 37.57 | 37.57 | 37.57 | 26.52 | 0% |
| 10 | 52.77 | 52.44 | 54.01 | 54.01 | 177.70 | 0% |
| 25 | 58.01 | 70.74 | 72.09 | 72.34 | 323.54 | 0% |
| 50 | 111.97 | 99.37 | 138.86 | 138.92 | 344.65 | 0% |
| 100 | 189.40 | 215.26 | 256.86 | 257.89 | 372.49 | 0% |

## Engineering interpretation

- **Measured results:** stdio averaged 821.21 ms at 1.22 requests/sec; stateful HTTP averaged 6.92 ms at 144.42 requests/sec; stateless HTTP averaged 5.89 ms at 169.86 requests/sec. All transport samples succeeded.
- **Observations:** stdio's p50 and p99 were close to its average because every operation includes launching a fresh server process. Stateless HTTP was faster than stateful HTTP in this sample, while both had occasional high-tail samples. In the concurrency run, p99 increased from 37.57 ms at concurrency 1 to 257.89 ms at concurrency 100, while throughput increased from 26.52 to 372.49 requests/sec and error rate remained 0%.
- **Engineering interpretation:** stdio is appropriate for local single-client integrations where process isolation and simple wiring matter more than per-request startup cost. Stateful HTTP is the appropriate choice when session continuity and resumability are required. Stateless HTTP showed lower initialization latency and higher initialization throughput in this run, consistent with lower per-request session bookkeeping, and its independent-request design is easier to distribute horizontally. These measurements do not prove that stateless mode will scale linearly across machines.
- **Limitations:** the concurrency workload exercises initialize exchanges, not a multi-request tool session. The current stateless implementation recreates its server and transport per POST, so a standard client cannot initialize in one request and call a tool in a later request without changing that architecture. The measured stateful HTTP operation also includes session DELETE cleanup.

## Limitations

Results depend on local CPU load, filesystem/process startup cost, Node.js version, operating system scheduling, warm-up effects, sample size, and port/network conditions. The workload does not call Anthropic or any other external model, so it does not measure sampling latency. OAuth is excluded because dynamic client registration, redirect handling, PKCE, and token exchange are a separate multi-step flow whose timing would add fragile client-flow variability to this transport comparison. The benchmark does not test a distributed deployment, TLS termination, or cross-machine horizontal scaling. The stateless limitation described above also means these are transport initialization measurements rather than end-to-end multi-request tool-session measurements.
