---
slug: troubleshooting
title: Troubleshooting and error messages
audience: all
area: general
---

# Troubleshooting and error messages

## Error codes

Every error from the server has a code. The application shows the message below for it —
either as a pop-up (for connection, access, rate-limit and server errors) or next to the form
you submitted.

| Code | Message shown | What it usually means and what to do |
| --- | --- | --- |
| `VALIDATION_ERROR` | "Validation failed" | Some fields are invalid; the form marks them. Fix the marked fields and submit again. |
| `BAD_REQUEST` | "Invalid request" | The request was understood but not accepted — for example a wrong current password, an end time before the start, an unknown owner. The form usually shows the exact reason. |
| `UNAUTHORIZED` | "Authentication required" | You are not signed in, or your session ended. Sign in again. On the sign-in page the reason is shown instead ("Invalid email or password", "Account is deactivated"). |
| `FORBIDDEN` | "Access denied" | Your role does not allow this action (for example changing organization settings without the Admin role, or changing an event you do not organize). Ask an administrator or the event organizer. |
| `NOT_FOUND` | "Not found" | The item does not exist, was deleted, or you are not allowed to see it (for example someone else's private event or a chat you are not part of). |
| `CONFLICT` | "Conflict" | The change clashes with existing data — for example the email is already used by another account ("Already exists"), or the assistant is still answering your previous question. |
| `TOO_MANY_REQUESTS` | "Wait a minute and try again." | You did the same action too many times in a short period. Wait and try again. |
| `INTERNAL_ERROR` | "Internal server error" | An unexpected problem on the server. Try again; if it repeats, tell your administrator what you did and when. |
| `SERVICE_UNAVAILABLE` | "Service temporarily unavailable, please try again" | The server or one of its services is temporarily unreachable. Try again in a moment. |

Pop-up titles: "Connection problem", "Access denied", "Too many attempts", "Service
unavailable", "Server error".

## Common field messages

- "Already exists" — the value must be unique (for example a user's email).
- "Invalid value", "Invalid format" — the value has the wrong form (an email without `@`, a
  phone number that is not valid, a website that is not a URL).
- "Value is too large" / "Value is too small" — too long or too short, or a number outside the
  allowed range (for example a password shorter than 12 characters).
- "Current password is incorrect" — the current password you typed is wrong.
- "Must be after the start" — an event's end is not after its start.
- "Unknown user" — the chosen owner or guest is not an active user.
- "You cannot disable yourself" — you tried to switch off your own access.

## Other messages

- "Cannot reach the server. Check your connection and try again." — your device is offline or
  the server cannot be reached.
- "Something went wrong. Please try again." — an unexpected response; try again.
- "This page does not exist" — the address is wrong or the item moved. Use "Back to home".
- "Could not load …" (the calendar, conversations, notifications, activity, your account) —
  reload the page; if it persists, the server may be unavailable.

## Common situations

- **I was sent back to the sign-in page.** Your session ended — signed out from another
  device, password changed by you or an administrator, 7 days without use, or 30 days since
  sign-in. Sign in again.
- **I cannot see the "Settings" area.** It is for administrators only.
- **I cannot change an event.** Only its organizer can.
- **A colleague's event is missing from my calendar.** You see only events you organize, were
  invited to, or that are linked to a customer and not private.
- **A customer disappeared from the list.** It may be archived — choose the "Archived" status
  filter. Deleted customers cannot be recovered.
- **New chat messages do not appear.** Chat updates on its own while the connection to the
  server is up. If a message is missing, the connection may have dropped: switch back to the
  window or reload the page, and the conversation catches up.
- **A conversation stays unread although I opened it.** A conversation counts as read only while
  the window is in front of you and the latest message is on screen. If you are scrolled up in the
  history or the window is in the background, the unread badge stays until you scroll to the
  newest message or come back to the window.
- **I see "… is typing…" above the message box.** A colleague who has the same conversation open
  is writing a message. It disappears when they send it or stop typing.
- **I did not get an email notification.** Notifications are in-app only; check the bell.
- **Times look shifted.** Your calendar uses the time zone from User settings → "Profile" (or
  the organization default); set it to where you are.
- **The assistant button is missing.** The assistant is not enabled in your installation.

## Assistant errors

- "The assistant is unavailable right now. Try again in a moment."
- "The assistant took too long to answer. Try again."
- "Something went wrong while answering. Try again."

Ask again after a moment. While an answer is being written you cannot send another question —
wait or click "Stop".
