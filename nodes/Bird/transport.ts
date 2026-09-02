// The core every operation's route executes through — the analog of the SDK's
// client.ts. What lives here is the behavior a route table cannot express:
// region derivation, blank omission, pagination, binary and error handling.

const REGION = /^[a-z]{2}[0-9]+$/;

export function baseUrlForKey(key: string): string {
  const [prefix, region, ...rest] = key.split("_");
  if (
    prefix !== "bk" ||
    !region ||
    !REGION.test(region) ||
    rest.join("_") === ""
  ) {
    throw new Error(
      "Bird API key is not in the expected bk_{region}_{token} format. Check the credential.",
    );
  }
  return `https://${region}.platform.bird.com`;
}

interface BirdErrorBody {
  error?: {
    code?: string;
    name?: string;
    message?: string;
    remediation?: string;
    details?: Array<{ param?: string; message?: string }>;
  };
}

export function birdErrorParts(
  statusCode: number,
  body: unknown,
  headers: Record<string, unknown> = {},
): { message: string; description: string } {
  const err =
    ((typeof body === "object" && body !== null ? body : {}) as BirdErrorBody)
      .error ?? {};
  const message =
    err.message ?? `Bird returned an unexpected error (HTTP ${statusCode}).`;
  const parts: string[] = [];
  if (err.remediation) parts.push(err.remediation);
  for (const d of err.details ?? []) {
    if (d.param && d.message) parts.push(`${d.param}: ${d.message}`);
  }
  // A rate-limited loop over items is n8n's common failure mode, so the wait
  // the gateway already announced is worth repeating to the user.
  if (statusCode === 429) {
    const reset = headers["retry-after"] ?? headers["ratelimit-reset"];
    if (
      (typeof reset === "string" && reset !== "") ||
      typeof reset === "number"
    ) {
      parts.push(`Retry after ${reset} second(s).`);
    }
  }
  return { message, description: parts.join(" ") };
}

// n8n's dateTime picker stores a naive local timestamp, and Bird requires an
// RFC 3339 offset. The n8n-native reading of a naive value is the workflow's
// timezone; two zoneOffset passes because the offset itself can shift at a
// DST boundary near the picked instant.
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

function zoneOffset(zone: string, at: Date): string {
  const name = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    timeZoneName: "longOffset",
  })
    .formatToParts(at)
    .find((p) => p.type === "timeZoneName")?.value;
  const m = /^GMT([+-]\d{2}:\d{2})?$/.exec(name ?? "");
  if (!m) throw new Error(`unresolvable zone ${zone}`);
  return m[1] ?? "+00:00";
}

export function completeDateTime(value: string, zone: string): string {
  if (!NAIVE_DATETIME.test(value)) return value;
  const base = value.length === 16 ? `${value}:00` : value;
  try {
    const guess = zoneOffset(zone, new Date(`${base}Z`));
    return base + zoneOffset(zone, new Date(base + guess));
  } catch {
    return `${base}Z`;
  }
}

// Bird reads an empty filter as one nothing matches, so a blank is omitted
// rather than sent. 0 and false are real values and stay.
export function compact(
  values: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      const t = v.trim();
      if (t === "") continue;
      out[k] = t;
      continue;
    }
    if (Array.isArray(v)) {
      const list = v
        .map((e) => (typeof e === "string" ? e.trim() : e))
        .filter((e) => e !== undefined && e !== null && e !== "");
      if (list.length === 0) continue;
      out[k] = list;
      continue;
    }
    out[k] = v;
  }
  return out;
}

import type {
  IBinaryData,
  IDataObject,
  IExecuteFunctions,
  IHttpRequestMethods,
  INode,
  JsonObject,
} from "n8n-workflow";
import { NodeApiError, NodeOperationError } from "n8n-workflow";

// A NodeOperationError already names a configuration mistake and the item it
// happened on; wrapping one would relabel it as something the API said.
export function asNodeError(
  node: INode,
  error: unknown,
  itemIndex?: number,
): Error {
  if (error instanceof NodeApiError || error instanceof NodeOperationError) {
    return error;
  }
  return new NodeApiError(node, error as JsonObject, { itemIndex });
}

