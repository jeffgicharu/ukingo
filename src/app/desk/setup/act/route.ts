import { clock } from "@/server/clock";
import { fieldsOf, isSetupAction, setupAction, SetupError, type Waiting } from "@/server/desk/setup";
import { flash, seal, unseal } from "@/server/flash";
import { field, seeOther } from "@/server/http";
import { must, NotAllowed } from "@/server/staff/permissions";
import { staffForRequest } from "@/server/staff/sessions";

// Every change to how the lodge is set up lands here. A change to prices or
// rules goes round twice: once to be said back, and once more to be saved.
export async function POST(request: Request) {
  const staff = await staffForRequest(request);
  if (!staff) return seeOther("/desk/sign-in");

  const form = await request.formData();
  const now = clock.now();

  // Back to the screen the form was on. Only addresses inside the back office are followed.
  const asked = field(form, "back");
  const back = asked.startsWith("/desk/") && !asked.includes("//") ? asked : "/desk";
  const join = back.includes("?") ? "&" : "?";
  const done = (message: string) => seeOther(`${back}${join}note=${flash(message)}`);
  const refuse = (message: string) => seeOther(`${back}${join}oops=${flash(message)}`);

  try {
    // The second time round: the member of staff has read what the change does and said yes.
    const confirmed = field(form, "confirm");
    if (confirmed) {
      const waiting = unseal<Waiting>(confirmed);
      if (!waiting || waiting.by !== staff.id || !isSetupAction(waiting.action)) {
        return refuse("That change could not be read. Please make it again.");
      }
      const action = setupAction(waiting.action);
      must(staff, action.ability);
      return done(await action.apply(waiting.proposal, staff, now));
    }

    const name = field(form, "action");
    if (!isSetupAction(name)) return refuse("That could not be done.");
    const action = setupAction(name);
    must(staff, action.ability);

    const proposal = await action.read(fieldsOf(form));
    if (action.review && action.lines) {
      const lines = await action.lines(proposal);
      if (lines.length === 0) return done("Nothing was changed.");
      const waiting: Waiting = { action: name, proposal, by: staff.id };
      return seeOther(`${back}${join}review=${seal(waiting)}`);
    }
    return done(await action.apply(proposal, staff, now));
  } catch (error) {
    if (error instanceof SetupError || error instanceof NotAllowed) return refuse(error.message);
    throw error;
  }
}
