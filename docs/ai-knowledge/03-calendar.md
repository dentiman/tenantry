---
slug: calendar
title: Calendar and events
audience: all
area: calendar
---

# Calendar and events

Open **"Calendar"** in the left rail. It opens the week view.

## Views and moving around

- View tabs: "Day", "Week" (default), "Month", "Agenda".
- "Today" jumps to the current period; the arrows ("Previous period" / "Next period") move
  back and forward.
- "Agenda" lists everything that has not ended yet, starting now, grouped by day ("Today",
  "Tomorrow", …). If it is empty: "Nothing scheduled ahead".
- The small month picker in the sidebar jumps to any date.
- In the month view a busy day shows "+N more".

### Keyboard shortcuts

Press `?` in the calendar to see them ("Keyboard shortcuts"). They work when no input field is
focused:

| Key | Action |
| --- | --- |
| `T` | "Go to today" |
| `D` / `W` / `M` / `A` | "Day view" / "Week view" / "Month view" / "Agenda view" |
| `←` / `→` | "Previous period" / "Next period" |
| `N` or `C` | "New event" |
| `?` | "Show this help" |
| `Esc` | "Close panel or dialog" |

## Creating an event

Click **"New event"**, or click an empty slot in the grid to create an event at that time. The
event opens in the context panel on the right ("New event" — "Guests get an in-app invitation
right away."). Fields:

- "Title" (required);
- "All day" — when on, you pick "Date" and "Last day"; when off, "Date", "From" and "To". The
  end must be after the start;
- "Type" — "Meeting" (default), "Call", "Deadline", "Out of office", "Other". The type only
  changes the colour and icon;
- "Customer" — optionally link the event to a customer; it then appears in that customer's
  "Upcoming" card;
- "Guests" — colleagues to invite ("Add a guest");
- "Reminders";
- "Location", "Notes";
- "Private" — see "Who can see an event" below;
- "Show me as busy" (on by default).

Click **"Create"**. If the event overlaps another one you see "Overlaps with another event" —
this is only a warning.

An event ends at its end time exactly: a 10:00–11:00 meeting and an 11:00–12:00 meeting do not
overlap.

## Changing an event

Open the event and edit the fields, then click **"Save"**. In the grid you can also drag an
event to move it or drag its edge to change the duration; a message "Moved to …" or "Duration
changed" offers "Undo".

Right-click an event for "Open event", "Are you going?", "Duplicate", "Cancel event" /
"Restore" and "Delete".

**Only the organizer can change an event** — its time, fields, guests, status. Guests see the
fields disabled. If you try anyway, the error is "Only the organizer can modify this event".

## Cancel or delete

- **"Cancel event"** keeps the event, marked as cancelled, and notifies the guests. It can be
  undone with "Restore". A cancelled event stays visible in the day, week and month views,
  marked as cancelled; the "Agenda" view and the "Upcoming" lists leave it out.
- **"Delete"** removes the event for everyone, permanently — "Cancel the event instead if you
  want to keep the history."

## Guests and answers (RSVP)

The organizer is always a guest of their own event and is marked as going. Invited colleagues
get an in-app invitation. As a guest you answer under **"Are you going?"** with "Yes", "Maybe"
or "No", and can "Add a note (optional)". Change your answer at any time. The organizer is
notified of your answer.

Each guest shows a badge: "Going", "Maybe", "Declined" or "No reply".

Only active users of your organization can be guests; customers and their contacts cannot be
invited, and there are no email invitations.

## Reminders

Reminders are **personal**: each person sets their own on an event, up to 5. Choose from "At
the start", 5, 10, 15 or 30 minutes, 1 or 2 hours, 1 day or 1 week before ("Add a reminder",
"Remove reminder").

- A reminder arrives as an **in-app notification** — "… starts soon". There are no email or
  phone reminders.
- If you do not choose, the organization default is used: 10 minutes before a timed event, and
  09:00 on the previous day for an all-day event (administrators can change the defaults).
- When the event is moved, reminders move with it; when it is cancelled or deleted, they are
  removed.
- A reminder that could not be delivered within about 10 minutes of its time is skipped.

You can turn off "Event reminders" in User settings → "Notifications".

## Who can see an event

You see an event if you are its organizer, its creator or one of its guests. In addition,
everyone in the organization can see an event **linked to a customer** — unless the event is
marked **"Private"**. "Private" removes exactly that organization-wide visibility; guests still
see it.

Administrators do not see other people's events, with one exception: events whose organizer's
account was deleted can be seen and managed by administrators.

## Time zones

Every event is stored with its time zone. Your calendar is drawn in **your** time zone
(User settings → "Profile" → "Time zone"), or the organization's default zone if you left it
empty. If your device is in a different zone, the sidebar warns "Times are shown in …".

## Not available

No recurring (repeating) events, no email invitations or reminders, no shared team or
resource calendars, no booking pages, and no synchronisation with external calendars.
