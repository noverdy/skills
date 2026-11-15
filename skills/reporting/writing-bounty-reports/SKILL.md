---
name: writing-bounty-reports
description: Writes, tightens and revises bug bounty report bodies, titles and triager comments in the user's house style - a one-paragraph summary, numbered curl steps with screenshots, two-bullet impact and remediation. Use when drafting a report, tightening or rewriting one, titling a finding, answering a triager, rebutting an informative or not-applicable closure, or asking a program for an update.
---

# Writing bounty reports

The reader is a triager who sees dozens of reports a day and wants the bug in ten seconds. Every sentence states a fact the reproduction proves. A report is _tight_ when nothing can be deleted without losing a fact, a value or a step.

Write only findings that passed the `gating-bounty-findings` skill with verdict FILE. The report claims what the gate proved and nothing past the last proven link. Severity and the CVSS vector are the gate's, copied unchanged into the form; the body argues neither.

## Steps

1. **Collect the facts.** From the engagement notes, take the impact sentence, each proven step with its exact request and response, and the evidence images. Done when every step has its real request, its real response excerpt and an image, and every value (ids, paths, headers, counts, durations, response bodies) is copied from a capture. Where no capture exists, write `<paste from capture>` in its place and add it to a **missing captures** list; the hunter fills it, the draft never does.

2. **Draft** to the template below, saved as `report/<id>-body.md`. Done when every section is present and nothing else is.

3. **Cut.** Read each sentence against the house style and delete what fails. Done when the summary is at most 3 sentences and 70 words, each step opens with one instruction line, impact and remediation are two bullets of at most 20 words each, the `leads to` phrase in the title is at most 6 words, and no line describes what was not tested, not read or not proven.

4. **Tighten with a fresh writer.** Hand the draft to a subagent on the strongest writing model available at medium effort (the user's default is Opus 5.5 medium), with the brief in [Tightening brief](#tightening-brief). Done when it returns a version whose code blocks and placeholders a script confirms are byte-identical to the input.

5. **Show it rendered.** Send the body to the user as rendered Markdown, not inside a code block, with the title on top and the missing captures list underneath. Done when the user approves or asks for changes.

6. **Revise surgically.** Each round, change only what the user asked for and leave every other line byte-identical. Save each round as the next version (`-v2`, `-v3`) so earlier text can be recovered. Done when the user approves.

## Template

~~~markdown
## Summary

<At most 3 sentences, 70 words. Sentence 1: what the endpoint or feature does wrong. Sentence 2: what it should check and does not. Sentence 3: what an attacker gets, with the one number that makes it concrete (lifetime, count, scope).>

## Steps to reproduce

1. <Setup in one line, e.g. "Sign in as an ordinary account that already has a PIN set:">

{YWH-....}

2. <Instruction in one line:>

Request:

```bash
curl -s -X POST "https://host/path" \
  -H "Content-Type: application/json" \
  -d '{"field":"value"}'
```

Response:

```json
{"the":"part that proves it"}
```

Screenshot:

{YWH-....}

## Impact

- <What the attacker gets, at most 20 words.>
- <The consequence that makes it matter, at most 20 words.>

## Remediation

- <The fix at the broken check, at most 20 words.>
- <The structural fix, at most 20 words.>
~~~

A worked example of the voice is in [`reference/example-report.md`](reference/example-report.md). Read it before the first draft in a session.

## House style

**Title.** `<Bug type> on <host> through <endpoint> via <METHOD> parameter "<name>" leads to <impact>`. The first half is what YesWeHack's form generates from the bug type, endpoint and vulnerable part; keep it and append `leads to <impact>` in at most 6 plain words (`leads to Account Takeover`, `leads to cross-organisation invoice tampering`). Write the `via <METHOD> parameter "<name>"` part only for a query, body or header parameter; an id inside the URL path (`/orgs/{orgId}/...`) is already in the endpoint, so the title goes straight from the endpoint to `leads to`. Choose the bug type that names the mechanism, and use the title agreed with the user even if the platform rewrites it.

**Summary.** At most 3 sentences and 70 words. Lead with the bug, not the product. Name the endpoint or action in backticks in the first sentence. State what the attacker holds at the end. Leave inferences to the triager: if the chain proves A and B, state A and B.

**Steps.**
- Numbered. Each step opens with exactly one short sentence, the instruction, ending in a colon. Background facts (id formats, link lifetimes, why it matters) are left out unless the step cannot be followed without them; the summary and impact carry them, then `Request:`, a code block, `Response:`, a code block, `Screenshot:`, the placeholder.
- curl, short: the URL, the headers that matter and the body. Use `$TOKEN`-style variables for credentials. Fence with `bash`, responses with `json` (or `bash` for a bare status line like `204 No Content`).
- Show only the part of a response that proves the step.
- Step 1 is the setup state, shown as an app screenshot, so the triager sees the starting point.
- Each step proves one thing. Show the blocked state and the bypassed state as separate steps.
- Steps walk the attack path only: the setup, each request the attacker sends, and what the victim then sees. Add a control step (a no-token request, an invalid input) only when the user asks for one.
- Attachment placeholders are `{YWH-....}` until uploaded, then the real `{YWH-R1234567}` refs, mapped by file name.

**Impact and remediation.** Exactly two bullets each, one sentence of at most 20 words per bullet, no semicolons. Impact bullets start with the attacker or the data (`An attacker can skip the approval...`). Remediation names the function, filter or controller to change.

**Words.**
- ASCII hyphen `-` only. No en or em dashes.
- State what you have. Every sentence is a positive claim about the target backed by a step.
- Plain verbs over labels: if a term needs explaining in the chat ("privesc", "gate", "scope token"), say what happens instead.
- No Notes, Controls, Background, Methodology or Timeline sections. The engagement notes keep the audit trail; the report carries the path.
- No internal finding ids, engagement names or tool names anywhere in the body or captions.

**Personal data.** When the finding exposes personal data, describe it by counts and field types only, and follow any programme rule restricting how personal data may be handled or shown.

## Comments to the programme

Same voice, shorter. Open with `Hi,` and close with `Regards`.

- **Asking for an update:** two sentences. Note the time since filing and ask whether anything is needed from you.
- **Rebutting a closure:** first own any mistake in the report plainly in one sentence ("My steps 4 and 5 were wrong"). Then re-test today and show it as a side-by-side: Account A (the expected, refused case) and Account B (the bypass), each as a short heading, one line, and a screenshot. Screenshots only, no code blocks. End with one paragraph on why the behaviour is not by design, citing what the product's own front end or docs do. Under 250 words.
- **Answering a question:** answer it in the first sentence, then the evidence.

## Tightening brief

Give the subagent the file path, the output path (`-vN+1`), and this:

> This is a real bug bounty report a human will submit. Tighten the prose and make it read like a person wrote it. Keep the section structure. Every code block, attachment placeholder, endpoint, header, id, number and quoted string must survive byte for byte; confirm that with a script before returning. Add no facts. Summary is at most 3 sentences and 70 words; impact and remediation are two bullets of at most 20 words each; ASCII hyphens only; keep every `<paste from capture>` placeholder as it is. Write the result to the output path and print it in full with the word count before and after.

Add the user's latest feedback verbatim when the round was triggered by it.
