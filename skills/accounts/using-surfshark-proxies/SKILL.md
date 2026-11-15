---
name: using-surfshark-proxies
description: Runs Surfshark VPN exits as local egress proxies, one per country or city. Use when a task needs traffic from another country, a geo-blocked target, a separate exit IP per agent, or the user's Surfshark VPN.
---

# Using Surfshark proxies

`scripts/surfshark.mjs` runs each **session** as its own Docker container connected to one Surfshark server, publishing an HTTP proxy on `127.0.0.1`. The host's routes and DNS stay as they are, so any number of sessions run side by side. Call it as `surfshark` when the user linked it, else `node <this skill>/scripts/surfshark.mjs`; `--help` lists every command, `--json` gives machine output.

## Setup

When a command exits 2 with `not set up`, ask the user to run `surfshark setup` (or the `node` form) in their own terminal. It prompts for the Surfshark *service* credentials with hidden input, so they stay out of the chat, and tests the login before saving. If the user points you at a two-line file (username, password), run `setup --from-file <file>` yourself. Done when `surfshark status` stops saying `not set up`.

## Steps

1. **Start:** `surfshark up <country> [city] --name <task>-<cc> --json`, e.g. `up jp tokyo --name acme-jp`; `surfshark list [country]` shows the cities. The task in the name keeps parallel agents apart and tells the user who owns which exit. Done when the JSON has `"secured": true` and a `proxy` URL.
2. **Route through it:** pass `proxy` to each tool: `curl -x`, `HTTPS_PROXY`/`HTTP_PROXY`, Playwright or Chrome `--proxy-server`, Burp or mitmproxy as the upstream proxy. A tool that skips the proxy leaves from the host's IP, so run tools without a proxy option inside the session: `surfshark exec <name> --image <image> -- <cmd>` (cwd is mounted at `/work`). Done when every tool you route has fetched `https://api.surfshark.com/v1/server/user` once and shown the session's exit IP.
3. **Stop:** `surfshark down <name>` when the task ends. Done when `surfshark status` no longer lists it.

## Rules

- **Sessions belong to whoever started them.** `status` lists every session on the machine, other agents' included; use and stop only the names you created.
- **The proxy fails closed.** When the tunnel drops, requests through it fail rather than leave from the host's IP, and gluetun rebuilds the tunnel within about a minute. Read a session's state from the EXIT column of `status`, since its health flag lags: on `no answer`, pause the work and recheck; after two minutes, read `surfshark logs <name>` and tell the user.
- **Hold one exit per target.** Keep the same session for a target's whole engagement. When a target rate-limits or blocks you, slow down and tell the user; a fresh exit is the user's call.
