<div align="center">

# using-yeswehack

*Your YesWeHack hunter account from the terminal: briefs, scope, reports, test credentials and program changes*

[What it can do](#what-the-agent-can-do) • [Installation](#installation) • [Usage](#usage) • [Limitations](#limitations)

</div>

An agent skill for hunting on YesWeHack. It logs in as you, 2FA included, keeps the session alive, and wraps the API reads that come up on every engagement. It's one Node script with no npm packages.

## What the agent can do

With this skill loaded, an agent can:

- list the programs your account can see, including private invitations, filtered by name or bounty
- summarise a program's brief: mandatory User-Agent token, VPN requirement, submission cost, credential pools, scopes by asset value and the reward grid
- write the whole brief to `SCOPE.md`, verbatim, so the rules sit next to the engagement
- list your reports, print one with its full conversation, and tell you which open reports are waiting on you
- fetch the test accounts assigned to you from credential pools, your `@yeswehack.ninja` email aliases, and the OpenVPN config with an auth file
- diff every program against its last snapshot, to catch new invitations and scope or reward changes early

It doesn't file, edit or comment on reports. You do that in the web app.

## Installation

The agent needs Node 18 or later. Install just this skill:

```bash
npx skills@latest add noverdy/skills --skill using-yeswehack
```

It also comes with the whole collection; see [Installation](../../README.md#installation). The skill itself lives in [`skills/accounts/using-yeswehack`](../../skills/accounts/using-yeswehack).

Then cache your login once, in your own terminal:

```bash
node skills/accounts/using-yeswehack/scripts/ywh.mjs setup
```

It asks for your email, password and TOTP secret (the base32 secret behind the authenticator QR code, or the `otpauth://` URI), with the last two hidden. It logs in to check them before saving. `setup --env-file <file>` reads `YWH_EMAIL`, `YWH_PASSWORD` and `YWH_TOTP_SECRET` from a file instead. The same variables in the environment override the cache.

## Usage

Ask in plain language:

```text
What's the scope and UA token for the Example Corp program? Save the brief as SCOPE.md.
```

```text
Do any of my YesWeHack reports need a reply?
```

The agent runs the script and reads the output:

```text
$ node scripts/ywh.mjs todo
1 of 3 open report(s) need you

▶ YOU  #YWH-PGM1234-56  more_info  program asked for more info  since 2026-11-12 09:14
       IDOR on api.example.com through /v2/invoices/{id} via GET parameter "id"
       manager: Hello, could you share the exact request you used for step 3? Thanks.

  them  #YWH-PGM7890-12  under_review  waiting on program  since 2026-11-10 16:02
       Stored XSS on app.example.org through /profile via POST parameter "bio"
       manager: Hello, Thanks for your submission. Your report will be reviewed by our team.
```

```text
$ node scripts/ywh.mjs watch
2 change(s) across 127 programs (★ = private)
★ UPDATED example-private-program  https://yeswehack.com/programs/example-private-program
   report_submission_cost: 3 -> 2
UPDATED example-public-program  https://yeswehack.com/programs/example-public-program
   SCOPE ADDED: api.example.com [web-application] value=HIGH
```

## Limitations

- Credentials are stored in plain text in `~/.config/yeswehack/credentials.json`, readable only by your user (mode 600). Anything running as you can read them.
- It only reads. Hunter accounts can't create API tokens, so the skill logs in with your password like the web app does.
- The endpoints aren't publicly documented for hunters. They're the ones the web app calls, and YesWeHack can change them.
- `watch` checks every private program on every run, so with 75 invitations one run takes a little over a minute at one request per second.

<details>
<summary>What the research found</summary>

All of this was checked against the live API on 2026-11-14 with a hunter account.

**Login**
- `POST /login` with `{email, password}` returns `{token}`, or `{totp_token}` when 2FA is on. `POST /account/totp` with `{token: <totp_token>, code}` then returns `{token}`, a JWT with an `exp` claim, sent as `Authorization: Bearer`.
- Personal access tokens (`X-AUTH-TOKEN`) can only be created by business unit and program managers, not hunters.

**Endpoints**
- `GET /user`: account, credit balance, 2FA and KYC state, invitation counts, whether a VPN password is set. `GET /user/notifications/unread?context=hunter` returns `{has_unread}`.
- `GET /programs?page=N&resultsPerPage=100`: every program the account can see, private ones included, with `last_update_at`. `GET /programs/<slug>` is the full brief, including `user_agent`, `vpn_active`, `scopes` with `asset_value`, the `reward_grid_*` objects, `rules`, `out_of_scope` and the (non-)qualifying lists.
- `GET /user/reports`: your reports, paginated, with `local_id` (`#YWH-PGM…`), `status.workflow_state`, `reward` in cents and `ask_for_fix_verification_status`. `GET /reports/<id>` is the detail with `triage_status` and `description`; `GET /reports/<id>/logs` is the conversation, each entry carrying an `author_indicator` (`hunter`, `manager`, `bot`, …).
- `GET /user/credentials`: credentials assigned to you from pools, with login and password. `GET /programs/<slug>/credential-pools` lists a program's pools; the pool and per-pool credential URLs answer 403 to hunters.
- `GET /user/email-aliases`: your `@yeswehack.ninja` aliases.
- `GET /user/vpn/configuration`: the OpenVPN config as plain text (`remote vpn.yeswehack.com 1194`, UDP, `auth-user-pass`). The VPN login is the account email and password.

</details>
