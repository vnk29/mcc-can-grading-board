# Milk Chilling Center — Can Grading Board

A booth-operator tool for grading incoming milk cans at a village dairy collection center. The operator tests each can and accepts or rejects it in under 10 seconds; every test produces an **immutable, timestamped, shareable record** that serves as a single source of truth for resolving disputes with farmers.

This is a 48-hour prototype build. The product is not "a logging app" — it is a **trust layer** between the operator and the farmer.

---

## Problem

When a can is rejected at the booth, there is no reliable, tamper-proof record of the test — only the operator's word. Disputes later in the evening become he-said/she-said with no shared evidence. This app creates an immutable record *at the moment of testing*, fast enough not to slow the line, and clear enough to end a dispute in one glance.

## Users

| User | Need |
|---|---|
| **Booth Operator** | Fastest possible entry, minimal typing, clear pass/fail feedback |
| **Farmer** | Proof of what was tested and why it was rejected, no account needed |
| **Supervisor** | A searchable, filterable, tamper-evident log to resolve disputes |

---

## Getting Started

### Prerequisites
- Node.js 18+
- A Supabase project (free tier works)

### Install & configure
```bash
npm install
cp .env.local.example .env.local
# Fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY from your Supabase project settings
```

### Set up the database
Run the SQL migrations in order against your Supabase Postgres:
1. `supabase/migrations/001_initial_schema.sql` — tables, RLS, immutability policies
2. `supabase/migrations/002_security_fixes.sql` — `auto_decision`, `is_borderline`
3. `supabase/migrations/003_security_fixes.sql` — `borderline_flags`, secure correction RPC
4. `supabase/migrations/004_disputes_and_evidence.sql` — disputes tracking and resolution RPC
5. `supabase/migrations/005_unified_resolution_rpc.sql` — unified correction RPC integration
6. `supabase/migrations/006_operator_access_hardening.sql` — secure `operator_profiles` view
7. `supabase/seed.sql` — demo operators, farmers, and sample data

### Run
```bash
npm run dev      # http://localhost:3000
npm run build    # production build
npm run lint     # eslint
npm run test:grading   # grading engine unit tests
npm run test:queue     # offline queue helper tests
npm run test           # all tests
```

---

## How it works

### Grading engine (`lib/grading.ts`)
A **pure function** `evaluateCanTest()` deterministically grades one can's readings. Identical inputs always produce identical outputs. Rules evaluate in fixed order (fat → SNF → temperature → adulteration) so every applicable reason is always reported.

Thresholds (configurable in `lib/config.ts`):
- Fat ≥ 3.5%
- SNF ≥ 8.5%
- Temperature ≤ 10°C
- Adulteration must be negative

A reading within a small delta of a threshold is flagged **borderline** (does not change the decision — only prompts the operator to double-check). Borderline detection uses precision-safe rounding to dodge JavaScript floating-point errors at decimal boundaries (e.g. `3.6 - 3.5`).

### Immutability
Enforced at **two layers**:
1. **Database** — `can_tests` and `corrections` have no `UPDATE` or `DELETE` RLS policies. The only way to amend a record is to insert a row into `corrections` (append-only), which never modifies the original.
2. **TypeScript** — `Update` is typed as `never` on these tables, so `.update()` queries won't compile.

### Offline resilience
Entries queue in **IndexedDB** (`idb-keyval`) when the network is unavailable and sync automatically on reconnect. The client generates a UUID and `reference_code` *before* going offline; on sync, a Postgres `23505` unique violation is treated as success (idempotent — no duplicates on retry).

### Timestamps
Every record carries two timestamps:
- `test_performed_at` — when the physical test happened on the device (client-supplied). Correct for offline-queued tests. Used on slips and in dispute views.
- `created_at` — when the row reached the database (server-stamped `DEFAULT now()`). Cannot be backdated by the client.

---

## UX trade-offs

- **Operator "login" is name + any non-empty PIN entered in the browser.** The PIN is typed at the client, then sent only when the operator submits a correction through the secure `submit_correction` RPC. The RPC verifies the operator ID + PIN server-side against the `operators` table; the PIN is not persisted on the record, in the correction payload, or in browser storage beyond the active form session. This keeps intake lightweight while preserving server-side authorization for corrections. Trade-off: operator identity at intake is trust-based, which is acceptable for a single-booth prototype but would need real auth for multi-operator centers.
- **Large touch targets, numeric keypads, minimal free-text.** The intake form is optimized for a standing operator with a queue, not a desk worker. Volume/temp/fat/SNF use centered numeric inputs; adulteration is a two-button PASS/FAIL toggle.
- **Rejection slip is generated in-flow, no extra screen.** A rejected can routes straight to a shareable slip (PNG via `html-to-image`, with a QR code linking to the dispute view). The farmer gets concrete proof in the same gesture as the decision.
- **Borderline is flagged, not auto-decided.** A reading near a threshold shows an amber "Review" state with the specific near-limit measurement called out, rather than silently accepting or rejecting.
- **Override requires a reason.** The operator can override the auto-suggested decision, but must supply a reason, and the record is visibly marked as an override with both the system suggestion and final decision shown.

