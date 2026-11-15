<div align="center">

# writing-bounty-reports

*Short, triager-friendly report bodies in one consistent voice*

[What it can do](#what-the-agent-can-do) • [Installation](#installation) • [Usage](#usage) • [Limitations](#limitations)

</div>

An agent skill that drafts and revises bug bounty reports in a fixed house style: a one-paragraph summary, numbered steps with short curl requests, responses and screenshots, and two one-sentence bullets each for impact and remediation. It also covers titles, update requests and rebuttals to an informative or not-applicable closure.

## What the agent can do

With this skill loaded, an agent can:

- draft a report from the proven steps of a finding, in a fixed template
- title it `<Bug type> on <host> through <endpoint> ... leads to <impact>`
- cut every line that is not a proven fact, then hand the draft to a fresh writer subagent and check that code blocks and attachment placeholders survived byte for byte
- revise only what was asked, keeping each round as a new version file
- write short comments to the programme: an update request, an answer, or a two-account rebuttal

## Installation

Pure Markdown. Pairs with [gating-bounty-findings](gating-bounty-findings.md) (run first) and [packing-report-evidence](packing-report-evidence.md) (for the images).

```bash
npx skills@latest add noverdy/skills --skill writing-bounty-reports
```

## Usage

```text
Draft the report for this finding and send it here.
Tighter. Impact two bullets, one sentence each.
They closed it as informative, write a rebuttal.
```

## Limitations

- The style is one hunter's. Edit the House style section and the example report to change it.
- Some programmes forbid AI-written reports or AI handling of personal data. The skill follows programme rules it is shown, but it cannot see rules you have not given it.
