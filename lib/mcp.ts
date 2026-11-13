// The Model Context Protocol, the small part of it this app speaks, by hand.
// Same reasoning as googleCalendar.ts calling Google over fetch: a few dozen lines
// of JSON-RPC beat a dependency and its transitive tree. Pure (unit-tested in
// tests/unit/mcp.test.ts); POST /api/mcp is the transport.
//
// What it is: a STATELESS "Streamable HTTP" server with tools only. Each POST
// carries one JSON-RPC message (or a batch) and gets a plain JSON reply — no
// sessions, no server-sent events, no prompts or resources. Reading tools take
// no arguments and return a section of the access key's snapshot
// (lib/agentSnapshot.ts); a key made "can act for me" also gets the
// writing tools, which declare their arguments as JSON Schema. Mirrors the
// vff-app (dwongbound/vff-app) server of the same name.

export const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-11-25",
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
] as const;
const LATEST = SUPPORTED_PROTOCOL_VERSIONS[0];

export interface McpTool {
  name: string;
  title: string;
  description: string;
  /** JSON Schema for the arguments. Absent = the tool takes none. */
  inputSchema?: Record<string, unknown>;
  /** False for a tool that changes something. Absent = read-only. */
  readOnly?: boolean;
  /** True for a tool that undoes something (giving up a seat). */
  destructive?: boolean;
}

const NO_ARGUMENTS = { type: "object", properties: {}, additionalProperties: false };

export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

type JsonRpcResponse =
  | { jsonrpc: "2.0"; id: string | number | null; result: unknown }
  | { jsonrpc: "2.0"; id: string | number | null; error: { code: number; message: string } };

// JSON-RPC's own error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

export interface McpServer {
  name: string;
  version: string;
  /** Shown to the model once, at initialize: what this server is for. */
  instructions: string;
  tools: McpTool[];
  /**
   * Runs a tool the client named with the arguments it sent (always an object,
   * {} when none came); its result is sent back as JSON text. A throw becomes
   * a tool error the model reads, with the thrown message as its text.
   */
  callTool: (name: string, args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * One POST body → the replies to send, or null when there is nothing to say
 * (only notifications, which the transport answers with 202 and no body).
 */
export async function handleMcp(
  server: McpServer,
  body: unknown
): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
  if (Array.isArray(body)) {
    if (body.length === 0) return errorReply(null, INVALID_REQUEST, "Empty batch.");
    const replies = (await Promise.all(body.map((m) => handleOne(server, m)))).filter(
      (r): r is JsonRpcResponse => r !== null
    );
    return replies.length > 0 ? replies : null;
  }
  return handleOne(server, body);
}

async function handleOne(server: McpServer, message: unknown): Promise<JsonRpcResponse | null> {
  if (!isRequest(message)) return errorReply(null, INVALID_REQUEST, "Not a JSON-RPC 2.0 message.");
  // No id = a notification ("initialized", "cancelled"): never answered.
  if (message.id === undefined) return null;
  const id = message.id;

  switch (message.method) {
    case "initialize": {
      const asked = message.params?.protocolVersion;
      const version = (SUPPORTED_PROTOCOL_VERSIONS as readonly unknown[]).includes(asked)
        ? (asked as string)
        : LATEST;
      return reply(id, {
        protocolVersion: version,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: server.name, version: server.version },
        instructions: server.instructions,
      });
    }
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, {
        tools: server.tools.map((t) => ({
          name: t.name,
          title: t.title,
          description: t.description,
          inputSchema: t.inputSchema ?? NO_ARGUMENTS,
          annotations: {
            readOnlyHint: t.readOnly !== false,
            destructiveHint: t.destructive === true,
            openWorldHint: false,
          },
        })),
      });
    case "tools/call": {
      const name = message.params?.name;
      if (typeof name !== "string" || !server.tools.some((t) => t.name === name)) {
        return errorReply(id, INVALID_PARAMS, `Unknown tool: ${String(name)}`);
      }
      try {
        const raw = message.params?.arguments;
        const args =
          typeof raw === "object" && raw !== null && !Array.isArray(raw)
            ? (raw as Record<string, unknown>)
            : {};
        const data = await server.callTool(name, args);
        return reply(id, {
          content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
          isError: false,
        });
      } catch (e) {
        // A tool that failed is a RESULT the model can read, not a protocol error.
        return reply(id, {
          content: [{ type: "text", text: e instanceof Error ? e.message : "The tool failed." }],
          isError: true,
        });
      }
    }
    default:
      return errorReply(id, METHOD_NOT_FOUND, `Method not found: ${message.method}`);
  }
}

/** For the transport: a body that wasn't JSON at all. */
export function parseErrorReply(): JsonRpcResponse {
  return errorReply(null, PARSE_ERROR, "Body is not JSON.");
}

function isRequest(m: unknown): m is JsonRpcRequest {
  return (
    typeof m === "object" &&
    m !== null &&
    (m as JsonRpcRequest).jsonrpc === "2.0" &&
    typeof (m as JsonRpcRequest).method === "string"
  );
}

function reply(id: string | number | null, result: unknown): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function errorReply(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}