---

## Edge cases handled

- **Duplicate submit** — `submitLock` ref guards the form; UUID + `reference_code` generated once per submission.
- **Offline → online sync without duplication** — idempotent retries via `23505` handling.
- **Borderline readings** — flagged visually, not silently decided; `borderline_flags` persisted to the row.
- **Operator override** — requires a reason, marked `is_override`, both auto and final decisions stored.
- **Missing/malformed inputs** — `INVALID_*` reason codes prevent persistence; the form shows "TEST INCOMPLETE" with the specific problems.
- **Floating-point threshold comparison** — precision-safe rounding (6 decimals) before comparing deltas.
- **No photo evidence** — `photo_url` is nullable; the record and slip remain usable as text-only.
- **Correction authorization** — `submit_correction` is a `SECURITY DEFINER` RPC that verifies operator PIN server-side; the client cannot bypass it.
- **Legacy rows** — `auto_decision` and `is_borderline` are nullable on old rows; the UI degrades gracefully ("Unavailable for this legacy record").
- **Offline metrics & queues** — local IDB items seamlessly merge with remote Supabase records in the daily dashboard and lookup screens so that the operator always sees an accurate local representation.

---

## Tech stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript 5**
- **Tailwind CSS** + hand-rolled shadcn-style UI primitives (`components/ui/`)
- **Supabase** (Postgres + Row Level Security + RPC)
- **idb-keyval** (IndexedDB offline queue)
- **html-to-image** + **qrcode.react** (rejection slip export)
- **date-fns**, **lucide-react**, **uuid**, **cmdk** (farmer search)

---

## Project structure

```
app/
  page.tsx                    # Intake form (operator login + grading)
  dashboard/                  # Daily summary dashboard (liters, disputes, causes)
  disputes/                   # Operator queue to review and settle open disputes
  lookup/                     # Farmer view & record detail
  result/[reference]/         # Post-submit result screen
  slip/[referenceCode]/       # Rejection slip (PNG/PDF export, QR)
components/
  AppHeader.tsx               # Main application navigation header
  BottomNav.tsx               # Mobile-friendly bottom navigation
  SyncStatusBar.tsx           # Persistent online/offline/sync indicator
  ui/                         # Hand-rolled primitives

lib/
  grading.ts                  # Canonical grading engine + mapToDbInsert
  config.ts                   # Quality thresholds
  offlineQueue.ts             # IndexedDB queue + sync engine
  supabase.ts                 # Typed Supabase client
  useNetworkStatus.ts         # Online/offline/sync hook
  __tests__/                  # Unit tests (tsx-based hand-rolled harness)
supabase/
  migrations/                 # 001 schema, 002 audit fields, 003 security
  seed.sql                    # Demo data
types/
  database.ts                 # snake_case DB types, Database map (Update: never)
  index.ts                    # camelCase app types
```

---

## Testing

Tests use a lightweight `tsx`-based harness (no jest/vitest dependency). Run all with `npm run test`.

- `lib/__tests__/grading.test.ts` — grading engine: accept/reject/borderline/invalid/float-precision/DB mapping
- `lib/__tests__/offlineQueue.test.ts` — queue helpers: `isNetworkError` classification, `toAppEntry` mapping

The sync engine itself (`syncPendingEntries`) requires a live Supabase instance and is not covered by unit tests.

---

## Deployment (Vercel)

### 1. Create a Supabase project
1. Go to [app.supabase.com](https://app.supabase.com) and create a new project.
2. From **Project Settings → API**, copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### 2. Run migrations
In the Supabase **SQL Editor**, run each migration file in order:
```sql
-- Paste and run each file in turn:
supabase/migrations/001_initial_schema.sql
supabase/migrations/002_security_fixes.sql
supabase/migrations/003_security_fixes.sql
supabase/migrations/004_disputes_and_evidence.sql
supabase/migrations/005_unified_resolution_rpc.sql
supabase/migrations/006_operator_access_hardening.sql
```
Optionally load demo data: `supabase/seed.sql`

### 3. Deploy to Vercel
1. Push this repository to GitHub/GitLab/Bitbucket.
2. Import the repo in [vercel.com/new](https://vercel.com/new).
3. Add **Environment Variables** in the Vercel project settings:
   | Key | Value |
   |-----|-------|
   | `NEXT_PUBLIC_SUPABASE_URL` | `https://your-project-ref.supabase.co` |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | your anon key |
4. Deploy. Vercel auto-detects Next.js — no `vercel.json` required.

> **Never add the Supabase service-role key to Vercel environment variables** unless you are writing server-only API routes that explicitly need it. This app uses only the anon key.

---

## Future improvements

- Real operator authentication (Supabase Auth) instead of name + PIN
- Photo evidence capture at intake (currently `photo_url` is always null)
- PWA manifest for installable, offline-capable field use
- Multi-center sync and supervisor analytics dashboard
- Configurable thresholds per center (currently global in `lib/config.ts`)
- Integration tests for the sync engine against a ephemeral Postgres/Supabase
- Farmer SMS/WhatsApp notification on rejection (instead of a printed/shared slip)
