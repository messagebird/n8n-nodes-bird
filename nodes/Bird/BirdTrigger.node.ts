import type {
  IDataObject,
  IHookFunctions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import { birdEvents } from "./generated/events.gen";
import { asNodeError, birdRequest } from "./transport";
import { verifyStandardWebhook } from "./webhook-verify";

interface StoredEndpoint {
  id: string;
  secret: string;
}

// Static data survives workflow restarts; endpoints are keyed by webhook URL
// because the test and production URLs subscribe as separate Bird webhooks.
function endpoints(
  ctx: IHookFunctions | IWebhookFunctions,
): Record<string, StoredEndpoint> {
  const data = ctx.getWorkflowStaticData("node");
  if (typeof data.endpoints !== "object" || data.endpoints === null)
    data.endpoints = {};
  return data.endpoints as Record<string, StoredEndpoint>;
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { httpCode?: unknown }).httpCode === "404"
  );
}

export class BirdTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Bird Trigger",
    name: "birdTrigger",
    icon: { light: "file:bird.svg", dark: "file:bird-dark.svg" },
    group: ["trigger"],
    version: 1,
    subtitle: '={{ ($parameter["events"] || []).join(", ") }}',
    description:
      "Starts a workflow when Bird delivers a subscribed event, such as an email delivery, a bounce, or an inbound SMS. Deliveries are verified as Standard Webhooks before the workflow runs.",
    defaults: { name: "Bird Trigger" },
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [{ name: "birdApi", required: true }],
    webhooks: [
      {
        name: "default",
        httpMethod: "POST",
        responseMode: "onReceived",
        path: "default",
      },
    ],
    properties: [
      {
        displayName: "Events",
        name: "events",
        type: "multiOptions",
        required: true,
        default: [],
        options: birdEvents,
        description:
          "Event types this trigger subscribes to. The Bird webhook is registered automatically and receives only matching events.",
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl("default") as string;
        const store = endpoints(this);
        const entry = store[url];
        if (!entry) return false;
        try {
          await birdRequest(this, {
            method: "GET",
            path: `/v1/webhooks/${entry.id}`,
          });
          return true;
        } catch (error) {
          if (isNotFound(error)) {
            // Deleted out-of-band: drop the stale entry so n8n recreates.
            delete store[url];
            return false;
          }
          throw asNodeError(this.getNode(), error);
        }
      },
      async create(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl("default") as string;
        const events = this.getNodeParameter("events") as string[];
        const res = await birdRequest(this, {
          method: "POST",
          path: "/v1/webhooks",
          body: { url, events },
        });
        const id = res.id as string | undefined;
        const secret = res.secret as string | undefined;
        if (!id || !secret) {
          throw new NodeOperationError(
            this.getNode(),
            "Bird did not return a webhook id and signing secret.",
          );
        }
        endpoints(this)[url] = { id, secret };
        return true;
      },
      async delete(this: IHookFunctions): Promise<boolean> {
        const url = this.getNodeWebhookUrl("default") as string;
        const store = endpoints(this);
        const entry = store[url];
        if (!entry) return true;
        try {
          await birdRequest(this, {
            method: "DELETE",
            path: `/v1/webhooks/${entry.id}`,
          });
        } catch (error) {
          if (!isNotFound(error)) {
            throw asNodeError(this.getNode(), error);
          }
        }
        delete store[url];
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const url = this.getNodeWebhookUrl("default") as string;
    const entry = endpoints(this)[url];
    const headers = this.getHeaderData() as Record<string, string | undefined>;
    const request = this.getRequestObject();
    const rawBody = (request as { rawBody?: unknown }).rawBody;
    const payload =
      typeof rawBody === "string"
        ? rawBody
        : Buffer.isBuffer(rawBody)
          ? rawBody.toString("utf8")
          : JSON.stringify(this.getBodyData() ?? {});

    const id = headers["webhook-id"] ?? "";
    const timestamp = headers["webhook-timestamp"] ?? "";
    const signature = headers["webhook-signature"] ?? "";
    if (
      !entry ||
      !verifyStandardWebhook(entry.secret, id, timestamp, payload, signature)
    ) {
      this.getResponseObject()
        .status(401)
        .json({
          error:
            rawBody === undefined
              ? "Delivery could not be verified: the raw request body is unavailable on this n8n instance."
              : "Invalid webhook signature",
        });
      return { noWebhookResponse: true };
    }

    // Bird delivers at-least-once; the signed webhook-id deduplicates. The
    // redelivery is ACKED — an unanswered request would hang until timeout
    // and Bird would retry the same id forever.
    const data = this.getWorkflowStaticData("node");
    const seen = Array.isArray(data.seenIds) ? (data.seenIds as string[]) : [];
    if (seen.includes(id)) {
      this.getResponseObject().status(200).json({ received: true });
      return { noWebhookResponse: true };
    }
    seen.push(id);
    if (seen.length > 500) seen.splice(0, seen.length - 500);
    data.seenIds = seen;

    return {
      workflowData: [
        this.helpers.returnJsonArray([this.getBodyData() as IDataObject]),
      ],
    };
  }
}
