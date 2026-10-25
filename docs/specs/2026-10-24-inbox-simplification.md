# Inbox Simplification

Status: approved · 2026-10-24

Supersedes the navigation and cold-compose parts of
`docs/specs/2026-10-21-outreach-inbox.md`. The inbox filtering, Board filtering,
and `thread_id` recording remain as specified there.

## Goal

One cold-outreach inbox with a simple composer. No separate Outreach screen, no
contact/address management, and no compliance footer in the email body.

## Decisions

1. **Navigation:** Inbox (default), Board, Dashboard. Settings is a gear button
   at the **bottom-left** of the sidebar, above the account/Refresh row — not in
   the main nav. Delete the Outreach view.
2. **Inbox contents:** cold-only and replies-only (unchanged from 2026-10-21).
   No All-mail toggle. The header shows `Inbox` + count and a `+ New` button.
3. **Composer:** opens in the reader pane from `+ New`. Fields: To, Context
   (optional one-liner), Tone, Subject, Body, Generate, Send, Cancel. No name
   field, no contacts list, no address book.
4. **Sending:** `sendGuard` keeps do-not-contact and the rate limits; the
   mailing-address requirement is removed. The body is sent as-is: no mailing
   address, no unsubscribe line, and no `List-Unsubscribe` header. The composer
   records the send (invisible `sends` row) with the Gmail `thread_id`, adds an
   activity entry, and closes on success. Test mode disables Send.
5. **Settings:** remove the mailing-address and unsubscribe fields and their
   setting keys. Keep Gmail, AI, signature, and rate-limit keys.
6. **Recipients:** `sends(kind='cold')`. **Your own address is included only
   while Test mode is on**, so single-account testing works; with Test mode off,
   self-sent threads are excluded from the Inbox and Trash. Only an inbound
   message from a recipient matches, so outbound self-notes still do not
   qualify. The composer writes the send row so the inbox filter keeps working.
7. **Delete `src/views/OutreachView.tsx`.**

## Non-goals

- Showing cold emails that have not been answered (replies only).
- Alias/plus-address matching.
- Any change to the Board or Dashboard behavior.

## Tests

- `sendGuard`: drop the mailing-address cases; keep opt-out and rate-limit cases.
- `settings`: drop mailing-address and unsubscribe expectations.
- Full suite, typecheck, lint, build, `cargo check`.
- Manual: send from the composer, reply from a second address, reply appears.

## Risks

- Removing the footer/opt-out is a deliberate compliance trade-off requested by
  the user. Do-not-contact and rate limits still apply.
