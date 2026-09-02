import type {
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

import { CREDENTIAL_SCOPES } from "../nodes/Bird/generated/scopes.gen";

export class BirdApi implements ICredentialType {
  name = "birdApi";

  displayName = "Bird API";

  icon = {
    light: "file:bird.svg",
    dark: "file:bird-dark.svg",
  } as const;

  documentationUrl = "https://bird.com/docs";

  properties: INodeProperties[] = [
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: { password: true },
      required: true,
      default: "",
      description: `A Bird API key, created in the Bird dashboard under API keys, near the bottom of the sidebar. The key is all this node needs — there is nothing else to configure. Grant the scopes covering the operations your workflows use; the full set this node can call: ${CREDENTIAL_SCOPES.join(", ")}.`,
    },
  ];

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{$credentials.apiKey}}",
      },
    },
  };

  // The base URL is an expression over the key itself — the same derivation
  // transport.ts does — because the region must never be asked.
  test: ICredentialTestRequest = {
    request: {
      baseURL:
        '=https://{{$credentials.apiKey.split("_")[1]}}.platform.bird.com',
      url: "/v1/workspace",
    },
    // A 403 here means the key authenticated but lacks the probe's scope —
    // without this rule n8n shows "Forbidden - perhaps check your
    // credentials?", which reads as a bad key.
    rules: [
      {
        type: "responseCode",
        properties: {
          value: 403,
          message:
            "The API key is valid but has not been granted the workspace scope (read). Grant it in the Bird dashboard under API keys, near the bottom of the sidebar, then retest.",
        },
      },
    ],
  };
}