export interface BirdRoute {
  method: string;
  path: string;
  pathParams: string[];
  // The names execute() may read with getNodeParameter — the fields emitted
  // as top-level properties. n8n throws on any name it cannot resolve.
  topLevel: string[];
  // Collection properties whose members are flat wire fields: Additional
  // Fields, and Sort on an operation that offers one.
  collections: string[];
  query: string[];
  body: string[];
  // Body fields whose property type is json: the editor stores their value
  // as a string, so buildRequest parses these before the request goes out.
  jsonFields: string[];
  // Fields rendered as collection inputs: the editor stores a struct as
  // {values: {...}}, a map as {pairs: [{key, value}]}, and a list as
  // {items: [{...}]}; buildRequest unwraps these into the API shape.
  structured: Record<string, "struct" | "map" | "list">;
  // Property name -> wire name for a field the node itself owns the name of
  // (a wire `limit` against n8n's pagination Limit). buildRequest restores the
  // wire name before the request goes out.
  renames: Record<string, string>;
  // Fields whose wire type is an array of scalars. The editor renders these as
  // one comma-separated string, which splits here; a closed enum renders as
  // multiOptions and arrives as an array already, which passes through.
  arrayFields: string[];
  // Fields whose wire type is an RFC 3339 date-time: a naive editor value is
  // completed with the workflow timezone's offset. Scoped by name so message
  // content that merely looks like a timestamp is never rewritten.
  dateTimeFields: string[];
  // Nullable body fields: an expression-supplied null is a CLEAR operation on
  // the wire (distinct from omitting the field) and survives blank compaction.
  nullableFields: string[];
  // List fields whose rows may point at an item's binary property instead of
  // carrying bytes.
  binaryFields: string[];
  // Non-empty when the request body is an array root: the named property
  // carries the whole body verbatim ("" for ordinary object bodies).
  rawBodyField: string;
  paginated: boolean;
  collection: boolean;
  idempotencyHeader: boolean;
  scopes: string[];
}

// foldPairs turns the editor's {pairs: [{key, value}]} rows into a map,
// dropping blank keys; anything else (an expression's own object) passes.
function foldPairs(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null) return raw;
  const pairs = (raw as { pairs?: unknown }).pairs;
  if (!Array.isArray(pairs)) return raw;
  const out: Record<string, unknown> = {};
  for (const p of pairs) {
    const { key, value } = (p ?? {}) as { key?: unknown; value?: unknown };
    if (typeof key === "string" && key.trim() !== "") out[key.trim()] = value;
  }
  return out;
}

function foldMembers(
  members: Record<string, unknown>,
): Record<string, unknown> {
  const folded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(members)) {
    const fv = foldPairs(value);
    if (
      typeof fv === "object" &&
      fv !== null &&
      Object.keys(fv as object).length === 0
    )
      continue;
    if (typeof fv === "string" && fv.trim() === "") continue;
    folded[key] = fv;
  }
  return folded;
}

// A row of a repeatable fixedCollection folds exactly like a struct, which is
// what lets a list carry a map member with no descriptor of its own.
function listRows(raw: unknown): unknown[] | undefined {
  const rows = Array.isArray(raw) ? raw : (raw as { items?: unknown }).items;
  // An untouched fixedCollection stores {}, which is a blank rather than a
  // mistake; anything else non-array is a value the API would reject.
  if (rows === undefined)
    return Object.keys(raw as object).length === 0 ? [] : undefined;
  if (!Array.isArray(rows)) return undefined;
  const out: unknown[] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) {
      out.push(row);
      continue;
    }
    const folded = foldMembers(row as Record<string, unknown>);
    if (Object.keys(folded).length > 0) out.push(folded);
  }
  return out;
}

// unwrapStructured rewrites collection storage into API objects. A string
// is parsed as JSON and a plain object passes through, so expressions keep
// working; a field that unwraps to nothing is dropped like any blank.
function unwrapStructured(
  node: INode,
  itemIndex: number | undefined,
  route: BirdRoute,
  v: Record<string, unknown>,
): void {
  for (const [name, kind] of Object.entries(route.structured)) {
    let raw = v[name];
    if (raw === undefined) continue;
    if (typeof raw === "string") {
      try {
        raw = JSON.parse(raw) as unknown;
      } catch {
        throw new NodeOperationError(
          node,
          kind === "list"
            ? `${name} is not valid JSON. Provide an array, for example [{"name": "value"}].`
            : `${name} is not valid JSON. Provide an object, for example {"key": "value"}.`,
          { itemIndex },
        );
      }
    }
    if (typeof raw !== "object" || raw === null) continue;
    if (kind === "list") {
      const rows = listRows(raw);
      if (rows === undefined) {
        throw new NodeOperationError(
          node,
          `${name} must be a list. Provide an array, for example [{"name": "value"}].`,
          { itemIndex },
        );
      }
      if (rows.length === 0) delete v[name];
      else v[name] = rows;
      continue;
    }
    if (kind === "map") {
      raw = foldPairs(raw);
    } else {
      const group = (raw as { values?: unknown }).values;
      const members = (
        typeof group === "object" && group !== null ? group : raw
      ) as Record<string, unknown>;
      raw = foldMembers(members);
    }
    if (
      typeof raw === "object" &&
      raw !== null &&
      Object.keys(raw as object).length === 0
    ) {
      delete v[name];
      continue;
    }
    v[name] = raw;
  }
}

