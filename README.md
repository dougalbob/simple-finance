# Simple Finance

A private household finance app for two people, running on the household's own server (Unraid, Docker,
Cloudflare Access in front). It records what actually happened, keeps reported balances honestly labelled
as checkpoints, projects the shape of the month ahead, and warns before the dates that cost money to
miss.

- **Built for:** one household of two adults, one Unraid box, one Cloudflare Access application, no cloud
  account, no bank connection.
- **Not built for:** anyone else. There is no sign-up, no multi-tenancy, no telemetry, no external
  services. The app talks to nothing but its own SQLite database and filesystem.
- **Status:** Phases 0–5 are merged and released, and **v0.8.0 is the published image** (`latest` on the
  registry). **v0.8.0 makes the app installable as a PWA** — a web app manifest and icons (no service worker,
  no offline caching, no offline queue). Android Chrome offers Install; iOS Safari → Share → Add to Home Screen
  gives the icon and a standalone window. The manifest and icon paths are served without Access credentials via
  a path-scoped Bypass → Everyone policy; every other URL remains behind the email-policy app. Merging a pull
  request publishes nothing on its own — the lower-case tag does. See
  [`docs/HANDOFF.md`](docs/HANDOFF.md) and
  [`docs/RELEASE_NOTES_v0.8.0.md`](docs/RELEASE_NOTES_v0.8.0.md).
