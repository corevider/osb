# OSB live

Watch your bots from your phone: status, HP/MP, XP, gold and kills per hour, Sun and Moon drops and the activity log, one table row per character, refreshed every few seconds. It works with OSB in a browser and in OSB Manager.

This is an optional companion, separate from the bot. Nothing here is part of the OSB userscript: OSB itself is unchanged and sends nothing more than before. You install and start it yourself, and everything runs on your own machine. There is no account and no quota, and nothing is stored.

## What it sends, and where

- **To the hub on your own machine:** each character's name, level, HP/MP, position, session numbers, its own Sun and Moon drops and the last 12 lines of the bot's log. The hub keeps only the latest report per character, in memory.
- **Through Cloudflare, only with the phone link on:** the same reports and the dashboard page travel through a [Cloudflare quick tunnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) between your machine and your phone, protected by your private code.
- **To [ntfy.sh](https://ntfy.sh), only with the phone link on:** the tunnel's current address and nothing else, so that OSB Manager can find the hub again after a restart; see below.

With `TUNNEL=off` nothing leaves your machine.

## What you need

- OSB running in a browser with Tampermonkey (or Violentmonkey), or in OSB Manager
- This folder on the machine the bots run on
- [Node.js](https://nodejs.org/) 18 or newer
- `cloudflared`, for the phone link
  - macOS: `brew install cloudflared`
  - Windows: `winget install Cloudflare.cloudflared`
  - Linux: see [Cloudflare's downloads](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/downloads/)

Without `cloudflared` the dashboard still works, but only on the machine itself.

## Start

1. Start the hub and leave its window open.
   - macOS / Linux: `node hub.js` in this folder
   - Windows: double-click `start.bat`
2. It prints three links:
   - **Install reporter**: open it in the browser where the game runs, accept it in Tampermonkey, then reload the game tab. If Tampermonkey asks whether the script may connect to `127.0.0.1`, choose "Always allow". You do this once.
   - **Phone link**: open it on your phone. Your characters appear a few seconds after they enter the game.
   - **Dashboard**: the same page, for this machine only.

## Good to know

- **The phone link is private.** Anyone who has the full link can watch your stats. The part after `#` is your code; it is created on first start and kept in the `.code` file. Never share that file or the link. The install link carries the same code, so treat it the same way. On Windows the `.code` file is not locked to your user the way it is on macOS and Linux, so keep the folder private. To get a new code, delete `.code`, restart the hub and install the reporter again.
- **The phone link changes on every start.** Only the address changes; your code stays the same. The link is printed once its address resolves, which the hub checks with the public resolver `1.1.1.1`; on a network that blocks it, the link appears after 30 seconds instead.
- **Local only.** Set `TUNNEL=off` to skip the phone link (macOS / Linux: `TUNNEL=off node hub.js`).
- **"Offline" appears after 90 seconds without a report.** A background game tab can report as rarely as once a minute, so a late report first shows its age ("Hunting · fight · 40s ago"). A character that has not reported for a day is dropped.
- **The hub must be running** on the machine with the bots. If that machine sleeps, the dashboard shows the bots as offline.
- **Several bots** on the same machine all report to the same hub and show on the same link, one row each.
- **The table.** The tiles on top add up all characters. Below them you can search by name, show only the hunting characters or only those that need attention (stopped, dead, not in game, offline), or only those with Sun or Moon drops. A column heading sorts by that column. The arrow on a row opens the rest: session numbers, the drops and the log. On a phone the row keeps the character, XP/h and Gold/h, and everything else is in the opened row. The sort order and the opened rows are remembered on that device.
- **The per-hour numbers** are XP, net gold and kills divided by the hunting time, the same way OSB Manager's Stats tab works them out, and appear after 30 seconds of hunting. Net gold includes purchases and repairs, so Gold/h can be negative. The sums on top leave out the rates of offline characters.
- **Sun and Moon drops** are read from the game's server-wide drop announcements, the ones naming your character; Star is left out. The game announces who the drop was for, so in a party the item may end up with another member. The list starts when the game tab loads and holds the last 20.
- **NIX works too.** OSB is a fork of [opensro-bot-lean](https://github.com/nixxane/opensro-bot-lean) (NIX), which exposes the same diagnostics, so the same reporter covers both bots, and the row says which bot it is.
- **It is read-only.** The reporter reads what the bot shows and never sends anything to the game.

## OSB Manager

[OSB Manager](https://osb.lol/en/osb-manager/) runs the game in its own browser, which has no Tampermonkey, so the reporter goes into the Manager's own Scripts list:

1. Start the hub with the phone link on. It prints a fourth link, **For OSB Manager**.
2. In OSB Manager choose **Scripts › Add from URL…** and paste that link.
3. Choose **Scripts › Reload open game windows**. The characters appear on the dashboard once they are back in the game.

You do this once. The Manager's browser does not let a page reach `127.0.0.1`, so there the reporter sends its reports to the hub through the tunnel, whose address is new on every hub start. To let the reporter find the new one, the hub posts its current tunnel address to [ntfy.sh](https://ntfy.sh), a free public message board, under a topic derived from your code; the reporter reads it from there when the address it knows stops answering. Only the address is posted, never your code or any stats, and ntfy deletes it after 12 hours (the hub posts it again every 6).

- After a hub restart the Manager's characters show as offline for up to about 3 minutes, then come back by themselves.
- If ntfy.sh cannot be reached, add the new **For OSB Manager** link again and reload the game windows.
- It needs the phone link, so it does not work with `TUNNEL=off`.
- With a new code (after deleting `.code`), add the link again.

Tested on macOS with OSB Manager 1.2.1. Not tested on Windows.

## If something is wrong

| You see | What to do |
| --- | --- |
| "Waiting for a bot to report…" | Check the reporter is enabled in Tampermonkey and reload the game tab. |
| "wrong code" | Open the phone link exactly as the hub printed it. |
| "hub unreachable, retrying…" | The hub or tunnel stopped. Start it again and use the new phone link. |
| "Port 4173 is in use" | The hub is already running in another window. To use another port, set the `PORT` environment variable (macOS / Linux: `PORT=4180 node hub.js`), then install the reporter again. |
| Stats stop after a bot update | The bot changed what the reporter reads. The browser console shows `[OSB live] bot layout changed`. |

## Files

- `hub.js`: the hub, with no dependencies
- `reporter.js`: the reporter userscript, without its header; install it from the hub's link, which adds the header and fills in your code
- `dashboard/index.html`: the dashboard page
- `reporter.test.cjs`, `hub.test.cjs`: self-checks, run with `node reporter.test.cjs` and `node hub.test.cjs`

The reporter reads the bot's diagnostics on `window.SROLean` (`stats`, `world`, `hunt`, `log`, `activity.userMessage`), and the drop announcements in `world.gp.chat.lines` and `world.gp.notices`. It only reads them. If they change, update `snapshot()` and `readDrops()` in `reporter.js` and its test. The dashboard works its numbers out from the text of `stats.display()`.

## Why it is built this way

- **The hub listens on `127.0.0.1` only.** The tunnel is the one way in from outside, and every request except the page itself needs the code, compared in constant time.
- **The code sits in the install link's path**, so the address still ends in `.user.js`, which is what makes Tampermonkey offer to install it.
- **In a browser the userscript manager sends the reports** (`GM_xmlhttpRequest`), so the game site's rules about reaching localhost do not apply. OSB Manager has no such function, so there the game page posts by itself: the hub lets only the game's origin through, only to `/report`, and the report still needs the code.
- **The dashboard polls** every 3 seconds, because Cloudflare quick tunnels hold back a pushed stream until it closes.
- **The hub stamps each report with its own time** and sends its clock along, so a phone with a wrong clock cannot show a bot as offline.
- **A worker timer drives the reporter**, because a browser slows the timers of a background game tab to about once a minute.
- **Drop lines already on screen when the reporter starts are not counted**, and a Sun drop that arrives both as a chat line and as a notice counts once.
- **All text from the bot goes into the page as text, never as HTML**: log lines and drop announcements can carry other players' names.
