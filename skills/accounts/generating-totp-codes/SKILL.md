---
name: generating-totp-codes
description: Generates TOTP 2FA codes from saved or given secrets, and saves, lists and removes those secrets. Use when a login asks for an authenticator, 2FA or MFA code, when the user gives a TOTP secret or otpauth:// URI, or when enrolling a test account in 2FA.
---

# Generating TOTP codes

`scripts/totp.mjs` keeps TOTP secrets under short names and prints the current code for one. Run it as `node <this skill>/scripts/totp.mjs`, written `totp` below; `--help` lists every command, `--json` gives machine output. The **vault** is the store it writes, `~/.config/totp/secrets.json`.

## Steps

1. **Pick the name:** `totp list` shows saved names with their issuer. Done when you have a name matching the account, or know none exists.
2. **Save a new secret** (only when the user gives one, or a site you're enrolling shows one): pipe it in, `printf '%s' '<base32 or otpauth:// URI>' | totp add <site>-<account>`. Prefer the otpauth URI when you have it, since it carries the digits, period and algorithm. For the user's own accounts, ask them to run `totp add <name>` in their terminal so the secret never enters the chat. Done when `add` prints `saved`.
3. **Get the code:** `totp code <name> --json`, and submit `code` straight away. It waits out the last 5 seconds of a period so the code it returns stays valid long enough to submit. For a secret you won't need again, `printf '%s' '<secret>' | totp code -` saves nothing. Done when the site accepts the code.

## Rules

- **The vault is write-only to you.** Reach secrets through `totp code` alone. Once a secret is saved, refer to it by name in chat and commands.
- **A rejected code means drift or a wrong secret.** Retry once in the next period; on a second rejection, tell the user, since repeated failures can lock the account.
- **Exit 3 means no such name.** The error lists the saved names; pick from those or ask the user, rather than guessing a secret.
