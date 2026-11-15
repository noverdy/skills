<div align="center">

# packing-report-evidence

*One clean image per reproduction step, zipped*

[What it can do](#what-the-agent-can-do) • [Installation](#installation) • [Usage](#usage) • [Limitations](#limitations)

</div>

An agent skill that builds every image a report needs, one per step: app screenshots marked up in the live page, Burp-style request/response snapshots (through [snapshotting-http-requests](snapshotting-http-requests.md)), and terminal or `adb logcat` output rendered as an image. Secrets are removed from the page and blurred with their last four characters kept in green, internal ids never appear, and the set is checked, written to a manifest and zipped.

## What the agent can do

With this skill loaded, an agent can:

- map a report's numbered steps to the image each one needs
- box and blur elements or text in a real browser page by injecting `markup.js`
- render captured terminal or logcat output as a dark, cropped PNG with `terminal.mjs`, colouring logcat levels
- review every image for leaked secrets, internal names and bad crops before handing it over
- produce a manifest and a zip whose contents match it

## Installation

`terminal.mjs` needs Node 18+ and a local Chrome or Chromium (found on PATH, in Playwright's cache, or via `$CHROME`). `markup.js` runs in any browser the agent can evaluate JavaScript in.

```bash
npx skills@latest add noverdy/skills --skill packing-report-evidence
```

## Usage

```text
Make the screenshots for every step of this report and zip them.
Render this logcat as a terminal screenshot, box the token and blur it.
```

## Limitations

- `markup.js` matches text inside single text nodes; text split across elements needs a CSS selector instead.
- A box on a blurred value comes from the blur entry's `box` option, not a separate box entry.
- Terminal renders run Chrome with `--no-sandbox` by default; set `CHROME_NO_SANDBOX=0` to keep the sandbox.
