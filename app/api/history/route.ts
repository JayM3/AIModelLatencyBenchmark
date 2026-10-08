import type { NextRequest } from "next/server";
import { createHistoryStore } from "@/src/lib/history-store";
import { normalizeSavedBenchmark } from "@/src/lib/saved-benchmark";
import { isJsonRequest } from "@/src/lib/request-validation";
import type { SavedBenchmark } from "@/src/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const historyStore = createHistoryStore(process.env.MODEL_BENCH_DATA_DIR || "data");

export async function GET() {
  try {
    return Response.json({ history: await historyStore.read() }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Unable to read saved history; check the history file and directory permissions", history: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!isJsonRequest(request)) return Response.json({ error: "Content-Type must be application/json" }, { status: 415 });
  let item: SavedBenchmark;
  try {
    item = normalizeSavedBenchmark(await request.json());
  } catch (error) {
    return Response.json({ error: error instanceof SyntaxError ? "Request body must be valid JSON" : error instanceof Error ? error.message : "Invalid benchmark record" }, { status: 400 });
  }
  try {
    const history = await historyStore.save(item);
    return Response.json({ success: true, history }, { status: 201 });
  } catch {
    return Response.json({ error: "Unable to save history; check the history file and directory permissions" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return Response.json({ error: "Missing id parameter" }, { status: 400 });
  try {
    const history = await historyStore.remove(id);
    return Response.json({ success: true, history });
  } catch {
    return Response.json({ error: "Unable to delete history; check the history file and directory permissions" }, { status: 500 });
  }
}
