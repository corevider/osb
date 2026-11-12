# OSB usage statistics, error reports and reports

OSB can send two kinds of data to the OSB team at `https://api.osb.lol/v1`. It is the only host OSB sends data to, apart from the game's own origin and the GitHub update checks already listed in the README.

1. **Usage statistics, error reports and performance data**, only after the player turns on **Settings → Privacy → Share usage statistics, error reports and performance data**. Off by default. It is one switch (operator decision of 2026-11-12): there is no separate switch for error reports. The data is linked to a random install ID, which is pseudonymous personal data, so OSB never calls it anonymous. Only a report sent without sharing is called anonymous, because it is not linked to an install. Performance data is the perf entry of the error-report batch (see "Performance entries").
2. **A report** (bug or feature request), only when the player presses **Send** in the report window and then confirms.

Nothing else is sent about the player. One request is made without consent, and a second only when the player turns on a switch; neither carries data about the player. The first is the update check to GitHub (`lean-update.js`): `api.github.com/repos/corevider/osb`, `raw.githubusercontent.com/corevider/osb` (the release metadata and the patch-notes headline), about every 15 minutes. It carries no data about the player or the game, is on by default, and is switched off with **Settings → Privacy → Check GitHub for OSB updates** (stored under `sroBotLean:v1:updateCheck`); when it is off, `lean-update.js` makes no request at all. With no recorded consent, a declined one or a withdrawn one, OSB makes no request to `api.osb.lol` at all: no registration, no ping, no statistics, no configuration read. The server side is described in `PLATFORM.md` of the osb-platform repository (sections 6, 7 and 10); this page describes what the bot does.

The second is the game site's unique tracker (`lean-unique-tracker.js`): `GET /uniques` on the game's own origin (opensro.online), made only after the player turns on **Use the game site's unique tracker** (**off by default**; the switch is in Combat → Unique hunt and at the top of the Setup page's Uniques list, one setting) and then only while either the unique hunt runs or the Setup page is shown in a visible, not minimised panel. It is read when one of these begins (unless it was read less than 2 minutes before) and then at most every 2 minutes, with a backoff of 4, 8, 16 and at most 30 minutes after a failure. **Refresh** in the Setup page's Uniques list asks again, but never within 30 s of the last request. The request uses `credentials: 'omit'`, `cache: 'no-store'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, no query string and no body, and is aborted after 15 s; it is started from a zero-delay timer, never inside `Controller.tick`. The page is parsed with `DOMParser`, never inserted into the page, and only each row's state, monster number, level and map name are read, never the last killer. With the switch off (the default), or while neither the unique hunt runs nor the Setup page is shown, `lean-unique-tracker.js` makes no request at all.

## Consent states and network behaviour

| State | How it comes about | Network behaviour |
|-------|--------------------|-------------------|
| No consent recorded | A fresh install, or an upgrade; the default | No request to `api.osb.lol`. No usage timer is armed. (The GitHub update check runs unless it was switched off.) No install ID or key exists. |
| Declined | The player never turned the toggle on, or a stored record has usage version 0 or a damaged identity | The same as no consent. A stored identity without a valid consent is ignored. |
| Given | The player ticked **Share usage statistics, error reports and performance data**. The record keeps the consent version (`usage`: 2), the id of the consent text (`usageText`: `2026-11-12.1`, from `CONSENT.md` in osb-platform) and the time | After a start delay of 60 to 180 s: read the configuration, register the install once, then one status report about every 10 minutes, and error reports when the server allows them (see "Error reports"). See "Requests". |
| Given, characters | The player also ticked **Show my characters in the OSB dashboard** (needs "Given") | As "Given", and the status report carries the character name. Turning it off tells the server at once and is retried until the server has it. |
| Withdrawn | The player unticked the toggle and answered "Yes, stop and delete", or pressed **Delete my data** and confirmed | The timer is cancelled, the install ID and key, the slot and session caches and every error-report buffer (inbox, pending events, trail state, private terms) are wiped at once, a request still in flight is aborted, then one `DELETE /installs/me` is sent (best effort). No further request. |
| Outdated (consent version 1) | A record from OSB 2.0.13 or older: `usage` 1, text `2026-11-04.1` | Off: no request at all, the character sub-switch is off too, and a report is not linked to the install. The switch shows a **Changed** mark and the line "The text of this switch changed: it now also covers error reports and performance data. Switch it on again if you want to share." until Settings has been opened once (`changedSeen`; the mark stays for the rest of that page). There is no prompt. Ticking the switch again keeps the stored install ID and key and sends one `PUT /installs/me/consent` with `usage_version` 2 and `characters` false instead of a new registration (a 401 or 404 registers the same ID again). **Delete my data** still deletes that install. |
| Consent text newer than the stored consent | The consent version in the code is higher than the stored one | Counts as "No consent" until the player accepts again. |
| Inside OSB Manager | `window.chrome?.webview` exists | OSB makes no request for usage statistics or error reports (the Manager reports its accounts). It records error reports only while the Manager tells it `osb-diagnostics` `on: true`, and hands them to the Manager as page messages (see Error reports, "Inside OSB Manager"). It shows "Usage statistics, error reports and performance data are handled by OSB Manager. OSB sends none itself." A report still goes directly, and only on Send. |
| A report | The player pressed **Send** and then **Yes, send** | Reads the configuration if it is not cached, then one `POST /reports`. Up to 3 attempts in this page session. Anonymous unless usage consent is given and the install is registered. |

