import { describe, expect, it } from "vitest";
import {
  baseUrlForKey,
  birdErrorParts,
  compact,
  completeDateTime,
} from "./transport";

describe("baseUrlForKey", () => {
  it("derives the regional host from the key prefix", () => {
    expect(baseUrlForKey("bk_eu1_abcdef123456")).toBe(
      "https://eu1.platform.bird.com",
    );
    expect(baseUrlForKey("bk_us2_abcdef123456")).toBe(
      "https://us2.platform.bird.com",
    );
  });
  it("rejects anything that is not bk_{region}_{token}", () => {
    for (const bad of [
      "",
      "bk_eu1_",
      "bt_eu1_tok",
      "bk_EU1_tok",
      "bk_nounderscore",
      "sk_eu1_tok",
    ]) {
      expect(() => baseUrlForKey(bad)).toThrow(/bk_\{region\}_\{token\}/);
    }
  });
});

describe("birdErrorParts", () => {
  it("surfaces message, remediation, and per-param details", () => {
    const { message, description } = birdErrorParts(422, {
      error: {
        code: "E12001",
        name: "EmailValidationError",
        message: "The from address is not on a verified domain.",
        remediation:
          "Verify the domain in Bird, or send from the shared onboarding domain.",
        details: [
          { param: "from", message: "domain acme.test is not verified" },
        ],
      },
    });
    expect(message).toBe("The from address is not on a verified domain.");
    expect(description).toContain("Verify the domain in Bird");
    expect(description).toContain("from: domain acme.test is not verified");
  });
  it("falls back to the status code when the body is not Bird's shape", () => {
    const { message } = birdErrorParts(502, "gateway blew up");
    expect(message).toBe("Bird returned an unexpected error (HTTP 502).");
  });
});

describe("compact", () => {
  it("drops blanks so an empty filter is omitted, never sent", () => {
    expect(
      compact({
        a: "",
        b: "  ",
        c: null,
        d: undefined,
        e: [],
        f: "x ",
        g: 0,
        h: false,
        i: ["", "y"],
      }),
    ).toEqual({ f: "x", g: 0, h: false, i: ["y"] });
  });
});

import type { INode } from "n8n-workflow";

import { buildRequest, collectPages, type BirdRoute } from "./transport";

// buildRequest attaches its validation errors to the node n8n shows them on.
const req = (
  route: BirdRoute,
  values: Record<string, unknown>,
  zone?: string,
) => buildRequest({ name: "Bird" } as INode, route, values, zone);

const listRoute: BirdRoute = {
  method: "GET",
  path: "/v1/email/messages",
  pathParams: [],
  topLevel: [],
  query: ["status", "tag", "to"],
  body: [],
  paginated: true,
  collection: true,
  jsonFields: [],
  structured: {},
  renames: {},
  arrayFields: [],
  nullableFields: [],
  dateTimeFields: [],
  rawBodyField: "",
  idempotencyHeader: false,
  scopes: ["emails"],
};

describe("birdErrorParts rate limiting", () => {
  it("surfaces Retry-After on a 429", () => {
    const { description } = birdErrorParts(429, {}, { "retry-after": "30" });
    expect(description).toContain("Retry after 30 second(s).");
  });
  it("falls back to ratelimit-reset and stays quiet without either", () => {
    const { description } = birdErrorParts(429, {}, { "ratelimit-reset": "7" });
    expect(description).toContain("Retry after 7 second(s).");
    expect(birdErrorParts(429, {}, {}).description).not.toContain(
      "Retry after",
    );
  });
});

describe("completeDateTime", () => {
  it("completes a naive picker value with the workflow zone's offset", () => {
    expect(completeDateTime("2026-08-28T00:00:00", "Europe/Amsterdam")).toBe(
      "2026-08-28T00:00:00+02:00",
    );
    expect(completeDateTime("2026-01-15T12:00:00", "Europe/Amsterdam")).toBe(
      "2026-01-15T12:00:00+01:00",
    );
    expect(completeDateTime("2026-08-28T00:00", "UTC")).toBe(
      "2026-08-28T00:00:00+00:00",
    );
  });
  it("leaves offset-carrying, date-only, and non-date values alone", () => {
    expect(completeDateTime("2026-08-28T00:00:00Z", "Europe/Amsterdam")).toBe(
      "2026-08-28T00:00:00Z",
    );
    expect(
      completeDateTime("2026-08-28T00:00:00+05:30", "Europe/Amsterdam"),
    ).toBe("2026-08-28T00:00:00+05:30");
    expect(completeDateTime("2026-08-28", "Europe/Amsterdam")).toBe(
      "2026-08-28",
    );
    expect(completeDateTime("category:welcome", "Europe/Amsterdam")).toBe(
      "category:welcome",
    );
  });
  it("falls back to UTC when the zone is unknown", () => {
    expect(completeDateTime("2026-08-28T00:00:00", "Not/AZone")).toBe(
      "2026-08-28T00:00:00Z",
    );
  });
});

