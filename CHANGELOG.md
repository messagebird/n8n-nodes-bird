# Changelog

## 0.20.1

- The `status_reason` field on Apple Messages business accounts and submissions is now documented as possibly containing basic Markdown.

## 0.20.0

- Limit webhook deliveries to one mailbox with `filter.mailbox_id`, including retries and replay. Scoped endpoints can subscribe only to `email_mailbox.*` events. Create, inspect, replace or clear the scope through the webhook operations.
- Voice legs gain an optional `sip_call_id`, the SIP Call-ID of the leg's signalling, for matching a leg against a carrier's records or your own PBX logs. It is absent on some legs recorded before this release.
- `AvailableNumber` now reports `ownership_address_scope`, where the carrier requires the business address on a number's ownership registration to be.

## 0.19.0

- **Breaking:** available-number search naming a `number_type` now refuses `ending_before` and returns neither `prev_cursor` nor `refresh_cursor` in markets where the suppliers on sale are ranked into more than one priority tier, so page those searches forward with `starting_after` only.

## 0.18.0

- Add `blocked_by_fraud_protection` to the `error_code` filter help when listing SMS messages.
- Listing webhooks can filter by URL. Creating a webhook marks the URL optional, because the API builds it for an endpoint that delivers through a connector; an endpoint created from n8n still needs one.

## 0.17.0

- Add names and customer references to allocated numbers, with updates and search. Set an optional reference when buying a number, including orders that complete later.

## 0.16.2

- Email template `parameters` help now identifies values supplied by the caller.

## 0.16.1

- Fix test events.

## 0.16.0

- Contact batch entries now accept invalid field values so each contact can return its own validation result while valid contacts are saved.
- Apple Messages accepted-event descriptions now account for monthly active contact billing.

## 0.15.0

- Add **Timezone** under **Additional Fields** to the Bird node's **Email** > **Stats By Broadcast** operation for customer-local date windows, with UTC as the default.

## 0.14.0

- Add Apple Messages triggers for messages, conversations, and suppressions with `business_account_id`, plus invitation consent fields in n8n preference operations.
- Add `search`, `provider`, and `route` filters to the n8n Voice Numbers list operation for number or name, number source, and incoming call routing.
- The `status` descriptions for Apple Messages for Business records now clarify that configured businesses can exchange messages regardless of onboarding status and Apple decides whether to accept outgoing requests.
- Email template create and update actions now accept an empty subject for drafts. Publishing still requires a subject in every language.

## 0.13.1

- Email send requests support `template` with `scheduled_at`. The request pins the published version, language and parameter values, and a template deleted before the due time rejects the message with `generation_failure`.

## 0.13.0

- Add cursor pagination and campaign tag-name filtering to email statistics breakdowns.

## 0.12.0

- The webhook trigger's event list now offers `whatsapp.group.join_request_created` and `whatsapp.group.join_request_revoked`, fired when someone asks to join a WhatsApp group that requires approval and when they withdraw the request.

## 0.11.0

- Add batch email lookup for up to 1,000 addresses, with ordered assessments and per-address billing.
- Webhook endpoint and replay descriptions now match delivery behavior: a replayed delivery takes one attempt rather than following the retry schedule, `since` and `until` bound the time a delivery was attempted rather than when the event occurred, and a replay does not recover events that were never attempted, such as those that arrived while the endpoint was paused.

## 0.10.0

- **Breaking:** voice connection records now use `/v1/voice/legs` and `call_id` replaces their `session_id` field. Use the `voice.legs` resource in SDKs, `bird voice legs` in the CLI, or the list/get voice leg operations in integrations; existing `vcl_` record IDs stay valid.

## 0.9.2

- Email message lookup help now explains which message ID to use for each broadcast recipient.

## 0.9.1

- Clarify email suppression filters and removal guidance while preserving the existing workflow resource names.

## 0.9.0

- **Breaking:** the `SMS Template` resource's `Get` and `List` operations now return summaries without `body` or `variables`; read content through the SMS template version and language API endpoints.
- Add pagination, search, sorting, and status filters to `SMS Template` → `List`.

