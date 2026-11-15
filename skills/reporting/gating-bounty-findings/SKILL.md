---
name: gating-bounty-findings
description: Decides whether a bug bounty finding is worth filing before any severity, payout or draft exists, by checking the chain reaches a real impact, fits the programme's qualifying list and pays more than the credit costs. Use before assigning a severity or CVSS, before drafting or filing a report, when asked whether a finding is real, valid, in scope or worth submitting, or how much it would pay.
---

# Gating bounty findings

The gate turns a candidate finding into one verdict: **FILE**, **PARK** or **KILL**. Run it before anyone writes a severity, a payout or a report. A finding that has not passed the gate carries no severity, only "candidate".

The bar is _impact_: a concrete thing an attacker now holds or does. Data read, action performed, account reached, money moved. A hardening gap, a best-practice deviation or a vendor's documented default is not impact, however well it is argued. A sharper argument for the same gap is still the same gap, so when the impact sentence dies, the finding dies with it.

## Steps

1. **Write the impact sentence.** One sentence, present tense, with the attacker as the subject and a concrete capability as the verb: _"Any signed-in user reads another tenant's invoices by changing `orgId`."_ Done when the sentence names who the attacker is, what they start with (anonymous, free account, victim's click) and what they end up holding. If it only holds together with _could_, _would_, _if_, _may allow_, _is the input to_ or a quote of vendor guidance, the verdict is KILL or PARK; go to step 6.

2. **Walk the chain.** List every link from the attacker's starting position to the impact in the sentence, and mark each one _proven_ (with the evidence file or request that shows it) or _unproven_. Done when every link is marked and you can name the **last proven link** and the **first unproven** one. Severity can never exceed the last proven link.
   - An unproven link that is in scope gets reproduced now. Ordinary use of the product in a browser is usually the cheapest way to close it.
   - An unproven link that is out of scope stays unproven. "Stopped for scope" and "proven" are different states; write down which one applies.
   - A third party in the path (CDN, video host, payment provider) that enforces its own check is part of the chain. The chain ends where the attacker gets the asset, not where the first server says yes.

3. **Run the controls.** Done when each proven link has a control that would have come out differently if the link were false:
   - **Broken request:** send a deliberately-malformed or unauthorised version of the key request. If it returns the same thing as the real one, the real one proved nothing.
   - **Read-back for writes:** re-read the object as its owner after every write. A `200` with a success-shaped body is not a write; GraphQL returns `200` with an `errors` array, so select `errors` in every mutation.
   - **Positive control for negatives:** before retracting anything on a negative result, flip one bit of your own probe and get the opposite answer.
   - **Verbatim re-run:** replay the steps exactly as they will appear in the report, bodies included. A step trimmed for length and never re-run is how a report reproduces wrong.

4. **Diff against the vendor.** When the finding is an exposed service, a permissive setting or a missing auth layer on a product someone else ships, read that vendor's deployment guide for the exact product. Done when every pillar of the claim is either absent from the vendor's required configuration or dropped. What survives the diff is the finding.

5. **Fit the programme.** Read the programme's brief (with the `using-yeswehack` skill: `program <slug>`, `scope <slug>`, and `get /programs/<slug>/hacktivity` for what is already filed). Done when you can quote:
   - the asset the bug sits on and its asset value;
   - the `qualifying_vulnerability` line it falls under, quoted;
   - every `non_qualifying_vulnerability` line that could catch it, quoted, with why it does not (watch for _"without exploitable PoC"_, _"without direct security impact"_, _"unexploitable header-based issue"_, _"lack of rate-limiting"_, self-XSS, best practices);
   - prior hacktivity entries of the same bug class on the same asset, and the programme's first-reporter and reporting-deadline rules;
   - any rule that limits what you may do or show (no mass extraction, no AI handling of personal data, no reading other users' records).

6. **Price it.** Done when the verdict table below is filled.
   - CVSS 3.1 vector **as proven**, not as argued. Note the vector the programme would argue down to, and how.
   - Payout from the programme's reward grid for that asset value and severity. Many grids pay nothing for Low; say so.
   - Submission cost and the current credit balance (`whoami`).
   - Duplicate risk from step 5's hacktivity.

## Verdict

Hand back this table and nothing longer:

| | |
|---|---|
| **Verdict** | FILE / PARK / KILL |
| **Impact sentence** | step 1, or "none" |
| **Last proven → first unproven** | step 2 |
| **Controls** | each control and its result |
| **Qualifies under** | quoted line, or the non-qualifying line that catches it |
| **CVSS as proven** | vector and score |
| **Payout** | grid amount for that severity, and for one severity lower |
| **Cost** | credits it spends / credits left |
| **Duplicate risk** | low / high, with the hacktivity entries |
| **Next** | FILE: write the report. PARK: the one thing that would unblock it. KILL: the reason, for the killed-leads record. |

- **FILE** when every link to the impact sentence is proven, the controls hold, a qualifying line fits and no non-qualifying line catches it, and the expected payout is worth the credit.
- **PARK** when the impact is real but a link is unproven for a reason that can clear (a second account, a session the user must capture, an out-of-scope hop the programme might allow). Name the unblocker.
- **KILL** when there is no impact sentence, a control failed, the vendor requires the configuration, or the programme excludes the class. Record it with its evidence so nobody runs it again.

Recommending against filing is a complete and often correct answer. Write the verdict back into the engagement's findings notes so the next session reads it, not this conversation.
