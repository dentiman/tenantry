---
slug: customers
title: Customers and contacts
audience: all
area: workspace
---

# Customers and contacts

Open **Workspace → "Customers"**. The page is titled "Customers" — "The companies and people
you do business with."

## Company or individual

Each customer has a "Type":

- "Company" — an organization;
- "Individual" — a private person.

The type only describes the customer; both types have the same fields.

## The customer list

- **Search** — the box "Name, number, email or tax ID…" finds customers by name, legal name,
  email or tax ID, and by number: "C-000123", "000123" and "123" all find customer number 123.
- **Filters** — "Status" ("All statuses", "Active", "Inactive", "Archived") and "Type" ("All
  types", "Company", "Individual"). "Reset" clears them.
- **Columns** — "No.", "Customer", "Phone", "Status", "Owner", "Tags" (hidden by default),
  "Created". Click a sortable header ("No.", "Customer", "Status", "Created") to sort. The gear
  in the header row opens "Field settings", where you can show, hide and reorder columns, and
  "Reset to default".
- **Paging** — 20 rows per page by default; the footer shows "Total", the page and "Items per
  page".
- **Archived customers are hidden** from the list by default. Choose the "Archived" status
  filter to see them.

Inactive and archived rows are shown dimmed.

## Adding a customer

Click **"Add customer"**. Only "Name" is required — "everything else can be filled in later".
The dialog also has "Type" (defaults to "Company"), "Owner" (defaults to you), "Email" and
"Phone". Click "Create customer".

- A phone number is stored in international format — pick the country code and type the
  number; if you enter one, it must be a real, valid number.
- The customer's currency is taken from the organization's default currency.
- Names, emails and tax IDs do not have to be unique — two customers may share them.

## The customer page

Click a customer's name to open its page. The header shows the name, number and status badge,
with the buttons "Edit", "Archive" (or "Restore") and "Delete".

Tab **"Overview"**:

- "Upcoming" — calendar events linked to this customer, with "Schedule a meeting";
- "State" — "Status", "Owner", "Contacts", "Customer since";
- "Contact" — "Email", "Phone", "Website", "Address";
- "Business" — "Type", "Legal name", "Tax ID", "Currency", "External ID";
- "Tags", "Notes", and "Record" ("Created", "Last updated", "Customer ID").

Tab **"Contacts"** lists the customer's contact persons. The right side of the page shows the
customer's "Activity".

## Editing a customer

Click **"Edit"**. The "Edit customer" dialog has "Name", "Legal name", "Type", "Owner",
"Email", "Phone", "Website", the address ("Address line 1", "Address line 2", "City",
"Region", "Postal code", "Country (ISO code)" — a two-letter code such as `DE`), "Tax ID",
"Currency" (a three-letter code such as `EUR`) and "Notes". Click "Save changes".

Tags, language and external ID are shown on the page but cannot be edited in the interface.

## Owner

The owner is the colleague responsible for the customer. It must be an active user. A new
owner gets an in-app notification (User settings → "Notifications" → "Customers assigned to
me" turns it off). A customer can also be
"Unassigned".

## Statuses

| Status | Meaning |
| --- | --- |
| "Active" | A customer you currently work with (the default). |
| "Inactive" | Temporarily not active; stays in the list, dimmed. |
| "Archived" | Hidden from the default list; nothing is deleted. |

Change the status from the row menu of the list ("Mark inactive", "Mark active", "Archive",
"Restore") or with "Archive"/"Restore" on the customer page. Any status can change to any
other. There are no sales stages such as lead or prospect.

## Archive or delete

- **Archive** hides the customer from the default list — "Nothing is deleted — you can
  restore them at any time."
- **Delete** removes the customer **permanently**, together with its contacts. It cannot be
  undone. Calendar events that were linked to the customer are kept but lose the link.
  Prefer archiving if you only want a customer out of the way.

## Customer numbers

Every customer gets a human-readable number when it is created, for example `C-000001`. The
number is assigned automatically and can never be changed or reused. By default numbers have
the prefix `C-` and six digits. An administrator can change the format (prefix, number of
digits) in Settings → "Numbering"; the new format then applies to the numbers of all existing
customers as they are displayed.

## Contact persons

On the "Contacts" tab click **"Add contact"**. Fields: "Name" (required), "Position", "Email",
"Phone", the switch "Primary contact", and "Notes". Click "Save".

- Only one contact can be primary; marking another one primary moves the flag.
- Use the row menu ("Contact actions") for "Edit contact" or "Delete". Deleting a contact is
  permanent.

## Who can do what

Every signed-in user can view, add, edit, archive and delete customers and their contacts —
there is no per-role restriction on customers.

## Not available

No import or export of customers, no bulk actions, no merging of duplicates, no parent/child
company hierarchy, no sales pipeline, and no file attachments on customers.