// A Resource Locator stores {__rl, mode, value} whichever mode picked it, so
// the raw id is taken once here rather than at every read site. A bare string
// passes through: an expression supplying an id resolves to one.
export function unwrapLocator(value: unknown): unknown {
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { __rl?: unknown }).__rl === true
  ) {
    return (value as { value?: unknown }).value;
  }
  return value;
}

// The defaults live here because a row left alone arrives carrying neither —
// see integrations/AGENTS.md on what n8n stores.
export const ROW_TYPE = "attachmentType";
export const ROW_PROPERTY = "binaryPropertyName";
const ROW_CONTENT = "content";
const ROW_FILENAME = "filename";
const ROW_CONTENT_TYPE = "content_type";
// ROW_FROM_ITEM doubles as the selector's default: what a row means when the
// member is absent has to be what the property declares as its default.
export const ROW_FROM_ITEM = "binary";
export const ROW_PROPERTY_DEFAULT = "data";

// The API's `birdContentBudgetBytes`: decimal not binary, over the encoded
// value, and shared with the html and text bodies counted into the same total.
const MESSAGE_LIMIT = 20_000_000;

// assertBinaryData raises its own error naming the property the item does not
// carry, which is why nothing here checks for one.
export interface BirdBinaryContext {
  getNode(): INode;
  helpers: {
    assertBinaryData(itemIndex: number, propertyName: string): IBinaryData;
    getBinaryDataBuffer(
      itemIndex: number,
      propertyName: string,
    ): Promise<Buffer>;
  };
}

// Which shape the rows arrived in decides what an absent member means, so it has
// to survive the read. A JSON string is neither shape; buildRequest parses that.
function storedRows(raw: unknown): { rows: unknown[]; fromEditor: boolean } {
  if (Array.isArray(raw)) return { rows: raw, fromEditor: false };
  if (typeof raw === "object" && raw !== null) {
    const items = (raw as { items?: unknown }).items;
    if (Array.isArray(items)) return { rows: items, fromEditor: true };
  }
  return { rows: [], fromEditor: false };
}

