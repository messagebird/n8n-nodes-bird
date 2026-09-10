# Changelog

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