describe("buildRequest nullable clears", () => {
  const route = {
    method: "PATCH",
    path: "/v1/email/inbound-routes/r1",
    pathParams: [],
    topLevel: [],
    query: [],
    body: ["match_value", "enabled"],
    jsonFields: [],
    structured: {},
    renames: {},
    arrayFields: [],
    dateTimeFields: [],
    nullableFields: ["match_value"],
    rawBodyField: "",
    paginated: false,
    collection: false,
    idempotencyHeader: true,
    scopes: ["emails"],
  };
  it("sends an explicit null for a nullable field as the clear operation", () => {
    const { body } = req(route, { match_value: null, enabled: true });
    expect(body).toEqual({ match_value: null, enabled: true });
  });
  it("still drops null on non-nullable fields", () => {
    const { body } = req(route, { enabled: null });
    expect(body).toEqual({});
  });
});

describe("buildRequest array conversion", () => {
  const route: BirdRoute = {
    method: "PATCH",
    path: "/v1/email/threads/t1",
    pathParams: [],
    topLevel: [],
    query: [],
    body: ["labels", "events"],
    jsonFields: [],
    structured: { labels: "struct" },
    renames: {},
    arrayFields: ["events", "labels.add", "labels.remove"],
    nullableFields: [],
    dateTimeFields: [],
    rawBodyField: "",
    paginated: false,
    collection: false,
    idempotencyHeader: true,
    scopes: ["mailbox"],
  };
  it("splits comma strings into arrays, including struct members by dotted name", () => {
    const { body } = req(route, {
      events: "delivered,opened",
      labels: { values: { add: "unread", remove: " spam , archive " } },
    });
    expect(body).toEqual({
      events: ["delivered", "opened"],
      labels: { add: ["unread"], remove: ["spam", "archive"] },
    });
  });
});

describe("buildRequest structured fields", () => {
  const route = {
    method: "POST",
    path: "/v1/sms/messages",
    pathParams: [],
    topLevel: ["to"],
    query: [],
    body: ["to", "template", "metadata"],
    jsonFields: [],
    structured: { template: "struct", metadata: "map" },
    renames: {},
    arrayFields: [],
    nullableFields: [],
    dateTimeFields: [],
    rawBodyField: "",
    paginated: false,
    collection: false,
    idempotencyHeader: true,
    scopes: ["sms"],
  };
  it("folds a struct collection's nested pair rows and drops empty members", () => {
    const { body } = req(route, {
      to: "+14155551234",
      template: {
        slug: "bird_pickup_ready",
        parameters: { pairs: [{ key: "ref", value: "R42" }] },
      },
    });
    expect(body).toEqual({
      to: "+14155551234",
      template: { slug: "bird_pickup_ready", parameters: { ref: "R42" } },
    });
  });
  it("folds a map's pair rows and drops blank keys", () => {
    const { body } = req(route, {
      to: "+1",
      metadata: {
        pairs: [
          { key: "order", value: "o_1" },
          { key: "", value: "ignored" },
        ],
      },
    });
    expect(body.metadata).toEqual({ order: "o_1" });
  });
  it("passes an expression-supplied object through and parses a string", () => {
    const direct = { slug: "s", parameters: { ref: "R" } };
    expect(req(route, { to: "+1", template: direct }).body.template).toEqual(
      direct,
    );
    expect(
      req(route, { to: "+1", template: JSON.stringify(direct) }).body.template,
    ).toEqual(direct);
  });
  it("drops a structured field that unwraps to nothing", () => {
    const { body } = req(route, {
      to: "+1",
      template: { values: {} },
      metadata: { pairs: [] },
    });
    expect(body).toEqual({ to: "+1" });
  });
});

