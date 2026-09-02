import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";

import { birdProperties } from "./generated/properties.gen";
import { birdRoutes } from "./generated/routing.gen";
import { birdListSearch } from "./pickers";
import {
  asNodeError,
  birdRequest,
  buildRequest,
  collectPages,
  resolveBinary,
} from "./transport";

export class Bird implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Bird",
    name: "bird",
    icon: { light: "file:bird.svg", dark: "file:bird-dark.svg" },
    group: ["output"],
    version: 1,
    subtitle: '={{ $parameter["operation"] + ": " + $parameter["resource"] }}',
    description: "Send email over Bird and read your sending data",
    defaults: { name: "Bird" },
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    usableAsTool: true,
    credentials: [{ name: "birdApi", required: true }],
    properties: birdProperties,
  };

  methods = { listSearch: birdListSearch() };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter("resource", i) as string;
        const operation = this.getNodeParameter("operation", i) as string;
        const route = birdRoutes[`${resource}:${operation}`];
        if (!route) {
          throw new NodeOperationError(
            this.getNode(),
            `Unknown operation ${resource}:${operation}`,
          );
        }

        // Optional values arrive through the route's collections; the only
        // names safe to read top-level are route.topLevel — n8n resolves
        // stored parameters and throws on any other name.
        const values: IDataObject = {};
        for (const name of route.collections) {
          Object.assign(
            values,
            this.getNodeParameter(name, i, {}) as IDataObject,
          );
        }
        for (const name of route.topLevel) {
          const v = this.getNodeParameter(name, i, null);
          if (v !== null && v !== undefined)
            values[name] = v as IDataObject[string];
        }

        await resolveBinary(this, route, values, i);

        const { path, qs, body } = buildRequest(
          this.getNode(),
          route,
          values as Record<string, unknown>,
          this.getTimezone(),
          i,
        );

        if (route.paginated) {
          const returnAll = this.getNodeParameter(
            "returnAll",
            i,
            false,
          ) as boolean;
          const limit = this.getNodeParameter("limit", i, 50) as number;
          const rows = await collectPages(
            (cursor) =>
              birdRequest(this, {
                method: route.method,
                path,
                qs: {
                  ...qs,
                  limit: returnAll ? 100 : Math.min(limit, 100),
                  ...(cursor ? { starting_after: cursor } : {}),
                },
                itemIndex: i,
              }) as Promise<{ data?: unknown[]; next_cursor?: string }>,
            returnAll,
            limit,
          );
          for (const row of rows)
            out.push({ json: row as IDataObject, pairedItem: { item: i } });
          continue;
        }

        // Stable within one execution run, so n8n's Retry On Fail replays
        // the same key and Bird deduplicates instead of double-sending. The
        // run index keeps loop iterations distinct, and the node name is
        // encoded because header values must stay in Latin-1.
        let runIndex = "0";
        try {
          runIndex = String(this.evaluateExpression("{{ $runIndex }}", i));
        } catch {
          // An execution context without expressions keeps the default.
        }
        const headers = route.idempotencyHeader
          ? {
              "Idempotency-Key":
                `n8n/${this.getExecutionId()}/${runIndex}/${encodeURIComponent(this.getNode().name)}/${i}`.slice(
                  0,
                  255,
                ),
            }
          : undefined;
        const res = await birdRequest(this, {
          method: route.method,
          path,
          qs,
          body,
          headers,
          itemIndex: i,
        });
        // A collection body is rows wrapped in {data: []}; n8n items are the
        // rows, matching how the paginated branch already emits them.
        if (route.collection) {
          for (const row of (res as { data?: unknown[] }).data ?? [])
            out.push({ json: row as IDataObject, pairedItem: { item: i } });
          continue;
        }
        out.push({ json: res as IDataObject, pairedItem: { item: i } });
      } catch (error) {
        if (this.continueOnFail()) {
          // The remediation and the per-field details ride the description, so
          // dropping it leaves the branch that keeps running with the least
          // actionable half of what Bird said.
          const { message, description } = error as {
            message: string;
            description?: string;
          };
          out.push({
            json: description
              ? { error: message, description }
              : { error: message },
            pairedItem: { item: i },
          });
          continue;
        }
        throw asNodeError(this.getNode(), error, i);
      }
    }
    return [out];
  }
}
