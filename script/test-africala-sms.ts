/**
 * One-off Africala (SMSala) connectivity check — hits https://api2.smsala.com/SendSmsV2 directly
 * with no database or app involvement, so it is safe to run against production credentials
 * without touching any tenant data.
 *
 *   npx tsx script/test-africala-sms.ts --to +263771234567
 *   npx tsx script/test-africala-sms.ts --to 0771234567 --cc 263 --text "Custom message"
 *
 * Token / Sender ID resolution: --token / --sender flags, else AFRICALA_API_TOKEN /
 * SMS_SENDER_ID env vars. Nothing is persisted.
 */
import { normalizeMsisdn, isGsm7 } from "../server/phone";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apiToken = arg("token") || process.env.AFRICALA_API_TOKEN;
  const sourceAddress = arg("sender") || process.env.SMS_SENDER_ID;
  const rawTo = arg("to");
  const cc = arg("cc"); // dial code for a local "0…" number
  const text = arg("text") || "POL263 test message — Africala connectivity check. Please ignore.";

  if (!apiToken || !sourceAddress || !rawTo) {
    console.error("Need a token, sender, and --to. Example:\n  npx tsx script/test-africala-sms.ts --token XXX --sender POL263 --to +263771234567");
    process.exit(1);
  }

  const destinationAddress = normalizeMsisdn(rawTo, cc);
  const messageEncoding = isGsm7(text) ? "0" : "1";
  const payload = [{ apiToken, messageType: "2", messageEncoding, destinationAddress, sourceAddress, messageText: text }];

  console.log("POST https://api2.smsala.com/SendSmsV2");
  console.log("payload:", JSON.stringify([{ ...payload[0], apiToken: "***" }], null, 2));

  const res = await fetch("https://api2.smsala.com/SendSmsV2", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.text();
  console.log(`\nHTTP ${res.status}`);
  console.log("response:", body);

  try {
    const parsed = JSON.parse(body);
    const first = Array.isArray(parsed) ? parsed[0] : parsed;
    if (first?.OperationCode === 0 && first?.Status === "Success") {
      console.log(`\n✅ Accepted by Africala. MessageId: ${first.MessageId}`);
    } else {
      console.log(`\n❌ Rejected: ${first?.Remarks || first?.Status || "unknown"}`);
    }
  } catch {
    console.log("\n(could not parse response as JSON)");
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
