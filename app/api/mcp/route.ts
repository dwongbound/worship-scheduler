// POST /api/mcp — TapWorship as an MCP server, for a person's own assistant
// (Jarvis). Stateless Streamable HTTP: one JSON-RPC message (or batch) per
// POST, a plain JSON reply, tools only. Protocol rules in lib/mcp.ts, tools in
// lib/agentTools.ts, data in lib/agentSnapshot.ts.
//
// Authenticated by `Authorization: Bearer tw_…` ONLY, like /api/agent. Every
// key gets the reading tools; a key made "can act for me" also gets
// confirm_set, request_cover, cancel_cover_request and take_cover, which call
// the app's OWN route handlers with the same key, so the ownership check, the
// cover eligibility rule, the set history and the Slack messages are exactly
// the app's, and the key acts only on the person's own seats there
// (lib/accessKeyAuth.ts `getActingUser`).
import { NextRequest, NextResponse } from "next/server";
import { getKeyUser } from "@/lib/accessKeyAuth";
import { agentSection, agentSnapshot } from "@/lib/agentSnapshot";
import {
  AGENT_TOOLS,
  AGENT_WRITE_TOOLS,
  agentInstructions,
  agentToolsFor,
  type AgentAction,
} from "@/lib/agentTools";
import { STATUS_LABELS } from "@/lib/agentView";
import { handleMcp, parseErrorReply } from "@/lib/mcp";
import { PATCH as assignmentRoute } from "../assignments/[id]/route";
import { POST as takeRoute } from "../swaps/[id]/take/route";

export async function POST(req: Request) {
  const user = await getKeyUser(req);
  if (!user) {
    return NextResponse.json(
      { error: "Send a personal access key: Authorization: Bearer tw_… (make one on your profile)." },
      { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="tapworship"' } }
    );
  }

  const body = await req.json().catch(() => undefined);
  if (body === undefined) return NextResponse.json(parseErrorReply(), { status: 400 });

  const origin = new URL(req.url).origin;
  const replies = await handleMcp(
    {
      name: "tapworship",
      version: "1",
      instructions: agentInstructions(user.canWrite),
      tools: agentToolsFor(user.canWrite),
      callTool: async (name, args) => {
        const reader = AGENT_TOOLS.find((t) => t.name === name);
        if (reader) {
          if (reader.section) return agentSection(user, reader.section, origin);
          return agentSnapshot(user, origin);
        }
        // handleMcp only calls a tool it listed, and writers are only listed
        // for a key that may write.
        const writer = AGENT_WRITE_TOOLS.find((t) => t.name === name)!;
        return runWrite(req, writer.action, args);
      },
    },
    body
  );
  // Only notifications: accepted, nothing to say.
  if (replies === null) return new NextResponse(null, { status: 202 });
  return NextResponse.json(replies, { headers: { "Cache-Control": "no-store" } });
}

/**
 * No server-to-client stream: the spec lets a server that never pushes answer
 * GET with 405, and a client then simply POSTs.
 */
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

/** The assignmentId argument every writer takes, or a throw the model reads. */
function assignmentIdOf(args: Record<string, unknown>): string {
  const id = args.assignmentId;
  if (typeof id !== "string" || !id.trim()) {
    throw new Error("Send the seat's assignmentId (from get_my_sets or get_open_covers).");
  }
  return id.trim();
}

/**
 * A request to one of the app's own routes, carrying THIS request's key. The
 * route authenticates it again, which is the point: it can't be talked into
 * anything the key couldn't do by calling it directly.
 */
function inner(req: Request, path: string, method: string, json?: unknown) {
  return new NextRequest(new URL(path, req.url), {
    method,
    headers: {
      authorization: req.headers.get("authorization") ?? "",
      "content-type": "application/json",
    },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
}

/** The route's reply, or a throw carrying its own error sentence. */
async function readReply(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error ?? `The app refused that (HTTP ${res.status}).`);
  return data as { id: string; status: keyof typeof STATUS_LABELS };
}

/** One writing tool, handed to the app's own route. */
async function runWrite(req: Request, action: AgentAction, args: Record<string, unknown>) {
  const assignmentId = assignmentIdOf(args);
  const params = { params: Promise.resolve({ id: assignmentId }) };
  const path = `/api/assignments/${encodeURIComponent(assignmentId)}`;

  if (action === "take") {
    const res = await takeRoute(inner(req, `/api/swaps/${encodeURIComponent(assignmentId)}/take`, "POST"), params);
    const seat = await readReply(res);
    return { taken: true, assignmentId: seat.id, status: STATUS_LABELS[seat.status] };
  }

  const reason = typeof args.reason === "string" ? args.reason : undefined;
  const res = await assignmentRoute(inner(req, path, "PATCH", { action, reason }), params);
  const seat = await readReply(res);
  return { done: action, assignmentId: seat.id, status: STATUS_LABELS[seat.status] };
}
