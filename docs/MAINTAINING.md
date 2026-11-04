# Maintaining OSB

OSB lives at `github.com/corevider/osb`. It is a fork of `opensro-bot-lean`. This page is for the maintainers. The Claude tokens, what each workflow can do and how the tokens are protected are in [SECURITY.md](../SECURITY.md).

## How the automation fits together

| Workflow | Starts when | What it does | Why it is safe |
| --- | --- | --- | --- |
| `ci.yml` | every pull request, or by hand | builds, syntax-checks and tests the PR; checks the userscript header | plain `pull_request` event: no secrets, read-only token, even for forks |
| `claude-review.yml` | a PR by an `OWNER`, `MEMBER` or `COLLABORATOR`; any other PR after a maintainer adds the label `ok-to-review`; or by hand | a plain step saves the PR's text and diff; the agent reads them and main, leaves inline comments and returns a summary that ends with `VERDICT: MERGE` or `VERDICT: HOLD` | `pull_request_target` with main checked out, never the PR's code; the agent has no shell, network or write access and cannot approve or merge; the token guard checks what it posted |
| `claude-fix.yml` | an issue by an `OWNER`, `MEMBER` or `COLLABORATOR`; any other issue after a maintainer adds the label `ok-to-fix`; or by hand | the agent edits the code for the issue; a separate job builds and tests the patch; a third job opens a PR | the agent has no shell, network or token; its code runs only in a job without secrets; changes under `.github/`, `vendor/` and `notes/` are refused; the PR still needs a maintainer's approval |
| `merge-approved.yml` | a maintainer approves a PR from a branch of this repository, or by hand with a PR number | merges when the approval covers the current head commit, the `test` check passed and Claude did not say `HOLD`; never touches PRs that change `.github/` | runs no PR code; only reads a human approval |
| `release.yml` | a PR is merged, or by hand with a PR number | next patch version, notes, build, tests, a commit to `main`, a GitHub release with `osb.user.js` and `osb.meta.js` | runs on `main`, not on the PR; the notes agent can only read and return the notes, which the token guard checks |
| `upstream-sync.yml` | every Monday 06:17 UTC, or by hand | compares upstream's `main` with the commit recorded in `UPSTREAM.json` and opens or updates one issue that lists the new commits and every URL in their added lines | `contents: read` and `issues: write` only; fetches a public repository, runs none of its code, merges and pushes nothing |

Each workflow file starts with a comment that says why it is safe. Keep that comment true when you change the file.

An outside PR is reviewed once the label is added, at the commit that was there then. New commits from an outside author do not start another review: remove and add the label again after you have looked at them.

The author association of a PR is what GitHub reports: `OWNER`, `MEMBER` (organisation members whose membership is public), `COLLABORATOR` (people with a role on the repository), `CONTRIBUTOR` and below. If a maintainer's membership is private, their PR needs the `ok-to-review` label.

## Secrets and the `claude` environment

The Claude jobs take their token from the GitHub Environment `claude`. Create it once: Settings, Environments, New environment, name `claude`.

- Deployment branches and tags: **Selected branches and tags**, add the rule `main`.
- Optional: add yourself under **Required reviewers**. Every Claude run, including the notes of each release, then waits until you approve it in the run's page.
- Environment secrets, one of:

| Secret | Used by |
| --- | --- |
| `CLAUDE_CODE_OAUTH_TOKEN` | the default: the operator's subscription token, made with `claude setup-token` on the operator's own computer |
| `ANTHROPIC_API_KEY` | only when `CLAUDE_CODE_OAUTH_TOKEN` is not set: a CI-only API key in a Console workspace with a low spend limit |

Both are read by `claude-review.yml`, `claude-fix.yml` and the notes job of `release.yml`. Without either, the review and fix workflows skip their Claude step and the release writes notes from the PR title and body. SECURITY.md says how to create, switch and rotate them.

If the environment ever does not work for a run (the job fails with a deployment protection error), the fallback is repository secrets with the same names. The gates and the token guard stay the same, but any workflow on `main` could then read them.

One repository secret may be needed:

| Secret | Needed | Used by |
| --- | --- | --- |
| `RELEASE_TOKEN` | only if branch protection blocks the release push | `release.yml` pushes the version commit with it. A fine-grained token with `Contents: read and write` on this repository, from an account on the bypass list of the `main` rules. |

Also install the Claude GitHub App on the repository (run `/install-github-app` in Claude Code, or install it from github.com/apps/claude). Create the labels `ok-to-review` and `ok-to-fix` once. In Settings, Advanced Security, enable secret scanning, push protection and private vulnerability reporting.

Never put a key in the code, in a workflow file or in an issue.

## Branch protection on `main`

Set this after the first push (Settings, Rules, Rulesets, New branch ruleset, target `main`), or with classic branch protection:

1. Require a pull request before merging, with **1 approving review**. Dismiss stale approvals when new commits are pushed. Require approval of the most recent push.
2. Require status checks to pass: add **`test`** (the job of `ci.yml`; it appears in the list after the first run). Require branches to be up to date.
3. Block force pushes and deletion of `main`.
4. Do not give write access to people you do not trust with the secrets: a collaborator can change a workflow on a branch of this repository and read the secrets that workflow gets.
5. The release commit is pushed to `main` by the workflow. If the rules block it, add `github-actions` (or the account of `RELEASE_TOKEN`) to the bypass list. Allow bypass for pull requests only if you can limit it to that actor. If the ruleset has no way to bypass for `github-actions`, create `RELEASE_TOKEN` as described above.

Also in Settings, Actions, General: set "Fork pull request workflows from outside collaborators" to **Require approval for all outside collaborators**, and set the default workflow permissions to **Read repository contents** (every workflow here declares its own permissions).

