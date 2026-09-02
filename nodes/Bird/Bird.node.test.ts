import { describe, expect, it } from "vitest";
import type { IExecuteFunctions } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";
import { Bird } from "./Bird.node";
import {
  ROW_FROM_ITEM,
  ROW_PROPERTY,
  ROW_PROPERTY_DEFAULT,
  ROW_TYPE,
} from "./transport";
import { birdRoutes } from "./generated/routing.gen";
import { birdProperties } from "./generated/properties.gen";

describe("Bird node description", () => {
  const node = new Bird();
  it("declares the credential and the generated properties", () => {
    expect(node.description.credentials).toEqual([
      { name: "birdApi", required: true },
    ]);
    expect(node.description.properties).toBe(birdProperties);
  });
  it("every operation option resolves to a route", () => {
    const opProps = birdProperties.filter((p) => p.name === "operation");
    expect(opProps.length).toBeGreaterThan(0);
    for (const p of opProps) {
      const resource = (p.displayOptions?.show?.resource as string[])[0];
      for (const o of p.options ?? []) {
        const key = `${resource}:${(o as { value: string }).value}`;
        expect(birdRoutes[key], key).toBeDefined();
      }
    }
  });
  it("every route's params exist as properties or collection options", () => {
    const names = new Set<string>();
    for (const p of birdProperties) {
      names.add(p.name);
      for (const o of p.options ?? []) {
        const name = (o as { name?: string }).name;
        if (typeof name === "string") names.add(name);
      }
    }
    for (const route of Object.values(birdRoutes)) {
      for (const param of [
        ...route.pathParams,
        ...route.query,
        ...route.body,
      ]) {
        // Only the cursor set is owned by the returnAll/limit properties; a
        // wire limit on an unpaginated route renders under a renamed property.
        if (
          route.paginated &&
          ["limit", "starting_after", "ending_before"].includes(param)
        )
          continue;
        const prop =
          Object.entries(route.renames).find(
            ([, wire]) => wire === param,
          )?.[0] ?? param;
        expect(names.has(prop), prop).toBe(true);
      }
      // A wire limit on an unpaginated route has to be renamed: `limit` is the
      // node's own pagination control, so the property would collide with the
      // selector, and without the routing entry the value never reaches the API.
      if (!route.paginated && route.query.includes("limit")) {
        expect(route.renames.max_results, "wire limit rename").toBe("limit");
      }
      for (const [prop, wire] of Object.entries(route.renames)) {
        expect(names.has(prop), prop).toBe(true);
        expect([...route.query, ...route.body], prop).toContain(wire);
      }
    }
  });
  it("no top-level property shadows the selector or pagination names", () => {
    // n8n's Custom API Call injector dereferences the options of any property
    // named resource/operation, and execute() reads these names positionally.
    const reserved = new Set([
      "resource",
      "operation",
      "returnAll",
      "limit",
      "additionalFields",
    ]);
    for (const p of birdProperties) {
      if (!reserved.has(p.name)) continue;
      const ok =
        (p.name === "resource" && p.type === "options") ||
        (p.name === "operation" &&
          p.type === "options" &&
          (p.options?.length ?? 0) > 0) ||
        (p.name === "returnAll" && p.type === "boolean") ||
        (p.name === "limit" && p.type === "number") ||
        (p.name === "additionalFields" && p.type === "collection");
      expect(ok, `${p.displayName} (${p.name}/${p.type})`).toBe(true);
    }
  });
  it("every options-typed property offers at least one option", () => {
    const walk = (props: unknown[], where: string) => {
      for (const p of props as Array<{
        name?: string;
        type?: string;
        options?: unknown[];
        values?: unknown[];
      }>) {
        if (!p || typeof p !== "object") continue;
        if (p.type === "options")
          expect(p.options?.length ?? 0, `${where}/${p.name}`).toBeGreaterThan(
            0,
          );
        if (Array.isArray(p.options)) walk(p.options, `${where}/${p.name}`);
        if (Array.isArray(p.values)) walk(p.values, `${where}/${p.name}`);
      }
    };
    walk(birdProperties as unknown as unknown[], "root");
  });
  it("names an update's collection for what it holds, and reads the same name", () => {
    // The collection name is a stored path, so the routing table and the
    // property table have to agree; an update's optional fields ARE the
    // update, which is the name n8n's own nodes and its lint expect.
    const optional = new Set(["additionalFields", "updateFields"]);
    const rendered = new Map(
      birdProperties
        .filter((p) => p.type === "collection" && optional.has(p.name))
        .map((p) => [
          `${(p.displayOptions?.show?.resource as string[] | undefined)?.[0]}:${(p.displayOptions?.show?.operation as string[] | undefined)?.[0]}`,
          p.name,
        ]),
    );
    for (const [key, route] of Object.entries(birdRoutes)) {
      const want =
        route.method === "PATCH" ? "updateFields" : "additionalFields";
      expect(route.collections, key).toContain(want);
      const shown = rendered.get(key);
      if (shown !== undefined) expect(shown, key).toBe(want);
    }
  });
  it("routes offering a sort read it from the Sort collection", () => {
    // The collection is a stored path, so the routing table and the property
    // table have to name it identically or the values never reach the request.
    for (const [key, route] of Object.entries(birdRoutes)) {
      const sorts = route.query.includes("sort");
      expect(route.collections.includes("sort"), key).toBe(sorts);
      if (!sorts) continue;
      const [resource, operation] = key.split(":");
      const shown = birdProperties.some(
        (p) =>
          p.name === "sort" &&
          p.type === "collection" &&
          (p.displayOptions?.show?.resource as string[] | undefined)?.includes(
            resource,
          ) &&
          (p.displayOptions?.show?.operation as string[] | undefined)?.includes(
            operation,
          ),
      );
      expect(shown, key).toBe(true);
    }
  });
  it("the binary row exposes the members and defaults the runtime falls back to", () => {
    // transport.ts hardcodes these names and both defaults, and no guard on the
    // property side can see that — a rename has to fail here, at the consumer.
    const fields = new Set(
      Object.values(birdRoutes).flatMap((r) => r.binaryFields),
    );
    expect(fields.size).toBeGreaterThan(0);
    const seen = new Set<string>();
    const walk = (props: unknown[]) => {
      for (const p of props as Array<{
        name?: string;
        type?: string;
        options?: unknown[];
        values?: unknown[];
      }>) {
        if (!p || typeof p !== "object") continue;
        if (p.name && fields.has(p.name) && p.type === "fixedCollection") {
          const row = ((p.options?.[0] as { values?: unknown[] })?.values ??
            []) as Array<{
            name?: string;
            default?: unknown;
            options?: Array<{ value?: unknown }>;
          }>;
          const member = (n: string) => row.find((v) => v.name === n);
          // storedRows keys on the group name and on the value being an array;
          // rename either and every editor row reads as an expression's.
          expect(
            (p.options?.[0] as { name?: string })?.name,
            `${p.name} group`,
          ).toBe("items");
          expect(
            (p as { typeOptions?: { multipleValues?: boolean } }).typeOptions
              ?.multipleValues,
            `${p.name} multipleValues`,
          ).toBe(true);
          const selector = member(ROW_TYPE);
          expect(selector?.default, `${p.name} selector default`).toBe(
            ROW_FROM_ITEM,
          );
          expect(
            selector?.options?.map((o) => o.value),
            `${p.name} selector values`,
          ).toContain(ROW_FROM_ITEM);
          expect(
            member(ROW_PROPERTY)?.default,
            `${p.name} property default`,
          ).toBe(ROW_PROPERTY_DEFAULT);
          for (const n of ["content", "filename", "content_type"])
            expect(member(n), `${p.name}.${n}`).toBeDefined();
          seen.add(p.name);
        }
        if (Array.isArray(p.options)) walk(p.options);
        if (Array.isArray(p.values)) walk(p.values);
      }
    };
    walk(birdProperties as unknown as unknown[]);
    expect([...seen].sort()).toEqual([...fields].sort());
  });
  it("every topLevel name is a top-level property", () => {
    // getNodeParameter throws on a name with no stored value, so execute()
    // may only read names that exist as top-level properties.
    const topNames = new Set(birdProperties.map((p) => p.name));
    for (const [key, route] of Object.entries(birdRoutes)) {
      for (const n of route.topLevel) {
        expect(topNames.has(n), `${key}: ${n}`).toBe(true);
      }
    }
  });
});

