# Auth, email and the domain

Everything here is dashboard work, which no MCP tool reaches. The code side is already done and
deployed: the retention sweep, its branded notice, and the six auth templates under
`supabase/templates/`.

Project: `uumbvunbgcbkzoenupay`. Live hosts: `cuefloww.netlify.app` (primary, and the value of
`PRIMARY_ORIGIN` in `src/lib/api.ts`), `cueflow.pages.dev` and `cueflow-eta.vercel.app`. GitHub
Pages was retired on 2026-08-10 when the repository went private.

## 1. Google sign-in

The client is already created: `536911597487-v5p0fbjhqsj76ias4vp7c5oo94suk2c3.apps.googleusercontent.com`.
Two things are still wrong with it.

**In Google Cloud, Credentials, that OAuth client:**

- Authorized JavaScript origins currently lists only `https://cueflow.pages.dev`. Add the others,
  or sign-in breaks on every host but Cloudflare:
  ```
  https://cuefloww.netlify.app
  https://cueflow-eta.vercel.app
  http://localhost:5173
  ```
- Authorized redirect URIs needs exactly one entry, the Supabase callback (not your site):
  ```
  https://uumbvunbgcbkzoenupay.supabase.co/auth/v1/callback
  ```
  The screenshot shows `/auth/v1/authorize?prov...`, which is the wrong end of the handshake.
  Google must return to `/callback`.

**In Supabase, Authentication, Sign In / Providers, Google:** enable it, paste the client ID and
the client secret, save. `signInWith("google")` in `src/lib/store.ts` already exists and starts
working the moment the provider is on.

**In Supabase, Authentication, URL Configuration:**

- Site URL: `https://cuefloww.netlify.app` (a plain origin, no `/**`). This is the address every
  auth email links back to, so a wildcard here sends people to a broken URL.
- Redirect URLs: one line each.
  ```
  https://cuefloww.netlify.app/**
  https://cueflow.pages.dev/**
  https://cueflow-eta.vercel.app/**
  http://localhost:5173/**
  ```

**Leave the "OAuth Server" page alone.** That makes CueFlow an identity provider for other
people's apps. It is not how you sign in with Google, and enabling it asks you to implement a
consent screen at `/oauth/consent` that does not exist.

## 2. SMTP, so the emails come from you

Supabase's built-in sender is rate limited to a handful of messages an hour and is meant for
testing. Any real signup flow needs custom SMTP.

Recommended: **Resend**. Free tier, an API the retention function already speaks, and SMTP
credentials for Supabase from the same account. (Brevo is the fallback if you would rather have a
higher daily allowance; check both current free limits before deciding, they move.)

1. Create a Resend account and verify a sending domain (see section 4).
2. Resend, API Keys: create one with send permission.
3. Supabase, Project Settings, Authentication, SMTP Settings, enable custom SMTP:
   ```
   Host      smtp.resend.com
   Port      465
   Username  resend
   Password  <the Resend API key>
   Sender    hello@<your domain>
   Name      CueFlow
   ```
4. Supabase, Authentication, Emails: paste each file from `supabase/templates/` into the matching
   template. Confirm signup, Invite user, Magic link, Change email address, Reset password,
   Reauthentication. Regenerate them any time with `node scripts/emails.mjs`.

While you are on that page: the Security section screenshot shows every account-change notification
turned off. Turn on at least **Password changed** and **Email address changed**. Those are the two
that tell someone their account has been taken.

## 3. Two secrets the retention sweep needs

The function is deployed and the cron job is scheduled (`cueflow-retention`, daily at 03:17 UTC),
but it cannot send mail or authenticate itself until these exist.

**Edge function secret**, in Supabase, Edge Functions, Secrets:

```
RESEND_API_KEY   <the same Resend key>
SITE_URL         https://cuefloww.netlify.app
RETENTION_FROM   CueFlow <hello@your-domain>
```

Without `RESEND_API_KEY` the sweep still runs, still deletes guest uploads, and deliberately
refuses to delete a single account: an account is only ever deleted after a notice that actually
sent.

**Vault secret**, so the cron job can call the function. In the SQL editor, with your service role
key (Project Settings, API Keys, `service_role`, never commit it):

```sql
select vault.create_secret('<service-role-key>', 'retention_key', 'calls the retention function');
```

Check it afterwards:

```sql
select jobname, schedule, active from cron.job where jobname = 'cueflow-retention';
select status, return_message from net._http_response order by created desc limit 3;
```

## 4. A free domain to send from

Deliverability is the only reason this matters: mail from a shared sender lands in spam, mail from
a domain you have signed with DKIM does not.

**The free option that actually works: `eu.org`.** Real domain, free forever, run by a nonprofit.
Apply at nic.eu.org for `cueflow.eu.org`, point it at Cloudflare's nameservers, and you own the DNS.
Approval is manual and can take days to weeks, so start it now.

Then, in Cloudflare DNS for that domain:

- Add the three records Resend gives you (a DKIM `TXT`, an SPF `TXT`, and their `MX` for the
  bounce subdomain). Verify in Resend.
- For inbound, turn on **Cloudflare Email Routing** and forward `hello@cueflow.eu.org` to your
  Gmail. Free, and it gives the brand a real address to be replied to.

Two fallbacks if you do not want to wait for approval:

- **Send from Resend's `onboarding@resend.dev`.** Works today, no domain, but it will only deliver
  to your own verified address, so it is a test path, not a launch path. This is what
  `RETENTION_FROM` currently defaults to.
- **Buy the domain.** `cueflow.app` or `cueflow.show` is roughly the price of a coffee a month and
  removes every deliverability caveat above. Free subdomain services (`is-a.dev` and friends) are
  aimed at project pages, and several of them do not allow the `MX` and `TXT` records email needs.

## 5. What the retention rules are

Written out for people on `/privacy#retention`, and enforced in
`supabase/functions/retention/index.ts` with the maths unit tested in `src/lib/retention.test.ts`.

| Who | Kept | Warned |
|---|---|---|
| Uploaded while signed out | 30 days from upload | Not possible, no address exists |
| Signed in | 365 days from last use | One email at 335 days, with the deletion date |

Opening CueFlow while signed in calls `touch_last_seen()` once per load, which is the clock. The
notice email offers exactly the two ways out the sweep honours: come back, or take the zip from
`/account`.
