#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./createServer.js";

/**
 * stdio transport: the server's stdin/stdout *are* the protocol channel, so
 * nothing may write to stdout except JSON-RPC messages — that's why every
 * log line below goes to stderr. This is the transport Claude Desktop and
 * the MCP Inspector use to launch local servers as a child process; there's
 * no networking, no auth, no concurrent sessions. One process, one client.
 */
async function main(): Promise<void> {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("DevNotes MCP server running on stdio.");
}

main().catch((error: unknown) => {
  console.error("Fatal error starting stdio server:", error);
  process.exit(1);
});
