#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { getOAuthProtectedResourceMetadataUrl, mcpAuthMetadataRouter } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Express } from "express";
import { setupAuthServer } from "./auth.js";
import { createServer } from "./createServer.js";
import { InMemoryEventStore } from "./eventStore.js";

try {
  process.loadEnvFile();
} catch {
  // No .env file (or an older Node without process.loadEnvFile) — every
  // setting in .env.example is optional, so this is fine either way.
}

const args = new Set(process.argv.slice(2));
const useOAuth = args.has("--oauth") || args.has("--oauth-strict");
const oauthStrict = args.has("--oauth-strict");
const stateless = args.has("--stateless");

const MCP_PORT = Number(process.env["MCP_PORT"] ?? 3000);
const AUTH_PORT = Number(process.env["AUTH_PORT"] ?? 3001);
const HOST = "127.0.0.1"; // createMcpExpressApp auto-enables DNS-rebinding protection for localhost hosts.

function main(): void {
  const mcpServerUrl = new URL(`http://${HOST}:${MCP_PORT}/mcp`);
  const app = createMcpExpressApp({ host: HOST });

  if (useOAuth) {
    const authServerUrl = new URL(`http://${HOST}:${AUTH_PORT}`);
    // Runs its own listener; hands back the metadata *and* the provider
    // instance so this resource server can verify tokens against the exact
    // same in-memory store that issued them.
    const { metadata: oauthMetadata, provider } = setupAuthServer({
      authServerUrl,
      mcpServerUrl,
      strictResource: oauthStrict,
    });

    app.use(
      mcpAuthMetadataRouter({
        oauthMetadata,
        resourceServerUrl: mcpServerUrl,
        scopesSupported: ["mcp:tools"],
        resourceName: "DevNotes MCP",
      })
    );

    app.use(
      "/mcp",
      requireBearerAuth({
        verifier: provider,
        requiredScopes: ["mcp:tools"],
        resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(mcpServerUrl),
      })
    );

    console.log(`OAuth 2.1 + PKCE enforcement ON${oauthStrict ? " (strict resource checking)" : ""}.`);
    console.log(`Authorization server: ${authServerUrl.origin}`);
  }

  if (stateless) {
    registerStatelessMcpRoute(app);
    console.log("Mode: stateless — no session id, no resumability, horizontally scalable.");
  } else {
    registerStatefulMcpRoute(app);
    console.log("Mode: stateful — session id issued, resumable via Last-Event-ID.");
  }

  app.listen(MCP_PORT, HOST, () => {
    console.log(`DevNotes MCP server (Streamable HTTP) listening on ${mcpServerUrl.origin}/mcp`);
    if (!useOAuth) console.log("(No auth — pass --oauth to require a bearer token.)");
  });
}

/**
 * Stateless mode: no session id is ever issued, so there is nowhere to keep
 * a server instance between requests — a fresh McpServer + transport pair is
 * built, connected, and torn down for every single request. That statelessness
 * is exactly what makes it trivial to run behind a load balancer with no
 * sticky sessions; the cost is that resumability and server-initiated
 * requests that outlive one HTTP exchange (a slow sampling round-trip
 * spanning a reconnect, for instance) aren't supported.
 */
function registerStatelessMcpRoute(app: Express): void {
  app.post("/mcp", async (req, res) => {
    const server = createServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  const methodNotAllowed = (_req: IncomingMessage, res: ServerResponse) => {
    res.writeHead(405, { "Content-Type": "application/json" }).end(
      JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32000, message: "Method not allowed in stateless mode (no sessions to address)." },
        id: null,
      })
    );
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);
}

/**
 * Stateful mode: the first request (MCP `initialize`) gets a fresh server,
 * a fresh transport backed by the shared InMemoryEventStore, and a session
 * id; every later request for that session is routed to the same transport.
 * GET opens the long-lived SSE stream the server uses to push notifications
 * and server-initiated requests (sampling, elicitation, roots); DELETE ends
 * the session on purpose instead of waiting for it to time out.
 */
function registerStatefulMcpRoute(app: Express): void {
  const transports = new Map<string, StreamableHTTPServerTransport>();
  const eventStore = new InMemoryEventStore();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (!transport && !sessionId && isInitializeRequest(req.body)) {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        eventStore,
        onsessioninitialized: (id) => {
          transports.set(id, transport as StreamableHTTPServerTransport);
        },
        onsessionclosed: (id) => {
          transports.delete(id);
        },
      });
      const server = createServer();
      await server.connect(transport);
    } else if (!transport) {
      res.writeHead(sessionId ? 404 : 400, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: sessionId ? "Session not found." : "Missing Mcp-Session-Id header." },
          id: null,
        })
      );
      return;
    }

    await transport.handleRequest(req, res, req.body);
  });

  const forwardToSession = async (req: IncomingMessage, res: ServerResponse) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.writeHead(404, { "Content-Type": "application/json" }).end(
        JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Session not found." }, id: null })
      );
      return;
    }
    await transport.handleRequest(req, res);
  };
  app.get("/mcp", forwardToSession);
  app.delete("/mcp", forwardToSession);
}

main();
