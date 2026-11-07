import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";
import { createSignedUploadUrl, guessKind } from "@/lib/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Issue a Supabase signed upload URL for large files (videos, zips)
 * that would exceed the Vercel body limit.
 *
 * Body JSON: { filename, mime?, kind? }
 * Returns: { id, upload_url, token, path, filename, mime, kind }
 * Client PUTs/POSTs the file to upload_url, then references file id in chat.
 */
export async function POST(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return auth.response;
  try {
    const body = await req.json().catch(() => ({}));
    const filename =
      typeof body.filename === "string" && body.filename.trim()
        ? body.filename.trim()
        : "";
    if (!filename) {
      return Response.json({ error: "filename required" }, { status: 400 });
    }
    const mime =
      typeof body.mime === "string" && body.mime.trim()
        ? body.mime.trim()
        : "application/octet-stream";
    const kind =
      typeof body.kind === "string" && body.kind.trim()
        ? body.kind.trim()
        : guessKind(mime, filename);
    const signed = await createSignedUploadUrl({ filename, mime, kind });
    return Response.json(
      {
        id: signed.file.id,
        object: "upload",
        upload_url: signed.uploadUrl,
        token: signed.token,
        path: signed.path,
        filename: signed.file.filename,
        mime,
        kind,
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
