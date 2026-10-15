import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clock } from "@/server/clock";
import { at, freshLodge } from "@/testing/lodge";

import { alert } from "./alerts";

type Sent = { to: string[]; subject: string; text: string };

const sent: Sent[] = [];
let answer = 200;

const monday = at("2026-10-12 09:00");
const later = (minutes: number) => new Date(monday.getTime() + minutes * 60_000);

beforeEach(async () => {
  await freshLodge();
  sent.length = 0;
  answer = 200;
  process.env.RESEND_API_KEY = "re_a_key_for_the_tests";
  process.env.ALERT_EMAIL = "owner@lodge.example";
  // A stand-in for the mail service that remembers what it was handed.
  vi.stubGlobal("fetch", async (_address: string, request: RequestInit) => {
    if (answer === 200) sent.push(JSON.parse(String(request.body)) as Sent);
    return new Response(JSON.stringify(answer === 200 ? { id: "m-1" } : { message: "no" }), { status: answer });
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  clock.release();
  delete process.env.RESEND_API_KEY;
  delete process.env.ALERT_EMAIL;
});

describe("reporting trouble", () => {
  it("sends the first report and holds back the same trouble for fifteen minutes", async () => {
    clock.pin(monday);
    expect(await alert("jobs:reminders", "A job failed", "It threw.")).toBe("sent");
    clock.pin(later(5));
    expect(await alert("jobs:reminders", "A job failed", "It threw.")).toBe("quiet");
    clock.pin(later(14));
    expect(await alert("jobs:reminders", "A job failed", "It threw.")).toBe("quiet");
    clock.pin(later(16));
    expect(await alert("jobs:reminders", "A job failed", "It threw again.")).toBe("sent");

    expect(sent).toHaveLength(2);
    expect(sent[0]).toMatchObject({ to: ["owner@lodge.example"], subject: "[Ukingo] A job failed" });
    expect(sent[0].text).not.toContain("more time");
    expect(sent[1].text).toContain("It threw again.");
    // The two repeats held back are counted in the next report.
    expect(sent[1].text).toContain("It also happened 2 more times after the report of Mon 12 Oct 2026, 9 am.");
  });

  it("counts nothing held back when the trouble comes back after a quiet spell", async () => {
    clock.pin(monday);
    await alert("page", "A page failed", "It threw.");
    clock.pin(later(40));
    expect(await alert("page", "A page failed", "It threw.")).toBe("sent");
    expect(sent[1].text).not.toContain("more time");
  });

  it("does not let one kind of trouble quieten another", async () => {
    clock.pin(monday);
    expect(await alert("backup", "Last night's backup needs looking at", "No copy was made.")).toBe("sent");
    expect(await alert("page", "A page failed", "It threw.")).toBe("sent");
    expect(sent.map((message) => message.subject)).toEqual([
      "[Ukingo] Last night's backup needs looking at",
      "[Ukingo] A page failed",
    ]);
  });

  it("is off until there is both an address and a mail key", async () => {
    delete process.env.ALERT_EMAIL;
    expect(await alert("page", "A page failed", "It threw.")).toBe("off");
    process.env.ALERT_EMAIL = "owner@lodge.example";
    delete process.env.RESEND_API_KEY;
    expect(await alert("page", "A page failed", "It threw.")).toBe("off");
    expect(sent).toHaveLength(0);
  });

  it("says so, and never throws, when the mail service refuses the report", async () => {
    answer = 500;
    await expect(alert("page", "A page failed", "It threw.")).resolves.toBe("failed");
  });
});
