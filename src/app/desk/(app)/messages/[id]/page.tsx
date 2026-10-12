import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { MessageChip, recipientFor } from "@/components/desk/messages";
import { DeskPage, Panel } from "@/components/desk/page";
import { formatMoment } from "@/lib/format";
import { nameFor } from "@/server/desk/bookings";
import { hasLinkStandIn, htmlForDisplay, messageById } from "@/server/desk/messages";
import { LINK, messageName } from "@/server/messages/templates";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Message" };

export default async function MessagePage({ params, searchParams }: PageProps<"/desk/messages/[id]">) {
  await connection();
  const staff = await requireStaff("messages.view");
  const { id } = await params;
  const message = await messageById(Number(id));
  if (!message) notFound();

  // What was written to a real visitor is theirs. A training account sees that it exists, not what it says.
  const hidden = staff.training && !message.sample;
  const rows: [string, React.ReactNode][] = [
    ["To", recipientFor(staff, message)],
    ["Sent by", message.channel === "email" ? "Email" : "Text message"],
    ["Written", formatMoment(message.createdAt)],
    [
      "State",
      <span key="state" className="flex flex-wrap items-center gap-2">
        <MessageChip status={message.status} />
        {message.sentAt ? <span className="text-ink-soft">{formatMoment(message.sentAt)}</span> : null}
        {message.statusReason ? <span className="text-ink-soft">{message.statusReason}</span> : null}
      </span>,
    ],
  ];
  if (message.bookingId) {
    rows.push([
      "Booking",
      <a key="booking" href={`/desk/bookings/${message.bookingId}`} className="link">
        {message.guestName ? nameFor(staff, { name: message.guestName, sample: message.sample }) : "Booking"} ·{" "}
        <span className="tabular whitespace-nowrap">{message.reference}</span>
      </a>,
    ]);
  }

  return (
    <DeskPage
      title={`${message.channel === "sms" ? "Text: " : ""}${messageName(message.kind)}`}
      summary={message.subject && !hidden ? message.subject : undefined}
      actions={
        <a href="/desk/messages" className="button button-line min-h-10 px-4 py-2 text-sm">
          All messages
        </a>
      }
      query={await searchParams}
    >
      <div className="grid gap-4 lg:grid-cols-[1fr_1.6fr] lg:items-start">
        <Panel title="About this message">
          <dl className="divide-y divide-rule">
            {rows.map(([label, value]) => (
              <div key={label} className="grid grid-cols-[5.5rem_1fr] gap-3 px-4 py-2.5 sm:px-5">
                <dt className="label pt-1 text-ink-faint">{label}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {!hidden && hasLinkStandIn(message) ? (
            <p className="border-t border-rule px-4 py-3 text-sm text-ink-faint sm:px-5">
              Where this copy says <span className="tabular text-ink-soft">{LINK}</span>, the guest&apos;s own private
              link was put in as the message was sent. The link itself is never kept, so nobody can take it from here.
            </p>
          ) : null}
        </Panel>

        <Panel title={message.channel === "email" ? "As the guest received it" : "The text"}>
          {hidden ? (
            <p className="px-4 py-8 text-center text-ink-faint sm:px-5">
              This was written to a real visitor. Training accounts can see that it exists, not what it says.
            </p>
          ) : message.channel === "email" && message.html ? (
            // The email is drawn in a frame of its own: it cannot run script, follow links or reach this page.
            <iframe
              title="The email as the guest received it"
              sandbox=""
              srcDoc={htmlForDisplay(message.html)}
              className="block h-[42rem] w-full rounded-b-xl bg-white"
            />
          ) : (
            <p className="px-4 py-4 whitespace-pre-line sm:px-5">{message.body}</p>
          )}
        </Panel>

        {!hidden && message.channel === "email" && message.html ? (
          <details className="rounded-xl border border-rule bg-white shadow-panel lg:col-start-2">
            <summary className="cursor-pointer px-4 py-3 font-semibold sm:px-5">The plain text version</summary>
            <p className="border-t border-rule px-4 py-4 text-[0.95rem] whitespace-pre-line text-ink-soft sm:px-5">
              {message.body}
            </p>
          </details>
        ) : null}
      </div>
    </DeskPage>
  );
}
