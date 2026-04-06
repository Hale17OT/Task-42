const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../../db/pool");
const env = require("../../config/env");
const ApiError = require("../../errors/api-error");
const { enqueueJob } = require("../queue/queue.service");
const { parseContentByType, dedupeKeyForItem, normalizeText } = require("./ingestion.logic");
const { writeAuditEvent } = require("../../services/audit-log");

async function screenSensitiveWords(item) {
  const textToCheck = [item.title || "", item.summary || "", item.bodyText || ""]
    .join(" ")
    .toLowerCase();

  const [rows] = await pool.query("SELECT word FROM sensitive_words WHERE is_active = 1");
  return rows
    .map((row) => row.word)
    .filter((word) => textToCheck.includes(String(word).toLowerCase()));
}

function ensureIngestionDir() {
  const dir = path.resolve(env.INGESTION_DROP_DIR);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function immutableEventHash(data) {
  return crypto.createHash("sha256").update(`${Date.now()}|${Math.random()}|${JSON.stringify(data)}`).digest("hex");
}

async function logIngestionEvent({ sourceId, logType, logMessage, payload }) {
  await pool.query(
    `
      INSERT INTO immutable_ingestion_logs (source_id, log_type, log_message, payload_json, event_hash)
      VALUES (?, ?, ?, ?, ?)
    `,
    [sourceId, logType, logMessage, payload ? JSON.stringify(payload) : null, immutableEventHash({ sourceId, logType, logMessage, payload })]
  );
}

async function listContentSources() {
  const [rows] = await pool.query("SELECT * FROM content_sources ORDER BY id ASC");
  return rows;
}

async function createContentSource(payload, actorUserId = null, requestId = null) {
  const [insert] = await pool.query(
    `
      INSERT INTO content_sources (source_name, source_type, ingest_path, allowlisted, blocklisted, rate_limit_per_minute, source_status)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
    [
      payload.sourceName,
      payload.sourceType,
      payload.ingestPath,
      payload.allowlisted ? 1 : 0,
      payload.blocklisted ? 1 : 0,
      payload.rateLimitPerMinute || 60,
      payload.sourceStatus || "active"
    ]
  );

  const [rows] = await pool.query("SELECT * FROM content_sources WHERE id = ? LIMIT 1", [insert.insertId]);
  if (actorUserId) {
    await writeAuditEvent({
      actorUserId,
      eventType: "ingestion.source.created",
      entityType: "content_source",
      entityId: String(insert.insertId),
      requestId,
      payload: { sourceName: payload.sourceName, sourceType: payload.sourceType }
    });
  }
  return rows[0];
}

async function updateContentSource(sourceId, payload, actorUserId = null, requestId = null) {
  const fields = [];
  const values = [];
  const mapping = {
    sourceName: "source_name",
    sourceType: "source_type",
    ingestPath: "ingest_path",
    allowlisted: "allowlisted",
    blocklisted: "blocklisted",
    rateLimitPerMinute: "rate_limit_per_minute",
    sourceStatus: "source_status"
  };

  for (const [key, dbField] of Object.entries(mapping)) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      fields.push(`${dbField} = ?`);
      if (key === "allowlisted" || key === "blocklisted") {
        values.push(payload[key] ? 1 : 0);
      } else {
        values.push(payload[key]);
      }
    }
  }

  if (!fields.length) {
    throw new ApiError(400, "NO_UPDATES", "No updates provided");
  }

  values.push(sourceId);
  await pool.query(`UPDATE content_sources SET ${fields.join(", ")} WHERE id = ?`, values);
  const [rows] = await pool.query("SELECT * FROM content_sources WHERE id = ? LIMIT 1", [sourceId]);
  if (actorUserId) {
    await writeAuditEvent({
      actorUserId,
      eventType: "ingestion.source.updated",
      entityType: "content_source",
      entityId: String(sourceId),
      requestId,
      payload
    });
  }
  return rows[0] || null;
}

async function listIngestionLogs({ sourceId = null, limit = 200 }) {
  const safeLimit = Math.max(1, Math.min(1000, Number(limit) || 200));
  if (sourceId) {
    const [rows] = await pool.query(
      `SELECT * FROM immutable_ingestion_logs WHERE source_id = ? ORDER BY id DESC LIMIT ${safeLimit}`,
      [sourceId]
    );
    return rows;
  }

  const [rows] = await pool.query(`SELECT * FROM immutable_ingestion_logs ORDER BY id DESC LIMIT ${safeLimit}`);
  return rows;
}

async function enqueueIngestionScanJob(actorUserId = null, requestId = null) {
  await enqueueJob({
    jobType: "ingestion_scan_sources",
    payload: { triggeredAt: new Date().toISOString(), actorUserId },
    idempotencyKey: `ingestion_scan_sources:${new Date().toISOString().slice(0, 16)}`,
    maxAttempts: 3
  });

  if (actorUserId) {
    await writeAuditEvent({
      actorUserId,
      eventType: "ingestion.scan.enqueued",
      entityType: "content_source",
      entityId: null,
      requestId
    });
  }
}

function collectFilesRecursive(basePath) {
  const files = [];
  if (!fs.existsSync(basePath)) {
    return files;
  }

  const stack = [basePath];
  while (stack.length) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else {
        files.push(fullPath);
      }
    }
  }

  return files;
}

function fileContentHash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

async function handleIngestionScanSourcesJob() {
  ensureIngestionDir();
  const [sources] = await pool.query(
    `
      SELECT *
      FROM content_sources
      WHERE source_status = 'active'
        AND allowlisted = 1
        AND blocklisted = 0
    `
  );

  for (const source of sources) {
    const basePath = path.resolve(source.ingest_path || env.INGESTION_DROP_DIR);
    const files = collectFilesRecursive(basePath);
    for (const filePath of files) {
      const stats = fs.statSync(filePath);
      const idempotencyKey = `ingest_file:${source.id}:${filePath}:${stats.mtimeMs}`;
      await enqueueJob({
        jobType: "ingestion_process_file",
        payload: { sourceId: source.id, filePath },
        idempotencyKey,
        maxAttempts: 3
      });
    }
  }
}

function sourceKindFromContentSource(sourceType) {
  if (sourceType === "rss") {
    return "rss";
  }
  if (sourceType === "html_extract") {
    return "html_extract";
  }
  return "api_payload";
}

async function handleIngestionProcessFileJob({ sourceId, filePath }) {
  const [sourceRows] = await pool.query("SELECT * FROM content_sources WHERE id = ? LIMIT 1", [sourceId]);
  if (!sourceRows.length) {
    throw new ApiError(404, "SOURCE_NOT_FOUND", "Content source not found");
  }

  const source = sourceRows[0];
  if (source.source_status !== "active" || !source.allowlisted || source.blocklisted) {
    await logIngestionEvent({
      sourceId,
      logType: "filtered",
      logMessage: "Source is disabled or blocked",
      payload: { filePath }
    });
    return;
  }

  if (!fs.existsSync(filePath)) {
    await logIngestionEvent({ sourceId, logType: "failed", logMessage: "File not found", payload: { filePath } });
    throw new ApiError(404, "INGESTION_FILE_MISSING", "Ingestion file missing");
  }

  const content = fs.readFileSync(filePath, "utf8");
  await logIngestionEvent({ sourceId, logType: "detected", logMessage: "Detected ingestion file", payload: { filePath } });

  let parsedItems;
  try {
    parsedItems = parseContentByType({ sourceType: sourceKindFromContentSource(source.source_type), content });
  } catch (error) {
    await logIngestionEvent({ sourceId, logType: "failed", logMessage: "Parsing failed", payload: { error: error.message, filePath } });
    throw error;
  }

  await logIngestionEvent({ sourceId, logType: "parsed", logMessage: "Parsed items from file", payload: { count: parsedItems.length, filePath } });

  for (const item of parsedItems) {
    const contentHash = dedupeKeyForItem(item);
    const [existingRows] = await pool.query("SELECT id FROM ingested_content_items WHERE content_hash = ? LIMIT 1", [contentHash]);
    if (existingRows.length) {
      await logIngestionEvent({
        sourceId,
        logType: "filtered",
        logMessage: "Duplicate item skipped",
        payload: { contentHash, filePath }
      });
      continue;
    }

    // Screen content against sensitive words before publishing
    const sensitiveMatches = await screenSensitiveWords(item);
    const ingestionStatus = sensitiveMatches.length ? "quarantined" : "published";

    if (sensitiveMatches.length) {
      await logIngestionEvent({
        sourceId,
        logType: "moderation_flag",
        logMessage: "Content quarantined: sensitive words detected",
        payload: { contentHash, matchCount: sensitiveMatches.length, filePath }
      });
    }

    const tagList = Array.isArray(item.tags) ? item.tags : [];
    await pool.query(
      `
        INSERT INTO ingested_content_items (
          source_id,
          external_item_id,
          title,
          author_name,
          tag_list_json,
          summary,
          body_text,
          published_at,
          content_hash,
          ingestion_status,
          raw_payload_path
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        sourceId,
        item.externalItemId || null,
        item.title,
        item.authorName || "Unknown",
        JSON.stringify(tagList),
        item.summary || "",
        item.bodyText || item.summary || "",
        item.publishedAt ? new Date(item.publishedAt) : new Date(),
        contentHash,
        ingestionStatus,
        filePath
      ]
    );

    await logIngestionEvent({
      sourceId,
      logType: "stored",
      logMessage: sensitiveMatches.length ? "Stored quarantined item" : "Stored normalized item",
      payload: {
        title: item.title,
        contentHash,
        authorName: normalizeText(item.authorName || "Unknown"),
        ingestionStatus
      }
    });
  }

  await pool.query("UPDATE content_sources SET last_ingested_at = CURRENT_TIMESTAMP WHERE id = ?", [sourceId]);
}

module.exports = {
  listContentSources,
  createContentSource,
  updateContentSource,
  listIngestionLogs,
  enqueueIngestionScanJob,
  handleIngestionScanSourcesJob,
  handleIngestionProcessFileJob,
  logIngestionEvent,
  dedupeKeyForItem,
  fileContentHash
};