// Faithful to n8n-core's _getNodeParameter: a lodash `get` over the STORED
// editor parameters with the caller's fallback, then a throw when the result
// is undefined — an explicit undefined fallback does not save the lookup, and
// description defaults are never consulted.
function execCtx(
  stored: Record<string, unknown>,
  requests: unknown[],
  binaries: Record<
    string,
    { fileName?: string; fileExtension?: string; mimeType: string }
  > = {},
  bytes: Record<string, string> = {},
) {
  return {
    getInputData: () => [{ json: {} }],
    getNode: () => ({ name: "Bird", type: "bird", typeVersion: 1 }),
    continueOnFail: () => false,
    getNodeParameter: (name: string, _i: number, ...rest: unknown[]) => {
      const value = stored[name] !== undefined ? stored[name] : rest[0];
      if (value === undefined)
        throw new Error(`Could not get parameter "${name}"`);
      return value;
    },
    getCredentials: async () => ({ apiKey: "bk_eu1_token" }),
    getExecutionId: () => "exec42",
    evaluateExpression: () => 0,
    getTimezone: () => "Europe/Amsterdam",
    helpers: {
      httpRequestWithAuthentication: async (
        _cred: string,
        opts: unknown,
      ): Promise<unknown> => {
        requests.push(opts);
        return { statusCode: 200, body: { data: [{ id: "m1" }] } };
      },
      assertBinaryData: (_i: number, prop: string) => {
        const meta = binaries[prop];
        // n8n-core raises a NodeOperationError here, which asNodeError passes
        // through; a plain Error would be relabelled as something the API said.
        if (!meta)
          throw new NodeOperationError(
            { name: "Bird", type: "bird", typeVersion: 1 } as never,
            `The item has no binary field "${prop}"`,
          );
        return meta;
      },
      getBinaryDataBuffer: async (_i: number, prop: string) =>
        Buffer.from(bytes[prop] ?? ""),
    },
  };
}

