import parsePhoneNumberFromString from "libphonenumber-js/max";
import type { CountryCode } from "libphonenumber-js/max";

const supportedRegions = new Set<CountryCode>(["US", "PR", "VI", "GU", "AS", "MP"]);
const phoneSyntax =
  /^(?:\+?1 *(?:[.-] *)?)?(?:\([2-9]\d{2}\)|[2-9]\d{2}) *(?:[.-] *)?[2-9](?!11)\d{2} *(?:[.-] *)?\d{4}$/;

export function parsePhoneNumber(input: string): string | null {
  const text = input.trim();
  if (!phoneSyntax.test(text)) {
    return null;
  }

  const nationalNumber = text.replace(/\D/g, "").slice(-10);
  const phone = parsePhoneNumberFromString(`+1${nationalNumber}`);
  if (!phone?.country || !supportedRegions.has(phone.country)) {
    return null;
  }

  // Shared NANP service codes, such as toll-free numbers, have no geographic assignment.
  const type = phone.getType();
  if (
    type !== "FIXED_LINE_OR_MOBILE" &&
    type !== "FIXED_LINE" &&
    type !== "MOBILE" &&
    type !== "VOIP"
  ) {
    return null;
  }

  return phone.number;
}

export function formatPhoneNumber(input: string): string | null {
  const phone = parsePhoneNumber(input);
  if (phone === null) {
    return null;
  }

  const nationalNumber = phone.slice(2);
  return `(${nationalNumber.slice(0, 3)}) ${nationalNumber.slice(3, 6)}-${nationalNumber.slice(6)}`;
}
