import type { Metadata } from "next";
import { connection } from "next/server";

import { MessageChip, recipientFor } from "@/components/desk/messages";
import { DeskPage, Empty, Pager, Panel } from "@/components/desk/page";
import { formatMoment, plural } from "@/lib/format";
import { nameFor } from "@/server/desk/bookings";
import {
  listMessages,
  MESSAGE_STATES,
  MESSAGES_PER_PAGE,
  type ListedMessage,
  type MessageFilters,
} from "@/server/desk/messages";
import { messageName } from "@/server/messages/templates";
import { requireStaff } from "@/server/staff/sessions";

export const metadata: Metadata = { title: "Messages" };

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";

export default async function MessagesPage({ searchParams }: PageProps<"/desk/messages">) {
  await connection();
  const staff = await requireStaff("messages.view");
  const query = await searchParams;

  const channel = one(query.channel);
  const status = one(query.status);
  const filters: MessageFilters = {
    channel: channel === "email" || channel === "sms" ? channel : "all",
    status: status in MESSAGE_STATES ? (status as MessageFilters["status"]) : "all",
    q: one(query.q).trim().slice(0, 80),
    page: Math.max(1, Number(one(query.page)) || 1),
  };
  const { rows, total } = await listMessages(filters);
  const filtered = filters.q !== "" || filters.channel !== "all" || filters.status !== "all";

  const address = (page: number) => {
    const params = new URLSearchParams();
    if (filters.q) params.set("q", filters.q);
    if (filters.channel !== "all") params.set("channel", filters.channel);
    if (filters.status !== "all") params.set("status", filters.status);
    if (page > 1) params.set("page", String(page));
    const text = params.toString();
    return text ? `/desk/messages?${text}` : "/desk/messages";
  };

  const who = (message: ListedMessage) =>
    message.guestName ? nameFor(staff, { name: message.guestName, sample: message.sample }) : "No booking";

  return (
    <DeskPage
      title="Messages"
      summary={`${plural(total, "message")}${filtered ? " match" : ""}. Every email and text written to a guest, sent or not.`}
      query={query}
      wide
    >
      <form
        action="/desk/messages"
        method="get"
        className="grid gap-3 rounded-xl border border-rule bg-white p-4 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_auto] lg:items-end"
      >
        <label className="block">
          <span className="field-label">Address, name, subject or reference</span>
          <input name="q" type="search" defaultValue={filters.q} className="field min-h-10 py-2" />
        </label>
        <label className="block">
          <span className="field-label">Sent by</span>
          <select name="channel" defaultValue={filters.channel} className="field min-h-10 py-2">
            <option value="all">Email and text</option>
            <option value="email">Email</option>
            <option value="sms">Text</option>
          </select>
        </label>
        <label className="block">
          <span className="field-label">State</span>
          <select name="status" defaultValue={filters.status} className="field min-h-10 py-2">
            {(Object.keys(MESSAGE_STATES) as (keyof typeof MESSAGE_STATES)[]).map((key) => (
              <option key={key} value={key}>
                {MESSAGE_STATES[key]}
              </option>
            ))}
          </select>
        </label>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <button type="submit" className="button button-night min-h-10 px-5 py-2 text-sm">
            Search
          </button>
          {filtered ? (
            <a href="/desk/messages" className="button button-line min-h-10 px-4 py-2 text-sm">
              Clear
            </a>
          ) : null}
        </div>
      </form>

      <Panel className="mt-4 overflow-hidden">
        {rows.length === 0 ? (
          <Empty>{filtered ? "No message matches that." : "No message has been written yet."}</Empty>
        ) : (
          <>
            <table className="hidden w-full text-left text-[0.95rem] md:table">
              <thead>
                <tr className="label border-b border-rule text-ink-faint">
                  <th scope="col" className="px-5 py-3 font-semibold">
                    Written
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    Message
                  </th>
                  <th scope="col" className="px-3 py-3 font-semibold">
                    To
                  </th>
                  <th scope="col" className="px-5 py-3 font-semibold">
                    State
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-rule">
                {rows.map((message) => (
                  <tr key={message.id} className="align-top hover:bg-mist-50">
                    <td className="px-5 py-3 whitespace-nowrap">{formatMoment(message.createdAt)}</td>
                    <td className="px-3 py-3">
                      <a
                        href={`/desk/messages/${message.id}`}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {message.channel === "sms" ? "Text: " : ""}
                        {messageName(message.kind)}
                      </a>
                      <p className="text-sm text-ink-faint">
                        {who(message)}
                        {message.reference ? <span className="tabular"> · {message.reference}</span> : null}
                      </p>
                    </td>
                    <td className="px-3 py-3 break-all">{recipientFor(staff, message)}</td>
                    <td className="max-w-xs px-5 py-3">
                      <MessageChip status={message.status} />
                      {message.statusReason ? (
                        <p className="mt-1 text-sm text-ink-faint">{message.statusReason}</p>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-rule md:hidden">
              {rows.map((message) => (
                <li key={message.id}>
                  <a href={`/desk/messages/${message.id}`} className="block px-4 py-3">
                    <span className="flex items-start justify-between gap-3">
                      <span className="font-semibold">
                        {message.channel === "sms" ? "Text: " : ""}
                        {messageName(message.kind)}
                      </span>
                      <MessageChip status={message.status} />
                    </span>
                    <span className="mt-0.5 block text-sm break-all text-ink-soft">
                      {who(message)} · {recipientFor(staff, message)}
                    </span>
                    <span className="tabular mt-0.5 block text-sm text-ink-faint">
                      {formatMoment(message.createdAt)}
                      {message.reference ? ` · ${message.reference}` : ""}
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>
      <Pager page={filters.page} pages={Math.max(1, Math.ceil(total / MESSAGES_PER_PAGE))} href={address} />
    </DeskPage>
  );
}
