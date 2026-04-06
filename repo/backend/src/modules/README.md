# Backend Module Structure

This directory contains the implemented feature modules for the TrailForge backend.

## Modules

- **auth** - Session-based authentication, registration, login with rate limiting and device fingerprinting
- **admin** - Admin-only endpoints (job triggers, system operations)
- **users** - User profile management
- **orders** - Order lifecycle (creation, status transitions, auto-cancel)
- **payments** - Payment reconciliation imports, refund processing, ledger entries
- **reviews** - Review CRUD, dimension scoring, image uploads, followups, appeals, staff replies, moderation, risk escalation, governance
- **activities** - Activity tracking, GPX upload/parsing, places management
- **follows** - User follow graph
- **feed** - Personalized feed with deduplication, impression tracking, preference management
- **ingestion** - Content source management, file scanning, rate-limited ingest pipeline
- **catalog** - Course/service catalog browsing
- **analytics** - Dashboard metrics, reports (enrollment funnel, popularity, renewal/refund rates), CSV export with audit logging
- **queue** - Background job queue service used by the worker process
