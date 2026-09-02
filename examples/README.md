# @messagebird/n8n-nodes-bird — Example Workflows

Ready-to-import workflows showing what the Bird node is for. Each one runs against real Bird operations and carries its own setup notes on the canvas.

## How to import

1. Open your n8n instance.
2. Go to **Workflows → New Workflow → More options (⋮) → Import from File**.
3. Select the `.json` file and click **Import**.
4. Follow the **Setup Instructions** sticky note in the workflow, then add your **Bird API** credential.

Every example needs an API key from the Bird dashboard, under **API keys**. The key's region prefix (`bk_eu1_…`, `bk_us1_…`) selects the API host, so there is nothing else to configure. Each workflow's setup note lists the scopes its key needs.

---

## Examples

### 01 — Contact Form → Welcome Email

**File:** `01-contact-form-welcome-email.json`

An n8n form captures a mailing-list sign-up and Bird sends the welcome email straight away, addressing the subscriber by the name they gave.

**Nodes:** n8n Form Trigger → Bird (Send Email)

**Bird operations:** `email › send`

**Scopes:** `email`

---

### 02 — Order Shipped → SMS from a Stored Template

**File:** `02-order-shipped-sms-template.json`

Your order system posts to a webhook and Bird sends the shipping SMS from a template stored in Bird, so the copy and its translations live outside the workflow. The order number and tracking link are passed as template parameters.

**Nodes:** Webhook → Bird (Send SMS)

**Bird operations:** `sms › send`

**Scopes:** `sms`

A template supplies the sender and the copy, so **Text**, **From** and **Category** are left empty when one is used.

---

### 03 — Bounce & Complaint Handler

**File:** `03-bounce-complaint-handler.json`

Bird Trigger fires on `email.bounced` and `email.complained`. The address is added to the workspace suppression list so nothing sends to it again, and the deliverability team gets a note naming the event and the message.

**Nodes:** Bird Trigger → Bird (Add Suppression) → Bird (Send Email)

**Bird operations:** `email › send`, `suppression › add`

**Scopes:** `webhooks`, `email`, `suppressions`

Activating the workflow registers the Bird webhook for you, and every delivery is verified before the workflow runs. Each event carries `type`, `timestamp` and `data`; the address is at `data.recipient`.