function filled(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function megabytes(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

// Rows are replaced rather than mutated: getNodeParameter can hand back the same
// stored object on every item, which would send item one's file with item two.
export async function resolveBinary(
  ctx: BirdBinaryContext,
  route: BirdRoute,
  values: Record<string, unknown>,
  itemIndex: number,
): Promise<void> {
  let encoded = 0;
  for (const name of route.binaryFields) {
    const { rows: stored, fromEditor } = storedRows(values[name]);
    if (stored.length === 0) continue;
    const rows: unknown[] = [];
    for (const source of stored) {
      if (typeof source !== "object" || source === null) {
        rows.push(source);
        continue;
      }
      const src = source as Record<string, unknown>;
      const row = { ...src };
      delete row[ROW_TYPE];
      delete row[ROW_PROPERTY];
      // An absent selector means the emitted default only for an editor row — see
      // integrations/AGENTS.md on what an absent member means per author.
      const fromItem = filled(src[ROW_TYPE])
        ? src[ROW_TYPE] === ROW_FROM_ITEM
        : fromEditor && !filled(src[ROW_CONTENT]);
      // Blank is the user clearing it, which omits the row; a name the item lacks
      // is a wrong value instead, and assertBinaryData is left to raise on that.
      const prop =
        ROW_PROPERTY in src
          ? String(src[ROW_PROPERTY] ?? "").trim()
          : ROW_PROPERTY_DEFAULT;
      if (fromItem && prop !== "") {
        const meta = ctx.helpers.assertBinaryData(itemIndex, prop);
        // Under n8n's filesystem binary mode `data` holds a reference, not the
        // payload; only the helper resolves both modes.
        const buffer = await ctx.helpers.getBinaryDataBuffer(itemIndex, prop);
        row[ROW_CONTENT] = buffer.toString("base64");
        if (!filled(row[ROW_FILENAME])) {
          row[ROW_FILENAME] = filled(meta.fileName)
            ? meta.fileName
            : meta.fileExtension
              ? `${prop}.${meta.fileExtension}`
              : prop;
        }
        if (!filled(row[ROW_CONTENT_TYPE]) && filled(meta.mimeType)) {
          row[ROW_CONTENT_TYPE] = meta.mimeType;
        }
      }
      // Keeps the Input Binary Field promise: without this a cleared row survives
      // on a stray filename and reaches the API with no bytes, which is a 422.
      if (fromEditor && fromItem && prop === "") continue;
      if (typeof row[ROW_CONTENT] === "string")
        encoded += row[ROW_CONTENT].length;
      rows.push(row);
    }
    values[name] = rows;
  }
  // Pointing at a file makes the ceiling easy to cross without noticing, and
  // the API answers with a 413 about a body the user never assembled.
  if (encoded > MESSAGE_LIMIT) {
    throw new NodeOperationError(
      ctx.getNode(),
      `The attachments come to ${megabytes(encoded)} once base64-encoded, over the ${megabytes(MESSAGE_LIMIT)} a message may be. Encoding adds about a third, so the files themselves have to stay under roughly ${megabytes(MESSAGE_LIMIT * 0.75)} — less, since the body counts against the same budget.`,
      { itemIndex },
    );
  }
}

export function buildRequest(
  node: INode,
  route: BirdRoute,
  values: Record<string, unknown>,
  zone?: string,
  itemIndex?: number,
): {
  path: string;
  qs: Record<string, unknown>;
  body: Record<string, unknown>;
} {
  for (const [name, stored] of Object.entries(values)) {
    values[name] = unwrapLocator(stored);
  }
  // Capture explicit nulls on nullable fields before compaction drops them:
  // on these fields null is the API's clear operation, not a blank.
  for (const [prop, wire] of Object.entries(route.renames)) {
    if (prop in values) {
      values[wire] = values[prop];
      delete values[prop];
    }
  }
  const cleared = route.nullableFields.filter((n) => values[n] === null);
  const v = compact(values);
  unwrapStructured(node, itemIndex, route, v);
  for (const n of cleared) v[n] = null;
  // A dotted name (template.components, labels.add) is a member inside an
  // already-unwrapped struct.
  const locate = (
    name: string,
  ): [Record<string, unknown> | undefined, string] => {
    const [head, member] = name.split(".");
    if (member === undefined) return [v, head];
    return [v[head] as Record<string, unknown> | undefined, member];
  };
  for (const name of route.jsonFields) {
    const [holder, key] = locate(name);
    const raw = holder?.[key];
    if (!holder || typeof raw !== "string") continue;
    try {
      holder[key] = JSON.parse(raw) as unknown;
    } catch {
      throw new NodeOperationError(
        node,
        `${name} is not valid JSON. Provide an object, for example {"key": "value"}.`,
        { itemIndex },
      );
    }
  }
  for (const name of route.arrayFields) {
    const [holder, key] = locate(name);
    const raw = holder?.[key];
    if (!holder || typeof raw !== "string") continue;
    const list = raw
      .split(",")
      .map((e) => e.trim())
      .filter((e) => e !== "");
    if (list.length === 0) delete holder[key];
    else holder[key] = list;
  }
  if (zone) {
    for (const name of route.dateTimeFields) {
      const [holder, key] = locate(name);
      const raw = holder?.[key];
      if (holder && typeof raw === "string")
        holder[key] = completeDateTime(raw, zone);
    }
  }
  if (route.rawBodyField !== "") {
    const raw = v[route.rawBodyField];
    let parsed: unknown = raw;
    if (typeof raw === "string") {
      try {
        parsed = JSON.parse(raw) as unknown;
      } catch {
        throw new NodeOperationError(
          node,
          `${route.rawBodyField} is not valid JSON. Provide a JSON array.`,
          { itemIndex },
        );
      }
    }
    if (!Array.isArray(parsed)) {
      throw new NodeOperationError(
        node,
        `${route.rawBodyField} must be a JSON array, as the API reference documents.`,
        { itemIndex },
      );
    }
    let path = route.path;
    for (const p of route.pathParams) {
      const val = v[p];
      if (val === undefined) {
        throw new NodeOperationError(
          node,
          `${p} is required and cannot be blank.`,
          { itemIndex },
        );
      }
      path = path.replace(`{${p}}`, encodeURIComponent(String(val)));
    }
    const pick = (keys: string[]) =>
      Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));
    return {
      path,
      qs: pick(route.query),
      body: parsed as unknown as Record<string, unknown>,
    };
  }
  let path = route.path;
  for (const p of route.pathParams) {
    const val = v[p];
    if (val === undefined) {
      throw new NodeOperationError(
        node,
        `${p} is required and cannot be blank.`,
        { itemIndex },
      );
    }
    path = path.replace(`{${p}}`, encodeURIComponent(String(val)));
  }
  requireTopLevel(node, route, v, itemIndex);
  const pick = (keys: string[]) =>
    Object.fromEntries(keys.filter((k) => k in v).map((k) => [k, v[k]]));
  return { path, qs: pick(route.query), body: pick(route.body) };
}

