# Ingestion Drop Folder

This directory is **bind-mounted** into both the `backend` and `worker`
containers at `/app/ingestion_drop` when you run `docker-compose up`.

## Operator workflow

1. Copy your RSS, HTML, or JSON payload file into this folder on the host:

   ```bash
   cp ~/downloads/sports-feed.xml ./ingestion_drop/
   ```

2. The worker scans every `INGESTION_SCAN_INTERVAL_MINUTES` (default: 1 min)
   and picks up files from any source whose `ingest_path` matches this folder.

3. To wire a source to this folder, admins create a `content_sources` row
   via `POST /api/v1/admin/ingestion/sources` with `ingestPath`
   set to `/app/ingestion_drop` (the container-side path).

4. Processed files log events to `immutable_ingestion_logs`; view them via
   `GET /api/v1/admin/ingestion/logs`.

## Overriding the host path

Set `INGESTION_DROP_HOST_DIR` in your `.env` to bind-mount a different host
path (e.g., an NFS share) into the same container path:

```bash
INGESTION_DROP_HOST_DIR=/mnt/sports-ingest docker-compose up --build
```

This folder is gitignored except for `.gitkeep` and this README, so
operator-dropped files never enter version control.
