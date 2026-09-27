---
slug: account-security
title: Account security, passwords and devices
audience: all
area: user-settings
---

# Account security, passwords and devices

Everything here is in **User settings** (account menu at the bottom of the sidebar → "User
settings").

## Changing your password

User settings → **"Security"** → "Password" — "Changing your password signs you out
everywhere else." Fill in "Current password", "New password" and "Confirm new password", then
click "Change password".

- The new password must be 12 to 128 characters long. There are no other rules — a long
  passphrase is a good choice.
- A wrong current password shows "Current password is incorrect".
- All your other browsers and devices are signed out; the device you are using stays signed
  in.
- You can change your password at most 10 times per hour.

## Forgot your password

1. On the sign-in page click **"Forgot password?"**.
2. Enter your "Email" (and "Organization (optional)" if you normally fill it in) and click
   "Send reset link". You always see "If that email exists, a reset link is on its way. It
   expires in 60 minutes." — the page does not reveal whether an account exists.
3. Open the link from the email, choose "New password" and "Confirm new password", and click
   "Reset password". You are signed in, and all other sessions are signed out.

If the link is too old or already used you see "This link is invalid or has expired." — use
"Request a new reset link". You can request at most 3 reset links per hour.

## Changing your email address

User settings → **"Account"** → "Change email" — "We'll send a confirmation link to the new
address before it takes effect." Enter "New email" and your "Current password", then click
"Send confirmation link". Open the link sent to the new address within 60 minutes to confirm;
your old address then receives a notice about the change. Until you confirm, the old address
stays in effect.

## Signed-in devices (sessions)

User settings → **"Security"** → "Active sessions" — "Devices that are currently signed in to
your account." Each row shows the device, its IP address and when it was last used; your
current device is marked "This device".

- **"Sign out"** on a row signs that device out; it will have to sign in again. Signing out
  your own device takes you back to the sign-in page.
- **"Sign out everywhere else"** signs out all other browsers and devices; this device stays
  signed in.
- "Ending a session closes its live connection immediately; ongoing requests from that device
  stop working within 15 minutes."

If you see a device you do not recognise, sign it out and change your password.

## How long you stay signed in

You stay signed in while you use the application. A session ends after 7 days without any use,
and in any case 30 days after you signed in; then you sign in again.

## Security notifications

You always receive (and cannot turn off) in-app notifications for: password changes
("Password changes"), a sign-in from a new device ("Sign-ins from new devices" — "New sign-in
from … "), and "Suspicious session activity" — a sign that someone may have copied your
session; if you get it, change your password.

## Sign-in problems

- **"Invalid email or password"** — the email or the password is wrong. Check the keyboard
  layout and Caps Lock, or use "Forgot password?".
- **"Account is deactivated"** — your access or your whole organization has been disabled.
  Contact your administrator.
- **Too many attempts** — after 5 sign-in attempts with the same email within a minute you
  must wait a minute before trying again ("Too many attempts"). There is no permanent lock-out.
- If you are suddenly taken back to the sign-in page, your session ended (signed out on
  another device, password changed, or expired). Sign in again.

## Not available

No two-factor authentication, no passkeys, no single sign-on (Google, Microsoft, SAML), and
no "remember me" choice.
