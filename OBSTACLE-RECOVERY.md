# Obstacle pursuit and recovery

Implemented on `codex/obstacle-pursuit-recovery`, based on bot 1.2.100.

The bot checks a selected enemy's approach before sending repeated combat commands. A confirmed detour owns character movement until it completes or the target is stopped and released. Missing coverage, invalid start, search exhaustion, unreachable route, direct approach and valid detour are distinct outcomes. Since 1.2.102, failed initial queries preserve native targeting and need fresh observed lack of progress before a no-route result can abandon a target. Unknown coverage and search exhaustion alone never authorize a ban or stop.

Detours keep their route, use short collision-checked moves, replan on meaningful target/collision changes or loss of route progress, and have a bounded retry/episode budget. Arrival needs fresh state and a stability interval. Target HP changes alone never cancel a route. Failed approaches are remembered locally for 15 seconds, scoped to the same monster, nearby positions, world epoch and collision revision. This is not a permanent obstacle map, and never blacklists a different nearby monster.

Known ranged skill reach permits one bounded trial before routing. Only positive local result impacts preserve successful ranged offense; local cast sends, party damage and repeated cast publications do not establish new damage. Unknown weapon reach is not fabricated. The bot cannot infer projectile visibility solely from a walking chord.

Escape checks object-wall reachability in addition to terrain admission. Recent breadcrumbs retain world/navigation identity; retreat uses short recent segments instead of a distant shortcut. A blocked terrain departure can leave a contiguous blocked prefix but cannot cross an object wall, reenter blocked terrain or use missing coverage. Every attempt tracks local admission separately from observed movement. Success requires fresh stable arrival and a second legal movement, so a small correction or cast timestamp cannot declare the character free.

The existing detection and detour switches remain available. Two new Settings options default off:

- **Recall to town if legal escape attempts fail:** requires enabled, valid town service and scrolls. It has a five-minute cooldown. The recovery trip completes services and stops in town; it does not reverse into the same trapped origin.
- **Keep detailed escape diagnostics locally:** retains up to 64 escape transition records with position/revision/dispatch context in `SROLean`'s `Trap` owner. They are not added to report uploads. Turning it off or changing world/profile clears the trace.

`SROLean.navigation.setClipQuery(fn)` is an optional synchronous read-only validation adapter. It receives `{ from, to, epoch, revision }` and must return `{ pose, epoch, revision }` matching the requested endpoint and current identity. Null, stale, shortened, incorrect-height or thrown replies reject movement. Without an adapter the existing bundle geometry is used. **No native worker query endpoint has been added to OpenSRO**, so production native-equivalent query integration remains dependent on that separate client API. Ordinary bot movement and server collision remain authoritative.

The implementation does not teleport, reset poses, disable collision or promise escape from a fully enclosed object. Missing or mismatched surface ownership is handled conservatively; use the optional adapter for stronger native validation. Exact tree-interior causes, long-running server corrections and background suspension still require controlled live validation.

Run `python build-lean.py`, `node --check osb.user.js`, and `node lean.test.cjs`. The integration runner includes `lean.obstacle.test.cjs` with generated-script fixtures. Browser validation uses `node lean.browser.test.cjs <directory-containing-playwright>`. Optional game collision comparison uses `node lean.navigation.native.test.mjs <OpenSRO-checkout>` and requires generated game assets. Test results for the delivered branch are reported separately; these commands are not a claim of live-server verification.

## Unconfirmed release (after OSB 2.0.2)

An abandoned target used to stop hunting when the game did not confirm its release within 5 seconds ("Blocked target release was not confirmed."), and an abandon that could not halt movement within 15 seconds stopped hunting too. Neither stops hunting any more. After the halt, the release is sent; if the target is still selected 5 seconds later it is sent once more; if it is still selected 5 seconds after that, or the 15-second abandon budget runs out, the target is banned for 60 seconds, the hunt target is cleared and ownership is released. The next selection replaces the stale one. A target that dies or despawns during the abandon counts as released. No attack, skill or select is sent to the abandoned target while its release is pending. Protect party members picks targets through the same ban list and the same pursuit checks.

## Validation on 2026-10-15 (1.2.101)

The final fork build and JavaScript syntax check exited 0. `node lean.test.cjs` passed 345 integration tests, including 30 obstacle/recovery regressions. The isolated headless Edge browser suite exited 0 with zero page errors. The local game collision comparison passed 30 legacy routes and 30 pursuit routes, with six enclosed approach pairs remaining unreachable. `git diff --check` exited 0. Rebuilding in the fork reproduced the reviewed userscript bytes.

No live account, production bot session, real scroll consumption or tree-interior recovery was exercised. The optional native clip adapter has behavioral tests and a documented contract, but still needs a separately provided client endpoint for live native-equivalent queries.

## Targeting regression correction (1.2.102)

The owner's live test reported repeated no-route abandonment of apparently reachable enemies, with nearby and party targets being skipped. A regression fixture reproduced a clear path being rejected solely because the two poses differed in Y by over 20 units (2 m). The collision query is horizontal and must leave terrain height resolution to native movement. The raw height cutoff is removed. Failed initial queries now observe normal movement and positive local result impacts before taking over; an unconfirmed query alone cannot halt, release or ban a fresh target. Failed-approach memory is also restricted to the same entity ID. These changes preserve the existing nearest/attacker priorities and party-aware no-KS handling; they do not introduce a new party-assist priority.

Validation on 2026-10-16: the regenerated script passed syntax checking, all 352 integration tests, the isolated Edge browser suite with zero page errors, and the local collision comparison (30 legacy routes, 30 pursuit routes, six enclosed pairs). The height regression failed against 1.2.101 with `actual: 'unreachable', expected: 'direct'` before the fix. Live verification of the owner's exact hunting area remains outstanding.

## Combat retry follow-up from the 1.2.102 report (2026-10-18)

The supplied redacted diagnostic timeline repeatedly reports normal attacks with all four rotation skills paused after server rejection, then one skill cooling down and three paused. It also records the existing weaker-attacker interruption. It contains no target IDs, route outcomes or original server errors, so it cannot establish the initial monster's exact obstruction or prove every reported target switch had the same cause.

Behavioral regressions reproduced two contributing code defects: a skill send used to approach a distant monster could be inferred as a silent rejection, and attack failure backoff applied to every monster. Silent rejection inference now requires known skill reach, an in-range selected target, fresh state and no pending movement, selection or inventory work. Its evidence must refer to the same target. Attack failures are stored by skill and target; self-skill failures remain global. Confirmed local casts clear the corresponding failure. The existing no-damage timeout, obstacle abandonment and weaker-attacker priority remain in effect.

Validation: regenerated userscript, JavaScript syntax check, all 360 integration tests and `git diff --check` passed. The distance regression failed against the original generated script before the fix. Prepared for release 1.2.103; the owner's live hunting sequence was not exercised.
