# Business Logic Questions Log

Record of questions raised while interpreting the TrailForge Sports Training & Community Portal prompt (`docs/prompt.md`). Format per execution manual: **Question** → **My Understanding** → **Solution**.

---

## 1 Subscribers vs regular users and role matrix

**Question:** The prompt opens with “athletes, subscribers, coaches, and operations staff” but authentication and RBAC name “Regular User” alongside Admin, Coach, and Support Agent. It is unclear whether “subscriber” is a billing/subscription state on the same account type, a separate role, or synonymous with “Regular User.”

**My Understanding:** “Regular User” is the authenticated end-user persona; “subscriber” describes entitlement (paid access to courses/services) implemented as flags or plans on the user record, not a fourth parallel role. Coaches and support are staff roles; operations maps to Admin (and possibly Support Agent) for back office.

**Solution:** Model subscription status and entitlements on `users` (or `user_subscriptions`), keep RBAC to the four named roles, and document in `design.md` that subscriber-only features gate on subscription records, not a separate login role.

---

## 2 Feed “similar items” and 7-day de-duplication

**Question:** The feed must de-duplicate “similar items” seen in the last 7 days, but the prompt does not define similarity (same URL, same source + title, embedding, fuzzy title, tags, etc.).

**My Understanding:** Similarity should be deterministic and explainable for an offline system: prefer normalized URL or stable external id when present; otherwise hash of (source_id, canonical title, primary tag) within a time window.

**Solution:** Store a `dedupe_key` (and optional `content_hash`) on ingested items; on feed assembly, exclude rows whose `dedupe_key` appeared in the user’s impression or feed history in the last 7 days. Document the key construction in design and tune via config, not hidden ML.

---

## 3 Cold-start recommendations (first week)

**Question:** Cold-start behavior is described as “based on selected sports and first-week browsing” without weights, fallback when browsing is empty, or whether recommendations mix with non-recommendation items.

**My Understanding:** First week prioritizes explicitly selected sports and trending/popular items in those sports; if browsing history is empty, rely entirely on sports preferences and safe defaults (featured courses, official announcements).

**Solution:** Implement a scored blend: preference match > light collaborative signals from anonymized aggregates (if available in snapshots) > editorial pins. Expose scoring weights in server config and cap recommendation ratio so the feed still shows timely news and orders.

---

## 4 Block author, block tag, and “Not Interested” persistence

**Question:** Scope and reversibility are not specified: per-user only, whether blocks affect all surfaces (feed only vs reviews vs messages), and whether users can unblock or manage lists.

**My Understanding:** Blocks and “Not Interested” are per regular user, feed-oriented by default; authors/tags blocked in feed should not reappear in that user’s home feed; unblocking is a reasonable UX expectation though not spelled out.

**Solution:** Persist `user_content_prefs` (or separate tables) with type `not_interested | block_author | block_tag`, target ids, and timestamps; apply filters in the feed query layer; add settings UI to list and remove entries. Extend to reviews only if design explicitly requires it.

---

## 5 Activity records: validation and optional fields

**Question:** Running/cycling/walking records list many metrics (duration, distance, calories, HR, pace, etc.) without required vs optional rules, unit constraints beyond miles, or validation when GPX is attached (derive distance vs user-entered).

**My Understanding:** Duration and distance are primary; calories/HR/pace can be optional or derived; if GPX is present, server may compute distance/path summary and flag large discrepancies with user-entered distance.

**Solution:** Define JSON schema / DB constraints: required `type`, `duration_seconds`, `distance_miles`; optional numeric fields nullable; on GPX upload, compute track length and store both user and computed values with optional soft warning in UI (non-blocking unless policy tightens).

---

## 6 GPX “simple coordinate list” display

**Question:** No detail on max points, simplification, elevation, or privacy (show full path vs sampled).

**My Understanding:** Offline portal shows a textual or tabular list of lat/lng (and optional elevation if parsed), possibly paginated or downsampled for large files.

**Solution:** Parse GPX server-side, store normalized points table or JSON blob with cap (e.g. first N points + decimation); API returns paginated coordinates; no map tiles required per prompt.

---

## 7 Reviews: one per order vs follow-up within 30 days

**Question:** Anti-fake rules say “one review per order” but users may “add one follow-up review within 30 days.” It is ambiguous whether the follow-up amends the same review entity, a second row linked to the first, or counts toward “max 2 reviews per day per user.”

**My Understanding:** Initial review is unique per order; follow-up is a child update or second entry tied to the same order with `is_follow_up` and a single allowed window, still one logical “thread” for moderation. Daily cap counts distinct publish actions (initial + follow-up could count as two events).

**Solution:** Schema: `reviews` with `parent_review_id` null for primary, non-null for follow-up; enforce one primary per order and at most one follow-up within 30 days; increment daily review count on each published body (initial and follow-up) to respect max 2/day.

---

## 8 Review dimensions: scoring rules

**Question:** Configurable dimensions (e.g. punctuality) do not state whether each dimension is mandatory, 1–5 only, or aggregated into the headline 1–5 rating.

**My Understanding:** Headline 1–5 is the main rating; dimensions are optional sub-scores configured by Admin, averaged or weighted into reporting, not necessarily blocking submission if omitted when optional.

**Solution:** `review_dimensions` config defines name, weight, required flag; store `review_dimension_scores` per review; default new dimensions to optional unless Admin marks required; service-quality analytics use weighted aggregates.

