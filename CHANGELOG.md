# Changelog

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
