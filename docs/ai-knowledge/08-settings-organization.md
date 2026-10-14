---
slug: settings-organization
title: Organization settings
audience: admin
area: settings
---

# Organization settings

The **"Settings"** area in the left rail holds settings that apply to the whole organization.
It is visible to administrators only; everyone else is sent back to the Workspace. Everyone
can still _see the effects_ (for example the organization name and default time zone).

Settings for yourself only (profile, password, notifications, theme) are in **User settings**,
not here. A simple test: if the person left the company, would the setting leave with them?
Then it is a user setting.

## General

Settings → **"General"** — "Name, language and currency used across the organization."

- "Organization name" (up to 120 characters) — shown at the top of the sidebar.
- "Default language" — only "English" is available.
- "Default currency" — "ISO 4217 code, e.g. USD or EUR. New customers inherit it." Changing
  it does not change existing customers.
- "Sign-in identifier: … — changed by the platform operator only." This is the value people
  type into "Organization (optional)" on the sign-in page; you cannot change it here.

Click "Save changes" ("Settings saved").

## Calendar

Settings → **"Calendar"** — "Defaults for everyone in the organization. People can override
their own time zone in user settings."

| Field | Default |
| --- | --- |
| "Default time zone" (an IANA name such as `Europe/Berlin`) | `UTC` |
| "Week starts on" ("Sunday", "Monday", "Saturday") | Monday |
| "Work day starts" / "Work day ends" | 09:00 / 18:00 |
| "Default event length (minutes)" (5–1440) | 30 |
| "Default reminder (minutes before)" — "Set 0 to remind at the start." | 10 |
| "Default all-day reminder (minutes before)" — "900 means 09:00 on the previous day" | 900 |

Click "Save calendar settings". The default reminders apply to events created afterwards when
the creator does not pick reminders; existing reminders are not changed.

## Numbering

Settings → **"Numbering"** — "How human-readable numbers are issued for your records." There is
one series, "Customers", showing "Next number: …".

- "Prefix" (up to 16 characters, e.g. `C-`), "Minimum digits" (0–12 — "6 turns 123 into
  000123"), "Starting number" (used only before the first customer is created). Click "Save
  format". The format is applied to all customer numbers when they are displayed, including
  existing ones.
- "Next number" — "Can only move forward — earlier numbers are already issued. Use it after
  importing records from another system." Click "Move counter". A lower value is ignored.

Numbers never restart and are never reused, even after a customer is deleted.

## AI assistant

Settings → **"AI assistant"** — "The persona and instructions the AI assistant follows for
everyone in the organization."

- "Persona" — "Who the assistant is and how it sounds. Up to 500 characters."
- "Instructions" — "What to emphasize, tone and level of detail. Up to 4000 characters."

Both are optional; leave them empty to use the assistant as it is. Click "Save AI assistant
settings" ("AI assistant settings saved"). The change applies to the next question anyone asks.

"Sent to the AI provider" — the persona and instructions are sent to the external AI provider
together with every question, so do not put passwords, keys or personal data there.

"The assistant's built-in limits always apply and cannot be changed here": it has no access to
your data, cannot perform actions, does not guess beyond the documentation, and answers in the
language of the question. Instructions that ask for anything else are ignored.

Only administrators can open this page or read what is saved on it.

## Messaging

Settings → **"Messaging"** — "Provider account and channels that customer conversations arrive on."
Administrators connect a WhatsApp Business account here.

- Click "Connect WhatsApp" and enter the "WhatsApp Business Account ID" and an "Access token" from
  Meta Business (a system-user token that does not expire is recommended; a temporary token shows a
  countdown and stops working when it runs out). "App ID (optional)" and "App secret (optional)" must be
  given together; with them the token is checked and its kind, expiry and permissions are shown, without
  them the card says "Not verified". The token is stored encrypted and is never shown again — only its
  last four characters.
- If Meta rejects the token, the reason is shown under the field (for example a missing permission or an
  account the token cannot read) and nothing is saved.
- The account card shows "Access token", the numbers synced from Meta with their quality, a switch
  "Enabled" for each number and "Make default" (one default number per account). "Refresh" re-reads the
  numbers, "Update token" replaces the token, "Disconnect" removes it and stops sending.
- Under each number, "Webhooks" shows where WhatsApp currently delivers that number's events: "Delivered to this
  system", "Not delivered anywhere" or "Delivered to …" another host. "Subscribe" sends them here (a server
  address must be configured, otherwise "No public address is configured on the server."); for events that
  go to another host "Take over" asks you to confirm, because that service stops receiving the number's
  webhooks until you press "Unsubscribe". Nothing is subscribed automatically.
- "Show received webhooks" lists what WhatsApp has sent, with "Signature valid", "Signature invalid" or
  "Not checked", and "Show body" for the raw text. Every webhook is kept exactly as received; for a subscribed
  number, messages and delivery receipts in them also update the conversations. A request without a valid
  signature is refused.
- "Show recent provider calls" lists the latest calls to Meta (without message text or tokens).
- A number that is not subscribed does not get delivery and read receipts: "Delivery and read receipts arrive
  only for numbers subscribed to this system (see “Webhooks” on each number); otherwise a sent message stays at
  “sent”."

## Activity

Settings → **"Activity"** — "Who changed the organization settings, and when." A read-only list
of changes to General, Calendar, Numbering and AI assistant (it shows that the AI assistant
settings changed, not the text).

## Not available

No branding (logo, colours), no email/SMTP settings, no per-organization feature switches, no
custom roles or permissions, no billing or subscription settings. For the AI assistant you can set
only the persona and instructions — it cannot be switched off per organization, and there is no
usage report.
