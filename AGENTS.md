<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Simple Finance

Continuation point: [`docs/HANDOFF.md`](docs/HANDOFF.md). Read that before changing the app. [`docs/SPEC.md`](docs/SPEC.md) is the product spec; [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) is the decision log — read the decisions that touch the area you are changing.

Releases follow [`docs/RELEASE_PROCESS.md`](docs/RELEASE_PROCESS.md) — the standing default for every GitHub release: the agent owns version bumps, the merge-commit pull request, the lower-case annotated tag, registry verification, release notes and the GitHub release. Do not ask the household to merge, tag or publish anything by hand.

## Working ethos — how to use the docs

These docs are here to help you and the household, not to box you in. Treat `docs/SPEC.md`, `docs/IMPLEMENTATION_PLAN.md` and `AGENT_APP_BLUEPRINT.md` as a guiding hand, not an unbreakable pact.

- If a doc is getting in the way of the task, **say so and ask**. You're authorised to challenge the spec and suggest a better alternative — have the quick conversation with the household before you deviate, don't just silently work around it.
- If a blueprint or spec rule is genuinely the wrong call for the change in front of you, propose the alternative and get an explicit "go ahead". That 30-second check beats a perfect implementation of the wrong thing.
- **Exception:** `docs/RELEASE_PROCESS.md` is the one rule that *is* strict. The household is deliberately hands-off on GitHub delivery (merge, tag, publish, release) — don't pull them into that flow and don't offer to let them do it by hand. Own it end-to-end (see that file for the 12 steps).

### Sandbox

The sandbox has real network/filesystem limits. Before you retry a failing install three times, read `docs/SANDBOX.md` — if you hit a *new* limit, add it there (with the fix) and reference it from `docs/HANDOFF.md` / `docs/IMPLEMENTATION_PLAN.md`. Update that handoff note **before** you merge the PR — Arena won't let you push substance after the merge.

[`AGENT_APP_BLUEPRINT.md`](AGENT_APP_BLUEPRINT.md) supported the initial build through the first release. It is historical context, not required reading for ongoing work. Do not treat it as a gate, and do not send future sessions back to it first.
