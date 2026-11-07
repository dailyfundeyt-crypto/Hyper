import { NextRequest } from "next/server";
import { requireAuth } from "@/lib/auth";
import { extractOwnerKey } from "@/lib/owner";
import { httpStatusFor } from "@/lib/messages";
import { listProjects, ownerSaveProject } from "@/lib/projects";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const fail = (e: unknown) => {
  const msg = e instanceof Error ? e.message : "error";
  return Response.json({ error: msg }, { status: httpStatusFor(msg) });
};

/** Project docs (session cookie or Muse key). */
export async function GET(req: NextRequest) {
  const auth = await requireAuth(req);
  if (!auth.ok) return auth.response;
  try {
    return Response.json({ projects: await listProjects() });
  } catch (e) {
    return fail(e);
  }
}

/** OWNER ONLY: create/update a doc {id?, name, body, always_active}. */
export async function POST(req: NextRequest) {
  const ownerKey = extractOwnerKey(req);
  if (!ownerKey) return Response.json({ error: "owner key required (x-owner-key)" }, { status: 403 });
  let b: Record<string, unknown> = {};
  try { b = await req.json(); } catch { /* empty */ }
  const name = typeof b.name === "string" ? b.name : "";
  if (!name.trim()) return Response.json({ error: "name required" }, { status: 400 });
  try {
    const project = await ownerSaveProject(ownerKey, {
      id: typeof b.id === "string" && b.id ? b.id : null,
      name,
      body: typeof b.body === "string" ? b.body : "",
      always_active: typeof b.always_active === "boolean" ? b.always_active : null,
    });
    return Response.json({ project });
  } catch (e) {
    return fail(e);
  }
}
