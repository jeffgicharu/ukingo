import { describe, expect, it } from "vitest";

import {
  addDays,
  addMonths,
  daysBetween,
  isDay,
  isWeekendNight,
  lodgeDay,
  lodgeHour,
  lodgeMoment,
  nightsIn,
  nightsOf,
  staysOverlap,
} from "./dates";
import {
  formatDay,
  formatMoment,
  formatMoney,
  formatPhone,
  formatStay,
  formatTime,
  maskEmail,
  maskPhone,
  normalisePhone,
  PHONE_PATTERN,
} from "./format";

describe("calendar dates", () => {
  it("accepts real dates only", () => {
    expect(isDay("2026-11-13")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2027-02-29")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("13/11/2026")).toBe(false);
    expect(isDay(undefined)).toBe(false);
  });

  it("counts nights, not days", () => {
    const stay = { from: "2026-11-13", to: "2026-11-15" };
    expect(nightsIn(stay)).toBe(2);
    expect(nightsOf(stay)).toEqual(["2026-11-13", "2026-11-14"]);
  });

  it("moves across months and years", () => {
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-10-12", "2026-11-13")).toBe(32);
    expect(addMonths("2026-10-31", 4)).toBe("2027-02-28");
    expect(addMonths("2026-10-12", 12)).toBe("2027-10-12");
  });

  it("prices Friday and Saturday nights as the weekend", () => {
    expect(isWeekendNight("2026-11-13")).toBe(true); // Friday
    expect(isWeekendNight("2026-11-14")).toBe(true); // Saturday
    expect(isWeekendNight("2026-11-15")).toBe(false); // Sunday
    expect(isWeekendNight("2026-11-12")).toBe(false); // Thursday
  });

  it("lets one guest leave on the morning another arrives", () => {
    expect(staysOverlap({ from: "2026-11-13", to: "2026-11-15" }, { from: "2026-11-15", to: "2026-11-17" })).toBe(
      false,
    );
    expect(staysOverlap({ from: "2026-11-13", to: "2026-11-16" }, { from: "2026-11-15", to: "2026-11-17" })).toBe(true);
  });
});

describe("the lodge's clock", () => {
  it("is East Africa Time whatever the server's clock says", () => {
    // 22:30 UTC on the 12th is 01:30 on the 13th at the lodge.
    const lateEvening = new Date("2026-10-12T22:30:00Z");
    expect(lodgeDay(lateEvening)).toBe("2026-10-13");
    expect(lodgeHour(lateEvening)).toBe(1);

    expect(lodgeDay(new Date("2026-10-12T20:59:59Z"))).toBe("2026-10-12");
    expect(lodgeDay(new Date("2026-10-12T21:00:00Z"))).toBe("2026-10-13");
  });

  it("turns a lodge date and time into the right moment", () => {
    expect(lodgeMoment("2026-11-13", 14).toISOString()).toBe("2026-11-13T11:00:00.000Z");
    expect(lodgeMoment("2026-11-13").toISOString()).toBe("2026-11-12T21:00:00.000Z");
  });
});

describe("how things are written", () => {
  it("writes dates as day, month, year", () => {
    expect(formatDay("2026-10-30")).toBe("Fri 30 Oct 2026");
    expect(formatDay("2026-10-30", "long")).toBe("Friday 30 October 2026");
    expect(formatStay({ from: "2026-11-13", to: "2026-11-15" })).toBe("Fri 13 Nov to Sun 15 Nov 2026");
    expect(formatStay({ from: "2026-12-30", to: "2027-01-02" })).toBe("Wed 30 Dec 2026 to Sat 2 Jan 2027");
  });

  it("writes moments in East Africa Time", () => {
    expect(formatMoment(new Date("2026-11-13T11:05:00Z"))).toBe("Fri 13 Nov 2026, 2.05 pm");
    expect(formatTime(new Date("2026-11-13T06:00:00Z"))).toBe("9 am");
  });

  it("writes money as shillings", () => {
    expect(formatMoney(4_500_000)).toBe("KSh 45,000");
    expect(formatMoney(100)).toBe("KSh 1");
    expect(formatMoney(4_500_050)).toBe("KSh 45,000.50");
    expect(formatMoney(0)).toBe("KSh 0");
  });

  it("stores every phone number one way", () => {
    for (const typed of ["0712345678", "712345678", "+254712345678", "254712345678", "0712 345 678", "0712-345-678"]) {
      expect(normalisePhone(typed)).toBe("+254712345678");
    }
    expect(normalisePhone("0112345678")).toBe("+254112345678");
    expect(normalisePhone("071234567")).toBeNull();
    expect(normalisePhone("0212345678")).toBeNull();
    expect(normalisePhone("hello")).toBeNull();
    expect(formatPhone("+254712345678")).toBe("0712 345 678");
  });

  it("gives form fields a pattern that browsers accept and that agrees with the rule", () => {
    // Browsers compile a field's pattern this way. One they cannot compile is ignored, and checks nothing.
    const asBrowsersReadIt = new RegExp("^(?:" + PHONE_PATTERN + ")$", "v");
    const typed = ["0712 345 678", "+254 712 345 678", "254712345678", "0112-345-678", "712345678", " 0712345678 "];
    const mistyped = ["12345", "0812345678", "07123456789", "071234567", "hello", ""];
    for (const number of typed) {
      expect(asBrowsersReadIt.test(number), number).toBe(true);
      expect(normalisePhone(number), number).not.toBeNull();
    }
    for (const number of mistyped) {
      expect(asBrowsersReadIt.test(number), number).toBe(false);
      expect(normalisePhone(number), number).toBeNull();
    }
  });

  it("hides the middle of contact details", () => {
    expect(maskPhone("+254712345678")).toBe("0712 ••• 678");
    expect(maskEmail("wanjiru@gmail.com")).toBe("w•••@gmail.com");
  });
});
