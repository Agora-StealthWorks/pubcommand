# PubCommand's system emails

PubCommand sends a few emails on its own behalf, never on an organization's: invites, sign-in links and password resets. Organizations' own email (website members, forms, funnels, reports) is set up separately in each organization's **Settings → Email** and is not covered here.

## The emails

| Email | Sent when | Placeholders |
| --- | --- | --- |
| Invite to an organization | Someone adds a person to an organization (Settings → Members, or Organizations in the console) | `{organization}` |
| Invite to PubCommand staff | A super admin adds someone under Staff | none |
| Sign-in link | Someone uses "Email me a link" on the login page (only when `EMAIL_LOGIN_ENABLED=true`) | none |
| Password reset | Someone uses "Forgot password" on the login page | `{minutes}` |

The catalog, default copy and placeholder rules live in `packages/core/src/system-emails.ts`. They are sent through Resend with PubCommand's own key (`RESEND_API_KEY`, from `EMAIL_FROM`). Without a key nothing is sent and the sign-in link is logged.

## Editing and previewing (Admin → Emails)

The platform console has an **Emails** page (`admin.pubcommand.com/emails`) for super admins only (permission `platform.emails.manage`). For each email you can:

- Edit the subject, heading, body (a blank line starts a new paragraph), button label and footnote.
- See a live preview as you type, at desktop or phone width, plus the plain-text version. The preview is rendered by the same function as the real send (`renderSystemEmail`), with sample values for placeholders, so it matches what goes out.
- **Send a test to me**: emails the copy in the form, saved or not, to your own address only, with "[Test]" in the subject. Its button goes to the login page, not a real sign-in link.
- **Save**: every email of that kind uses the new copy from then on.
- **Reset to the default copy**: removes the edits.

Rules: subject, heading, body and button label can't be empty; each field has a length limit; only the placeholders listed for that email are allowed. The button always carries the person's own secure link, which can't be edited.

Edits are stored in `platform_settings` under the key `system_email_copy` (one entry per edited email). If they can't be read, emails go out with the default copy rather than failing. Saves, resets and test sends write platform audit rows (`system_email.copy.updated`, `system_email.copy.reset`, `system_email.test_sent`, target `platform_setting` / `system_email_copy`).

## How they look

Every system email uses the same template (`pubcommandSystemEmail` in `packages/core/src/email-layout.ts`):

1. A skinny black bar across the top with the white "By Agora StealthWorks" logo centred (`/brand/agora-stealthworks-white.png`).
2. The PubCommand masthead: the PubCommand logo centred on white over a violet rule.
3. The heading, paragraphs, a violet button, the link spelled out, and the footnote, on a lilac page.
4. A footer: "PubCommand by Agora StealthWorks · pubcommand.com".

Logos are PNGs served from the site the link points at, because many email clients block SVG.
