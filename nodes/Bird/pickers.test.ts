import type { ILoadOptionsFunctions, INodeListSearchItems } from "n8n-workflow";
import { describe, expect, it } from "vitest";

import { birdPickers } from "./generated/pickers.gen";
import { birdProperties } from "./generated/properties.gen";
import { birdRoutes } from "./generated/routing.gen";
import {
  pickerRowName,
  pickerRows,
  runPicker,
  type BirdPicker,
} from "./pickers";

const pair = (r: INodeListSearchItems) => [r.name, r.value];

const mailboxes: BirdPicker = {
  route: "email:mailboxes_list",
  fields: ["address"],
  search: "q",
  pathFrom: [],
};

const rules: BirdPicker = {
  route: "email:mailboxes_receive_rules_list",
  fields: ["entry"],
  search: "",
  pathFrom: ["mailbox_id"],
};

function ctx(
  response: unknown,
  stored: Record<string, unknown> = {},
  seen: Array<{ url: string; qs: unknown }> = [],
) {
  return {
    getNode: () => ({ name: "Bird", type: "bird", typeVersion: 1 }),
    getCredentials: async () => ({ apiKey: "bk_eu1_token" }),
    getCurrentNodeParameter: (name: string) => stored[name],
    helpers: {
      httpRequestWithAuthentication: async (
        _type: string,
        opts: { url: string; qs?: unknown },
      ) => {
        seen.push({ url: opts.url, qs: opts.qs });
        return { statusCode: 200, body: response, headers: {} };
      },
    },
  } as unknown as ILoadOptionsFunctions;
}

describe("pickerRowName", () => {
  it("takes the first field that carries a value, qualified by the id it stores", () => {
    const fields = ["email", "phone_number", "external_id"];
    expect(pickerRowName({ email: " a@b.c ", id: "ct_1" }, fields)).toBe(
      "a@b.c (ct_1)",
    );
    expect(
      pickerRowName({ email: "", phone_number: "+31612", id: "ct_1" }, fields),
    ).toBe("+31612 (ct_1)");
  });
  it("joins a list field and falls back to the id alone", () => {
    expect(
      pickerRowName({ keywords: ["STOP", "HALT"], id: "kw_1" }, ["keywords"]),
    ).toBe("STOP, HALT (kw_1)");
    expect(pickerRowName({ id: "kw_1", number: null }, ["number"])).toBe(
      "kw_1",
    );
  });
});

describe("pickerRows", () => {
  it("skips rows with no id and narrows on the filter", () => {
    const rows = [
      { id: "mbx_1", address: "support@acme.com" },
      { id: "mbx_2", address: "sales@acme.com" },
      { address: "orphan@acme.com" },
    ];
    // Rows are compared as pairs rather than as {name, value} literals: the
    // verification scanner lints this file too, and reads that shape as a node
    // parameter's options, which it then holds to title case.
    expect(pickerRows(rows, mailboxes).map(pair)).toEqual([
      ["support@acme.com (mbx_1)", "mbx_1"],
      ["sales@acme.com (mbx_2)", "mbx_2"],
    ]);
    expect(pickerRows(rows, mailboxes, "sales").map(pair)).toEqual([
      ["sales@acme.com (mbx_2)", "mbx_2"],
    ]);
  });
});

describe("runPicker", () => {
  it("returns the cursor as the pagination token and sends the one it is given", async () => {
    const seen: Array<{ url: string; qs: unknown }> = [];
    const res = await runPicker(
      ctx(
        {
          data: [{ id: "mbx_1", address: "support@acme.com" }],
          next_cursor: "c2",
        },
        {},
        seen,
      ),
      mailboxes,
      undefined,
      "c1",
    );
    expect(res.paginationToken).toBe("c2");
    expect(res.results.map(pair)).toEqual([
      ["support@acme.com (mbx_1)", "mbx_1"],
    ]);
    expect(seen[0].qs).toMatchObject({ starting_after: "c1" });
  });

  it("hands the filter to a searching route and keeps every row it answers with", async () => {
    const seen: Array<{ url: string; qs: unknown }> = [];
    // The route matched on display name, which the row label does not show;
    // filtering its answer again would drop the row the user searched for.
    const res = await runPicker(
      ctx({ data: [{ id: "mbx_1", address: "support@acme.com" }] }, {}, seen),
      mailboxes,
      "Helpdesk",
    );
    expect(seen[0].qs).toMatchObject({ q: "Helpdesk" });
    expect(res.results).toHaveLength(1);
  });

  it("scopes a nested list to its sibling locator, in either stored form", async () => {
    const seen: Array<{ url: string; qs: unknown }> = [];
    await runPicker(
      ctx(
        { data: [] },
        { mailbox_id: { __rl: true, mode: "list", value: "mbx_7" } },
        seen,
      ),
      rules,
    );
    expect(seen[0].url).toContain("/mailboxes/mbx_7/");
    await runPicker(ctx({ data: [] }, { mailbox_id: "mbx_8" }, seen), rules);
    expect(seen[1].url).toContain("/mailboxes/mbx_8/");
  });

  it("says which field to set first when the scoping locator is empty", async () => {
    await expect(runPicker(ctx({ data: [] }), rules)).rejects.toThrow(
      /mailbox_id/,
    );
  });

  it("surfaces the API's own message when the key lacks the list scope", async () => {
    const denied = {
      getNode: () => ({ name: "Bird", type: "bird", typeVersion: 1 }),
      getCredentials: async () => ({ apiKey: "bk_eu1_token" }),
      getCurrentNodeParameter: () => undefined,
      helpers: {
        httpRequestWithAuthentication: async () => ({
          statusCode: 403,
          headers: {},
          body: {
            error: {
              message: "This API key is missing the mailbox scope.",
              remediation: "Grant the mailbox scope to the key, or pick By ID.",
            },
          },
        }),
      },
    } as unknown as ILoadOptionsFunctions;
    await expect(runPicker(denied, mailboxes)).rejects.toThrow(
      /missing the mailbox scope/,
    );
  });
});

