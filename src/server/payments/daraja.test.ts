import { describe, expect, it } from "vitest";

import { readAskedResult, readQueryAnswer, readResult } from "./daraja";

describe("asking Safaricom what became of a prompt", () => {
  it("hears nothing in an error reply", () => {
    expect(
      readQueryAnswer(false, { errorCode: "500.001.1001", errorMessage: "The transaction is being processed" }),
    ).toBeNull();
    expect(readQueryAnswer(true, {})).toBeNull();
  });

  it("hears nothing in the result code that means the prompt is still open", () => {
    expect(
      readQueryAnswer(true, {
        ResponseCode: "0",
        ResultCode: "4999",
        ResultDesc: "The transaction is still under processing",
      }),
    ).toBeNull();
    expect(readQueryAnswer(true, { ResultCode: 4999 })).toBeNull();
  });

  it("passes on a result once there is one", () => {
    expect(
      readQueryAnswer(true, { ResultCode: "0", ResultDesc: "The service request is processed successfully." }),
    ).toEqual({ code: "0", description: "The service request is processed successfully." });
    expect(readQueryAnswer(true, { ResultCode: 1037, ResultDesc: "DS timeout user cannot be reached." })).toEqual({
      code: "1037",
      description: "DS timeout user cannot be reached.",
    });
  });
});

describe("what a result code means", () => {
  it("is the same whether the result was sent or asked for, for the codes the site knows", () => {
    for (const code of ["0", "1032", "1037", "1019", "2001", "1", "17", "1001", "1025"]) {
      expect(readAskedResult(code)).toEqual(readResult(code));
    }
    // A prompt that never reached the phone is over, even though the site has no special word for it.
    expect(readAskedResult("1025")).toEqual({ status: "failed", failure: "other" });
    expect(readResult("0")).toEqual({ status: "paid" });
    expect(readResult("1032")).toEqual({ status: "failed", failure: "cancelled" });
  });

  it("counts an unknown code as a failure when Safaricom sent it, and as no answer when the site asked", () => {
    expect(readResult("8888")).toEqual({ status: "failed", failure: "other" });
    expect(readAskedResult("8888")).toBeNull();
    expect(readAskedResult("4999")).toBeNull();
  });
});