## Releasing

Releases are automatic. Merge a PR that changes the bot (anything outside `.github/`, `docs/`, `notes/` and `*.md`) and `release.yml` does the rest:

1. next patch version from `build-lean.py` (`2.0.0` then `2.0.1`, and so on);
2. `notes/<version>.md` from Claude, or from the PR title and body without a Claude token;
3. both version strings bumped, the build, `node --check` and the tests;
4. one commit to `main` with `build-lean.py`, `osb.user.js`, `osb.meta.js` and the notes;
5. the GitHub release `v<version>` with `osb.user.js` and `osb.meta.js` as assets, and a comment on the PR.

Do not release a merged PR by hand as well. If a release failed, fix the cause and run `release.yml` again from the Actions tab with the PR number.

To change the version by hand (for example a new minor version), open a PR that changes both version strings in `build-lean.py` and adds `notes/<version>.md`. Release it by hand: build, run the tests, commit the sources and both generated files together, tag `v<version>`, and create the release with the two files attached. The PR itself must not be released by the workflow as well: label it, or merge it with the release notes already written, and run the workflow only if the version is still unpublished.

Users update through Tampermonkey: the `@updateURL` and `@downloadURL` point to `osb.meta.js` and `osb.user.js` on `main`, and the bot's own update check reads the same files.

## Taking an upstream port

OSB has its own history. Upstream's history is not merged: each time, the maintainers or an agent port the changes by hand. `UPSTREAM.json` records the last upstream commit OSB took (the commit, its version and the date), and `NOTICE` says the same for the GPL notice. `upstream-sync.yml` only watches: when upstream's `main` has commits after the recorded one, it opens or updates one issue labelled `upstream-sync` that lists the commits, every URL the added lines contain and the files changed. It merges nothing and starts nothing else.

1. Read the issue, then fetch upstream:

```sh
git remote add upstream https://github.com/nixxane/opensro-bot-lean.git
git fetch --no-tags upstream main
git switch -c upstream-port/<date> main
last=$(jq -r .commit UPSTREAM.json)
head=$(git rev-parse upstream/main)
git log --no-merges --reverse --format='%h %s' $last..$head
```

2. **Review every upstream commit**: read the code, not only the titles. For each one note what it does, any new storage key or setting, anything that talks to the network or to a third party, and any default that changes behaviour for existing users. OSB sends data only to `api.osb.lol/v1`, and only after the player's consent or confirmed Send (see `docs/telemetry.md`), so a new host (another report endpoint, analytics, a Discord invite) must be removed or reworked before the change is taken, and a change to the usage statistics or report code must keep the consent rules. Read every new URL in the issue and in `git diff -U0 $last..$head -- . ':!bot.lean.user.js' ':!bot.lean.meta.js' | grep '^+'`.
3. Apply the diff without upstream's generated files. The upstream objects are present after the fetch, so the three-way apply works without shared history:

```sh
git diff $last..$head -- . ':!bot.lean.user.js' ':!bot.lean.meta.js' | git apply -3
```

4. Resolve the conflicts. Keep OSB's header and name, the `corevider/osb` URLs, the version, the consent-based reports and usage statistics (`lean-telemetry.js`, `lean-reports.js`), the seal, the README and the docs (`build-lean.py` and `lean-ui.js` conflict most often). Take upstream's new notes files unchanged and add the new features to OSB's release note in OSB's voice.
5. Rebuild and run the checks below, including `lean.browser.test.cjs` with a Playwright folder. Fix a stale test in OSB's tree; report a problem in upstream's code without changing its behaviour.
6. Set `UPSTREAM.json` to the new commit, its version and the date, and update the base line and date in `NOTICE`.
7. Commit in steps (the port, the rebuild, the record) and open a pull request from `upstream-port/<date>`. Wait for `test`, read the Claude review, then approve. Do not release the PR by hand as well.

Never merge `upstream/main` into OSB: the histories do not share a base, and a merge would bring upstream's generated files and history back.

## Checks before a release or sync is trusted

- `python3 build-lean.py`, `node --check osb.user.js`, `node lean.test.cjs` (it includes `lean.telemetry.test.cjs`: with no consent the fake network sees zero requests) all pass, and so does `node lean.browser.test.cjs <folder with playwright>` (it needs Edge and runs on simulated pages only).
- The header of `osb.user.js` has `@name OSB`, `@version`, the `corevider/osb` update URLs, and the unchanged `@match https://opensro.online/play*`.
- The only outgoing hosts are `raw.githubusercontent.com/corevider/osb`, `api.github.com/repos/corevider/osb`, the game's own origin and `api.osb.lol/v1`: run `git grep -nI "https\?://" -- 'lean-*.js' restock.js` and read every host.
- Search the tree for third-party hosts and personal data: run `git grep -nI -i "nixxane\|workers.dev\|discord.gg"` and read every hit.

## Manual check after publishing

1. Disable the previous bot in Tampermonkey. Install OSB from `https://raw.githubusercontent.com/corevider/osb/main/osb.user.js`.
2. Reload the game: the panel title reads **OSB** with the version **2.0.0**.
3. Your settings are still there (they are stored under the same keys as the previous bot's).
4. OSB Manager shows **Bot 2.0.0**.
5. Settings, Send bug report: the window says the report goes out only when you press Send and confirm; **Copy report** and **Save report file** work. With Settings → Privacy off (the default), the browser's network tab shows no request to `api.osb.lol` until Send is confirmed, and with "Check GitHub for OSB updates" off it shows no update request either.
6. Settings, Share: a share code from the previous bot (`nixxane1:...`) previews and imports; a new code starts with `osb1:`.