## 0.8.1

- Example workflows now name the `emails` API-key scope required to send email.

## 0.8.0

- Add the whatsapp.reacted webhook event, raised when a contact places, changes or takes back a reaction on a message.
- Email `parameters` help now explains when inline content uses Liquid and how to preserve literal template delimiters.
- Preserve empty email parameters so Liquid expressions work without named values.

## 0.7.0

- **Breaking:** a WhatsApp send of a template you authored now picks its language the way that template says to, so a call that already worked can resolve to a different language or stop resolving at all: omitting `language` sends the template's `default_language` rather than the sole approved language, and a language the template does not stock is served by the closest match or refused according to the template's `on_missing_language` setting. Check that each template's `default_language` is one WhatsApp approved, and handle three refusals new to those sends: `E15007` for a language tag WhatsApp does not support, `E15077` when the template cannot send in the language you asked for, and `E15076` when the template sets `language_source_required` and your send names no language. A send served by a language other than the one you asked for is priced at that language's category, because WhatsApp categorizes each language separately, so sends already made under a template WhatsApp recategorized are worth re-checking.

## 0.6.0

- **Breaking:** a send that quotes a message Bird does not hold now fails with `404` `WhatsAppReferencedMessageNotFound` instead of `422` `WhatsAppInReplyToNotFound`; one Bird holds but cannot quote answers `422` `WhatsAppMessageNotQuotable`, and a quote Bird cannot look up answers `503` `WhatsAppMessageLookupUnavailable`, which is worth retrying. Update anything matching the old codes.

## 0.5.1

- Address n8n community-node review feedback.

## 0.5.0

- Add List Templates on the Email resource.

## 0.4.1

- `retention_tier` descriptions now distinguish retained text and attachments from the 30-day limit on original bodies and inbound raw MIME.

## 0.4.0

- **Breaking:** an alphanumeric SMS sender ID must now be 3 to 11 characters. Claiming a shorter one returns a `422`; a shorter sender your workspace already owns keeps sending.
- Verification channels gain `voice`, which delivers a passcode as an automated call reading the code aloud. A country's channel settings and channel order accept it, and a verification's `last_channel` can report it. Availability is per region and per country, so a country that has not enabled voice keeps the channels it already had.
- **Breaking:** with no `options.language` set, the passcode language is now read from the recipient phone number country instead of always being English; set `options.language` to pin one.
- Verify: a WhatsApp passcode requested in Norwegian (`no`) is now sent in Norwegian rather than English.
- Verify: an SMS attempt now reports `template_language`, so a caller can see which translation a passcode actually rendered in.
- Verify: options.language now selects the WhatsApp OTP translation too, not only the SMS one.
- Verify: the languages `options.language` accepts are now listed on the field itself.
- Verify: the one-time-passcode email is now sent in the language `options.language` selects, not English.

## 0.3.0

- Verify verifications accept `options.language`, which selects the built-in translation the one-time-passcode message is sent in. SMS is translated; every other channel still sends English.

## 0.2.1

- Document the undo window for lower mailbox retention and retention-based attachment availability.
- Add example workflows under `examples/` — a contact form sending a welcome email, an order-shipped SMS from a stored template, and a bounce and complaint handler that suppresses the address — and link them from the README.

## 0.2.0

- **Breaking:** the SMS and email `send_batch` operations take their sends in a `Messages` field (a JSON array) instead of the whole-body `Items` field; a saved workflow using `Items` must move its value to `Messages`.

## 0.1.1

- Publish as `@messagebird/n8n-nodes-bird`, matching the scope the Bird SDKs ship under. The node type becomes `@messagebird/n8n-nodes-bird.bird` (and `.birdTrigger`); 0.1.0 was tagged but never reached npm, so no installed workflow is affected.

## 0.1.0

- Add the Bird node for n8n: `Bird` runs the Bird API's email, SMS, WhatsApp, verification, lookup, contacts and number operations, and `Bird Trigger` starts a workflow on delivery and engagement events.
