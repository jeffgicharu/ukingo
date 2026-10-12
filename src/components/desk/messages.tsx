import { formatPhone, maskEmail, maskPhone } from "@/lib/format";
import type { MessageStatus } from "@/server/db/schema";
import type { Staff } from "@/server/staff/permissions";

import { Chip } from "./chips";

export const MESSAGE_STATE_NAMES: Record<MessageStatus, string> = {
  sent: "Sent",
  queued: "Waiting to send",
  failed: "Failed",
  not_sent: "Not sent",
};

/** Who a message went to, as this member of staff may see it. */
export function recipientFor(staff: Staff, message: { recipient: string; channel: string; sample: boolean }): string {
  const text = message.channel === "sms";
  if (!staff.training || message.sample) return text ? formatPhone(message.recipient) : message.recipient;
  return text ? maskPhone(message.recipient) : maskEmail(message.recipient);
}

export function MessageChip({ status }: { status: MessageStatus }) {
  const tone = status === "sent" ? "paid" : status === "queued" ? "wait" : status === "failed" ? "bad" : "gone";
  return <Chip label={MESSAGE_STATE_NAMES[status]} tone={tone} />;
}
