---
description: Commit all working-tree changes as multiple feature-grouped commits
---

Commit everything in the working tree as a series of small, feature-grouped commits instead of one big commit. Extra instructions from the user (may be empty): $ARGUMENTS

Follow this workflow:

## 1. Survey the changes
- Run `git status --short` for the full list (modified, untracked, deleted). Don't rely on a truncated snapshot.
- Skim the diffs (`git diff`, and `git diff --cached` if anything is already staged) plus each new untracked file, enough to know what each file's change is *for* — not just which file changed.
- Check for dirty submodules (lowercase `m` in status). This repo has `Common.Framework` — see step 4.

## 2. Group into features
- Cluster files by the feature/refactor they serve, not by directory. A backend controller + the frontend page that consumes it belong in the same commit.
- Typical buckets: new feature (backend + frontend + wiring), refactor/perf work, UI/theming polish, branding/assets, chores (.gitignore, stray file removal).
- Shared files that span several features (e.g. `App.jsx`, `main.jsx`, `Sidebar.jsx`): put each in the commit for its *dominant* change, or in the final wiring commit. Don't attempt hunk-level splitting unless the user asks.

## 3. Commit in dependency-safe order
- Foundations before consumers: contexts/providers, shared UI primitives, CSS tokens, and new services must be committed **before** the pages/controllers that import them, so every intermediate commit stays buildable.
- Usual order: chores → backend refactors/services → shared frontend foundations → page adoption → feature wiring (routes, providers, nav).
- Use conventional-commit subjects (`feat(scope):`, `fix:`, `refactor:`, `perf:`, `chore:`) with a short body explaining the *why* when non-obvious.
- Stage with explicit file paths (`git add <paths>`), never `git add -A`, so nothing unrelated slips in.

## 4. Submodule handling (Common.Framework)
- If the submodule is dirty, check whether the main repo's new code depends on those changes (it usually does). If so: commit inside the submodule first (on its `main` branch, grouped by feature the same way), then commit the pointer bump in the main repo.
- Remind the user at the end: push the submodule **before** pushing the main repo.

## 5. Verify and report
- After the last commit, run `git status --short` again. Files sometimes reappear with late editor auto-saves — inspect and commit those as follow-ups to the matching feature (`fix:`/follow-up commits; don't rebase).
- Do **not** push unless the user asked.
- Finish with a summary table of the commits created (subject + what it covers) and flag anything intentionally left uncommitted (e.g. `.claude/`, untracked local files).
