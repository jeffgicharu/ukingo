// Words can be read before they are published, by the staff who write them.

import { maySee } from "@/server/staff/permissions";
import { currentStaff } from "@/server/staff/sessions";

type Query = Record<string, string | string[] | undefined>;

/**
 * True when this page is being opened as a preview by a member of staff who
 * works on the site's words. Anyone else who adds "?preview=1" to an address
 * gets the published page, as if they had not.
 */
export async function isPreview(query: Query): Promise<boolean> {
  if (query.preview !== "1") return false;
  const staff = await currentStaff();
  return staff !== null && maySee(staff, "content.edit");
}
