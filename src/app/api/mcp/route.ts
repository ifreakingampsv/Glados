import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { authenticateToken } from "@/services/tokens";
import {
  MCP_TOOLS,
  mcpGetReport,
  mcpGetSpineSnapshot,
  mcpSaveDecisionRecord,
  mcpStartInterviewSession,
  mcpSubmitTranscript,
} from "@/services/mcp";

// S2 MCP transport (D86): a THIN JSON-RPC layer over the service functions —
// no business logic here. Feature-flagged: a disabled `mcp.server` flag row
// short-circuits everything (D6; absent flag = enabled, gateway convention).

export const dynamic = "force-dynamic";

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: unknown;
  method?: string;
  params?: Record<string, unknown>;
}

function rpc(id: unknown, result: unknown, status = 200) {
  return NextResponse.json({ jsonrpc: "2.0", id, result }, { status });
}

function rpcError(id: unknown, code: number, message: string, status = 200) {
  return NextResponse.json(
    { jsonrpc: "2.0", id, error: { code, message } },
    { status }
  );
}

async function checkMcpFlag(): Promise<boolean> {
  const flag = await db.featureFlag.findUnique({
    where: { key: "mcp.server" },
  });
  return !flag || flag.enabled;
}

export async function POST(request: Request) {
  if (!(await checkMcpFlag())) {
    return NextResponse.json({ error: "mcp disabled" }, { status: 403 });
  }
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) {
    return NextResponse.json(
      {
        error: "missing bearer token (create one under Settings → API tokens)",
      },
      { status: 401 }
    );
  }
  const authed = await authenticateToken(token);
  if (!authed) {
    return NextResponse.json({ error: "invalid token" }, { status: 401 });
  }
  const userId = authed.user.id;

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return rpcError(null, -32700, "parse error");
  }
  const { id, method } = body;
  const params = body.params ?? {};

  try {
    if (method === "initialize") {
      return rpc(id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "glados-interview", version: "1.0.0" },
      });
    }
    if (method === "tools/list") {
      return rpc(id, { tools: MCP_TOOLS });
    }
    if (method === "tools/call") {
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      switch (name) {
        case "start_interview_session": {
          const result = await mcpStartInterviewSession(userId, {
            scope: typeof args.scope === "string" ? args.scope : undefined,
            mode: typeof args.mode === "string" ? args.mode : undefined,
            projectId:
              typeof args.projectId === "string" ? args.projectId : undefined,
            projectIds: Array.isArray(args.projectIds)
              ? args.projectIds.map(String)
              : undefined,
            jdId: typeof args.jdId === "string" ? args.jdId : undefined,
          });
          return rpc(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          });
        }
        case "submit_interview_transcript": {
          const turns = Array.isArray(args.turns) ? args.turns : [];
          const result = await mcpSubmitTranscript(
            userId,
            String(args.sessionId ?? ""),
            turns.map((t) => {
              const turn = (t ?? {}) as Record<string, unknown>;
              return {
                question: String(turn.question ?? ""),
                answer: String(turn.answer ?? ""),
                pushesUsed:
                  typeof turn.pushesUsed === "number" ? turn.pushesUsed : 0,
                durationMs:
                  typeof turn.durationMs === "number"
                    ? turn.durationMs
                    : undefined,
              };
            })
          );
          return rpc(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          });
        }
        case "get_interview_report": {
          const result = await mcpGetReport(
            userId,
            String(args.sessionId ?? "")
          );
          return rpc(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          });
        }
        case "get_spine_snapshot": {
          const result = await mcpGetSpineSnapshot(userId);
          return rpc(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          });
        }
        case "save_decision_record": {
          const result = await mcpSaveDecisionRecord(userId, {
            projectId: String(args.projectId ?? ""),
            choice: String(args.choice ?? ""),
            alternatives: Array.isArray(args.alternatives)
              ? args.alternatives.map(String)
              : [],
            rationale: String(args.rationale ?? ""),
            sessionId:
              typeof args.sessionId === "string" ? args.sessionId : undefined,
            userConfirmed: args.userConfirmed === true,
          });
          return rpc(id, {
            content: [{ type: "text", text: JSON.stringify(result) }],
          });
        }
        default:
          return rpcError(id, -32601, `unknown tool: ${name}`);
      }
    }
    return rpcError(id, -32601, `unknown method: ${method}`);
  } catch (err) {
    return rpcError(
      id,
      -32000,
      err instanceof Error ? err.message : "tool call failed"
    );
  }
}