---

## 9 Anonymous vs real-name display and coach replies

**Question:** Unclear whether anonymous reviews show handle to staff internally, and whether threading exposes identity to coaches.

**My Understanding:** Public display respects user choice; internal tooling shows true identity for moderation and support; coach-facing thread may show display mode per policy (e.g. “Member (anonymous)” with id available only to support).

**Solution:** Store `display_mode` and always persist `user_id` for ACL; API layers strip PII for public/coach views according to role; document in api-spec and RBAC matrix.

---

## 10 Appeals (7 days) and arbitration lifecycle

**Question:** “Arbitration timeline and status messages” lacks states, who acts (Support vs Admin), final outcomes (uphold, overturn, partial), and whether the original review stays visible during arbitration.

**My Understanding:** Appeal creates a case linked to the review; Support/Admin workflow updates status; content governance hides or masks disputed content from public per “display rules that hide content under arbitration.”

**Solution:** State machine: `open → under_review → resolved (upheld|overturned|withdrawn)` with SLA timestamps; `review_visibility` tied to state; in-app messages and email-style notifications simulated as in-app toasts/banners only if offline scope allows.

---

## 11 Sensitive words, image deny list, and enforcement

**Question:** Dictionary behavior (reject vs mask vs queue), image hash list update process, and whether appeals bypass automated blocks are unspecified.

**My Understanding:** Server rejects or quarantines violating text on create/update; images validated MIME + size + perceptual/hash deny list; high-risk flows may flag for manual queue without blocking publish depending on severity (configurable).

**Solution:** Implement reject-with-message for clear violations; optional `pending_moderation` state for borderline; store `media_hash` on upload checks; Admin UI to maintain dictionary and hash entries; log all decisions in immutable audit fields.

---

## 12 High-risk users (3 upheld violations) and 30-day review blacklist

**Question:** “Upheld violations” scope (appeals only vs any sanction), whether blacklist is global, and interaction with orders already placed are not defined.

**My Understanding:** Three upheld appeals against the user’s content or three upheld policy violations in a defined window tag the account as high-risk; blacklist prevents new reviews for 30 days but does not void historical reviews.

**Solution:** `user_risk_flags` with counters and `review_banned_until`; enforce on review POST; cron or job clears ban after window; violations table ties to appeal/policy outcomes only as defined in config.

---

## 13 Device fingerprint and multi-account risk flag

**Question:** How fingerprint is generated in a privacy-sensitive, offline context, and false-positive handling are not specified.

**My Understanding:** Use coarse server-side signals available without third-party services: hashed user-agent + accept headers + optional app-generated stable id stored in local storage with consent implied by login—documented as weak device binding.

**Solution:** Store `device_id_hash` on session/login; flag when distinct user_ids exceed threshold per hash in rolling window; surface to Admin as risk signal, not auto-ban; avoid collecting unnecessary PII.

---

## 14 Offline ledger: WeChat Pay import format and signatures

**Question:** Batch reconciliation file format, signature algorithm, and public key storage are not in the prompt.

**My Understanding:** Define a canonical CSV/JSON import schema and PKCS or HMAC verification using keys provisioned via seeded config in container (no interactive setup per delivery rules—ship example keys for dev, document prod rotation).

**Solution:** Document file layout in `design.md`; implement parser + verifier interface with pluggable algorithm; idempotency keys on ledger rows; compensation jobs read MySQL queue table as specified.

---

## 15 Partial refunds, $0.01 granularity, and order consistency

**Question:** Interaction between auto-cancel (30 minutes unpaid) and late-arriving payment imports, and rounding rules for partial refunds, are underspecified.

**My Understanding:** Idempotency keys prevent double application; unpaid auto-cancel is a terminal state; late payment creates exception workflow or reversal transaction rows; amounts stored as integer cents supporting $0.01.

**Solution:** Monetary fields in minor units; state machine for orders; reconciliation job matches external refs and emits compensating ledger entries; retries documented in queue worker.

---

## 16 News ingestion: duplicates, allow/block, and failure retries

**Question:** Whether duplicate articles across RSS and HTML extracts merge, and how allow/block interacts with already-stored items, are not stated.

**My Understanding:** Normalize URL/id; upsert by stable key; block list prevents new ingest; allow list restricts sources when in strict mode; three retries with backoff then dead-letter folder or log entry.

**Solution:** Ingestion pipeline writes immutable logs; items keyed by `source_id + external_id`; scheduled job configuration for retries; monitor folder drops as described.

---

## 17 Analytics CSV export and PII

**Question:** “Access logging” depth and whether exports include personal data are not specified.

**My Understanding:** Exports aggregate operational metrics; access log records who exported when, with filters applied; direct PII only if dimension requires it and role is authorized.

**Solution:** `analytics_export_log` table; CSV builders for funnel, popularity, renewal/refund, channel, instructor utilization, location revenue/cost; Admin-only routes with audit.

---

## 18 “Operations staff” vs system roles

**Question:** Whether all back-office users are Admins or a subset is read-only analytics is unclear.

**My Understanding:** “Operations staff” maps to Admin for configuration and exports, and Support Agent for customer-facing dispute workflows; fine-grained permissions can split read-only reporting if needed.

**Solution:** Permission matrix in design: Admin (dimensions, dictionaries, blacklists), Support (appeals, threads), Coach (replies, courses), Regular User (self-service); optional `analyst_readonly` later if scope allows.
