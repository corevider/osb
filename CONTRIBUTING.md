# Contributing to OSB

Pull requests and issues are welcome. This page says what a change needs before it can be merged. AI coding agents also read [AGENTS.md](AGENTS.md), which has the module layout and the behaviour that must be preserved.

## Before you start

- **Open an issue first** for a new feature, a larger change, anything that adds a network request or a new host, a change to the saved settings (prefix `sroBotLean:v1:`), or a change to `window.SROLean`, which OSB Manager reads.
- **Security problems** go to a private report as [SECURITY.md](SECURITY.md) describes, never to a public issue.
- **Never test on a live account** without saying so. The tests use simulated game state.

## Rules for the code

- **Edit the sources, never the generated files.** Change the `lean-*.js` modules, `restock.js`, `lean-skin.css` or `build-lean.py`. Do not edit or commit `osb.user.js` and `osb.meta.js`; the release build makes them. Never change `vendor/bot.js`.
- **No new comments in code.** Use clear names and small functions instead. Explain the why in the commit message, the pull request or the docs. Existing comments may stay. Before you push, this must print nothing:

  ```sh
  git diff origin/main -- '*.js' '*.py' ':!osb.user.js' ':!osb.meta.js' ':!vendor/**' ':!*.test.cjs' | grep -E '^\+\s*(//|/\*|#[^!])'
  ```

- **English**, short and plain, for code, docs, commit messages, labels and log messages.
- **Plain JavaScript**: no bundler, no `package.json`, no new dependencies. LF line endings. Match the idiom of the module you change.
- **Keep the bot lean.** Small focused changes, no broad rewrites, and no full-assistant panels.
- **Privacy.** OSB fetches only from the hosts listed in [docs/telemetry.md](docs/telemetry.md), and sends data only after the player turns on the sharing switch or presses Send. Never send names, chat, log text or positions. A new host or new data needs an issue first.
- **Personal data.** Never commit browser profiles, settings files, screenshots of a real account or real character names. Tests use made-up names.
- **Tests.** Add a regression test for a bug fix (it must fail before the fix) and tests for a feature. Do not delete or skip a test to make CI pass. Say what was only tested in simulation.

## Build and test

With Python 3 and Node.js, from the repository root. The tests read the generated script, so build first:

```sh
python3 build-lean.py
node --check osb.user.js
node lean.test.cjs
python3 -m unittest discover -s tools -p 'test_*.py'
git diff --check
```

CI runs the same on every pull request. After the build, leave `osb.user.js` and `osb.meta.js` out of your commit.

## Commits and pull requests

- **Commit messages** follow [Conventional Commits](https://www.conventionalcommits.org/): `<type>(<scope>): <subject>`.
  - Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.
  - Scope examples: `loot`, `navigation`, `town`, `ui`, `telemetry`.
  - The subject is in the imperative mood, short, without a final period, for example `fix(loot): wait for the inventory change before counting a pickup`.
  - Add a body for anything that is not trivial: what was wrong and why this fixes it.
- **One topic per pull request**, as small as it can be.
- **The description** says what changed, why, and how you tested it.
- **Do not bump versions or write release notes.** The maintainers do that when they release.

## After you open a pull request

- CI builds and tests it. A maintainer may start a Claude review by adding a label.
- A maintainer reviews it and may ask for changes. Nothing is merged without a maintainer's approval.
- A merged change ships with the next release.
