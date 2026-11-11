# OSB usage statistics and reports

OSB can send two kinds of data to the OSB team at `https://api.osb.lol/v1`. It is the only host OSB sends data to, apart from the game's own origin and the GitHub update checks already listed in the README.

1. **Usage statistics**, only after the player turns on **Settings → Privacy → Share usage statistics**. Off by default. They are linked to a random install ID, which is pseudonymous personal data, so OSB never calls them anonymous. Only a report sent without usage statistics is called anonymous, because it is not linked to an install.
2. **A report** (bug or feature request), only when the player presses **Send** in the report window and then confirms.

Nothing else is sent about the player. One request is made without consent, and a second only when the player turns on a switch; neither carries data about the player. The first is the update check to GitHub (`lean-update.js`): `api.github.com/repos/corevider/osb`, `raw.githubusercontent.com/corevider/osb` (the release metadata and the patch-notes headline), about every 15 minutes. It carries no data about the player or the game, is on by default, and is switched off with **Settings → Privacy → Check GitHub for OSB updates** (stored under `sroBotLean:v1:updateCheck`); when it is off, `lean-update.js` makes no request at all. With no recorded consent, a declined one or a withdrawn one, OSB makes no request to `api.osb.lol` at all: no registration, no ping, no statistics, no configuration read. The server side is described in `PLATFORM.md` of the osb-platform repository (sections 6, 7 and 10); this page describes what the bot does.

The second is the game site's unique tracker (`lean-unique-tracker.js`): `GET /uniques` on the game's own origin (opensro.online), made only after the player turns on **Use the game site's unique tracker** (**off by default**; the switch is in Combat → Unique hunt and at the top of the Setup page's Uniques list, one setting) and then only while either the unique hunt runs or the Setup page is shown in a visible, not minimised panel. It is read when one of these begins (unless it was read less than 2 minutes before) and then at most every 2 minutes, with a backoff of 4, 8, 16 and at most 30 minutes after a failure. **Refresh** in the Setup page's Uniques list asks again, but never within 30 s of the last request. The request uses `credentials: 'omit'`, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, no query string and no body, and is aborted after 15 s; it is started from a zero-delay timer, never inside `Controller.tick`. The page is parsed with `DOMParser`, never inserted into the page, and only each row's state, monster number, level and map name are read, never the last killer. With the switch off (the default), or while neither the unique hunt runs nor the Setup page is shown, `lean-unique-tracker.js` makes no request at all.

## Consent states and network behaviour

| State | How it comes about | Network behaviour |
|-------|--------------------|-------------------|
| No consent recorded | A fresh install, or an upgrade; the default | No request to `api.osb.lol`. No usage timer is armed. (The GitHub update check runs unless it was switched off.) No install ID or key exists. |
| Declined | The player never turned the toggle on, or a stored record has usage version 0 or a damaged identity | The same as no consent. A stored identity without a valid consent is ignored. |
| Given | The player ticked **Share usage statistics**. The record keeps the consent version (`usage`: 1), the id of the consent text (`usageText`: `2026-11-04.1`, from `CONSENT.md` in osb-platform) and the time | After a start delay of 60 to 180 s: read the configuration, register the install once, then one status report about every 10 minutes. See "Requests". |
| Given, characters | The player also ticked **Show my characters in the OSB dashboard** (needs "Given") | As "Given", and the status report carries the character name. Turning it off tells the server at once and is retried until the server has it. |
| Withdrawn | The player unticked the toggle and answered "Yes, stop and delete", or pressed **Delete my data** and confirmed | The timer is cancelled, the install ID and key and the slot and session caches are wiped at once, a status report still in flight is ignored, then one `DELETE /installs/me` is sent (best effort). No further request. |
| Consent text newer than the stored consent | The consent version in the code is higher than the stored one | Counts as "No consent" until the player accepts again. |
| Inside OSB Manager | `window.chrome?.webview` exists | OSB sends no usage statistics at all (the Manager reports its accounts) and shows "Usage statistics are handled by OSB Manager." A report still goes directly, and only on Send. |
| A report | The player pressed **Send** and then **Yes, send** | Reads the configuration if it is not cached, then one `POST /reports`. Up to 3 attempts in this page session. Anonymous unless usage consent is given and the install is registered. |

The consent is stored in `localStorage` under `sroBotLean:v1:telemetry` (record: consent version, consent text id, time, character consent and time, install ID, install key, registration flags, cached configuration, last sent time and result). A change event or a click made by a script is ignored: only a real user action gives or withdraws consent, presses Send, or deletes.

## Requests

Every request uses `fetch` with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, `cache: 'no-store'` and an `AbortController` that aborts it after 15 s. Only one request is in flight at a time. No request runs inside `Controller.tick`, in the 100 ms Ticker or in a game message handler: a `setTimeout` chain wakes the module, the payload is copied in `requestIdleCallback` (5 s timeout, or a zero-delay timer when the browser has none), and the slot is computed with the asynchronous `crypto.subtle`.

| When | Request |
|------|---------|
| Once per cycle, at most every 6 h | `GET /config?app=osb&version=<version>` |
| Once, after consent | `POST /installs` (install ID, install key, app, version, OS, language, consent) |
| When the character consent changes | `PUT /installs/me/consent` |
| About every 10 minutes | `POST /telemetry` |
| Withdrawal or Delete my data | `DELETE /installs/me` |
| Download my data | `GET /installs/me/export` |
| Send | `POST /reports` (multipart: `report` JSON, optional `screenshot`) |

The wait between cycles is `max(300 s, config interval, next_after_s)` with a random factor of 0.9 to 1.1. An idle account that has not changed is resent at most once an hour. A failed request is retried with full-jitter backoff (base 60 s, cap 6 h, never less than 60 s); `Retry-After` replaces the backoff, clamped to 60 s to 24 h.

