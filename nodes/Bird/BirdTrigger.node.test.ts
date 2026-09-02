import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { IHookFunctions, IWebhookFunctions } from "n8n-workflow";
import { BirdTrigger } from "./BirdTrigger.node";
import { birdEvents } from "./generated/events.gen";

const URL = "https://n8n.example/webhook/abc";
const SECRET_KEY = "trigger-key-bytes";
const SECRET = "whsec_" + Buffer.from(SECRET_KEY).toString("base64");

function hookCtx(
  staticData: Record<string, unknown>,
  respond: (opts: { method: string; url: string; body?: unknown }) => unknown,
) {
  const requests: Array<{ method: string; url: string; body?: unknown }> = [];
  const ctx = {
    getNodeWebhookUrl: () => URL,
    getNodeParameter: (name: string) =>
      name === "events" ? ["email.delivered"] : undefined,
    getWorkflowStaticData: () => staticData,
    getNode: () => ({ name: "Bird Trigger", type: "birdTrigger" }),
    getCredentials: async () => ({ apiKey: "bk_eu1_token" }),
    helpers: {
      httpRequestWithAuthentication: async (_c: string, opts: never) => {
        const o = opts as { method: string; url: string; body?: unknown };
        requests.push(o);
        return respond(o);
      },
    },
  };
  return { ctx: ctx as unknown as IHookFunctions, requests };
}

describe("BirdTrigger description", () => {
  it("offers the generated event vocabulary and requires the credential", () => {
    const t = new BirdTrigger();
    expect(t.description.credentials).toEqual([
      { name: "birdApi", required: true },
    ]);
    const events = t.description.properties.find((p) => p.name === "events");
    expect(events?.options).toBe(birdEvents);
    expect(birdEvents.length).toBeGreaterThan(30);
  });
});

describe("BirdTrigger lifecycle", () => {
  it("create registers the webhook and stores id and secret per URL", async () => {
    const staticData: Record<string, unknown> = {};
    const { ctx, requests } = hookCtx(staticData, () => ({
      statusCode: 201,
      body: { id: "wh_1", secret: SECRET },
    }));
    const ok = await new BirdTrigger().webhookMethods.default.create.call(ctx);
    expect(ok).toBe(true);
    expect(requests[0]).toMatchObject({
      method: "POST",
      body: { url: URL, events: ["email.delivered"] },
    });
    expect(staticData.endpoints).toEqual({
      [URL]: { id: "wh_1", secret: SECRET },
    });
  });

  it("checkExists self-heals when the webhook was deleted out-of-band", async () => {
    const staticData = { endpoints: { [URL]: { id: "wh_1", secret: SECRET } } };
    const { ctx } = hookCtx(staticData, () => ({
      statusCode: 404,
      body: { error: { message: "not found" } },
    }));
    const exists =
      await new BirdTrigger().webhookMethods.default.checkExists.call(ctx);
    expect(exists).toBe(false);
    expect(staticData.endpoints).toEqual({});
  });

  it("delete tolerates an already-deleted webhook", async () => {
    const staticData = { endpoints: { [URL]: { id: "wh_1", secret: SECRET } } };
    const { ctx } = hookCtx(staticData, () => ({
      statusCode: 404,
      body: {},
    }));
    const ok = await new BirdTrigger().webhookMethods.default.delete.call(ctx);
    expect(ok).toBe(true);
    expect(staticData.endpoints).toEqual({});
  });
});

describe("BirdTrigger webhook", () => {
  function webhookCtx(staticData: Record<string, unknown>, body: object) {
    const payload = JSON.stringify(body);
    const ts = String(Math.floor(Date.now() / 1000));
    const sig =
      "v1," +
      createHmac("sha256", Buffer.from(SECRET_KEY))
        .update(`evt_1.${ts}.${payload}`)
        .digest("base64");
    const statuses: number[] = [];
    const ctx = {
      getNodeWebhookUrl: () => URL,
      getWorkflowStaticData: () => staticData,
      getBodyData: () => body,
      getHeaderData: () => ({
        "webhook-id": "evt_1",
        "webhook-timestamp": ts,
        "webhook-signature": sig,
      }),
      getRequestObject: () => ({ rawBody: Buffer.from(payload) }),
      getResponseObject: () => ({
        status: (code: number) => {
          statuses.push(code);
          return { json: () => undefined };
        },
      }),
      helpers: { returnJsonArray: (items: unknown[]) => items },
    };
    return { ctx: ctx as unknown as IWebhookFunctions, statuses, sig, ts };
  }

  const stored = () => ({
    endpoints: { [URL]: { id: "wh_1", secret: SECRET } },
  });

  it("verifies the delivery and hands the event to the workflow", async () => {
    const body = { type: "email.delivered", data: { email_id: "em_1" } };
    const { ctx } = webhookCtx(stored(), body);
    const out = await new BirdTrigger().webhook.call(ctx);
    expect(out.workflowData?.[0]).toEqual([body]);
  });

  it("rejects a delivery whose signature does not verify", async () => {
    const data = stored();
    data.endpoints[URL].secret =
      "whsec_" + Buffer.from("wrong-key").toString("base64");
    const { ctx, statuses } = webhookCtx(data, { type: "email.delivered" });
    const out = await new BirdTrigger().webhook.call(ctx);
    expect(out).toEqual({ noWebhookResponse: true });
    expect(statuses).toEqual([401]);
  });

  it("deduplicates on the signed webhook-id and acks the redelivery", async () => {
    const data = stored();
    const body = { type: "email.delivered" };
    const { ctx, statuses } = webhookCtx(data, body);
    const first = await new BirdTrigger().webhook.call(ctx);
    expect(first.workflowData).toBeDefined();
    const second = await new BirdTrigger().webhook.call(ctx);
    expect(second).toEqual({ noWebhookResponse: true });
    // The redelivery must be ACKED: an unanswered request hangs until the
    // server timeout and Bird retries the same id forever.
    expect(statuses).toEqual([200]);
  });
});
