import { deskPulse } from "@/server/desk/board";
import { json } from "@/server/http";
import { staffForRequest } from "@/server/staff/sessions";

// What every open staff screen asks every few seconds: has anything changed?
export async function GET(request: Request) {
  const staff = await staffForRequest(request);
  if (!staff) return json({ pulse: 0 }, 401);
  return json({ pulse: await deskPulse() });
}
