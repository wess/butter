# Resume Prompt — MCP Dev Server Implementation

Paste the block below into a fresh Claude Code session to continue MCP work without re-establishing context.

---

Continue MCP dev server implementation for butter framework.

**State:**
- Branch: `feat/mcp-dev-server` in worktree at `~/.config/superpowers/worktrees/butter/feat-mcp-dev-server`
- 14 commits, 487 tests pass, 0 fail
- Chunks 1-2 of plan complete (TypeScript MCP server + 5 tools, all TDD-verified, two-stage reviewed)
- Chunks 3-6 remaining

**Goal:** ship `butterframework` v1.4.0 with macOS MCP working so my ambry agent can drive butter apps.

**Next work** (skip Chunks 4-5 — Linux/Windows shims — for now):
- **Chunk 3** (macOS shim `mcp:eval` handler + console capture) — code is in the plan's "Plan Revisions" section, NOT the original Chunk 3 body
- **Chunk 6 Task 6.1** (boot MCP server in `runDev` with all 4 cleanup callers awaited)

**Plan:** `docs/superpowers/plans/2026-04-28-mcp-dev-server.md`
**Spec:** `docs/superpowers/specs/2026-04-28-mcp-dev-server-design.md`

**Approach:** `superpowers:subagent-driven-development`, same pattern as the prior session (implementer → spec review → code quality review → fix iterations → next task). Worktree already exists; do NOT create a new one. Don't touch `main` — I handle all git on `main`.

**Also pending** (separate concern, do NOT bundle into 1.4.0): v1.3.1 release blocked on `NPM_TOKEN` secret missing/expired in GitHub repo Settings → Secrets and variables → Actions. CI is green. Manual `gh workflow run Release --ref main` after fixing the secret will publish 1.3.1.

---

## Quick reference for the next session

**Worktree:** `cd ~/.config/superpowers/worktrees/butter/feat-mcp-dev-server`

**Verify clean baseline before starting:**
```sh
git log --oneline main..HEAD          # should show 14 MCP commits
bun run test                           # should pass: 482 + 0 + 5
git status                             # should be clean
```

**Tasks already done** (do not redo):
- 1.1 Add MCPOptions/DevOptions types
- 1.2 Fix config parser (security/splash/dev sections — closed 2 latent bugs)
- 1.3 Add `runtime.tap()` (with throw-isolation fix)
- 1.4 Console ring buffer (with `noUncheckedIndexedAccess` type fix)
- 2.1 wrap.ts helpers (with click/fill JSON return + auto-return-expression fix)
- 2.2 eval_javascript tool
- 2.3 list_console_messages tool
- 2.4 take_screenshot tool
- 2.5 click tool
- 2.6 fill tool
- 2.7 createMcpServer scaffold (uses `WebStandardStreamableHTTPServerTransport` from SDK 1.29.0, port 4711, 127.0.0.1, stateless)

**Tasks for this session:**
- Chunk 3 Task 3.1 — `mcp:eval` control handler in `src/shim/darwin.m`
- Chunk 3 Task 3.2 — console wrapper user-script + script-message hook in `src/shim/darwin.m`
- Chunk 6 Task 6.1 — boot MCP server in `src/cli/dev.ts` `runDev`, route `console:message` via `runtime.tap`, MCP-aware async cleanup with all 4 callers awaited (`shimProc.exited`, SIGINT, uncaughtException, unhandledRejection)

After all three pass review and merge to `main` (I'll handle the merge), bump `package.json` to `1.4.0` and trigger release.
