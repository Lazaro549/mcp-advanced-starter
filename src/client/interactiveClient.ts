#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { pathToFileURL } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CallToolResultSchema,
  CreateMessageRequestSchema,
  ElicitRequestSchema,
  ListRootsRequestSchema,
  LoggingMessageNotificationSchema,
} from "@modelcontextprotocol/sdk/types.js";

try {
  process.loadEnvFile();
} catch {
  // Optional — see .env.example. Everything below has a working fallback.
}

const args = process.argv.slice(2);
const useHttp = args.includes("--http");
const rootFlagIndex = args.indexOf("--root");
const rootPath = rootFlagIndex !== -1 ? args[rootFlagIndex + 1] : undefined;

const MCP_PORT = Number(process.env["MCP_PORT"] ?? 3000);
const SAMPLING_MODEL = process.env["MCP_SAMPLING_MODEL"] ?? "claude-haiku-4-5-20251001";
const anthropicApiKey = process.env["ANTHROPIC_API_KEY"];
const anthropic = anthropicApiKey ? new Anthropic({ apiKey: anthropicApiKey }) : undefined;

const rl = createInterface({ input: process.stdin, output: process.stdout });

async function main(): Promise<void> {
  const client = new Client(
    { name: "devnotes-interactive-client", version: "1.0.0" },
    { capabilities: { sampling: {}, roots: {}, elicitation: { form: {} } } }
  );

  registerSamplingHandler(client);
  registerRootsHandler(client);
  registerElicitationHandler(client);
  client.setNotificationHandler(LoggingMessageNotificationSchema, (notification) => {
    const { level, logger, data } = notification.params;
    console.log(`\n[log:${level}]${logger ? ` (${logger})` : ""} ${typeof data === "string" ? data : JSON.stringify(data)}`);
  });

  const transport = useHttp
    ? new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${MCP_PORT}/mcp`))
    : new StdioClientTransport({ command: "npx", args: ["tsx", "src/server/stdio.ts"] });

  console.log(`Connecting via ${useHttp ? `Streamable HTTP (127.0.0.1:${MCP_PORT})` : "stdio (spawning the server)"}...`);
  await client.connect(transport);
  console.log("Connected.\n");

  if (rootPath) console.log(`Roots: offering "${rootPath}" to the server when it asks.`);
  if (!anthropic) console.log("No ANTHROPIC_API_KEY set — sampling requests will get a mocked reply.\n");

  await repl(client);

  await client.close();
  rl.close();
}

function registerSamplingHandler(client: Client): void {
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    const prompt = request.params.messages
      .map((m) => {
        const blocks = Array.isArray(m.content) ? m.content : [m.content];
        return blocks.map((b) => (b.type === "text" ? b.text : `[${b.type} content]`)).join(" ");
      })
      .join("\n\n");

    if (!anthropic) {
      const mock = `[mock completion — set ANTHROPIC_API_KEY for a real one] ${prompt.slice(0, 140)}`;
      return { model: "mock-model", role: "assistant", content: { type: "text", text: mock } };
    }

    console.log(`\n[sampling] Server requested a completion — calling ${SAMPLING_MODEL}...`);
    const response = await anthropic.messages.create({
      model: SAMPLING_MODEL,
      max_tokens: request.params.maxTokens,
      system: request.params.systemPrompt,
      messages: [{ role: "user", content: prompt }],
    });
    const textBlock = response.content.find((block) => block.type === "text");
    return {
      model: response.model,
      role: "assistant",
      content: { type: "text", text: textBlock?.type === "text" ? textBlock.text : "" },
    };
  });
}

function registerRootsHandler(client: Client): void {
  client.setRequestHandler(ListRootsRequestSchema, async () => {
    if (!rootPath) return { roots: [] };
    return { roots: [{ uri: pathToFileURL(rootPath).href, name: rootPath }] };
  });
}

function registerElicitationHandler(client: Client): void {
  client.setRequestHandler(ElicitRequestSchema, async (request) => {
    if (request.params.mode === "url") {
      console.log(`\n[elicitation] Server wants a URL-mode elicitation (${request.params.url}) — declining; this demo client only supports form mode.`);
      return { action: "decline" };
    }

    console.log(`\n[elicitation] ${request.params.message}`);
    const { properties, required = [] } = request.params.requestedSchema;
    const content: Record<string, string> = {};

    for (const [key, fieldSchema] of Object.entries(properties)) {
      const title = "title" in fieldSchema && fieldSchema.title ? fieldSchema.title : key;
      const choices = "enum" in fieldSchema && fieldSchema.enum ? ` [${fieldSchema.enum.join("/")}]` : "";
      const isRequired = required.includes(key);
      const answer = (await rl.question(`  ${title}${choices}${isRequired ? "" : " (optional)"}: `)).trim();

      if (answer.length > 0) content[key] = answer;
      else if (isRequired) {
        console.log("  (left blank — cancelling elicitation)");
        return { action: "cancel" };
      }
    }
    return { action: "accept", content };
  });
}

/** Minimal REPL: list tools, pick one by number, fill in its inputs, see the result, repeat. */
async function repl(client: Client): Promise<void> {
  const { tools } = await client.listTools();

  for (;;) {
    console.log("Available tools:");
    tools.forEach((tool, i) => console.log(`  ${i + 1}. ${tool.name} — ${tool.description ?? ""}`));
    const choice = (await rl.question('\nCall a tool by number, or "quit": ')).trim();
    if (choice === "quit" || choice === "q") return;

    const tool = tools[Number(choice) - 1];
    if (!tool) {
      console.log("Not a valid choice.\n");
      continue;
    }

    const toolArgs = await promptForArgs(tool);
    console.log(`\nCalling ${tool.name}(${JSON.stringify(toolArgs)})...`);

    const result = await client.callTool(
      { name: tool.name, arguments: toolArgs },
      CallToolResultSchema,
      { onprogress: (p) => console.log(`  [progress] ${p.progress}${p.total ? `/${p.total}` : ""}${p.message ? ` — ${p.message}` : ""}`) }
    );

    printToolResult(result);
    console.log();
  }
}

async function promptForArgs(tool: { inputSchema: { properties?: Record<string, unknown>; required?: string[] } }): Promise<Record<string, unknown>> {
  const properties = tool.inputSchema.properties ?? {};
  const required = new Set(tool.inputSchema.required ?? []);
  const result: Record<string, unknown> = {};

  for (const [key, rawSchema] of Object.entries(properties)) {
    const schema = rawSchema as { type?: string; description?: string; items?: { type?: string } };
    const hint = schema.description ? ` — ${schema.description}` : "";
    const answer = (await rl.question(`  ${key}${required.has(key) ? "" : " (optional)"}${hint}: `)).trim();
    if (answer.length === 0) continue;

    if (schema.type === "number" || schema.type === "integer") result[key] = Number(answer);
    else if (schema.type === "boolean") result[key] = answer.toLowerCase() === "true";
    else if (schema.type === "array") result[key] = answer.split(",").map((s) => s.trim());
    else result[key] = answer;
  }
  return result;
}

function printToolResult(result: Awaited<ReturnType<Client["callTool"]>>): void {
  if (!("content" in result) || !Array.isArray(result.content)) {
    console.log("  (unrecognized result shape)");
    return;
  }
  if (result.isError) console.log("  [error]");
  for (const block of result.content) {
    if (block.type === "text") console.log(`  ${block.text}`);
  }
  if ("structuredContent" in result && result.structuredContent) {
    console.log(`  structuredContent: ${JSON.stringify(result.structuredContent, null, 2).split("\n").join("\n  ")}`);
  }
}

main().catch((error: unknown) => {
  console.error("Fatal error in interactive client:", error);
  process.exit(1);
});
