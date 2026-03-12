# Prelaunch Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Lumina's analyze/refine/XMP chain safer and production-ready by fixing provider-specific visual ingestion, hardening input boundaries, and adding baseline abuse protection.

**Architecture:** The backend will decide how a vision preview is presented to the model (`data_url` vs `public_url`) instead of hardcoding base64. Validation, rate limiting, and temporary-file lifecycle management will be extracted into focused modules so they can be unit-tested and reused across routes. The frontend will keep its existing interaction model and only gain clearer failure messaging for provider/environment constraints.

**Tech Stack:** Fastify, TypeScript, OpenAI SDK, Redis/ioredis, tsx, React/Next.js

---

### Task 1: Add failing tests for the new safety boundaries

**Files:**
- Create: `backend/src/services/vision-source.test.ts`
- Create: `backend/src/services/rate-limit.test.ts`
- Create: `backend/src/utils/clampParams.test.ts`
- Modify: `backend/package.json`

**Step 1: Write the failing vision strategy tests**

Cover:
- `codeproxy.dev` defaults to `public_url`
- `data_url` is allowed for generic providers
- missing or localhost-only `PUBLIC_API_BASE_URL` is rejected for `public_url`

**Step 2: Run the test to verify it fails**

Run: `pnpm --dir backend test -- --test-name-pattern vision`

Expected: FAIL because the strategy module does not exist yet.

**Step 3: Write the failing rate limit tests**

Cover:
- first requests pass
- requests beyond the window limit are rejected
- window expiry re-allows requests

**Step 4: Run the test to verify it fails**

Run: `pnpm --dir backend test -- --test-name-pattern rate`

Expected: FAIL because the limiter module does not exist yet.

**Step 5: Write the failing clamp whitelist tests**

Cover:
- known params are clamped
- unknown params are dropped
- tone curve arrays are normalized and unknown tone curve keys are dropped

**Step 6: Run the test to verify it fails**

Run: `pnpm --dir backend test -- --test-name-pattern clamp`

Expected: FAIL because current implementation preserves unknown keys.

### Task 2: Implement backend vision input strategy and preview URL serving

**Files:**
- Create: `backend/src/services/vision-source.ts`
- Create: `backend/src/services/visionPreviewFiles.ts`
- Modify: `backend/src/services/llm.ts`
- Modify: `backend/src/routes/analyze.ts`
- Modify: `backend/src/index.ts`
- Modify: `backend/.env.example`
- Modify: `README.md`

**Step 1: Build the vision strategy helper**

Implement:
- provider capability detection
- `auto | data_url | public_url` decision
- public base URL validation
- input builders for `responses.create` and `chat.completions.create`

**Step 2: Implement preview temp-file storage**

Add:
- temp preview directory
- filename generation
- TTL cleanup
- helper to return absolute public URL

**Step 3: Wire analyze route to use the new strategy**

Behavior:
- read upload into buffer once
- resolve the right image input source
- return a clear request error before LLM call if provider requires a public URL but runtime cannot provide one

**Step 4: Expose the temporary preview download route**

Add a secure GET route with:
- filename traversal checks
- short-lived image content serving
- cleanup timer integration

**Step 5: Run the tests**

Run: `pnpm --dir backend test`

Expected: vision strategy tests pass.

### Task 3: Harden backend validation, parameter boundaries, and session storage

**Files:**
- Create: `backend/src/services/rate-limit.ts`
- Create: `backend/src/utils/requestValidation.ts`
- Modify: `backend/src/utils/clampParams.ts`
- Modify: `backend/src/routes/analyze.ts`
- Modify: `backend/src/routes/refine.ts`
- Modify: `backend/src/routes/xmp.ts`
- Modify: `backend/src/services/session.ts`
- Modify: `backend/.env.example`
- Modify: `README.md`

**Step 1: Implement a testable rate limiter**

Support:
- fixed window counters
- in-memory default storage
- optional Redis-backed storage hook-in later

**Step 2: Add request validation helpers**

Validate:
- `session_id` format
- `user_intent` / `new_intent` length
- `style` allowlist
- raw data field shape and length assumptions

**Step 3: Lock down Lightroom param keys**

Change `clampLightroomParams` so that:
- only known scalar params are kept
- only known tone curve keys are kept
- malformed arrays are normalized or dropped

**Step 4: Remove unnecessary preview base64 from session storage**

Keep only data that refine actually consumes.

**Step 5: Apply the limiter and validators to routes**

Protect:
- `POST /api/analyze`
- `POST /api/refine`
- `POST /api/xmp`

**Step 6: Run tests and typecheck**

Run:
- `pnpm --dir backend test`
- `pnpm --dir backend typecheck`

Expected: all backend tests pass and TypeScript stays green.

### Task 4: Improve frontend error handling for provider/environment constraints

**Files:**
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/page.tsx`
- Modify: `frontend/components/left-sidebar.tsx`

**Step 1: Normalize backend error messages in the API layer**

Surface:
- provider requires public image URL
- missing `PUBLIC_API_BASE_URL`
- image transport unsupported for current environment

**Step 2: Thread that state into the existing analyze UX**

Show:
- actionable toast messages
- clearer staged messages where possible
- non-destructive fallback behavior

**Step 3: Verify frontend type safety**

Run:
- `pnpm --dir frontend typecheck`
- `pnpm --dir frontend lint`

Expected: frontend checks pass.

### Task 5: Final verification and documentation sync

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md` if behavior changes are user-visible enough to record

**Step 1: Re-run the full verification set**

Run:
- `pnpm --dir backend test`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm build`

**Step 2: Review for residual risks**

Document:
- local dev still needs a public URL when using providers that reject data URLs
- rate limiting is baseline protection, not a substitute for auth

**Step 3: Commit**

```bash
git add docs/plans/2026-03-12-prelaunch-hardening-design.md docs/plans/2026-03-12-prelaunch-hardening.md backend frontend README.md CHANGELOG.md
git commit -m "feat: harden prelaunch analyze pipeline"
```