The consent is stored in `localStorage` under `sroBotLean:v1:telemetry` (record: consent version, consent text id, time, character consent and time, install ID, install key, registration flags, the consent version and character flag the server last confirmed (`syncedUsage`, `synced`), whether the Changed mark was seen, cached configuration, last sent time and result). Error reports are never stored: they live in memory only and are lost on reload. A change event or a click made by a script is ignored: only a real user action gives or withdraws consent, presses Send, or deletes.

## Requests

Every request uses `fetch` with `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, `redirect: 'error'`, `cache: 'no-store'` and an `AbortController` that aborts it after 15 s. Only one request is in flight at a time. No request runs inside `Controller.tick`, in the 100 ms Ticker or in a game message handler: a `setTimeout` chain wakes the module, the payload is copied in `requestIdleCallback` (5 s timeout, or a zero-delay timer when the browser has none), and the slot is computed with the asynchronous `crypto.subtle`.

| When | Request |
|------|---------|
| Once per cycle, at most every 6 h | `GET /config?app=osb&version=<version>` |
| Once, after consent | `POST /installs` (install ID, install key, app, version, OS, language, consent) |
| When the character consent changes | `PUT /installs/me/consent` |
| About every 10 minutes | `POST /telemetry` |
| At most every `diagnostics.interval_s` (600 s or more), only when an error report is waiting | `POST /diagnostics` |
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

Configuration: a missing or malformed answer counts as "disabled"; a failed read keeps the last good configuration for 24 h. `client_ok: false` stops all sending. The configuration cannot make OSB collect more, change the URL or lower the interval below 300 s. Its `message` (200 characters at most) is shown as plain text. The `diagnostics` block (`enabled`, `perf`, `interval_s`, `perf_interval_s`, `sample_pct`) is clamped: `interval_s` to 600–86400, `perf_interval_s` to 1800–86400, `sample_pct` to 0–100; a missing or malformed block means error reports are off.

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

## Error reports

Error reports are the second job of the same module (`lean-diagnostics-upload.js`, object `Diag`, and `Telemetry.diagStep` in `lean-telemetry.js`). They follow DIAGNOSTICS.md in osb-platform (sections 1.3, 1.4, 3.3, 3.4 and 5.1, with the operator decisions of 2026-11-12).

**When anything is recorded.** Only while all of these hold (inside OSB Manager the Manager decides, see below): consent version 2 is given, OSB is not inside OSB Manager, the browser has `crypto.subtle`, the cached configuration has `diagnostics.enabled` true, and this page's random draw (0–99, made once) is below `sample_pct`. Otherwise nothing is recorded and every buffer is wiped. Turning the switch on starts with empty buffers.

**What is captured.** The capture step runs where the error happens, also inside `Controller.tick`, and only copies strings and a few fixed values into a bounded inbox (32 entries; identical consecutive entries only raise a repeat count; beyond that only `dropped.rate_limited` grows). It never does network, JSON or hashing. Capture points:

- errors caught by `Controller.guard` (module = the guard's name, origin `guard`), the outer catch of `Controller.tick` (`controller`, `tick`), the simulation message handler (`simulation`, `data`), the panel refreshers (`panel`, `panel`), the pet attack tick (`pet-attack`) and the wardrobe's `wdSafe` (`wardrobe`);
- uncaught errors (`window` `error`) and unhandled rejections, kept only when the first stack frame is in our script;
- every `Log.warn` and `Log.error` line and every warning or error activity entry, as a `warn` event: its code when it has a structured one, else `legacy` with the error class of `Diagnostics.errorCode`; game refusals keep `{ source, reason, native }`. A guard's own `Log.error` is not counted a second time;
- the bot's own stops (`Diagnostics.noteStop`, fed by `Retry.note` and `Town.fail`, and `stopAll`), mapped to a fixed code by `StopCodes`. The player's own stop and the mode switches "walking back" and "visiting a quest NPC" are not sent;
- the context at the error: game phase, bot mode, town phase, dead flag and page uptime, as enums.

**Processing** runs from `requestIdleCallback` (or a zero-delay timer): the scrubber, the fingerprint (`crypto.subtle.digest`, asynchronous), deduplication and the trail.

**Scrubber.** No free text leaves the page: only enums, numbers, versions, fixed codes, our own frames and normalised message templates.

- Error type: `e.name` when it is a plain identifier, else `Error`.
- Message template: only for engine errors (`TypeError`, `RangeError`, `ReferenceError`, `SyntaxError`, `URIError`, `EvalError`, `AggregateError`, `DOMException`). Errors made by our own code send no template. The message is cut to 300 characters; quoted parts become `<q>`, URLs `<url>`, paths (`C:\…`, `\\…`, `/a/b…`) `<path>`, e-mail-like words `<x>`, runs of two or more digits and hex numbers `<n>`, known private words `<x>`; every other character outside `A-Za-z0-9 .,:;()<>'_/-` is dropped; the result is cut to 160.
- Frames: only frames of `osb.user.js` (the script's own URL as seen at start, or the Tampermonkey `userscript.html?name=OSB.user.js` and the `OSB.user.js` forms) as `function@line:column`; the URL, which holds the script manager's script ID, is never kept; a run of foreign frames is one `ext`; at most 16.
- Private terms: an in-memory set (at most 2000) of the character name, the profile name, every player seen nearby, party and guild members, names in party matching and resurrection questions, and chat senders. Any template, frame or code that contains one (3 characters or more, any case) becomes `<x>` or drops the field; an event whose JSON still contains one is dropped. The set is never sent, stored or logged.
- Trail: the last 20 log entries of the 10 minutes before the error, attached to the first occurrence of a fingerprint in the page: `{ s, l, c, k, o, n, d, e }`, where `k` is the entry's code or `legacy` with `e` its error class, and `d` keeps only the allowlisted numbers and flags. Text, user text, names, ids and `goldChange` and `monsterId` are never copied.

**Fingerprint:** the first 16 hex of SHA-256 over `osb|js_error|type|module|first five of our frames without positions|template`; for stops `osb|bot_stop|code|source`; for warnings `osb|warn|category|code|error class|refusal`.

**Limits:** one pending event per fingerprint (repeats raise `count`, at most 100000); at most 30 new events an hour and 200 a day, beyond that `dropped.rate_limited`; the same fingerprint at most once an hour on the wire; at most 50 events a batch; an event over 4 KB loses its trail or is dropped; a batch over 60 KB loses trails (newest events first), then whole events (oldest first, `dropped.oversize`), then perf entries. Empty batches are never sent.

**Wire rules** (the server parser of DIAGNOSTICS.md 3.3.1): no `null` anywhere (an optional field is left out), numbers with at most one decimal (trail numbers are rounded to one decimal), no control or surrogate characters, never the reserved fingerprint `0000000000000000`, `uptime_s` in whole minutes, and a refusal only together with its numeric `native` code. An event or perf entry that breaks a rule is dropped before the batch is built, so one bad entry never costs the whole batch a 400. `lean.diagnostics.test.cjs` carries an independent copy of these rules; its fake server answers 400 to any batch that breaks one.

**Performance entries** (`lean-perf.js`, object `Perf`). Only while recording is on and the configuration has `diagnostics.perf` true (inside OSB Manager: only while the Manager asks this window, below); with either off nothing is timed or kept, and the observer and the sampler are stopped. The `Ticker` callback is `Perf.step()`: two `performance.now()` calls and increments of fixed `Uint32Array(32)` bins, one pair for the duration of `Controller.tick` (0.05 ms to 1 s) and one for the gap between ticks (10 ms to 10 s), plus a minimum, a maximum and a count of late ticks (duration over 50 ms) and late gaps (over 250 ms). Nothing is allocated, serialised, hashed or sent in the tick. Every 60 s a timer chain asks `requestIdleCallback` to read `performance.memory` (MB, where the browser has it) and count one sample; a `PerformanceObserver` for `longtask` counts entries and their total duration, never their names, where the browser supports it. After `perf_interval_s` (1800 s or more) the samples become one entry in the 3.3 OSB shape: `at`, `span_s`, `samples`, `js_heap_mb { used, total }` (the last sample), `tick_ms` and `gap_ms` `{ p50, p95, p99, max, late_pct }` (percentiles from the bins, interpolated inside a bin and kept between the true minimum and maximum, so a bin is the resolution; times are cut to 600000 ms), `long_tasks { count, total_ms }`. A field the browser cannot measure is left out. The histograms are reset after each entry. Entries wait in `Diag.perf` (at most 2; the oldest goes first), ride in the next batch, and an entry that breaks a wire rule is dropped. Show what is sent adds the entry that would be built now, without queueing it or resetting anything.

**Batch job.** It shares the request lane (one request at a time), the 15 s timeout, the start delay and the configuration with usage statistics, but keeps its own failure counter: a diagnostics failure never changes the usage schedule. It needs a registered install whose consent the server has (`usage_version` 2). Answers: 202 drops what was sent and waits `max(interval_s, next_after_s)`; 401 re-registers as for usage statistics; 403 `consent_required` sends one `PUT /installs/me/consent` and tries again after the interval, and a second one stops error reports until the page is reloaded; another 403 pauses them for 24 h; 429 waits `Retry-After`; 503 `disabled` waits for the next configuration read (at least an hour); 5xx, timeouts and network errors back off (base 60 s, cap 6 h); 400, 404, 413 and 415 drop the batch. Three unexpected errors inside the diagnostics code switch it off for the page; it never reports itself.

**Show what is sent** shows the next error-report batch in a second box, exactly as it would be sent, and sends nothing.

**Inside OSB Manager** (DIAGNOSTICS.md 3.6). OSB's own consent and configuration do not apply; the Manager's switch does. `Diag.start()` listens on `window.chrome.webview` for `{ "type": "osb-diagnostics", "on": <boolean>, "perf": <boolean, optional> }`; any other shape is ignored. With `on: true` recording works as above (`Diag.sync()`), without the sample draw (the Manager samples). With `on: false`, or before any message, nothing is recorded and every buffer is wiped. OSB never sends a diagnostics request to `api.osb.lol` there. Instead, a 60 s timer chain runs the idle-time job: it scrubs and deduplicates as above and posts at most one `{ "type": "osb-diagnostics-batch", "events": [...] }` per 60 s, events only, at most 10 events and 12 KB (each `<`, `>`, `&` and `'` counted as 6 bytes, in case the host escapes them; trails go first, newest events first, then whole events, oldest first). The same fingerprint still goes out at most once an hour. Perf is recorded only in the one window the Manager asks with `perf: true`: for one span of 1800 s, after which `Perf.close` posts `{ "type": "osb-diagnostics-perf", "perf": { ... } }` once (the OSB perf entry, at most 2 KB) and switches perf off until the next ask; `perf: false` or `on: false` stops it at once without an answer. Every other window keeps no perf state at all.

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

`lean.diagnostics.test.cjs` (also run by `node lean.test.cjs`) holds the error-report cases DG1 to DG24 of DIAGNOSTICS.md 3.7 that apply to OSB, adapted to the one switch, the scrubber canaries of 5.4 (each shown to leak without the scrubber), the golden OSB batch of 9.3, the `StopCodes` source scan and the outdated-consent cases. Every name in it is made up.

`lean.browser.test.cjs` records the game tick (the Ticker's callback) with consent off and with consent on against a server that never answers the status report. `OSB_TICK_PROOF_MS=600000` makes each run 10 minutes. The test's copy of the script exposes the internals (`Telemetry.base`, the timing table); the release script has no such hook.

## Privacy contact

`privacy@osb.lol`. The privacy policy is at `https://osb.lol/en/privacy/`. The consent texts are `docs/legal/CONSENT.md` (version `2026-11-12.1`) in the osb-platform repository; OSB uses their English wording exactly. A change to those texts needs a new text id and a new consent version in `lean-telemetry.js`, so that players are asked again.
