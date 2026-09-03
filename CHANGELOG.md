# Changelog

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