describe("Bird node execute", () => {
  it("lists with a created_after filter; pagination params stay runtime-owned", async () => {
    const requests: Array<{ qs?: Record<string, unknown> }> = [];
    const ctx = execCtx(
      {
        resource: "email",
        operation: "list",
        additionalFields: { created_after: "2026-08-01T00:00:00Z" },
      },
      requests,
    );
    const out = await new Bird().execute.call(
      ctx as unknown as IExecuteFunctions,
    );
    expect(requests).toHaveLength(1);
    expect(requests[0].qs).toEqual({
      created_after: "2026-08-01T00:00:00Z",
      limit: 50,
    });
    expect(out[0][0].json).toEqual({ id: "m1" });
  });

  it("sends the Sort collection's own values, which no longer ride Additional Fields", async () => {
    const requests: Array<{ qs?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "domains",
          operation: "list",
          sort: { sort: "created_at", order: "desc" },
        },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].qs).toMatchObject({ sort: "created_at", order: "desc" });
  });

  it("sends a stable Idempotency-Key on routes that accept one", async () => {
    const requests: Array<{ headers?: Record<string, unknown> }> = [];
    const run = () =>
      new Bird().execute.call(
        execCtx(
          {
            resource: "email",
            operation: "send",
            from: "noreply@example.com",
            to: "a@example.com",
            additionalFields: { subject: "hi" },
          },
          requests,
        ) as unknown as IExecuteFunctions,
      );
    await run();
    await run(); // a retry inside the same execution reuses the key
    expect(requests).toHaveLength(2);
    const key = requests[0].headers?.["Idempotency-Key"];
    expect(key).toBe("n8n/exec42/0/Bird/0");
    expect(requests[1].headers?.["Idempotency-Key"]).toBe(key);
  });

  it("wraps array-typed fields and splits comma-separated input", async () => {
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "email",
          operation: "send",
          from: "noreply@example.com",
          to: "a@example.com, b@example.com",
          additionalFields: { subject: "hi" },
        },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].body?.to).toEqual(["a@example.com", "b@example.com"]);
    expect(requests[0].body?.from).toBe("noreply@example.com");
  });

  it("sends an array-root body through the generated items field", async () => {
    const requests: Array<{ body?: unknown }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "email",
          operation: "send_batch",
          items: '[{"to": ["a@example.com"], "subject": "hi"}]',
          additionalFields: {},
        },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].body).toEqual([
      { to: ["a@example.com"], subject: "hi" },
    ]);
  });

  it("parses a json-typed member nested inside a struct", async () => {
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "whatsapp",
          operation: "send",
          to: "+14155551234",
          additionalFields: {
            template: {
              values: {
                slug: "order_update",
                components:
                  '[{"type":"body","parameters":[{"type":"text","text":"R42"}]}]',
              },
            },
          },
        },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    const template = requests[0].body?.template as Record<string, unknown>;
    expect(template.components).toEqual([
      { type: "body", parameters: [{ type: "text", text: "R42" }] },
    ]);
  });

  it("sends no Idempotency-Key on routes that do not take one", async () => {
    const requests: Array<{ headers?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        { resource: "email", operation: "list", additionalFields: {} },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].headers?.["Idempotency-Key"]).toBeUndefined();
  });

  it("issues a route whose optional collection was never rendered", async () => {
    // 74 routes record additionalFields in `collections` and render no such
    // property, because the operation has no optional inputs. execute() reads
    // every listed collection with a {} fallback, which n8n-core returns
    // instead of throwing — drop the fallback and this route dies before its
    // request.
    const requests: Array<{ url?: string; method?: string }> = [];
    await new Bird().execute.call(
      execCtx(
        { resource: "email", operation: "get", message_id: "m1" },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].method).toBe("GET");
    expect(requests[0].url).toContain("/v1/email/messages/m1");
  });

  it("sends a template from the fixedCollection editor shape", async () => {
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "sms",
          operation: "send",
          to: "+14155551234",
          additionalFields: {
            template: {
              values: {
                slug: "bird_pickup_ready",
                parameters: { pairs: [{ key: "ref", value: "R42" }] },
              },
            },
          },
        },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].body).toEqual({
      to: "+14155551234",
      template: { slug: "bird_pickup_ready", parameters: { ref: "R42" } },
    });
  });

  it("parses json-typed fields the editor stores as strings", async () => {
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "sms",
          operation: "send",
          to: "+14155551234",
          additionalFields: {
            template:
              '{"slug": "bird_pickup_ready", "parameters": {"ref": "R42"}}',
          },
        },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].body).toEqual({
      to: "+14155551234",
      template: { slug: "bird_pickup_ready", parameters: { ref: "R42" } },
    });
  });

  it("rejects invalid JSON in a json-typed field with the field named", async () => {
    const requests: unknown[] = [];
    await expect(
      new Bird().execute.call(
        execCtx(
          {
            resource: "sms",
            operation: "send",
            to: "+14155551234",
            additionalFields: { template: "{slug: nope" },
          },
          requests,
        ) as unknown as IExecuteFunctions,
      ),
    ).rejects.toThrow(/template.*JSON/);
  });

  it("flattens a non-paginated collection into one item per row", async () => {
    const requests: unknown[] = [];
    const ctx = execCtx(
      { resource: "sms_templates", operation: "list", additionalFields: {} },
      requests,
    );
    (
      ctx as { helpers: { httpRequestWithAuthentication: unknown } }
    ).helpers.httpRequestWithAuthentication = async () => ({
      statusCode: 200,
      body: { data: [{ id: "t1" }, { id: "t2" }] },
    });
    const out = await new Bird().execute.call(
      ctx as unknown as IExecuteFunctions,
    );
    expect(out[0]).toHaveLength(2);
    expect(out[0][0].json).toEqual({ id: "t1" });
    expect(out[0][1].json).toEqual({ id: "t2" });
  });

  it("completes a naive picker datetime with the workflow timezone", async () => {
    const requests: Array<{ qs?: Record<string, unknown> }> = [];
    const ctx = execCtx(
      {
        resource: "email",
        operation: "list",
        additionalFields: { created_after: "2026-08-28T00:00:00" },
      },
      requests,
    );
    await new Bird().execute.call(ctx as unknown as IExecuteFunctions);
    expect(requests[0].qs).toEqual({
      created_after: "2026-08-28T00:00:00+02:00",
      limit: 50,
    });
  });
  const sendWithAttachments = async (
    rows: Array<Record<string, unknown>>,
    binaries: Record<
      string,
      { fileName?: string; fileExtension?: string; mimeType: string }
    > = {},
    bytes: Record<string, string> = {},
  ) => {
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "email",
          operation: "send",
          from: "sales@acme.com",
          to: ["buyer@acme.com"],
          additionalFields: { attachments: { items: rows } },
        },
        requests,
        binaries,
        bytes,
      ) as unknown as IExecuteFunctions,
    );
    return requests[0].body?.attachments as Array<Record<string, unknown>>;
  };

  it("attaches the item's binary from the row n8n actually stores", async () => {
    // The commonest row of all — added, left on both defaults — reaches execute()
    // carrying neither member, and reading the selector literally attaches nothing.
    const sent = await sendWithAttachments(
      [{}],
      { data: { fileName: "invoice.pdf", mimeType: "application/pdf" } },
      { data: "hello" },
    );
    expect(sent).toEqual([
      {
        content: Buffer.from("hello").toString("base64"),
        filename: "invoice.pdf",
        content_type: "application/pdf",
      },
    ]);
  });

  it("lets the row override the file's own name and type", async () => {
    const sent = await sendWithAttachments(
      [
        {
          attachmentType: "binary",
          binaryPropertyName: "statement",
          filename: "statement.pdf",
          content_type: "application/octet-stream",
        },
      ],
      { statement: { fileName: "tmp-9f2.bin", mimeType: "application/pdf" } },
      { statement: "x" },
    );
    expect(sent).toEqual([
      {
        content: Buffer.from("x").toString("base64"),
        filename: "statement.pdf",
        content_type: "application/octet-stream",
      },
    ]);
  });

  it("names the binary property when the file carries no name of its own", async () => {
    const sent = await sendWithAttachments(
      [{ binaryPropertyName: "report" }],
      { report: { fileName: "", fileExtension: "csv", mimeType: "text/csv" } },
      { report: "a,b" },
    );
    expect(sent[0].filename).toBe("report.csv");
  });

  it("names a binary the item does not carry", async () => {
    await expect(
      sendWithAttachments([
        { attachmentType: "binary", binaryPropertyName: "invoice" },
      ]),
    ).rejects.toThrow(/invoice/);
  });

  it("omits a row whose binary field was cleared", async () => {
    // The filename is what makes this worth pinning: without it the row folds
    // away on its own, and the promise looks kept for the wrong reason.
    const sent = await sendWithAttachments([
      { attachmentType: "binary", binaryPropertyName: "  ", filename: "a.pdf" },
    ]);
    expect(sent).toBeUndefined();
  });

  it("keeps the manual row's base64 and strips the node-only members", async () => {
    // A manual row does store its selector, since "manual" is not the default.
    const sent = await sendWithAttachments([
      {
        attachmentType: "manual",
        binaryPropertyName: "data",
        filename: "note.txt",
        content: "aGk=",
      },
    ]);
    expect(sent).toEqual([{ filename: "note.txt", content: "aGk=" }]);
  });

  it("takes an expression's own rows literally", async () => {
    // An expression's array is API rows, not editor storage: no member was
    // omitted, so a row the API rejects has to reach it rather than vanish here.
    const requests: Array<{ body?: Record<string, unknown> }> = [];
    await new Bird().execute.call(
      execCtx(
        {
          resource: "email",
          operation: "send",
          from: "sales@acme.com",
          to: ["buyer@acme.com"],
          additionalFields: {
            attachments: [
              { filename: "note.txt", content: "aGk=" },
              { filename: "receipt.pdf" },
              "oops",
            ],
          },
        },
        requests,
      ) as unknown as IExecuteFunctions,
    );
    expect(requests[0].body?.attachments).toEqual([
      { filename: "note.txt", content: "aGk=" },
      { filename: "receipt.pdf" },
      "oops",
    ]);
  });

  it("reads bytes already in an authored row as the row's own", async () => {
    // The editor cannot produce this shape — it hides Content on the binary half —
    // so content, not the storage shape, says the row already means what it carries.
    const sent = await sendWithAttachments([
      { filename: "note.txt", content: "aGk=" },
    ]);
    expect(sent).toEqual([{ filename: "note.txt", content: "aGk=" }]);
  });

  it("names the encoded size rather than relaying a 413", async () => {
    // The ceiling is the API's decimal 20 MB over the encoded value, not 20
    // MiB — quoting the larger figure would pass a send the server rejects.
    await expect(
      sendWithAttachments(
        [{ binaryPropertyName: "big" }],
        { big: { fileName: "big.iso", mimeType: "application/octet-stream" } },
        { big: "z".repeat(15_100_000) },
      ),
    ).rejects.toThrow(/20\.1 MB.*20\.0 MB/);
  });
});
