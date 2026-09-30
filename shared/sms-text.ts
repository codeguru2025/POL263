/**
 * SMS length / encoding rules, shared by the server (credit counting, sending) and the template
 * editor (live "how many credits" meter). Pure — no app imports.
 *
 * One credit = one SMS part. Plain GSM-7 text fits 160 characters in one part (153 per part once
 * split); a single character outside GSM-7 (emoji, curly quotes, en/em dashes, most accents)
 * switches the WHOLE message to Unicode: 70 characters in one part, 67 per part once split.
 */

// GSM 03.38 default alphabet + extension table. Africala messageEncoding "0" for GSM-7, "1" for
// Unicode — hardcoding "1" doubled the cost of every notification.
const GSM7_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅå" +
  "Δ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
  " !\"#¤%&'()*+,-./0123456789:;<=>?¡" +
  "ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§" +
  "¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM7_EXTENSION = "^{}\\[~]|€\f";
// Extension-table characters take two septets each.
const GSM7_EXTENDED_RE = /[\^{}\\[\]~|€\f]/g;

export const SMS_SINGLE_PART_GSM7 = 160;
export const SMS_SINGLE_PART_UNICODE = 70;

export function isGsm7(text: string): boolean {
  for (const ch of text) {
    if (!GSM7_BASIC.includes(ch) && !GSM7_EXTENSION.includes(ch)) return false;
  }
  return true;
}

/** Billable length: septets for GSM-7, UTF-16 code units for Unicode (an emoji is two). */
export function smsLength(text: string): { length: number; unicode: boolean } {
  const body = String(text ?? "");
  if (isGsm7(body)) return { length: body.length + (body.match(GSM7_EXTENDED_RE)?.length ?? 0), unicode: false };
  return { length: body.length, unicode: true };
}

/** How many billable SMS parts `text` will be sent as. */
export function countSmsSegments(text: string): number {
  const { length, unicode } = smsLength(text);
  if (unicode) return length <= SMS_SINGLE_PART_UNICODE ? 1 : Math.ceil(length / 67);
  return length <= SMS_SINGLE_PART_GSM7 ? 1 : Math.ceil(length / 153);
}

// Look-alike characters that commonly sneak in (typed on a phone, pasted from Word, or in our own
// labels) and would otherwise force the whole message into 70-character Unicode parts.
const LOOKALIKES: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'", "`": "'", "´": "'",
  "“": '"', "”": '"', "„": '"', "″": '"',
  "–": "-", "—": "-", "‒": "-", "―": "-", "−": "-", "‐": "-", "‑": "-",
  "…": "...", "•": "-", "·": "-",
  " ": " ", " ": " ", " ": " ", " ": " ", " ": " ",
  "​": "", "‌": "", "‍": "", "﻿": "",
  "«": '"', "»": '"', "™": "TM", "©": "(c)", "®": "(R)",
};

/**
 * Swap look-alike characters for their plain GSM-7 equivalents (curly quotes, dashes, accents
 * such as "ê" → "e") so one stray character doesn't double or triple what a text costs. Anything
 * with no plain equivalent (emoji, non-Latin scripts) is left as-is.
 */
export function toGsm7(text: string): string {
  const input = String(text ?? "");
  if (isGsm7(input)) return input;
  let out = "";
  for (const ch of input) {
    if (GSM7_BASIC.includes(ch) || GSM7_EXTENSION.includes(ch)) { out += ch; continue; }
    const mapped = LOOKALIKES[ch];
    if (mapped !== undefined) { out += mapped; continue; }
    // Strip accents: "ê" → "e" + combining mark → "e".
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += base && base !== ch && isGsm7(base) ? base : ch;
  }
  return out;
}

/**
 * Longest realistic value per merge tag, used to show a template's worst-case credit cost.
 * Names are generous (long double-barrelled names are common); dates are "2026-12-31".
 */
export const SMS_TAG_MAX_LENGTH: Record<string, number> = {
  "{client_name}": 32, "{name}": 32, "{first_name}": 14, "{last_name}": 16,
  "{birthday_name}": 32, "{member_name}": 32,
  "{policy_number}": 10, "{claim_number}": 10, "{activation_code}": 12,
  "{product_name}": 24, "{org_name}": 28,
  "{premium_amount}": 12, "{payment_amount}": 12, "{balance}": 12, "{outstanding}": 12,
  "{currency}": 3, "{payment_schedule}": 9, "{payment_method}": 14,
  "{effective_date}": 10, "{inception_date}": 10, "{grace_end}": 10, "{waiting_end}": 10,
  "{payment_date}": 10, "{birthday_date}": 10, "{cycle_end}": 10,
  "{status}": 34, "{group_name}": 32, "{anniversary_years}": 2, "{document_label}": 20,
};

/** Credit cost of a template once its tags are filled with the longest realistic values. */
export function smsTemplateWorstCase(template: string): { length: number; segments: number; unicode: boolean } {
  let filled = toGsm7(template);
  for (const [tag, len] of Object.entries(SMS_TAG_MAX_LENGTH)) filled = filled.split(tag).join("x".repeat(len));
  const { length, unicode } = smsLength(filled);
  return { length, unicode, segments: countSmsSegments(filled) };
}
