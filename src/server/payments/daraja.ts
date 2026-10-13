// Safaricom's Daraja API, as far as the lodge uses it: asking a phone to pay
// (an STK push) and asking what became of a prompt.

import { env } from "@/server/env";
import type { PaymentFailure } from "@/server/db/schema";

export type PromptRequest = {
  /** 2547XXXXXXXX: Safaricom's own form, without the plus. */
  phone: string;
  shillings: number;
  /** Shown on the phone and on the statement. At most 12 characters. */
  reference: string;
  /** Where Safaricom reports the result. Must be a public https address. */
  answerUrl: string;
};

export type PromptAnswer = { checkoutRequestId: string; merchantRequestId: string | null };
export type PromptResult = { code: string; description: string };

export interface Mpesa {
  prompt(request: PromptRequest): Promise<PromptAnswer>;
  /** What became of a prompt, or null while the guest has still to answer it. */
  result(checkoutRequestId: string): Promise<PromptResult | null>;
}

/** The most M-Pesa moves in one transaction. */
export const MPESA_LIMIT_CENTS = 250_000 * 100;

type Outcome = { status: "paid" } | { status: "failed"; failure: PaymentFailure };

/** What Safaricom's result codes mean. */
export function readResult(code: string): Outcome {
  switch (code) {
    case "0":
      return { status: "paid" };
    case "1032":
      return { status: "failed", failure: "cancelled" };
    case "1037":
      return { status: "failed", failure: "unreachable" };
    case "1019":
      return { status: "failed", failure: "timeout" };
    case "2001":
      return { status: "failed", failure: "wrong_pin" };
    case "1":
      return { status: "failed", failure: "insufficient_funds" };
    case "17":
      return { status: "failed", failure: "limit" };
    default:
      return { status: "failed", failure: "other" };
  }
}

/**
 * The same, for a result the site asked for rather than was sent. Asked while
 * a prompt is still open, Safaricom has more than one way of saying so. So a
 * code this site has never met settles nothing here: the confirmation will,
 * or the site giving up.
 */
export function readAskedResult(code: string): Outcome | null {
  const outcome = readResult(code);
  return outcome.status === "failed" && outcome.failure === "other" ? null : outcome;
}

/** Safaricom's result code for a prompt the phone has not answered yet. */
const STILL_OPEN = "4999";

/**
 * Reads Safaricom's reply to "what became of this prompt?". Until the guest
 * answers, the reply is either an error or a result code that only means the
 * prompt is still open. Neither is news.
 */
export function readQueryAnswer(ok: boolean, answer: Record<string, unknown>): PromptResult | null {
  if (!ok || answer.ResultCode === undefined || answer.ResultCode === null) return null;
  const code = String(answer.ResultCode);
  if (code === STILL_OPEN) return null;
  return { code, description: String(answer.ResultDesc ?? "") };
}

/** What to tell a guest whose payment did not go through, and what to do next. */
export function failureMessage(failure: PaymentFailure | null): string {
  switch (failure) {
    case "cancelled":
      return "The prompt was cancelled on the phone. Nothing was paid. You can send it again.";
    case "timeout":
      return "The prompt was not answered in time. Nothing was paid. You can send it again.";
    case "wrong_pin":
      return "M-Pesa did not accept the PIN. Nothing was paid. Send the prompt again and enter your PIN carefully.";
    case "insufficient_funds":
      return "There was not enough money in the M-Pesa account. Nothing was paid. Top up and try again, or pay from another number.";
    case "unreachable":
      return "The phone could not be reached. Check that it is on, has signal and is a Safaricom line, then send the prompt again.";
    case "limit":
      return "This payment would take the M-Pesa account past its limit. Nothing was paid. Try a smaller amount or another number.";
    default:
      return "M-Pesa could not complete the payment. Nothing was paid. Please try again in a moment.";
  }
}

let token: { value: string; until: number } | undefined;

function timestamp(now: Date): string {
  // East Africa Time, as YYYYMMDDHHmmss.
  return new Date(now.getTime() + 3 * 3_600_000).toISOString().replace(/\D/g, "").slice(0, 14);
}

/** The live connection to Safaricom, or null when M-Pesa has not been set up. */
export function daraja(): Mpesa | null {
  const settings = env.daraja;
  if (!settings) return null;

  const base = settings.production ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

  async function accessToken(): Promise<string> {
    if (token && token.until > Date.now()) return token.value;

    const response = await fetch(`${base}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${settings!.consumerKey}:${settings!.consumerSecret}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(25_000),
    });
    const answer = (await response.json().catch(() => ({}))) as { access_token?: string; expires_in?: string | number };
    if (!response.ok || !answer.access_token) {
      throw new Error("M-Pesa did not give the site an access token.");
    }
    const lifetime = Math.max(60, Number(answer.expires_in ?? 3599) - 120);
    token = { value: answer.access_token, until: Date.now() + lifetime * 1000 };
    return token.value;
  }

  async function post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; answer: Record<string, unknown> }> {
    const now = new Date();
    const stamp = timestamp(now);
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        BusinessShortCode: settings!.shortcode,
        Password: Buffer.from(`${settings!.shortcode}${settings!.passkey}${stamp}`).toString("base64"),
        Timestamp: stamp,
        ...body,
      }),
      signal: AbortSignal.timeout(25_000),
    });
    const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: response.ok, answer };
  }

  return {
    async prompt(request) {
      const { ok, answer } = await post("/mpesa/stkpush/v1/processrequest", {
        TransactionType: "CustomerPayBillOnline",
        Amount: request.shillings,
        PartyA: request.phone,
        PartyB: settings.shortcode,
        PhoneNumber: request.phone,
        CallBackURL: request.answerUrl,
        AccountReference: request.reference.slice(0, 12),
        TransactionDesc: "Ukingo stay",
      });

      const checkoutRequestId = typeof answer.CheckoutRequestID === "string" ? answer.CheckoutRequestID : "";
      if (!ok || String(answer.ResponseCode ?? "") !== "0" || !checkoutRequestId) {
        throw new Error(
          String(answer.errorMessage ?? answer.ResponseDescription ?? "M-Pesa did not accept the request."),
        );
      }
      return {
        checkoutRequestId,
        merchantRequestId: typeof answer.MerchantRequestID === "string" ? answer.MerchantRequestID : null,
      };
    },

    async result(checkoutRequestId) {
      const { ok, answer } = await post("/mpesa/stkpushquery/v1/query", { CheckoutRequestID: checkoutRequestId });
      return readQueryAnswer(ok, answer);
    },
  };
}
