// Standard Webhooks verification (https://www.standardwebhooks.com): Bird
// signs {webhook-id}.{webhook-timestamp}.{raw body} with HMAC-SHA256, keyed
// by the base64 bytes behind the secret's whsec_ prefix. Hand-rolled because
// verified community nodes cannot carry runtime dependencies.
import { createHmac, timingSafeEqual } from "node:crypto";

const TOLERANCE_SECONDS = 300;

export function verifyStandardWebhook(
  secret: string,
  webhookId: string,
  webhookTimestamp: string,
  rawBody: string,
  signatureHeader: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret || !webhookId || !signatureHeader) return false;
  const ts = Number(webhookTimestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowSeconds - ts) > TOLERANCE_SECONDS) return false;
  let key: Buffer;
  try {
    key = Buffer.from(
      secret.startsWith("whsec_") ? secret.slice(6) : secret,
      "base64",
    );
  } catch {
    return false;
  }
  if (key.length === 0) return false;
  const expected = createHmac("sha256", key)
    .update(`${webhookId}.${webhookTimestamp}.${rawBody}`)
    .digest();
  for (const part of signatureHeader.split(" ")) {
    const [version, sig] = part.split(",");
    if (version !== "v1" || !sig) continue;
    let candidate: Buffer;
    try {
      candidate = Buffer.from(sig, "base64");
    } catch {
      continue;
    }
    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    )
      return true;
  }
  return false;
}
