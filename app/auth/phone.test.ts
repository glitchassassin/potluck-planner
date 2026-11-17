import assert from "node:assert/strict";
import { describe, it } from "remix/test";

import { formatPhoneNumber, parsePhoneNumber } from "./phone.ts";

describe("phone numbers", () => {
  it("normalizes accepted formats and displays the full national number", () => {
    for (const input of [
      "2125550142",
      "12125550142",
      "+12125550142",
      " 1 (212) 555-0142 ",
      "+1.212.555.0142",
      "212 555 0142",
      "(212)5550142",
    ]) {
      assert.equal(parsePhoneNumber(input), "+12125550142", input);
      assert.equal(formatPhoneNumber(input), "(212) 555-0142", input);
    }
  });

  it("accepts U.S. states, D.C., and the supported territories", () => {
    for (const nationalNumber of [
      "9075550142", // Alaska
      "8085550142", // Hawaii
      "2025550142", // D.C.
      "7875550142", // Puerto Rico
      "9395550142", // Puerto Rico overlay
      "3405550142", // U.S. Virgin Islands
      "6715550142", // Guam
      "6847331234", // American Samoa
      "6705550142", // Northern Mariana Islands
    ]) {
      assert.equal(parsePhoneNumber(nationalNumber), `+1${nationalNumber}`);
    }
  });

  it("rejects malformed, unsupported, and non-geographic numbers", () => {
    for (const input of [
      "",
      "212555014",
      "+2125550142",
      "212--555-0142",
      "(212 555-0142",
      "212 (555)-0142",
      "212-555-0142 ext. 3",
      "212-555-0142#3",
      "212-555-CODE",
      "212-911-0142",
      "999-555-0142",
      "+1 (416) 555-0142", // Canada
      "+1 (876) 210-1234", // Jamaica
      "+1 (800) 555-0142", // toll-free
    ]) {
      assert.equal(parsePhoneNumber(input), null, input);
      assert.equal(formatPhoneNumber(input), null, input);
    }
  });
});