// n8n's own canvas check misses an empty required multiOptions field, so this
// names it at execution instead — docs/roadmap/n8n.md carries why.
function requireTopLevel(
  node: INode,
  route: BirdRoute,
  values: Record<string, unknown>,
  itemIndex?: number,
): void {
  for (const name of route.topLevel) {
    // topLevel names the property; the value is under its wire name by now.
    const wire = route.renames[name] ?? name;
    if (route.pathParams.includes(wire)) continue;
    if (values[wire] === undefined) {
      throw new NodeOperationError(
        node,
        `${name} is required and cannot be empty.`,
        { itemIndex },
      );
    }
  }
}

export async function collectPages(
  fetchPage: (
    cursor?: string,
  ) => Promise<{ data?: unknown[]; next_cursor?: string }>,
  returnAll: boolean,
  limit: number,
): Promise<unknown[]> {
  const out: unknown[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    out.push(...(page.data ?? []));
    cursor = page.next_cursor;
  } while (cursor && (returnAll || out.length < limit));
  return returnAll ? out : out.slice(0, limit);
}

// The subset of n8n's execution contexts birdRequest needs: execute, hook,
// and load-options contexts all satisfy it (methods check bivariantly).
export interface BirdRequestContext {
  getCredentials(type: string): Promise<Record<string, unknown>>;
  getNode(): INode;
  helpers: {
    httpRequestWithAuthentication(
      this: unknown,
      credentialType: string,
      options: unknown,
    ): Promise<unknown>;
  };
}

export async function birdRequest(
  ctx: BirdRequestContext,
  opts: {
    method: string;
    path: string;
    qs?: Record<string, unknown>;
    body?: Record<string, unknown>;
    headers?: Record<string, string>;
    // n8n attributes an error to an input item from the error it is given, and
    // its constructor ignores options when handed one that is already a
    // NodeApiError — so the index has to be set where the error is built.
    itemIndex?: number;
  },
): Promise<Record<string, unknown>> {
  const creds = await ctx.getCredentials("birdApi");
  let baseUrl: string;
  try {
    baseUrl = baseUrlForKey(String(creds.apiKey ?? ""));
  } catch (e) {
    throw new NodeOperationError(ctx.getNode(), (e as Error).message, {
      itemIndex: opts.itemIndex,
    });
  }
  // ignoreHttpStatusErrors is what lets Bird's error body survive into
  // birdErrorParts instead of being swallowed by the helper's own throw.
  const res = await ctx.helpers.httpRequestWithAuthentication.call(
    ctx,
    "birdApi",
    {
      method: opts.method as IHttpRequestMethods,
      url: baseUrl + opts.path,
      headers:
        opts.headers && Object.keys(opts.headers).length > 0
          ? opts.headers
          : undefined,
      qs:
        opts.qs && Object.keys(opts.qs).length > 0
          ? (opts.qs as IDataObject)
          : undefined,
      body:
        opts.body && Object.keys(opts.body).length > 0
          ? (opts.body as IDataObject)
          : undefined,
      json: true,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
    },
  );
  const statusCode = (res as { statusCode: number }).statusCode;
  const body = (res as { body?: unknown }).body;
  if (statusCode >= 400) {
    const headers =
      (res as { headers?: Record<string, unknown> }).headers ?? {};
    const { message, description } = birdErrorParts(statusCode, body, headers);
    throw new NodeApiError(ctx.getNode(), (body ?? {}) as never, {
      message,
      description,
      httpCode: String(statusCode),
      itemIndex: opts.itemIndex,
    });
  }
  return (body ?? {}) as Record<string, unknown>;
}