- **Docs:** [`docs/HANDOFF.md`](docs/HANDOFF.md) (continuation point — read this first),
  [`docs/SPEC.md`](docs/SPEC.md) (product spec), [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
  (plan + decision log). [`AGENT_APP_BLUEPRINT.md`](AGENT_APP_BLUEPRINT.md) is the engineering contract from
  the initial build through the first release; it is historical context, not required reading for ongoing work.

## What the app will be (and won't be)

- **Will:** fast mobile entry at the till (supplier memory, splits, visible one-tap defaults); user-reported
  checkpoints with honest labels; a payday projection with pessimistic day-to-day behaviour; recurring
  schedule instances that convert automatically; two-tier warnings; renewal and contract-end alerts;
  receipt/invoice attachments kept with the record they belong to, and removable without breaking a later
  backup; encrypted, restorable backups that include the receipts still attached.
- **Won't:** connect to a bank or read statements; move money; recommend products; share or upload
  anything; run as more than one household.

## Install (Unraid)

The supported path is the Unraid container template. The household's data lives in one directory,
`/mnt/user/appdata/simple-finance`, which maps to `/data` in the container.

1. **Create the appdata directory and its config file.**
   ```
   mkdir -p /mnt/user/appdata/simple-finance
   cp .env.example /mnt/user/appdata/simple-finance/.env
   chmod 600 /mnt/user/appdata/simple-finance/.env
   ```
2. **Fill in `/data/.env`** — the two Cloudflare Access values and the two allowed household e-mail
   addresses (`AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_ALLOWED_EMAILS`). The file is sourced by the
   entrypoint on every start and overrides the template; keep it owned by `root`/`99:100` and unreadable by
   anyone else. `.env.example` explains every variable, including the optional `DOCUMENTS_DIR`.
3. **Add the template in Unraid.** Docker → Templates → *Add Container*, then paste the template URL
   `https://raw.githubusercontent.com/dougalbob/simple-finance/main/simple-finance.xml` (or copy the file
   into `/boot/config/plugins/dockerMan/templates-user/`). Set a free host port (the template defaults to
   `3000`; do not reuse another container's port) and leave `PUID`/`PGID` at `99`/`100` unless the array
   uses different ownership.
4. **Start the container.** The entrypoint aligns `/data` ownership, applies migrations, then runs the
   server as `PUID:PGID` — never as root. The health endpoint is `/api/health`.
5. **Set up Cloudflare Access with two applications:**

   **First app — hostname-wide, email policy.** This is the main Access application protecting the
   published port. It uses a Google sign-in policy with the two authorised household email addresses
   as the allowlist. Point the hostname at the same origin as `AUTH_ISSUER`. Until `AUTH_ISSUER`,
   `AUTH_AUDIENCE` and `AUTH_ALLOWED_EMAILS` are set, the app refuses everyone (fail closed,
   `docs/SPEC.md` §3).

   **Second app — path-scoped, Bypass → Everyone.** A separate Access application for the four
   PWA asset paths. Set the **application domain** to the same hostname as above but configure it
   with the following specific paths under Bypass → Everyone:
   - `/<host>/manifest.webmanifest`
   - `/<host>/icon-192.png`
   - `/<host>/icon-512.png`
   - `/<host>/apple-touch-icon.png`

   Remove any legacy `/sw.js` destination — no service worker ships, and a public 404 is worse than
   no destination at all. Keep this app's bypass scoped to those four paths and nothing else.

   **Access sessions default to 24 hours.** If daily re-authentication on the home-screen app is
   unwelcome, the application session duration can be raised to up to one month in the main app's
   Access settings.

   **Sanity check** (replace `<host>` with the real hostname):
   ```
   curl -sI https://<host>/manifest.webmanifest
   ```
   This should return `200` with `Content-Type: application/manifest+json` — and no Cloudflare
   Access login redirect. Every other URL (including `/`) should still ask for sign-in.

6. **Open the app in a browser** and sign in through Cloudflare Access. On first run the Overview/Household
   panels ask for the two people and any vehicles (household data is never seeded); categories already
   exist because they are product content, not household data.

### Updating

The image is published to GHCR as `ghcr.io/dougalbob/simple-finance` — `vX.Y.Z`, `latest`, and
`sha-<short>` all point at the same digest. In Unraid, Docker → check the container → **Force Update**
(or `docker pull ghcr.io/dougalbob/simple-finance:latest`), then start it again. Migrations run on
startup and are additive; there is no downgrade path, so **take a backup from Settings before updating**
if the release notes say the database changed. Nothing is published by merging a pull request — a release
is a `vX.Y.Z` tag, and the workflow refuses to push an image whose version does not match the tag.

### Local development

```
npm ci            # plain install (CI uses this; the sandbox here uses --ignore-scripts)
cp .env.example .env
npm run db:migrate
npm run dev       # http://localhost:3000 with the dev identity bypass
```

`AUTH_DEV_BYPASS=true` with `NODE_ENV` anything other than `production` signs every request in as the
configured development identity; a production build ignores the bypass entirely.

## Everyday use

- **At the till (phone):** Quick entry → Purchase — supplier (with its remembered category), total, split
  lines so the total matches exactly, paid-by, date, optional note, optional receipt photo.
- **Cash and bank checks:** Quick entry → Balance ("Balance now" = ledger balance for a bank, counted
  amount for cash). Checkpoints are labelled as checkpoints, and never as a bank balance.
- **Fuel:** Quick entry → Fuel for a vehicle.
- **Income (laptop):** `/income` — the salary that repeats, scheduled for its day of the month and
  corrected in place (a change applies from the next instance onward), plus one-off money recorded by
  hand: something you sold, a refund, a gift, a one-off job. Cash or bank transfer is simply which pot
  it landed in. A payday that falls on a Saturday or Sunday is expected on the Friday before. Income
  is not spending: it has no category, never appears in an insight, and shows up in All Transactions
  as `BAC`.
- **Moving money:** Quick entry → Move — between your own pots (a cash handover from one of you to the
  other is a transfer here, not a mystery), borrowing and repayments against someone you track on
  `/pots`, a swap with someone outside the household (cash one way, bank transfer the other), or other
  money in/out with a note saying what it was. Borrowing is always shown as owed beside "available
  now" — never as income — and repayments are never spending.
- **Reviewing:** `/purchases` filters and inline edit/refund/void (a purchase record is never deleted —
  the history is kept). A receipt attached to a purchase can be removed from Purchases, Overview or
  Suppliers; that removal is in the purchase's History, the file leaves `documents/`, and an older backup
  is the only way to get it back. `/recurring` shows the month calendar and the schedule list,
  `/contracts` shows contract ends and renewals with the follow-ups you promised.
- **All activity in one pot:** `/transactions` — a read-only list of everything that touched a chosen
  account or cash pot between two dates: purchases, direct debits and standing orders, transfers,
  borrowing and repayments, swaps and other money, and **income** (`BAC`), in one amount column (green
  in, red out relative to that pot), with the original note, checkpoint dividers and a link from every
  row to the page that can still edit or void it. Nothing on that page writes anything.
- **Insights:** `/insights` — month comparison, per-person attribution, vehicle running costs, and the
  honesty loop that compares configured figures with recent complete periods.
- **Charts:** `/charts` — the same figures drawn: the month ahead (household total, with zero always on the
  axis and the overdraft limit marked), the weekly shop against the configured figure and the trailing
  8-week average, personal spending per person per month with the household's shared spending kept
  separate, and the fixed commitments over the child categories ticked in Settings. Hand-rolled SVG, no
  client JavaScript, a table of the exact numbers under every chart, and a link from every bar to the
  purchases behind it.

## Backup, restore and recovery

The Settings page holds the whole capability; nothing is automatic and nothing leaves the house.

- **Backup** takes a password (at least 12 characters, never stored) and downloads
  `simple-finance-backup-v<version>-<local timestamp>.simple-finance-backup` — an AES-256-GCM archive
  (scrypt key derivation, `SFBA` frame) containing the database snapshot, every attachment the snapshot
  references, and a `manifest.json` listing counts, sizes and sha256 values. If the snapshot references an
  attachment that is missing on disk, the backup **fails loudly** instead of producing an archive that
  only looks complete; unreferenced files are listed as orphans and left alone. Store the archive and the
  password in two different places.
- **Restore** replaces **everything** — database and attachments — from an archive. The form requires the
  archive's password and the typed word `RESTORE`. Before anything is swapped, every member is checked
  against the manifest (size, sha256, member allowlist) and the restored database is checked for the
  attachments it references; if any check fails, the running installation is untouched. On success the
  previous database and documents directory are kept beside the new ones as `.pre-restore-<stamp>`.
- **Recovery checklist** (if a restore is interrupted or the app will not start). Both the database and
  the documents directory are preserved under `.pre-restore-<stamp>…` names next to the live ones:
  1. Stop the container. List the `/data` directory and note the preserved names (for example
     `simple-finance.sqlite.pre-restore-20260921-143012` and
     `documents.pre-restore-20260921-143012/`; the WAL sidecars are preserved the same way).
  2. Move the live files aside — never overwrite them in place — then rename the preserved copies back to
     `simple-finance.sqlite` and `documents/`.
  3. Start the container and confirm the app shows the expected data; only then tidy up the copies you
     no longer need. The app itself never deletes the last recoverable copy on any error path.

## Stack (as built)

Next.js 16 (App Router, React 19) · TypeScript strict · Tailwind CSS · SQLite via better-sqlite3 + Drizzle
ORM with checked-in SQL migrations · `jose` for Cloudflare Access JWT verification · Zod at the server
boundary · Node's built-in test runner through `tsx` · Playwright for the browser acceptance suite.
Domain engines (`estimates`, `projection`, `keydates`, `insights`, `chart-series`, `dates`) are
framework-free pure modules with DST and boundary tests.

## Gates

The same commands CI runs, all from the repository root:

```
npm ci                 # CI uses a plain install; this sandbox needs --ignore-scripts
npm run format:check   # Prettier (markdown is excluded deliberately)
npm run typecheck      # tsc --noEmit
npm test               # Node test runner: 340 tests across 85 suites
npm run build          # production build (Turbopack)
npm audit --omit=dev   # production dependencies must report 0 vulnerabilities
npm run test:e2e       # browser acceptance suite (needs: npx playwright install --with-deps chromium)
```

The browser suite runs in CI's `browser` job; the release workflow smoke-tests the built image (health,
unprivileged uid, database survival across recreation) before pushing it to GHCR. `npm audit` will suggest
`npm audit fix --force` for four moderate advisories in the dev-only drizzle-kit/esbuild chain — **do not
run it**: it downgrades drizzle-kit to 0.18.1.

## Privacy — this repository is public

No real names, balances, receipts or addresses exist anywhere in this repository, and none may be added —
not in code, tests, fixtures, screenshots, issues or pull requests. `.env.example` holds placeholders only.
Real configuration lives in `/data/.env` inside the private installation, and real data never leaves
`/data`.

## Version

The app version is `v0.8.0` and is shown in the navigation bar. `package.json`, `src/lib/version.ts` and the
release tag must agree; the publish workflow refuses to push an image when they do not.

The tag must be lower-case `vX.Y.Z` *and must sit on a commit that already carries that version*. The first
`v0.1.4` tag pointed at the PR #13 merge, whose `package.json` still said `0.1.3`; the run reached the
version check, refused, and pushed nothing. Both the workflow's `on.push.tags` filter and its version check
(`test "v${PKG_VERSION}" = "$VERSION"`) reject a capital `V` — which is why the `V0.1.1` tag never published an
image and the registry held only v0.1.0 until v0.1.2.