| Server answer | What OSB does |
|---------------|---------------|
| 400, 404, 413, 415 | Drops the item. The next status report is a fresh snapshot. A 400 on registration stops statistics until the next page load. |
| 401 | Registers once more with the same ID and key. A second 401 stops statistics until the next page load. |
| 403 | Pauses the feature for 24 h. |
| 409 on registration | New install ID and key, then registers again after at least 60 s. |
| 429 | Waits `Retry-After`. |
| 503 `disabled` | Stops the feature until the next configuration read (at least an hour later). No message is shown. |
| 503 `unavailable`, other 5xx, timeout, network error, redirect | Backs off. The only trace is the "Last sent" line in Settings. |

Configuration: a missing or malformed answer counts as "disabled"; a failed read keeps the last good configuration for 24 h. `client_ok: false` stops all sending. The configuration cannot make OSB collect more, change the URL or lower the interval below 300 s. Its `message` (200 characters at most) is shown as plain text.

A bug in the module is caught. After three unexpected errors the usage statistics stop for the page with one log line, and the bot is not affected.

## The usage status report

One account per page: the current character. Fields: `slot`, `state`, `level`, `gold`, `hp_pct`, `mp_pct`, `scrolls` (`return`, `reverse`), `bot_version`, `session` (`key`, `ms`, `kills`, `deaths`, `xp`, `gold`, `sox`) and, only with the character consent, `character.name`. Every field except `slot` and `state` is left out when unknown. OSB does not know the game server's name, so `character.server` is never sent. A negative net session gold is left out, not sent.

- **slot**: the first 16 hex characters of `HMAC-SHA256(key = the 32 install key bytes, message = "slot:" + character name)`. The name is the current profile's name (`default` before a character is known).
- **session.key**: 8 random bytes as hex, new when the bot session starts or its duration or kill counter goes down. The session is sent while the bot runs, and once more after it stops so the final totals arrive.
- **Show what is sent** in Settings shows the next body, built the same way and never sent.

Never sent: login ID, password, account display name, region or position, party members, chat, item names or IDs, drop texts, file paths, machine name, hardware IDs, MAC addresses, other installed software.

### The `state` values

| `state` | OSB condition |
|---------|---------------|
| `login` | Game phase `signed-out`, `listing-servers`, `loading-roster` or `authenticating` |
| `loading` | Phase `connecting`, `entering-world` or `reconnecting`, or phase `world` before the character data has arrived |
| `offline` | Phase `disconnected` |
| `dead` | In the world and the character is dead |
| `town` | In the world, alive, and a town trip (`Town.trip`) or a walking restock (`Restock.trip`) is running |
| `hunting` | In the world, alive, no town trip, and the bot is hunting (`Hunt.running`) |
| `stopped` | In the world, alive, not hunting, and the player last pressed Stop for this character |
| `idle` | In the world, alive, not hunting, and the player did not stop it |
| `unknown` | Any other game phase |

## Reports

**Settings → Send bug report** opens the report window. It has a kind (bug report or feature request), a description (1000 characters at most), an optional screenshot, a preview, **Send**, **Copy report**, **Save report file** and **Close**.

- The preview is the exact text that is sent as the `report` part of the request, byte for byte. Copy and Save use the same text.
- A bug report carries the diagnostics OSB already builds (`Diagnostics.report()`): fixed wording, error categories, counts, no names, chat or locations. A feature request carries none. The diagnostics are trimmed to the server's shape rules (600 keys, 32 KB, depth 5, 50 array items, 300-character strings); the oldest recent states are dropped first, and the preview shows the trimmed result.
- **Send** only asks. The text "Send this report to the OSB team at api.osb.lol?" and **Yes, send** / **Cancel** appear, and nothing leaves the computer until the player presses **Yes, send**.
- **Add screenshot** asks the browser for one frame of a tab (`getDisplayMedia`, the browser's own prompt every time), at most 1280 px, JPEG, 768 KB. It is shown as a thumbnail with **Remove screenshot**, kept in memory only, and dropped when the report is sent or the window is closed. It is sent only when the server takes screenshots.
- Without usage consent the report is anonymous (no install key). With it on and the install registered, the report is linked to the install ID.
- Failure: up to 3 attempts in this page session (now, after about 60 s, after about 300 s), each limited to 15 s. Nothing is saved to disk. Closing the window cancels the retries. The final message is "Not sent. Copy or save the report and try later." A success shows "Sent. Your report code is R-XXXXXXXX."

## Testing

`lean.telemetry.test.cjs` (run by `node lean.test.cjs`) drives the generated bot in a `vm` context with a virtual clock and a fake network, never the real API. It holds the client cases C1 to C17 of `PLATFORM.md` 7.7, the golden payloads of its Appendix C, and the consent tests: with no consent, a declined or a withdrawn one, a normal lifecycle (start, status ticks, town trips, errors, the report window) makes zero requests.

`lean.browser.test.cjs` records the game tick (the Ticker's callback) with consent off and with consent on against a server that never answers the status report. `OSB_TICK_PROOF_MS=600000` makes each run 10 minutes. The test's copy of the script exposes the internals (`Telemetry.base`, the timing table); the release script has no such hook.

## Privacy contact

`privacy@osb.lol`. The privacy policy is at `https://osb.lol/en/privacy/`. The consent texts are `docs/legal/CONSENT.md` (version `2026-11-04.1`) in the osb-platform repository; OSB uses their English wording exactly. A change to those texts needs a new text id and a new consent version in `lean-telemetry.js`, so that players are asked again.
