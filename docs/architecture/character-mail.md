# Character mail and distributor

Character mail is separate from account verification and sign-in delivery. Every admitted character has a host-owned sender identity, an optional maker contact, recipient preferences, drafts, a private inbox and delivery history. Only Hubert is admitted now; the service and interfaces accept character-scoped configuration for future residents.

A character's sender cannot be changed by a model command. Hubert's default address is `Hubert <hubert@elswhr.dev>`. This is a configured identity, not proof that sending or receiving is already verified at Resend.

## Pending receiving

Keep `CHARACTER_MAIL_RECEIVING=pending` while Resend's receiving-domain verification is pending. The UI reports the pending state; incoming content is not fetched or accepted for an inactive recipient. Sending has its own domain/key requirements and does not establish receiving readiness.

After the receiving record is verified in Resend:

1. Create a webhook at `/api/mail/webhook/resend` on the public Elsewhere origin. Subscribe only to `email.received`, `email.delivered`, `email.bounced` and `email.complained`.
2. Install its signing secret in private `CHARACTER_MAIL_WEBHOOK_SECRET` runtime storage.
3. Supply a separate `CHARACTER_MAIL_RECEIVE_API_KEY` capable of reading received emails. A domain-limited Sending access key cannot perform the received-email GET. Resend's current broader access model may require a Full access receiving key; it stays private to the fixed host transport and is never exposed to a character.
4. Set `CHARACTER_MAIL_RECEIVING=enabled` and restart/redeploy the runtime. This setting is an explicit operator attestation of verification, not an automatic DNS checker.

Sending-domain verification, receiving MX verification and webhook installation happen in Resend/DNS; application code does not provision or alter them. Do not replace an existing mailbox's root-domain MX routing without reconciling that mail service first. A dedicated receiving subdomain or forwarding may be appropriate if `elswhr.dev` already has another receiving provider.

## Private runtime settings

```dotenv
CHARACTER_MAIL_API_KEY=re_dedicated_character_sending_key
CHARACTER_MAIL_FROM_DOMAIN=elswhr.dev
HUBERT_OWNER_USER_ID=huberts-actual-elsewhere-owner-id
CHARACTER_MAIL_MAKER_USER_ID=makers-verified-elsewhere-account-id
CHARACTER_MAIL_UNSUBSCRIBE_SECRET=independent-generated-secret-at-least-32-characters
CHARACTER_MAIL_DAILY_LIMIT=20
CHARACTER_MAIL_PUBLICATION=review
CHARACTER_MAIL_RECEIVING=pending
WEB_ORIGIN=https://elswhr.dev
```

The maker is an explicit Elsewhere account binding and may differ from the character owner. No email address or maker identity is inferred from an administrator role. The host resolves configured account IDs to current verified account email addresses at dispatch; account lists and raw recipient addresses are not model-visible.

Without `CHARACTER_MAIL_API_KEY`, sending remains disabled. No code falls back to the account-mail `AUTH_EMAIL_API_KEY`; sharing that key is rejected. Use a separate Resend sending key restricted to the character sending domain. The unsubscribe secret signs durable preference links and must remain stable across restarts; rotation invalidates existing unsubscribe URLs.

## Correspondence and newsletters

Signing in does not subscribe a user. Newsletter subscription and permission for direct character correspondence are separate per-character preferences. Recipients must have a verified account email. Preferences and current account verification are rechecked before dispatch; revoked or suppressed recipients are skipped.

Maker messages use the explicitly configured maker contact. Direct correspondence addresses an eligible account ID rather than an arbitrary email address. A newsletter is distributed as separate emails to that character's subscribed recipients, with its own unsubscribe link and one-click unsubscribe headers. Elsewhere's distributor owns this audience; this implementation does not bulk-import every account into Resend Contacts or silently create a provider Broadcast list.

The default newsletter policy is `review`: owners review the exact persisted draft before approving delivery. `automatic` is an explicit operator publication grant. Character-initiated draft content is built from publication-eligible notebook entry IDs; the planner cannot submit unrestricted text copied from private visitor messages. Owner-authored drafts are identified separately. The service never treats a successfully written or delivered message as proof that its claims are true.

A stable per-recipient idempotency key is committed before a provider request. Resend acceptance and final delivery are distinct states. Crashes or transport outcomes that may have sent mail become uncertain rather than silently repeating the request. Sending allowance uses real time, persists across restart, and cannot be replenished by resetting the simulated world. Delivery failures remain visible in private owner mail history; bounce and complaint events suppress future deliveries.

## Webhook and inbox boundary

The raw request body is authenticated with the Resend endpoint's Svix signing secret before parsing or fetching message content. Verification checks HMAC-SHA256, the signed event ID, the exact body and a five-minute timestamp tolerance. Event IDs are deduplicated by the durable mail service; a valid signature is not treated as new delivery authority on replay.

The host matches recipient addresses against enabled character configuration before retrieving received content, and matches them again against the retrieved payload. Only bounded plain text is stored. HTML-only messages receive an explicit no-plain-text placeholder; HTML and attachments are not rendered or executed.

A valid webhook authenticates Resend, not the email's claimed author. Sender/account association uses only Resend's server-computed `authentication` response field: DMARC must pass, plus SPF or DKIM. Missing, failed or old authentication leaves the sender unverified. Email-supplied `Authentication-Results` headers cannot establish account identity. Inbound messages remain untrusted external content, never a command to grant permissions or send mail.

## Operator validation

Unit and integration tests use mock transports and isolated databases; they do not send real mail, subscribe existing users or change DNS. Activate actual sending only after private settings and verified domain readiness are installed. Pending receiving can be tested in the UI before any receiving key or webhook is configured.

## Provider references

Verified November 10, 2026:

- [Resend send email API](https://resend.com/docs/api-reference/emails/send-email): sender/recipient fields, reply routing and request idempotency. Provider idempotency keys expire after 24 hours; local recovery must not depend on unlimited provider deduplication.
- [Retrieve received email](https://resend.com/docs/api-reference/emails/retrieve-received-email): received message bodies and server-computed authentication results.
- [Verify Resend webhook requests](https://resend.com/docs/webhooks/verify-webhooks-requests) and [Svix manual verification](https://docs.svix.com/receiving/verifying-payloads/how-manual): exact raw-body verification, signing input and HMAC-SHA256.
- [Custom receiving domains](https://resend.com/docs/dashboard/receiving/custom-domains): receiving verification and MX routing are distinct from sending.
- [Resend API key permissions](https://resend.com/changelog/new-api-key-permissions): Sending access keys are send-only; Full access permits resource reads.
