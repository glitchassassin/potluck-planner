import { usAreaCodes } from "./us-area-codes.ts";

const phoneSyntax =
  /^(?:\+?1 *(?:[.-] *)?)?(?:\([2-9]\d{2}\)|[2-9]\d{2}) *(?:[.-] *)?[2-9](?!11)\d{2} *(?:[.-] *)?\d{4}$/;

export function parsePhoneNumber(input: string): string | null {
  const text = input.trim();
  if (!phoneSyntax.test(text)) {
    return null;
  }

  const nationalNumber = text.replace(/\D/g, "").slice(-10);
  if (!usAreaCodes.has(nationalNumber.slice(0, 3))) {
    return null;
  }

  return `+1${nationalNumber}`;
}

export function formatPhoneNumber(input: string): string | null {
  const phone = parsePhoneNumber(input);
  if (phone === null) {
    return null;
  }

  const nationalNumber = phone.slice(2);
  return `(${nationalNumber.slice(0, 3)}) ${nationalNumber.slice(3, 6)}-${nationalNumber.slice(6)}`;
}
