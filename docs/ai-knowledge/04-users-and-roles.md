---
slug: users-and-roles
title: Users and roles
audience: admin
area: workspace
---

# Users and roles

User accounts are managed on **Workspace → "Users"** — "Manage the people who can sign in to
this organization."

## Roles

| Role | Shown as | What it adds |
| --- | --- | --- |
| `USER` | "User" | The regular role. |
| `ADMIN` | "Admin" | Opens the "Settings" area and can change organization settings (name, currency, calendar defaults, numbering). Can also see and manage calendar events whose organizer's account was deleted. |

There are only these two roles; there are no custom roles or fine-grained permissions.
Administrators do **not** get access to other people's private data: they cannot read someone
else's calendar events, chat conversations, notifications or assistant conversations.

Note: the Users page itself is not restricted by role in the current version — every
signed-in user can open it and use its actions. Agree inside your organization who manages
accounts.

## The user list

- Search "Search by email or name…", filter "Status" ("All statuses", "Active", "Inactive").
- Columns: "User", "Phone", "Role", "Active", "Last seen" ("Online", "Never signed in" or "Last
  seen …"), "Created".
- The "Active" column is a switch: flip it to enable or disable access directly in the list.
- Row checkboxes select users; the "Export selected" button that appears is a placeholder and
  is always disabled — bulk actions and export are not available.

## Adding a user

There is no self-registration and no email invitation. To give someone access, click
**"Add user"** and fill in:

- "Email" (required, unique in the organization — a duplicate shows "Already exists");
- "Name" (optional);
- "Role" ("User" or "Admin", default "User");
- "Phone" (optional);
- "Initial password" (required, 12 to 128 characters).

Click "Create user", then give the person their email and initial password in a safe way.
They receive a welcome email, are added automatically to the organization's default chat
channel, and administrators get the notification about a new user. Ask the new user to
change the password in User settings → "Security".

## Changing someone's password

Row menu → **"Change password"** (or the button on the user's page). Enter "New password" and
"Confirm password" (12–128 characters). No current password is needed. "The user will be
signed out of all sessions and will need the new password to sign in again." The user gets a
notification that their password was changed.

People who forgot their own password can reset it themselves with "Forgot password?" on the
sign-in page.

## Disabling and enabling access

Row menu → **"Disable access"**: the user "will not be able to sign in, and all their sessions
will be signed out." Their data stays. "Enable access" gives access back. You cannot disable
yourself ("You cannot disable yourself").

Prefer disabling over deleting for people who leave.

## Deleting a user

Row menu → **"Delete"**: "This will permanently delete … This action cannot be undone." Their
customers become "Unassigned", and calendar events they organized lose their organizer (an
administrator can still manage those events). You cannot delete yourself.

## Avatar

Row menu → **"Change avatar"** uploads a profile picture for the user (JPEG, PNG, WebP or GIF).

## The user page

Click a user to open their page: badges for role and "Active"/"Inactive" (and "You" on your
own record), the cards "State", "Contact", "Account", "Avatar", "Record" and "Activity", and
the buttons "Change password", "Change avatar", "Disable access"/"Enable access", "Delete".

There is no form to edit another user's name, phone or role in the interface; people edit
their own name and phone in User settings → "Profile". To change someone's role, currently
the only way in the interface is to create the account with the right role.

## Activity

Row menu → **"View activity"** opens the "Activity" drawer: account creation, password changes,
signing out of all devices, enabling/disabling and email changes are recorded there.
