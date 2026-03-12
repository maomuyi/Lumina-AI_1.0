# Session Architecture Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor Lumina into a session-preserving but image-ephemeral architecture, while upgrading rate limiting to Redis fixed-window with fail-open behavior.

**Architecture:** The backend will keep only business context in Redis sessions and treat images as request-scoped temporary inputs. The frontend will own the current image as the single source of truth and silently resend it for refine requests when needed. The analyze, refine, and xmp routes will be thinned into orchestration controllers over dedicated services.

**Tech Stack:** Fastify, TypeScript, Redis/ioredis, OpenAI SDK, Next.js, React

---

### Task 1: Introduce shared Redis infrastructure

**Files:**
- Create: `backend/src/services/redis.ts`
- Modify: `backend/src/services/session.ts`
- Modify: `backend/src/services/rate-limit.ts`

**Step 1: Write the failing tests**

Create or extend tests to assert:
- Redis rate-limit store uses a shared Redis client interface
- fail-open returns `allowed: true` with a degraded flag when Redis throws

**Step 2: Run tests to verify failure**

Run: `pnpm --dir backend test -- --test-name-pattern rate`

Expected: FAIL because Redis-backed store and degraded behavior do not exist yet.

**Step 3: Implement shared Redis service**

Add a single Redis accessor with:
- singleton connection
- lazy connect
- common error logging

**Step 4: Implement Redis fixed-window limiter**

Use:
- `INCR`
- first-hit `EXPIRE`
- `fail-open` on Redis exception

**Step 5: Re-run tests**

Run: `pnpm --dir backend test -- --test-name-pattern rate`

Expected: PASS.

### Task 2: Redesign session data to remove image persistence

**Files:**
- Modify: `backend/src/services/session.ts`
- Modify: `backend/src/routes/analyze.ts`
- Modify: `backend/src/routes/refine.ts`
- Test: `backend/src/services/session.test.ts`

**Step 1: Write the failing session tests**

Cover:
- session payload no longer stores image bytes or preview URLs
- session stores `image_fingerprint`
- revision increments correctly

**Step 2: Run tests to verify failure**

Run: `pnpm --dir backend test -- --test-name-pattern session`

Expected: FAIL because session shape still lacks the new contract.

**Step 3: Update session service**

Add:
- `imageFingerprint`
- `revision`
- optional `intentHistory`
- helper to compare revision and fingerprint

Remove:
- any persisted image payload fields

**Step 4: Re-run session tests**

Run: `pnpm --dir backend test -- --test-name-pattern session`

Expected: PASS.

### Task 3: Split request-scoped image ingestion from business session logic

**Files:**
- Modify: `backend/src/services/vision-source.ts`
- Modify: `backend/src/services/visionPreviewFiles.ts`
- Modify: `backend/src/routes/analyze.ts`
- Modify: `backend/src/routes/refine.ts`
- Test: `backend/src/services/vision-source.test.ts`

**Step 1: Write the failing tests**

Cover:
- request-scoped temporary preview creation
- cleanup is callable at request end
- public URL mode still rejects invalid `PUBLIC_API_BASE_URL`

**Step 2: Run tests to verify failure**

Run: `pnpm --dir backend test -- --test-name-pattern vision`

Expected: FAIL because request-scoped cleanup behavior is not complete yet.

**Step 3: Implement request-scoped preview lifecycle**

Behavior:
- create temp preview only when current provider requires public URL
- return a cleanup handle
- call cleanup in `finally`

**Step 4: Re-run tests**

Run: `pnpm --dir backend test -- --test-name-pattern vision`

Expected: PASS.

### Task 4: Redesign analyze/refine contracts around session + current image

**Files:**
- Modify: `backend/src/routes/analyze.ts`
- Modify: `backend/src/routes/refine.ts`
- Modify: `backend/src/utils/requestValidation.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/page.tsx`

**Step 1: Write failing contract tests**

Cover:
- analyze requires `image_fingerprint`
- refine validates `session_id`, `revision`, `image_fingerprint`
- refine returns `409` on revision conflict or fingerprint mismatch
- refine can accept the silently resent image

**Step 2: Run tests to verify failure**

Run: `pnpm --dir backend test`

Expected: FAIL because current refine contract does not enforce these fields.

**Step 3: Implement analyze contract**

Add:
- `image_fingerprint`
- `revision` in final payload

**Step 4: Implement refine contract**

Add:
- `multipart/form-data` handling
- `revision` and `image_fingerprint` checks
- optional request-scoped image use for vision-required providers

**Step 5: Update frontend flow**

Frontend should:
- generate/store current image fingerprint
- keep current file locally
- silently resend current image on refine
- clear session state on image switch

**Step 6: Re-run tests and frontend typechecks**

Run:
- `pnpm --dir backend test`
- `pnpm --dir frontend typecheck`

Expected: PASS.

### Task 5: Keep XMP export stateless and independent

**Files:**
- Modify: `backend/src/routes/xmp.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/app/page.tsx`

**Step 1: Add the failing tests**

Cover:
- xmp route works without session image context
- session_id/revision remain optional
- export behavior does not mutate session

**Step 2: Run tests to verify failure**

Run: `pnpm --dir backend test -- --test-name-pattern xmp`

Expected: FAIL if xmp still depends on session semantics.

**Step 3: Implement stateless XMP flow**

Ensure:
- xmp generation is parameter-only
- frontend can export current params at any point

**Step 4: Re-run tests**

Run: `pnpm --dir backend test -- --test-name-pattern xmp`

Expected: PASS.

### Task 6: Final verification and cleanup

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md` if needed
- Review: current working tree for unrelated files

**Step 1: Run the full verification set**

Run:
- `pnpm --dir backend test`
- `pnpm -C . typecheck`
- `pnpm -C . lint`
- `pnpm -C . build`

**Step 2: Confirm image persistence boundaries**

Verify by inspection:
- no session stores image payloads
- temp image files are request-scoped and actively cleaned
- only TTL cleanup remains as a safety net

**Step 3: Commit**

```bash
git add docs/plans/2026-03-12-session-architecture-design.md docs/plans/2026-03-12-session-architecture-implementation.md backend frontend README.md CHANGELOG.md
git commit -m "refactor: decouple session context from image storage"
```
