---
name: packing-report-evidence
description: Builds the full image set for a bug bounty report, one image per reproduction step - app screenshots with boxes and blurred secrets, request/response snapshots, and terminal or logcat captures - then checks, names and zips them. Use when a report needs screenshots or evidence for its steps, when marking up or blurring a browser screenshot, when rendering terminal or adb logcat output as an image, or when assembling an evidence zip.
---

# Packing report evidence

A **pack** is the set of images a report's steps point at, one folder per step, in step order. Each image shows the real state or exchange that step claims; markup (boxes, blur, hiding noise) is the only change. When a step needs a different picture, reproduce the step again and capture that.

## House style

Every image in the pack follows these defaults unless the user asks otherwise:

- **Box, line, short label.** Box each piece of evidence and join it with a line to a label of a few words (`204 - PIN changed`, `Only credential sent: the session token`), the way the snapshot tool's `note` draws it. No title bar, no caption and no footer text; the report carries the explanation.
- **Blur, keep the tail.** Secrets (tokens, cookies, passwords, API keys, personal data the finding does not rely on) are blurred, never shown as a bar. Values of 12+ characters keep their last 4 characters visible, in green, so the reader can match them across images. Values the finding relies on stay readable.
- **Outside eyes only.** Pixels and file names carry nothing that exists only in our notes: no finding ids, engagement names, test-account nicknames or tool names. The triager sees the target's own UI and data.
- **Cropped to the evidence.** No blank margins, browser chrome or unrelated panels. Dark theme for terminal output.
- **The step's own register.** A UI step ("sign in", "the content is blocked") gets an app screenshot. An API step gets a request/response snapshot. Device or CLI output gets a terminal render.

## Steps

1. **Map the steps.** Read the report draft's numbered steps and write a table: step number, what it proves, image kind (app, snapshot, terminal), folder `NN-<slug>/`. Done when every step that has a `{YWH-....}` placeholder has exactly one row, and every row's kind matches the register rule above.

2. **Capture each row.** Done when each folder holds its PNG plus the sources that produced it.
   - **Snapshot:** use the `snapshotting-http-requests` skill. In its spec set no `title` or `caption`, give every mark a `note` of a few words, and keep `redactStyle: "blur"`.
   - **App screenshot:** bring the real page to the state the step describes, in a mobile viewport when the product is mobile-first. Evaluate [`scripts/markup.js`](scripts/markup.js) in the page with the browser tool's eval command, then call `evidenceMark(spec)` (spec below), then take an element or clipped screenshot of the region that proves the step. `evidenceMark` returns `{boxed, blurred, hidden, missing}`; done when `missing` is empty.
   - **Terminal or logcat:** save the real output to a text file, write a spec next to it and run `node scripts/terminal.mjs spec.json [out.png]` (Node 18+, uses the local Chrome or Chromium; `--help` lists the fields). It exits 1 and names any selector that matched nothing.

3. **Look at every PNG** with your image reader. Done when, for each one: every box sits on its evidence, nothing secret is readable, no id or name from our notes is visible anywhere, the crop holds only what the step needs, and the image proves what its step says without the report text beside it.

4. **Pack.** Write `MANIFEST.md` in the pack folder: step number, file, one line on what it shows. Remove images in the pack folder that are no longer in the manifest. Zip the folder as `<report>-evidence.zip`. Done when the zip's file list equals the manifest.

5. **Hand over.** Show the user each PNG inline, in step order, labelled by step number only. Upload and placeholder replacement happen when the report is filed.

## `evidenceMark` spec

Used by `markup.js` in the page and by `terminal.mjs`'s `box` and `blur` fields.

```json
{
  "hide": [".cookie-banner", "#chat-widget"],
  "blur": [{ "match": "access_token=([^&]+)", "keep": 4, "box": true },
           { "selector": ".account-email" }],
  "box":  [{ "match": "Status: in progress" }, { "selector": "button.pin-dialog", "color": "red" }]
}
```

- `match` is a regular expression applied inside single text nodes; when it has a capture group, only group 1 is marked. `selector` is CSS and marks the whole element.
- Order is hide, then blur, then box. To box a secret, set `"box": true` (or a colour) on its blur entry, since the box pass can no longer see the blurred text.
- The original secret is removed from the page, never just covered, so a later screenshot or DOM dump cannot leak it.
- Colours: `red` (default), `green`, `amber`, `blue` or any CSS colour.
