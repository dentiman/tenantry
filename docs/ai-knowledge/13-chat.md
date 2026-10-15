---
slug: chat
title: Chat
audience: all
area: general
---

# Chat

Open **Chat** in the left rail. The list on the left has two tabs: "Customers" (conversations
that arrive from a messaging channel; this tab opens first) and "Team" (conversations with
colleagues). Each customer conversation row is titled with the person you are talking to (the profile name
from WhatsApp) and shows the avatar of the linked customer (a building for a company, initials for
a person), the last message, and underneath a small label with the channel it came through
("WhatsApp", or "Fake" for the built-in test channel), the customer the person belongs to ("No
customer linked" when there is none) and the person's phone number. Customer conversations are drawn like a messenger chat: your
messages are green, the customer's are white (dark grey in the dark theme), over a patterned
background, with larger tick marks (grey = sent or delivered, blue = read).

## Team conversations

- Click "New conversation", pick colleagues under "Participants" and optionally give the
  conversation a "Name". The title is the other people's names when no name is set.
- Type in "Write a message…" and press Enter to send ("Send"); Shift+Enter starts a new line.
- A message that could not be delivered shows "Not sent" with "Retry" and "Discard".
- You see "… is typing…" while someone writes, and unread counts in the list.
- Only participants can open a team conversation — not even an administrator who is not in it.

## Customer conversations

Customer conversations appear under "Customers" when a customer writes to your messaging
channel. They are visible to every active user of the organization, and a conversation has a
status ("Open", "Pending", "Resolved") and an optional assignee.

- Reply with "Reply to customer"; use "Internal note" for a note only your team sees — a note is
  never sent to the customer and does not change the inbox order.
- A free-text reply is only possible within **24 hours** of the customer's last message. After that
  the composer explains that the window is closed and offers only "Internal note"; the customer
  writing again reopens the window.
- Each of your replies shows its delivery state next to the time: a clock (sending), one tick
  (sent), two ticks (delivered), two highlighted ticks (read). A failed reply shows the reason and
  "Resend" (not offered when the 24-hour window is closed).
- Replying to a conversation nobody is assigned to assigns it to you; replying to a "Resolved" one
  reopens it. The assignee gets a notification ("New customer messages") when the customer writes,
  unless they already have the conversation open.
- In a conversation's contact panel you can link the contact to a customer or create one.

Customer conversations need a connected messaging channel; an administrator connects WhatsApp under
Settings → "Messaging". Once a number is subscribed there ("Webhooks" → "Subscribe"), a customer's WhatsApp
message creates a conversation (or adds to the open one) under "Customers", and your replies show their
delivery state: one tick (sent), two ticks (delivered), two highlighted ticks (read). A reply WhatsApp could not
deliver shows the reason and "Resend". A customer's message that is not text (a photo, document, voice note…) appears as "Message not supported (image)" — it is not downloaded yet. A customer's reaction to a message appears as "Reacted 👍" (or "Removed a reaction") and does not reopen the 24-hour window. When you open a customer's message in a WhatsApp conversation, the customer sees it as read (blue ticks) on their phone. Without a subscription a sent
message stays at "sent" and the composer says "Delivery and read receipts are not tracked on this channel yet:
a message stays at “sent”."

To write to a customer first, open the "Customers" tab, click "New customer conversation", pick the
"WhatsApp number", enter the "Customer phone" in international format (for example +380501234567) and
click "Start". If that number already has an open conversation, it opens instead. Outside the 24-hour
window only an approved template can be sent: click "Send template", enter the "Template name" and
"Language code" (for example hello_world and en_US) and click "Send". Templates with variables are not
supported yet; if the template does not exist in that language, or the number is not allowed on a test
account, the message shows as failed with "Resend".

## Notifications

A colleague's message creates a "New chat messages" notification (category "Chat") only when you are
not looking at that conversation; several messages are combined into one entry, and opening the
conversation clears it. You can turn it off in User settings → "Notifications".