describe("buildRequest", () => {
  it("splits values by route placement and drops blanks", () => {
    const r = req(listRoute, {
      status: "delivered",
      tag: [],
      to: " a@b.c ",
    });
    expect(r).toEqual({
      path: "/v1/email/messages",
      qs: { status: "delivered", to: "a@b.c" },
      body: {},
    });
  });
  it("restores the wire name of a renamed property", () => {
    // The node owns the property name `limit`, so a wire limit renders as
    // max_results; without the restore the API never sees the cap and the
    // request silently returns the server's own page instead.
    const r = req(
      { ...listRoute, query: ["limit"], renames: { max_results: "limit" } },
      { max_results: 25 },
    );
    expect(r.qs).toEqual({ limit: 25 });
  });
  it("substitutes and encodes path params", () => {
    const route: BirdRoute = {
      ...listRoute,
      path: "/v1/email/messages/{message_id}",
      pathParams: ["message_id"],
      query: [],
      paginated: false,
    };
    const r = req(route, { message_id: "em_01/x" });
    expect(r.path).toBe("/v1/email/messages/em_01%2Fx");
  });
  it("attributes a validation error to its input item", () => {
    // n8n prints [Item X] from the index the error carries; the node's catch
    // cannot add it, since re-wrapping a NodeError ignores its options.
    const route: BirdRoute = {
      ...listRoute,
      path: "/v1/email/messages/{message_id}",
      pathParams: ["message_id"],
    };
    let thrown: unknown;
    try {
      buildRequest({ name: "Bird" } as INode, route, {}, undefined, 3);
    } catch (e) {
      thrown = e;
    }
    expect(
      (thrown as { context?: { itemIndex?: number } }).context?.itemIndex,
    ).toBe(3);
  });
  it("throws when a path param is blank — a blank id must not become a list call", () => {
    const route: BirdRoute = {
      ...listRoute,
      path: "/v1/email/messages/{message_id}",
      pathParams: ["message_id"],
    };
    expect(() => req(route, { message_id: " " })).toThrow(/message_id/);
  });
});

describe("collectPages", () => {
  const pages: Record<string, { data: number[]; next_cursor?: string }> = {
    start: { data: [1, 2], next_cursor: "c2" },
    c2: { data: [3, 4], next_cursor: "c3" },
    c3: { data: [5] },
  };
  const fetchPage = async (cursor?: string) => pages[cursor ?? "start"];
  it("follows next_cursor to the end when returnAll", async () => {
    expect(await collectPages(fetchPage, true, 0)).toEqual([1, 2, 3, 4, 5]);
  });
  it("stops at limit without returnAll", async () => {
    expect(await collectPages(fetchPage, false, 3)).toEqual([1, 2, 3]);
  });
});

describe("buildRequest resource locators", () => {
  const route: BirdRoute = {
    ...listRoute,
    path: "/v1/email/mailboxes/{mailbox_id}/messages",
    pathParams: ["mailbox_id"],
    query: [],
  };
  it("resolves a locator to the raw id — unresolved it reaches the API as an object", () => {
    const { path } = req(route, {
      mailbox_id: { __rl: true, mode: "list", value: "mbx_1" },
    });
    expect(path).toBe("/v1/email/mailboxes/mbx_1/messages");
  });
  it("takes a bare string too, which is what an expression resolves to", () => {
    const { path } = req(route, { mailbox_id: "mbx_2" });
    expect(path).toBe("/v1/email/mailboxes/mbx_2/messages");
  });
});

describe("buildRequest repeatable lists", () => {
  const route: BirdRoute = {
    method: "POST",
    path: "/v1/email/messages",
    pathParams: [],
    topLevel: ["to"],
    collections: ["additionalFields"],
    query: [],
    body: ["to"],
    jsonFields: [],
    structured: {},
    renames: {},
    arrayFields: ["to"],
    dateTimeFields: [],
    nullableFields: [],
    rawBodyField: "",
    paginated: false,
    collection: false,
    idempotencyHeader: true,
    scopes: ["emails"],
  };
  it("passes the editor's array through and still splits a string", () => {
    expect(req(route, { to: ["a@b.c", " d@e.f "] }).body).toEqual({
      to: ["a@b.c", "d@e.f"],
    });
    expect(req(route, { to: "a@b.c, d@e.f" }).body).toEqual({
      to: ["a@b.c", "d@e.f"],
    });
  });
});

