import { connection } from "next/server";

import { readPhotoFile } from "@/server/lodge/photo-files";

// The copies of photographs staff put up: /uploads/forest-cottage-main-3fa9c1d2e0-800.avif
// Each photograph gets a new name when it is put up, so a copy never changes
// under its name and a browser may keep it for a year.
export async function GET(_request: Request, context: RouteContext<"/uploads/[file]">) {
  await connection();
  const { file } = await context.params;
  const found = await readPhotoFile(file);
  if (!found) {
    return new Response("Not found", {
      status: 404,
      headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" },
    });
  }
  return new Response(new Uint8Array(found.body), {
    headers: {
      "Content-Type": found.type,
      "Content-Length": String(found.body.byteLength),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
