import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";
import { uploadBuffer, guessKind } from "@/lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return auth.response;
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return Response.json({ error: "file required" }, { status: 400 });
    }
    const blob = file as Blob & { name?: string };
    const filename =
      (typeof form.get("filename") === "string" && String(form.get("filename"))) ||
      (typeof blob.name === "string" && blob.name) ||
      "upload.bin";
    const mime =
      blob.type ||
      (typeof form.get("mime") === "string" ? String(form.get("mime")) : "") ||
      "application/octet-stream";
    const buf = Buffer.from(await blob.arrayBuffer());
    const kind =
      (typeof form.get("purpose") === "string" && String(form.get("purpose"))) ||
      guessKind(mime, filename);
    const stored = await uploadBuffer({ buffer: buf, filename, mime, kind });
    return Response.json(
      {
        id: stored.id,
        object: "file",
        bytes: stored.size,
        created_at: Math.floor(Date.now() / 1000),
        filename: stored.filename,
        purpose: kind,
        mime: stored.mime,
        path: stored.path,
      },
      { status: 201 }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "error";
    return Response.json({ error: msg }, { status: 500 });
  }
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key",
    },
  });
}