describe("buildRequest list collections", () => {
  const route: BirdRoute = {
    method: "POST",
    path: "/v1/contacts/batch",
    pathParams: [],
    topLevel: ["contacts"],
    collections: ["additionalFields"],
    query: [],
    body: ["contacts", "tags"],
    jsonFields: [],
    structured: { contacts: "list", tags: "list" },
    renames: {},
    arrayFields: [],
    dateTimeFields: [],
    nullableFields: [],
    rawBodyField: "",
    paginated: false,
    collection: false,
    idempotencyHeader: true,
    scopes: ["contacts"],
  };
  it("unwraps the editor's rows, folding a map member and dropping untouched ones", () => {
    const { body } = req(route, {
      contacts: {
        items: [
          {
            email: "a@b.c",
            first_name: "",
            data: { pairs: [{ key: "plan", value: "pro" }] },
          },
        ],
      },
      tags: { items: [{ name: "Category", value: "welcome" }] },
    });
    expect(body).toEqual({
      contacts: [{ email: "a@b.c", data: { plan: "pro" } }],
      tags: [{ name: "Category", value: "welcome" }],
    });
  });
  it("keeps an expression's own array and drops a list left empty", () => {
    const { body } = req(route, {
      contacts: [{ email: "a@b.c" }],
      tags: { items: [] },
    });
    expect(body).toEqual({ contacts: [{ email: "a@b.c" }] });
  });
  it("still parses a JSON string, which is what an expression supplies", () => {
    const { body } = req(route, {
      contacts: '[{"email":"a@b.c"}]',
    });
    expect(body).toEqual({ contacts: [{ email: "a@b.c" }] });
  });
});

describe("buildRequest required fields", () => {
  const route: BirdRoute = {
    method: "POST",
    path: "/v1/email/messages",
    pathParams: [],
    topLevel: ["from", "to"],
    collections: ["additionalFields"],
    query: [],
    body: ["from", "to"],
    jsonFields: [],
    structured: {},
    renames: {},
    arrayFields: ["to"],
    dateTimeFields: [],
    nullableFields: [],
    rawBodyField: "",
    paginated: false,
    collection: false,
    idempotencyHeader: true,
    scopes: ["emails"],
  };
  // n8n raises its own editor-time issue for a blank required field, but not
  // for a repeatable one: its check iterates the array, so an empty list
  // reports nothing and the request would leave without the field.
  it("names the empty repeatable field rather than letting the API answer", () => {
    expect(() => req(route, { from: "a@b.c", to: [] })).toThrow(
      /to is required/,
    );
    expect(() => req(route, { from: "a@b.c" })).toThrow(/to is required/);
  });
  // A field the node renames is stored under the property name and sent under
  // the wire name, so the required check has to look for the one that survives
  // the rename or it refuses a value that is present.
  it("looks past a rename to find the value", () => {
    const renamed: BirdRoute = {
      ...route,
      topLevel: ["keyword_operation"],
      body: ["operation"],
      arrayFields: [],
      renames: { keyword_operation: "operation" },
    };
    expect(req(renamed, { keyword_operation: "stop" }).body).toEqual({
      operation: "stop",
    });
    expect(() => req(renamed, {})).toThrow(/keyword_operation is required/);
  });
  it("passes once every required field carries a value", () => {
    expect(req(route, { from: "a@b.c", to: ["d@e.f"] }).body).toEqual({
      from: "a@b.c",
      to: ["d@e.f"],
    });
  });
});

describe("buildRequest list shape errors", () => {
  const route: BirdRoute = {
    method: "POST",
    path: "/v1/email/messages",
    pathParams: [],
    topLevel: [],
    collections: ["additionalFields"],
    query: [],
    body: ["tags"],
    jsonFields: [],
    structured: { tags: "list" },
    renames: {},
    arrayFields: [],
    dateTimeFields: [],
    nullableFields: [],
    rawBodyField: "",
    paginated: false,
    collection: false,
    idempotencyHeader: true,
    scopes: ["emails"],
  };
  // A single object parses, so nothing else would notice; dropping it silently
  // sends the message without the tags the user set.
  it("refuses a value that parses but is not a list", () => {
    expect(() => req(route, { tags: { name: "Category" } })).toThrow(
      /tags must be a list/,
    );
    expect(() => req(route, { tags: '{"name":"Category"}' })).toThrow(
      /tags must be a list/,
    );
  });
  it("asks for an array, not an object, when the JSON does not parse", () => {
    expect(() => req(route, { tags: "not json" })).toThrow(/Provide an array/);
  });
  it("still treats an untouched collection as a blank", () => {
    expect(req(route, { tags: {} }).body).toEqual({});
  });
});
