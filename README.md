# @messagebird/n8n-nodes-bird

The official [Bird](https://bird.com) node for [n8n](https://n8n.io). Send transactional email and SMS, look up delivery status, browse SMS templates, and wire Bird into your workflows.

📚 **Bird API documentation:** https://bird.com/docs

## Installation

Open the nodes panel in any workflow, search for **Bird**, and select **Install**.

On a self-hosted instance that has not enabled community nodes in the panel, use **Settings → Community Nodes → Install** and enter `@messagebird/n8n-nodes-bird`. Requires n8n 2.x on Node.js 20 or later.

## Operations

The **Bird** node covers the public Bird API: email and SMS sends, delivery status and event timelines, WhatsApp, verification, templates, sending domains, suppressions, inbound routes, webhooks, statistics, lookup, and more. Resources and operations mirror the API reference at https://bird.com/docs/api. Three areas are deliberately out: publishing and subscribing on Realtime, which needs an app key and secret this credential cannot hold (managing Realtime apps and keys is included); the attachment and media downloads, which return bytes rather than the JSON a workflow item carries; and redirect-based media fetches.

<details>
<summary><strong>177 operations across 22 resources</strong></summary>

- **Audience** (9) — Add Contacts, Create, Delete, Get, List, List Contacts, Remove Contact, Remove Contacts, Update
- **Contact** (7) — Batch, Create, Delete, Get, List, List Preferences, Update
- **Contact Property** (6) — Archive, Create, Get, List, Unarchive, Update
- **Doc** (2) — Read, Search
- **Domain** (9) — Create, Delete, Get, List, List Events, Release Tracking, Share DNS Records, Update, Verify
- **Email** (57) — Cancel, Content, Create Inbound Route, Create Mailbox, Create Mailbox Message, Create Mailbox Receive Rule, Delete Inbound Route, Delete Mailbox, Delete Mailbox Receive Rule, Delete Thread, Delete Thread Message, Get, Get Inbound Route, Get Mailbox, Get Mailbox Statistics, Get SMTP Config, Get Thread, Get Thread Message, Get Thread Message Body, List, List Events, List Inbound Routes, List Mailbox Labels, List Mailbox Messages, List Mailbox Receive Rules, List Mailboxes, List SMTP Configs, List Thread Message Attachments, List Thread Messages, List Threads, Recipients, Reply to Thread Message, Restore Mailbox, Resume Mailbox, Send, Send Batch, Stats By Bounce Code, Stats By Broadcast, Stats By Category, Stats By Client, Stats By Complaint Type, Stats By Location, Stats By Mailbox Provider, Stats By Mailbox Provider Region, Stats By Recipient Domain, Stats By Sending Domain, Stats By Sending IP, Stats By Tag, Stats By Template, Stats Daily, Stats Hourly, Stats Summary, Update Inbound Route, Update Mailbox, Update SMTP Config, Update Thread, Update Thread Message
- **Inbound Address** (5) — Create, Delete, Get, List, Update
- **Inbound Message** (4) — Attachments, Body, Get, List
- **Lookup** (2) — Email, Phone Number
- **Number** (8) — Create Order, Get, Get Available Number, Get Order, List, List Available Numbers, List Orders, Release
- **Preference** (4) — Create, Delete, Get, List
- **Realtime** (9) — Create App, Create App Key, Delete App, Get App, List App Keys, List Apps, List Regions, Revoke App Key, Update App
- **SMS** (21) — Get, List, List Events, Send, Send Batch, Stats By Carrier, Stats By Category, Stats By Country, Stats By Error Code, Stats By Originator, Stats By Status, Stats By Tag, Stats Daily, Stats Hourly, Stats Inbound By Country, Stats Inbound By Number, Stats Inbound By Operator, Stats Inbound Daily, Stats Inbound Hourly, Stats Inbound Summary, Stats Summary
- **SMS Keyword Rule** (5) — Create, Delete, Get, List, Update
- **SMS Suppression** (4) — Add, Get, List, Remove
- **SMS Template** (2) — Get, List
- **Suppression** (4) — Add, Get, List, Remove
- **Verify** (3) — Create Next Channel Attempt, Create Verification, Create Verification Check
- **Voice** (2) — Get, List
- **Webhook** (9) — Attempts, Create, Delete, Get, List, Replay, Rotate Secret, Test, Update
- **WhatsApp** (4) — Get, List, List Events, Send
- **Workspace** (1) — Get

</details>

## Trigger

The **Bird Trigger** node starts a workflow when Bird delivers a subscribed event (an email delivered, a bounce, an inbound SMS, and 50 more). It registers the webhook automatically with your API key, verifies every delivery as a [Standard Webhook](https://www.standardwebhooks.com) before the workflow runs, and deduplicates redelivered events. One Bird webhook is created per workflow; workspace webhook quotas apply.

## Credentials

Create an API key in the Bird dashboard under **API keys**, near the bottom of the sidebar, and paste it into the **Bird API** credential. The key is all the node needs — nothing else to configure. The credential's help text lists the scopes the key needs; the credential test verifies the key against your workspace.

## Limitations

An email has to fit in 20 MB once assembled, counting each attachment at its larger base64-encoded size.

## License

[MIT](LICENSE)
