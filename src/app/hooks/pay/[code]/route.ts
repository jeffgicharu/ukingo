import { eq } from "drizzle-orm";
import { after } from "next/server";

import { clock } from "@/server/clock";
import { db, schema } from "@/server/db";
import { json } from "@/server/http";
import { deliverQueued } from "@/server/messages/deliver";
import { readResult } from "@/server/payments/daraja";
import { answerMatches, settlePayment } from "@/server/payments/service";

const ACCEPTED = { ResultCode: 0, ResultDesc: "Accepted" };

type Report = {
  Body?: {
    stkCallback?: {
      CheckoutRequestID?: string;
      ResultCode?: number | string;
      ResultDesc?: string;
      CallbackMetadata?: { Item?: { Name?: string; Value?: string | number }[] };
    };
  };
};

// Where Safaricom reports what became of a prompt.
//
// The message is not signed by Safaricom, so it is trusted only as far as it
// can be checked: the address must be the one given out with that one prompt,
// the message must name that prompt, and the amount paid must be the amount
// asked for. Whatever arrives, the answer is the same short acknowledgement,
// and a message that arrives twice is recorded once.
export async function POST(request: Request, { params }: RouteContext<"/hooks/pay/[code]">) {
  const { code } = await params;
  const id = Number(code.split(".")[0]);
  if (!Number.isInteger(id)) return json(ACCEPTED);

  const [payment] = await db().select().from(schema.payments).where(eq(schema.payments.id, id));
  if (!payment || !answerMatches(code, payment)) return json(ACCEPTED);

  const report = ((await request.json().catch(() => null)) as Report | null)?.Body?.stkCallback;
  if (
    !report ||
    !payment.checkoutRequestId ||
    report.CheckoutRequestID !== payment.checkoutRequestId ||
    report.ResultCode === undefined ||
    report.ResultCode === null
  ) {
    return json(ACCEPTED);
  }

  const details = new Map((report.CallbackMetadata?.Item ?? []).map((item) => [item.Name, item.Value]));
  const outcome = readResult(String(report.ResultCode));

  await settlePayment(
    payment.id,
    outcome.status === "paid"
      ? {
          status: "paid",
          receipt: details.has("MpesaReceiptNumber") ? String(details.get("MpesaReceiptNumber")) : null,
          paidShillings: details.has("Amount") ? Math.round(Number(details.get("Amount"))) : null,
        }
      : { ...outcome, detail: String(report.ResultDesc ?? "").slice(0, 250) },
    clock.now(),
  );

  after(() => deliverQueued());
  return json(ACCEPTED);
}
