# Security review: <repo> @ <short-sha>

- **Commit:** <full SHA> (<branch>, <date>)
- **Mode:** quick (diff) | standard (repo) | deep (repo + threat model)
- **Scope:** <what was reviewed>; **not covered:** <what was not, and why>
- **Status:** private, undisclosed. Do not share outside <who>.

## Summary

<Two to four sentences: the most important result first, the overall risk, the top fix.>

| # | Severity | Title | Location | Status | Models agreed |
|---|---|---|---|---|---|
| 1 | High | <title> | `path:line` | CONFIRMED | Claude, Codex |

Candidates found: <n>. Confirmed: <n>. Plausible: <n>. Rejected: <n>.

## Findings

### 1. <Title>

- **Severity:** High. <One line: reachability × impact.>
- **Location:** `path:line`
- **Path from source to sink:**
  1. `path:line`: <untrusted input enters>
  2. `path:line`: <passes through without a check>
  3. `path:line`: <reaches the sink>
- **Why it is exploitable:** <prose; preconditions; no working payload>
- **Impact:** <what an attacker gets>
- **Fix:** <the change, with the file to edit>; **test:** <the test that proves the fix>
- **Verification:** CONFIRMED by <model> (skeptic) and read by the lead. <Disagreement, if any.>

## Checked and clean

| Area | What was checked | Result |
|---|---|---|
| Access control on /api/* | every route in the map has an auth dependency (`path:line` of the middleware) | clean |

## Scanners

| Scanner | Ran | Result |
|---|---|---|
| gitleaks | yes | 0 leaks |
| semgrep | missing | `brew install semgrep` (not installed; ask first) |

## Worker ledger

| Worker | Tier / model | Task | Result | Checked by lead |
|---|---|---|---|---|
| map-api | cheap / claude-haiku-5-5 | attack-surface map, API slice | 42 entry points | sampled 10 |
