import { NextRequest } from "next/server";
import { requireBearerKey } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = requireBearerKey(req);
  if (!auth.ok) return auth.response;
  return Response.json({
    object: "list",
    data: [
      {
        id: "muse",
        object: "model",
        created: 0,
        owned_by: "muse",
      },
    ],
  });
}

export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, x-api-key",
    },
  });
}
