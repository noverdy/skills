<div align="center">

# using-surfshark-proxies

*Surfshark exits in any country as local proxies, one per agent, without touching your host's network*

[What it can do](#what-the-agent-can-do) • [Installation](#installation) • [Usage](#usage) • [Limitations](#limitations)

</div>

An agent skill that runs your Surfshark VPN as egress proxies instead of a system-wide tunnel. Each session is a Docker container connected to one Surfshark server, with an HTTP proxy on `127.0.0.1`. Your default route, DNS and any other VPN stay as they are, so several agents can work from different countries at the same time. It's one Node script with no npm packages, driving the [gluetun](https://github.com/qdm12/gluetun) image.

Unofficial, and not affiliated with Surfshark.

## What the agent can do

With this skill loaded, an agent can:

- list Surfshark's countries and cities with their current load
- start a session on the least-loaded server in a country or city, and get back its proxy URL and confirmed exit IP
- run several sessions at once, each on its own port, named after the task that uses it
- run a tool that ignores proxy settings inside a container whose only network is the session's tunnel
- check every session's health and live exit IP, read its log, and stop it

## Installation

The agent needs Node 18 or later and Docker. On Linux, your user needs access to the Docker daemon (the `docker` group); no sudo is needed after that. Install just this skill:

```bash
npx skills@latest add noverdy/skills --skill using-surfshark-proxies
```

It also comes with the whole collection; see [Installation](../../README.md#installation). The skill itself lives in [`skills/accounts/using-surfshark-proxies`](../../skills/accounts/using-surfshark-proxies).

Then set it up once, in your own terminal:

```bash
node skills/accounts/using-surfshark-proxies/scripts/surfshark.mjs setup
```

It asks for your Surfshark **service credentials**, both hidden. These aren't your account login: find them at my.surfshark.com > VPN > Manual setup > Router or other device > Credentials. Setup pulls the image, makes one test connection to check the login, saves the credentials only if Surfshark accepts them, and offers to link `surfshark` into `~/.local/bin`. If Surfshark's own Linux app already owns the `surfshark` command, it won't hide it; use `--link-as surfshark-proxy` instead. `setup --from-file <file>` reads the two values (username, then password, one per line) from a file, or from stdin with `-`.

## Usage

Ask in plain language:

```text
Check whether example.com serves a different login page from Japan and from the US.
```

```text
Run the scan from a German IP and leave my own connection alone.
```

The agent starts sessions and points its tools at them:

```text
$ surfshark up jp tokyo --name acme-jp
starting "acme-jp": Tokyo, Japan (jp-tok.prod.surfshark.com, udp, load 32%) on 127.0.0.1:8881...
http://127.0.0.1:8881  acme-jp  exit 89.187.160.155 (Tokyo, Japan)

$ surfshark status
NAME     PROXY                  LOCATION                SERVER                     PROTO  HEALTH   EXIT
acme-jp  http://127.0.0.1:8881  Tokyo, Japan            jp-tok.prod.surfshark.com  udp    healthy  89.187.160.155 (Tokyo)
acme-us  http://127.0.0.1:8880  Phoenix, United States  us-phx.prod.surfshark.com  udp    healthy  172.216.11.23 (Phoenix)

$ curl -x http://127.0.0.1:8881 https://example.com/login
$ surfshark exec acme-jp --image projectdiscovery/nuclei -- -u https://example.com
$ surfshark down acme-jp acme-us
```

Where things live:

- `~/.config/surfshark/`: `openvpn_user` and `openvpn_password` (mode 600) and `config.json`, which sets the image and the port range (8880-8899 by default). `SURFSHARK_HOME` moves it.
- `~/.cache/surfshark/`: Surfshark's server list and config bundle, refreshed weekly.
- `~/.local/state/surfshark/sessions/`: the OpenVPN config each running session uses.

## Limitations

- The credentials are stored in plain text, readable only by your user. Anyone in the `docker` group can read them too, since Docker access amounts to root.
- The proxy is HTTP only (CONNECT works, so HTTPS does too). There's no SOCKS5, and no UDP through the proxy. Use `exec` for UDP or raw sockets.
- A tool that ignores proxy settings goes out from your own IP. `exec` closes that gap, but only for tools that run in a container image.
- Only OpenVPN is used, not WireGuard. Each session costs one Surfshark connection; Surfshark doesn't limit how many you have.
- Sessions don't survive a reboot or a Docker restart. Start them again with `up`.

<details>
<summary>What the research found</summary>

All of this was checked on 2026-11-14 with Docker 29.9 and gluetun v3.41.3.

**Surfshark**
- `GET https://api.surfshark.com/v1/server/clusters` lists about 140 locations with `country`, `countryCode`, `location` (city), `load` and `connectionName` (e.g. `jp-tok.prod.surfshark.com`), without authentication.
- `GET https://my.surfshark.com/vpn/api/v1/server/configurations` is a zip of `<connectionName>_udp.ovpn` and `_tcp.ovpn` for every server, also without authentication. The files share one template; only `proto`, `remote` and the port (1194 UDP, 1443 TCP) differ.
- `GET https://api.surfshark.com/v1/server/user` returns the caller's IP, city, country and `secured: true` when the request comes through Surfshark. `up` and `status` use it, through the proxy, to confirm each exit.

**gluetun**
- The `custom` provider (`OPENVPN_CUSTOM_CONFIG`) rejects hostnames in `remote` lines ("host is not an IP address"), so the script resolves the server and writes one `remote` per address.
- Credentials are read from `/run/secrets/openvpn_user` and `/run/secrets/openvpn_password`, so they're bind-mounted read-only and never appear in the environment or in `docker inspect`.
- `HTTPPROXY=on` listens on `:8888`, which is published to `127.0.0.1` only. The servers push `block-outside-dns`, a Windows-only option, so the config adds `pull-filter ignore "block-outside-dns"`.
- With `tun0` taken down inside a container, requests through its proxy failed for the whole outage rather than leaving from the host's IP. The health check restarted the tunnel after about 45 s, on the same exit IP.
- `PUBLICIP_ENABLED=off` and `VERSION_INFORMATION=off` stop gluetun calling ipinfo.io and GitHub from each session.

</details>
