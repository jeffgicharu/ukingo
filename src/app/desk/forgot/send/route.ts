import { clock } from "@/server/clock";
import { flash } from "@/server/flash";
import { field, seeOther } from "@/server/http";
import { requestReset } from "@/server/staff/manage";

// The answer is the same whether or not the address belongs to anyone here.
export async function POST(request: Request) {
  const form = await request.formData();
  await requestReset(field(form, "email"), clock.now());
  return seeOther(
    `/desk/forgot?note=${flash("If that address belongs to a member of staff, a link is on its way to it. It is good for one hour.")}`,
  );
}
