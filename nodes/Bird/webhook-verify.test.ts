import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyStandardWebhook } from "./webhook-verify";

const SECRET = "whsec_" + Buffer.from("test-key-bytes").toString("base64");

function sign(id: string, ts: string, body: string, key = "test-key-bytes") {
  const mac = createHmac("sha256", Buffer.from(key))
    .update(`${id}.${ts}.${body}`)
    .digest("base64");
  return `v1,${mac}`;
}

const NOW = 1_756_000_000;

describe("verifyStandardWebhook", () => {
  const id = "msg_1";
  const ts = String(NOW);
  const body = '{"type":"email.delivered"}';

  it("accepts a correctly signed delivery", () => {
    expect(
      verifyStandardWebhook(SECRET, id, ts, body, sign(id, ts, body), NOW),
    ).toBe(true);
  });

  it("accepts when one of several space-delimited signatures matches", () => {
    const header = `v1,${Buffer.from("garbage").toString("base64")} ${sign(id, ts, body)}`;
    expect(verifyStandardWebhook(SECRET, id, ts, body, header, NOW)).toBe(true);
  });

  it("rejects a wrong signature and a tampered body", () => {
    expect(
      verifyStandardWebhook(SECRET, id, ts, body, sign(id, ts, "{}"), NOW),
    ).toBe(false);
    expect(
      verifyStandardWebhook(
        SECRET,
        id,
        ts,
        body,
        sign(id, ts, body, "other-key"),
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects a timestamp outside the five-minute tolerance", () => {
    const old = String(NOW - 301);
    expect(
      verifyStandardWebhook(SECRET, id, old, body, sign(id, old, body), NOW),
    ).toBe(false);
  });

  it("rejects malformed inputs without throwing", () => {
    expect(
      verifyStandardWebhook("", id, ts, body, sign(id, ts, body), NOW),
    ).toBe(false);
    expect(
      verifyStandardWebhook(SECRET, id, "not-a-number", body, "v1,x", NOW),
    ).toBe(false);
    expect(verifyStandardWebhook(SECRET, id, ts, body, "", NOW)).toBe(false);
  });
});
