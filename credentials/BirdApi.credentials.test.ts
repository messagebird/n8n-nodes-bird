import { describe, expect, it } from "vitest";
import { BirdApi } from "./BirdApi.credentials";

describe("BirdApi credential", () => {
  const cred = new BirdApi();
  it("is a password-masked single API key field", () => {
    expect(cred.name).toBe("birdApi");
    expect(cred.properties).toHaveLength(1);
    expect(cred.properties[0].name).toBe("apiKey");
    expect(cred.properties[0].typeOptions).toMatchObject({ password: true });
  });
  it("injects the key as a Bearer header", () => {
    expect(cred.authenticate.properties.headers?.Authorization).toBe(
      "=Bearer {{$credentials.apiKey}}",
    );
  });
  it("tests against the workspace read on the derived regional host", () => {
    expect(cred.test.request.url).toBe("/v1/workspace");
    expect(cred.test.request.baseURL).toContain("$credentials.apiKey.split");
    // Without the 403 rule, a valid key missing the probe scope surfaces as
    // n8n's generic "Forbidden", which reads as a bad key.
    expect(cred.test.rules?.[0]).toMatchObject({
      type: "responseCode",
      properties: { value: 403 },
    });
  });
  it("names the scopes the key needs", () => {
    expect(cred.properties[0].description).toContain("emails");
  });
});
