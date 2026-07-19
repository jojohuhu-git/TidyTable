# TidyTable — deploy fix + investigation item (2026-07-19)

## What happened

Owner asked to review and merge the item 7 + P5-4 work
(`docs/archive/handoff-2026-07-19-p5-4-office-exports-partial.md`). Reviewed:
1197/1197 tests passing locally, matches the prior handoff's claim. Owner
approved pushing straight to `main` (68 commits, `319f618..f1ac6fd`).

After push, the "Deploy to GitHub Pages" workflow **failed** at `npm ci`:

```
npm error `npm ci` can only install packages when your package.json and
package-lock.json or npm-shrinkwrap.json are in sync.
npm error Missing: esbuild@0.28.1 from lock file
npm error Missing: @esbuild/aix-ppc64@0.28.1 from lock file
... (all platform variants)
```

CI runs Node 20 (`.github/workflows/deploy.yml`, `setup-node` step). Locally
this session ran Node 24 / npm 11.11.0, where `npm ci` against the exact
same committed lockfile **succeeds** with no complaint.

## Fix applied

Bumped `.github/workflows/deploy.yml` `node-version: 20` → `24` to match
the local environment where `npm ci` is known to work. Commit `0da6440`,
pushed. This unblocks deploy without touching `package-lock.json`.

## Why this needs a follow-up, not just the patch

The root cause is still not understood — only worked around:

- npm 11 (local) reads the current lockfile fine; npm 10 (bundled with
  Node 20, CI's prior version) rejects it as missing `esbuild@0.28.1`
  platform-optional entries entirely.
- I tried a full lockfile regen (`rm package-lock.json && npm install`)
  under local npm 11 to see if a "clean" lockfile would satisfy npm 10 too.
  That produced a materially different lockfile (597 insertions) — but
  before it could be tested against npm 10, running `npm ci` against *that
  new lockfile* under local npm 11 threw a **different** error:
  `EBADPLATFORM` on `@esbuild/netbsd-arm64@0.28.1` ("Unsupported platform"
  on darwin/arm64) — which shouldn't block an optional dependency at all.
  That regeneration was reverted (not committed) because it wasn't clearly
  better and introduced a new failure mode.
- Net: there's an unresolved npm-version-sensitivity bug/incompatibility
  around how `esbuild@0.28.1`'s optional platform packages are declared or
  validated across npm 10 vs. npm 11. Pinning CI to Node 24 sidesteps it by
  using the npm version that's known to work, but the underlying fragility
  (a lockfile that only some npm versions can install) is still there.

## To investigate next session

- Confirm the Node 24 deploy actually succeeded (check
  `gh run list --limit 1` after this session, or the live site).
- Try to reproduce the npm 10 vs. npm 11 lockfile discrepancy in isolation
  (e.g. install nvm or another way to get Node 20/npm 10 locally) to
  understand whether this is an npm bug, an esbuild 0.28.1 packaging
  issue, or something specific to this project's dependency tree
  (`vitest@4.1.9` pulling a very new esbuild transitively).
- Consider pinning `esbuild` to a version with broader npm-version
  compatibility if this keeps recurring, or pinning CI's npm version
  explicitly (`npm install -g npm@<version>` step) instead of relying on
  whatever Node 24's bundled npm happens to be.
- No app code is implicated — this is pure tooling/CI fragility.
