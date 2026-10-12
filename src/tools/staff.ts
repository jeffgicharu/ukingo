// Adds a member of staff, or switches one off, from the command line. For
// the first account, before anyone can sign in to add the others.
//
//   STAFF_PASSWORD=… node staff.mjs add owner ada@example.com "Ada Wanjiku"
//   node staff.mjs off ada@example.com
//
// The password is read from the environment so that it never appears in the
// list of running commands or in the shell's history.

import { eq } from "drizzle-orm";

import { closeDatabase, db, schema } from "@/server/db";
import type { StaffRole } from "@/server/db/schema";
import { hashPassword, passwordProblem } from "@/server/staff/passwords";
import { closeAllSessions } from "@/server/staff/auth";

const ROLES: StaffRole[] = ["owner", "reservations", "front_desk"];

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "add") {
    const [role, email, name] = rest;
    const password = process.env.STAFF_PASSWORD ?? "";
    if (!ROLES.includes(role as StaffRole) || !email?.includes("@") || !name) {
      throw new Error(`Usage: staff add <${ROLES.join("|")}> <email> <name>`);
    }
    const problem = passwordProblem(password);
    if (problem) throw new Error(`STAFF_PASSWORD will not do. ${problem}`);

    const values = {
      name,
      email: email.toLowerCase(),
      passwordHash: await hashPassword(password),
      role: role as StaffRole,
      active: true,
    };
    await db()
      .insert(schema.staff)
      .values(values)
      .onConflictDoUpdate({
        target: schema.staff.email,
        set: { name, passwordHash: values.passwordHash, role: values.role, active: true },
      });
    console.log(`${name} can now sign in as ${values.role}.`);
    return;
  }

  if (command === "off") {
    const [email] = rest;
    const [member] = await db()
      .update(schema.staff)
      .set({ active: false })
      .where(eq(schema.staff.email, (email ?? "").toLowerCase()))
      .returning({ id: schema.staff.id, name: schema.staff.name });
    if (!member) throw new Error("No member of staff has that email.");
    await closeAllSessions(member.id);
    console.log(`${member.name} can no longer sign in.`);
    return;
  }

  throw new Error("Usage: staff add <role> <email> <name> | staff off <email>");
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => closeDatabase());
