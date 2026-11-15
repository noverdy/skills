<div align="center">

# gating-bounty-findings

*Decide whether a finding is worth a report before anyone writes one*

[What it can do](#what-the-agent-can-do) • [Installation](#installation) • [Usage](#usage) • [Limitations](#limitations)

</div>

An agent skill that runs a candidate finding through one gate and returns FILE, PARK or KILL. It asks for a one-sentence impact an attacker actually achieves, walks the chain link by link to the last proven step, runs controls (a deliberately broken request, a read-back after every write, a verbatim re-run of the report's steps), diffs exposed-service claims against the vendor's own deployment guide, and maps the bug to the programme's qualifying and non-qualifying lists and reward grid.

## What the agent can do

With this skill loaded, an agent can:

- refuse to put a severity on a chain whose last link was never proven
- catch "best practice" and vendor-required configuration dressed up as a vulnerability
- quote the programme line a finding qualifies under, and the exclusion that might catch it
- price a finding from the reward grid against the credit it costs, and check hacktivity for duplicates
- record a KILL with its evidence so the lead is not re-run

## Installation

Pure Markdown; programme data comes from the [using-yeswehack](../accounts/using-yeswehack.md) skill. Install just this skill:

```bash
npx skills@latest add noverdy/skills --skill gating-bounty-findings
```

## Usage

```text
Is this IDOR worth filing? How much would it pay?
```

The agent answers with a verdict table: impact sentence, last proven and first unproven link, controls, qualifying line, CVSS as proven, payout, credit cost, duplicate risk and the next action.

## Limitations

- Programme checks assume YesWeHack's brief format. Other platforms need the qualifying lists pasted in.
- The gate judges evidence the agent has. It cannot prove a link the agent was not allowed to test.
