# Changelog

## 0.1.1

- Publish as `@messagebird/n8n-nodes-bird`, matching the scope the Bird SDKs ship under. The node type becomes `@messagebird/n8n-nodes-bird.bird` (and `.birdTrigger`); 0.1.0 was tagged but never reached npm, so no installed workflow is affected.

## 0.1.0

- Add the Bird node for n8n: `Bird` runs the Bird API's email, SMS, WhatsApp, verification, lookup, contacts and number operations, and `Bird Trigger` starts a workflow on delivery and engagement events.
