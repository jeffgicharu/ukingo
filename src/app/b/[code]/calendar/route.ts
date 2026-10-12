import { bookingUrl } from "@/server/booking/links";
import { bookingForLink } from "@/server/booking/view";
import { clock } from "@/server/clock";

const fold = (line: string) => line.replace(/(.{70})/g, "$1\r\n ").replace(/\r\n $/, "");
const text = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
const stamp = (moment: Date) =>
  moment
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");

// The stay as a calendar entry the guest's phone can keep. Check-in is from
// 2 pm and check-out by 10.30 am, East Africa Time.
export async function GET(_request: Request, { params }: RouteContext<"/b/[code]/calendar">) {
  const { code } = await params;
  const booking = await bookingForLink(code);
  if (!booking || !["confirmed", "checked_in", "checked_out"].includes(booking.status)) {
    return new Response("Not found", { status: 404 });
  }

  const local = (day: string, time: string) => `${day.replace(/-/g, "")}T${time}`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Ukingo//Bookings//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VTIMEZONE",
    "TZID:Africa/Nairobi",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0300",
    "TZNAME:EAT",
    "END:STANDARD",
    "END:VTIMEZONE",
    "BEGIN:VEVENT",
    `UID:${booking.reference}@ukingo`,
    `DTSTAMP:${stamp(clock.now())}`,
    `DTSTART;TZID=Africa/Nairobi:${local(booking.stay.from, "140000")}`,
    `DTEND;TZID=Africa/Nairobi:${local(booking.stay.to, "103000")}`,
    `SUMMARY:${text("Stay at Ukingo")}`,
    `LOCATION:${text("Ukingo, 14 km from Nanyuki, Kenya")}`,
    `DESCRIPTION:${text(`Booking ${booking.reference}. Check-in from 2 pm, check-out by 10.30 am. The gate closes at 9 pm.\nYour booking: ${bookingUrl(booking)}`)}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Response(lines.map(fold).join("\r\n") + "\r\n", {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": `attachment; filename="ukingo-${booking.reference}.ics"`,
      "Cache-Control": "private, no-store",
    },
  });
}
