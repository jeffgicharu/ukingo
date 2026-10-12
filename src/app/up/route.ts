import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/server/db";

// A plain answer for the web server and the outside check: the application
// is running and can reach its database.
export async function GET() {
  await connection();

  try {
    await db().execute(sql`SELECT 1`);
  } catch {
    return new Response("database unreachable\n", { status: 503, headers: { "Cache-Control": "no-store" } });
  }

  return new Response("ok\n", {
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}

export async function HEAD() {
  await connection();
  return new Response(null, { headers: { "Cache-Control": "no-store" } });
}