describe("the generated picker table", () => {
  it("names a route that exists and a search parameter that route accepts", () => {
    for (const [name, picker] of Object.entries(birdPickers)) {
      const route = birdRoutes[picker.route];
      expect(route, name).toBeDefined();
      expect(route.collection, `${name} lists nothing`).toBe(true);
      if (picker.search !== "") {
        expect(route.query, name).toContain(picker.search);
      }
      for (const p of picker.pathFrom) {
        expect(route.pathParams, name).toContain(p);
      }
    }
  });

  it("is reachable from every locator that points at it", () => {
    const wanted = new Set<string>();
    const walk = (props: unknown[]) => {
      for (const raw of props) {
        const p = raw as {
          type?: string;
          modes?: Array<{ typeOptions?: { searchListMethod?: string } }>;
        };
        if (p.type !== "resourceLocator") continue;
        for (const mode of p.modes ?? []) {
          const m = mode.typeOptions?.searchListMethod;
          if (m) wanted.add(m);
        }
      }
    };
    walk(birdProperties as unknown as unknown[]);
    expect(wanted.size).toBeGreaterThan(0);
    for (const m of wanted) expect(birdPickers[m], m).toBeDefined();
  });
});

describe("runPicker client-side filtering", () => {
  const pages: Record<string, unknown> = {
    start: {
      data: [{ id: "wh_1", url: "https://a.example/hook" }],
      next_cursor: "c2",
    },
    c2: { data: [{ id: "wh_2", url: "https://target.example/hook" }] },
  };
  function paging(seen: Array<{ url: string; qs: unknown }>) {
    return {
      getNode: () => ({ name: "Bird", type: "bird", typeVersion: 1 }),
      getCredentials: async () => ({ apiKey: "bk_eu1_token" }),
      getCurrentNodeParameter: () => undefined,
      helpers: {
        httpRequestWithAuthentication: async (
          _type: string,
          opts: { url: string; qs?: { starting_after?: string } },
        ) => {
          seen.push({ url: opts.url, qs: opts.qs });
          return {
            statusCode: 200,
            headers: {},
            body: pages[opts.qs?.starting_after ?? "start"],
          };
        },
      },
    } as unknown as ILoadOptionsFunctions;
  }
  const webhooks: BirdPicker = {
    route: "webhooks:list",
    fields: ["url"],
    search: "",
    pathFrom: [],
  };

  // The route has no search parameter, so the filter is applied here — over
  // rows already fetched. Stopping at the first page renders an empty dropdown
  // with nothing to scroll for, which reads as "no such webhook".
  it("keeps fetching until the filter finds something", async () => {
    const seen: Array<{ url: string; qs: unknown }> = [];
    const res = await runPicker(paging(seen), webhooks, "target");
    expect(seen).toHaveLength(2);
    expect(res.results.map(pair)).toEqual([
      ["https://target.example/hook (wh_2)", "wh_2"],
    ]);
  });
  it("takes one page when nothing is being filtered", async () => {
    const seen: Array<{ url: string; qs: unknown }> = [];
    const res = await runPicker(paging(seen), webhooks);
    expect(seen).toHaveLength(1);
    expect(res.results).toHaveLength(1);
    expect(res.paginationToken).toBe("c2");
  });
});

describe("nested label fields", () => {
  // A WhatsApp address is an object, so the number that names the row sits one
  // level in; a missing member falls back to the id rather than mislabelling.
  it("reads a dotted field and falls back when it is absent", () => {
    const fields = ["to.phone_number"];
    expect(
      pickerRowName({ id: "wam_1", to: { phone_number: "+31612" } }, fields),
    ).toBe("+31612 (wam_1)");
    expect(pickerRowName({ id: "wam_2", to: {} }, fields)).toBe("wam_2");
    expect(pickerRowName({ id: "wam_3" }, fields)).toBe("wam_3");
  });
  // A recipient with no number of its own must still label its row: a bare id
  // reads as an unexplained value rather than as the message it identifies.
  it("falls through the address before giving up on a label", () => {
    const fields = ["to.phone_number", "to.bsuid", "created_at"];
    expect(
      pickerRowName(
        {
          id: "wam_4",
          to: { bsuid: "NL.abc" },
          created_at: "2026-09-01T07:42:00Z",
        },
        fields,
      ),
    ).toBe("NL.abc (wam_4)");
    expect(
      pickerRowName(
        { id: "wam_5", to: {}, created_at: "2026-09-01T07:42:00Z" },
        fields,
      ),
    ).toBe("2026-09-01T07:42:00Z (wam_5)");
  });
});
