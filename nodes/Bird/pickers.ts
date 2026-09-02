import type {
  ILoadOptionsFunctions,
  INodeListSearchItems,
  INodeListSearchResult,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { birdPickers } from "./generated/pickers.gen";
import { birdRoutes } from "./generated/routing.gen";
import { birdRequest, unwrapLocator } from "./transport";

export interface BirdPicker {
  route: string;
  // Row-label fields in priority order; the first with a value wins.
  fields: string[];
  // The list route's free-text search parameter, "" when it has none.
  search: string;
  // Path parameters the list route takes, read from the sibling property of
  // the same name on the operation the locator belongs to.
  pathFrom: string[];
}

const PICKER_PAGE_SIZE = 50;
const PICKER_FILTER_PAGES = 5;

// A label field may name a member of a nested object ("to.phone_number"), which
// is where a WhatsApp address keeps its number.
function readPath(row: Record<string, unknown>, field: string): unknown {
  const [head, member] = field.split(".");
  if (member === undefined) return row[head];
  const nested = row[head];
  if (typeof nested !== "object" || nested === null) return undefined;
  return (nested as Record<string, unknown>)[member];
}

// A row reads as its own label with the id it will store in parentheses, the
// shape the reference verified connector uses: two rows that read alike — two
// messages to one number — stay distinguishable, and what a pick sends is
// visible before it runs. A row with nothing to label it is its id.
export function pickerRowName(
  row: Record<string, unknown>,
  fields: string[],
): string {
  const id = typeof row.id === "string" ? row.id : "";
  const qualify = (label: string) => (id === "" ? label : `${label} (${id})`);
  for (const field of fields) {
    const value = readPath(row, field);
    if (typeof value === "string" && value.trim() !== "")
      return qualify(value.trim());
    if (Array.isArray(value)) {
      const list = value.filter(
        (e): e is string => typeof e === "string" && e.trim() !== "",
      );
      if (list.length > 0) return qualify(list.join(", "));
    }
  }
  return id;
}

export function pickerRows(
  rows: unknown[],
  picker: BirdPicker,
  filter?: string,
): INodeListSearchItems[] {
  const needle = filter?.trim().toLowerCase() ?? "";
  const out: INodeListSearchItems[] = [];
  for (const raw of rows) {
    const row = (typeof raw === "object" && raw !== null ? raw : {}) as Record<
      string,
      unknown
    >;
    const value = typeof row.id === "string" ? row.id : "";
    if (value === "") continue;
    const name = pickerRowName(row, picker.fields);
    if (
      needle !== "" &&
      !name.toLowerCase().includes(needle) &&
      !value.toLowerCase().includes(needle)
    ) {
      continue;
    }
    out.push({ name, value });
  }
  return out;
}

function pickerPath(ctx: ILoadOptionsFunctions, picker: BirdPicker): string {
  const route = birdRoutes[picker.route];
  let path = route.path;
  for (const name of picker.pathFrom) {
    const raw = unwrapLocator(ctx.getCurrentNodeParameter(name));
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value === "") {
      throw new NodeOperationError(
        ctx.getNode(),
        `Set ${name} before picking from this list — the list is scoped to it.`,
      );
    }
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }
  return path;
}

export async function runPicker(
  ctx: ILoadOptionsFunctions,
  picker: BirdPicker,
  filter?: string,
  paginationToken?: string,
): Promise<INodeListSearchResult> {
  const route = birdRoutes[picker.route];
  const path = pickerPath(ctx, picker);
  // A route that filters server-side has already answered the query; narrowing
  // its rows again would drop the ones it matched on a field we do not show.
  const clientFilter = picker.search === "" ? filter : undefined;
  const results: INodeListSearchItems[] = [];
  let cursor = paginationToken;
  let pages = 0;
  do {
    const qs: Record<string, unknown> = {};
    // A short list answers in one page and takes no cursor parameters; sending
    // them anyway would put the picker's own paging on a route that has none.
    if (route.paginated) {
      qs.limit = PICKER_PAGE_SIZE;
      if (cursor) qs.starting_after = cursor;
    }
    if (picker.search !== "" && filter) qs[picker.search] = filter;
    const res = await birdRequest(ctx, { method: route.method, path, qs });
    const rows = (res as { data?: unknown[] }).data ?? [];
    results.push(...pickerRows(rows, picker, clientFilter));
    cursor = (res as { next_cursor?: string }).next_cursor;
    pages++;
    // A filter applied here only sees the rows already fetched, so a match on a
    // later page would leave the dropdown empty with nothing to scroll for.
  } while (
    clientFilter &&
    results.length === 0 &&
    cursor !== undefined &&
    route.paginated &&
    pages < PICKER_FILTER_PAGES
  );
  return { results, paginationToken: cursor };
}

export function birdListSearch(): Record<
  string,
  (
    this: ILoadOptionsFunctions,
    filter?: string,
    paginationToken?: string,
  ) => Promise<INodeListSearchResult>
> {
  const methods: Record<
    string,
    (
      this: ILoadOptionsFunctions,
      filter?: string,
      paginationToken?: string,
    ) => Promise<INodeListSearchResult>
  > = {};
  for (const [name, picker] of Object.entries(birdPickers)) {
    methods[name] = async function (
      this: ILoadOptionsFunctions,
      filter?: string,
      paginationToken?: string,
    ) {
      return await runPicker(this, picker, filter, paginationToken);
    };
  }
  return methods;
}
