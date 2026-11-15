<div align="center">

# generating-totp-codes

*TOTP 2FA codes for the agent, from secrets it uses by name and never reads back*

[What it can do](#what-the-agent-can-do) • [Installation](#installation) • [Usage](#usage) • [Limitations](#limitations)

</div>

An agent skill that works as an authenticator app. You save a TOTP secret once under a short name, and from then on the agent asks for a code by that name, so the secret stays out of the chat on every later login. It's one Node script with no npm packages.

## What the agent can do

With this skill loaded, an agent can:

- print the current code for a saved account, with the seconds it has left, waiting for a fresh one when the current code is about to expire
- save a secret from a base32 string or an `otpauth://` URI, keeping its digits (6-8), period and algorithm (SHA1, SHA256, SHA512)
- generate a one-off code from a secret on stdin without saving it
- list saved names and remove them; secrets are never printed

## Installation

The agent needs Node 18 or later. Install just this skill:

```bash
npx skills@latest add noverdy/skills --skill generating-totp-codes
```

It also comes with the whole collection; see [Installation](../../README.md#installation). The skill itself lives in [`skills/accounts/generating-totp-codes`](../../skills/accounts/generating-totp-codes).

To save a secret for one of your own accounts without it passing through the agent, run this in your terminal. It prompts with hidden input:

```bash
node skills/accounts/generating-totp-codes/scripts/totp.mjs add github
```

## Usage

Ask in plain language:

```text
Log in to the staging admin as tester2, it has 2FA on (saved as acme-tester2).
```

```text
Turn on 2FA for the second test account and save its secret.
```

The agent runs:

```text
$ printf '%s' 'otpauth://totp/ACME:tester2?secret=JBSWY3DPEHPK3PXP&issuer=ACME' | totp add acme-tester2
saved "acme-tester2" (ACME) in ~/.config/totp/secrets.json

$ totp list
acme-tester2  6 digits / 30s / SHA1  ACME
github        6 digits / 30s / SHA1

$ totp code acme-tester2 --json
{"code":"647793","expires_in":24}

$ printf '%s' 'JBSWY3DPEHPK3PXP' | totp code -
647793  (24s left)
```

Secrets live in `~/.config/totp/secrets.json` (mode 600, folder mode 700). `TOTP_HOME` moves it.

## Limitations

- Secrets are stored in plain text, readable only by your user. There's no encryption or system keyring.
- The agent is told not to read the secrets file, but nothing stops it technically. Anything else running as your user can read it too.
- A secret the agent saves with `add` passes through its chat, so it's in the transcript. Run `add` yourself for accounts that matter.
- TOTP only. HOTP (counter-based) and Steam Guard codes aren't supported.
- Codes depend on your clock. If they're rejected, check the system time is synced.
