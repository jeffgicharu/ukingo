import { flash } from "@/server/flash";
import { field, numberField, seeOther } from "@/server/http";
import { addStaff, changeDetails, changeRole, setActive, setPassword, StaffError } from "@/server/staff/manage";
import { NotAllowed } from "@/server/staff/permissions";
import { staffForRequest } from "@/server/staff/sessions";

// An owner adds people, changes what they do, and switches accounts off and on.
export async function POST(request: Request) {
  const staff = await staffForRequest(request);
  if (!staff) return seeOther("/desk/sign-in");

  const form = await request.formData();
  const done = (message: string) => seeOther(`/desk/staff?note=${flash(message)}`);
  const refuse = (message: string) => seeOther(`/desk/staff?oops=${flash(message)}`);
  const id = numberField(form, "id");

  try {
    switch (field(form, "action")) {
      case "add": {
        const name = field(form, "name");
        await addStaff(staff, {
          name,
          email: field(form, "email"),
          role: field(form, "role"),
          // Taken exactly as typed: a space at either end is part of the password.
          password: String(form.get("password") ?? ""),
        });
        return done(`${name} can now sign in. Tell them their first password yourself.`);
      }
      case "details":
        await changeDetails(staff, id, { name: field(form, "name"), email: field(form, "email") });
        return done("Their details are saved.");
      case "role":
        await changeRole(staff, id, field(form, "role"));
        return done("Their role is changed. They will need to sign in again.");
      case "password": {
        const name = await setPassword(staff, id, String(form.get("password") ?? ""));
        return done(`${name} has a new password and has been signed out everywhere. Tell it to them yourself.`);
      }
      case "use": {
        const active = field(form, "active") === "1";
        const name = await setActive(staff, id, active);
        return done(
          active ? `${name} can sign in again.` : `${name} can no longer sign in. Their name stays in the history.`,
        );
      }
      default:
        return refuse("That could not be done.");
    }
  } catch (error) {
    if (error instanceof StaffError || error instanceof NotAllowed) return refuse(error.message);
    throw error;
  }
}
