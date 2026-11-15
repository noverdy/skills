---
name: using-yeswehack
description: Reads the user's YesWeHack hunter account through the API with a cached 2FA login. Use when a task needs a YWH program's brief, scope, User-Agent token or VPN config, the user's reports and their conversations, which reports are waiting on the user, assigned test credentials or email aliases, or what changed in programs since the last check.
---

# Using YesWeHack

`scripts/ywh.mjs` (Node 18+, no packages) logs in as the user on `api.yeswehack.com` and wraps the reads a hunter needs. Run `node scripts/ywh.mjs --help` for every command; add `--json` for the raw API objects. Requests are paced at one per second.

## Login

The email, password and TOTP secret are cached in `~/.config/yeswehack/credentials.json` (mode 600; `YWH_HOME` moves it), and the session token next to them is renewed on its own. When a command says there are no cached credentials:

- If the user points you at an env file holding `YWH_EMAIL`, `YWH_PASSWORD` and `YWH_TOTP_SECRET`, run `setup --env-file <path>`.
- Otherwise ask the user to run `node <this skill>/scripts/ywh.mjs setup` in their own terminal. It prompts with hidden input, so the password and TOTP secret stay out of the chat.

Done when `whoami` prints the username.

## Facts the commands rely on

- **The wrapper only reads.** The user files, edits and comments on reports, accepts invitations and requests credentials in the YesWeHack web app. Your part is to draft the text and hand it over.
- **Report rewards are in cents.** The API's `reward: 30000` is 300 EUR. `reports` and `report` print the converted amount; divide by 100 yourself when reading `--json`.
- **The program's User-Agent token goes on every request to its targets.** `program <slug>` prints it as `mandatory User-Agent token`, along with whether the VPN is required.
- **`credentials` prints live passwords** for the test accounts assigned from credential pools. Use them in commands, and keep them out of files that get committed.

## Steps

Pick the branch the task needs.

1. **Starting on a program:** `program <slug>` for the summary, then `scope <slug> --out <dir>/SCOPE.md` for the whole brief verbatim: scopes with asset values, reward grids, rules, out-of-scope and (non-)qualifying lists. Find a slug with `programs --search <name>`, or list invitations with `programs --private`. Done when you hold the scope list, the User-Agent token, the VPN requirement and the submission cost.

2. **Getting access:** `credentials --program <slug>` for assigned test accounts, `pools <slug>` for the program's pools, `aliases` for the user's `@yeswehack.ninja` addresses. When `program` says the VPN is required, `vpn --out <file>.ovpn --with-auth` writes the config and an auth file holding the account email and password. Connecting takes root (`sudo openvpn --config <file>`), so confirm with the user first. Done when you have a working login or know which pool to ask the user to request.

3. **Following reports:** `todo` checks every open report and marks the ones where it is the user's turn: the program asked for more info, requested a fix verification, or commented last. `report <id or #YWH-...>` prints one report with its full conversation; add `--description` for the body as filed. `reports [--program slug] [--open]` lists them all. Done when each report the user asked about has its state, its last message and whose turn it is.

4. **Watching programs:** `watch` lists every visible program and diffs each brief against the snapshot from the previous run: new programs and invitations, scopes added, removed or re-valued, reward grids, cost, rules and status. The first run only records a baseline. Private programs are re-fetched every run, the rest only when their `last_update_at` moves. History is appended to `changes.log` in the state folder (`--state <dir>` moves it). Done when you have reported each change, private (★) programs first, or that nothing changed.

For anything else, `get <api-path>` sends an authenticated GET and prints the JSON.
