# Production readiness checklist

What stands between EkDrive as it is today (a working prototype, see
[2026-10-22-status.md](./2026-10-22-status.md)) and running it for real users.

Each item says **why** it matters and **who** has to do it: *owner* means an account, domain or
provider decision only the project owner can make; *code* means it can be built here.

---

## 1. Blockers — real users cannot be onboarded until these are done

- [ ] **Publish the Google OAuth consent screen** *(owner)*
      The app is in **Testing** mode, where refresh tokens expire after **7 days**. Every user
      would have to sign in again weekly, and connected drives would silently stop working. No
      amount of code fixes this. Moving to Production needs the items below.
      EkDrive only requests `drive.file`, which is not a restricted scope, so the full security
      assessment should not apply — but brand verification still does.
- [ ] **Privacy policy and terms of service, publicly reachable** *(owner)*
      Required to publish the consent screen, and expected by users granting Drive access.
- [ ] **A domain with HTTPS** *(owner)*
      The session cookie is marked `Secure` only when `BACKEND_URL` is `https://`. Over plain
      HTTP the session travels unprotected, and the `SameSite=Strict` + Origin defences assume
      one real origin. Terminate TLS at Cloudflare, Caddy or nginx.
- [ ] **Managed PostgreSQL with backups, and one practised restore** *(owner)*
      The database is the only record of which chunk lives where. Chunks on Google Drive are
      useless without it — losing the database loses every file. Take backups, then actually
      restore one into a scratch database and confirm a file downloads afterwards.
- [ ] **Secrets in a secret store, not `.env.local`** *(owner + code)*
      Also note: rotating `ENCRYPTION_KEY` today would make every stored drive token
      undecryptable. A rotation path (key version column plus a re-encrypt pass) has to be
      built before a rotation is ever attempted.
- [ ] **Build and run the container stack once** *(owner)*
      `docker-compose.yml` and both Dockerfiles were written without Docker available on the
      machine, so they have never been built. `docker compose up --build` is the proof.

## 2. Reliability — needed to run it without babysitting

- [ ] **Make a second instance possible** *(code)*
      The rate limiter counts in memory and the rebalance lock is an in-process `Set`, so two
      instances would double limits and could rebalance the same user twice. Move both to
      Redis, which also moves the job scheduler onto BullMQ.
- [ ] **Drain in-flight work on shutdown** *(code)*
      `shutdown()` closes the server and exits without waiting, so a deploy cuts downloads and
      uploads that are mid-stream. Await the close with a timeout.
- [ ] **A readiness probe that checks dependencies** *(code)*
      `/health` only proves the process is alive. A load balancer needs an endpoint that fails
      when PostgreSQL or Redis is unreachable, so traffic stops going to a broken instance.
- [ ] **Make rebalance survive a restart** *(code)*
      It runs as a detached promise with an in-memory lock; a restart halfway leaves the work
      half-applied until someone presses the button again.
- [ ] **Track the Google API quota** *(code)*
      Transient failures are retried with backoff, but nothing watches the per-project quota,
      so the first warning of exhaustion would be users seeing errors.

## 3. Observability — currently nothing

- [ ] **Error tracking** *(code)* — Sentry or equivalent, so exceptions are seen without reading logs.
- [ ] **Metrics endpoint** *(code)* — request rate and latency, job outcomes, drive health, queue depth.
- [ ] **Ship the logs somewhere** *(owner)* — they are structured JSON with request ids on stdout and nothing collects them; after a restart yesterday is gone.
- [ ] **Alerts** *(owner + code)* — a drive offline, a failing job, a rising 5xx rate, chunks reported missing.
- [ ] **Uptime check and a short runbook** *(owner)* — what to do when the API is down, a drive needs reconnecting, or a file reports missing chunks.

## 4. Legal and data rights

- [ ] **Account deletion and data export** *(code)*
      There is no way to delete a user through the API today. Needed for GDPR, and asked about
      during Google verification. Deletion has to remove the chunks from every connected drive
      as well as the rows here.
- [ ] **Written data retention** *(owner)* — trash is 30 days, health checks 90, resolved sync entries 30. Say so publicly.

## 5. Quality gates before opening the doors

- [ ] **End-to-end tests** *(code)* — the integration suite covers the API with Google mocked; nothing drives a browser. `plan/testing-strategy.md` lists five scenarios, including a large-file round trip and surviving a disconnected drive.
- [ ] **A load test** *(code)* — the throughput targets in `plan/testing-strategy.md` §6 have never been measured, and every byte currently passes through the backend.
- [ ] **Accessibility audit** *(code)* — dialogs trap focus and icon buttons are labelled by hand, but axe has never run and no screen reader has been tried.
- [ ] **Raise frontend coverage** *(code)* — about 15%; the services and two components are tested, the pages are not.
- [ ] **A second pair of eyes on the sharing and ownership checks** *(owner)* — share links are the one unauthenticated surface.

## 6. Known scale limits (fine now, will bite later)

- Every chunk passes **through the backend**, so bandwidth is paid for twice. Uploading straight from the browser to Google with a resumable URL removes that.
- **Thumbnails live in PostgreSQL.** Fine for thousands of images, not for millions; they would move to object storage or Redis.
- **Change detection polls** every 10 minutes. Google Drive push notifications would make it immediate.

## 7. Product gaps users will ask about

Drag-and-drop, toast notifications instead of inline banners, thumbnails for PDFs and video,
a per-folder storage mode override, and resuming an upload on a different device.

---

## Suggested order

**First, the owner's track** (mostly waiting on other people): publish the consent screen with
a privacy policy, point a domain with HTTPS at it, move the secrets, and practise a database
restore.

**Then phase 1 in code** — the minimum to run unattended: drain on shutdown, a real readiness
probe, Redis-backed rate limiting and locking, error tracking and metrics, account deletion and
export. None of this depends on the owner's track, so the two can run in parallel.

**Phase 2:** end-to-end tests, a load test, resumable rebalance, quota tracking, accessibility
audit.

**Phase 3:** upload straight to Google from the browser, then the product polish in section 7.
