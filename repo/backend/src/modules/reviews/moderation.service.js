const crypto = require("crypto");
const ApiError = require("../../errors/api-error");
const { pool } = require("../../db/pool");

const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg"];
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

async function ensureUserNotBlacklisted(userId) {
  const [rows] = await pool.query(
    `
      SELECT id
      FROM review_blacklist
      WHERE user_id = ?
        AND is_active = 1
        AND ends_at > CURRENT_TIMESTAMP
      LIMIT 1
    `,
    [userId]
  );

  if (rows.length) {
    throw new ApiError(403, "REVIEW_BLACKLISTED", "User is temporarily blocked from publishing reviews");
  }
}

async function checkSensitiveWords(text) {
  const normalized = String(text || "").toLowerCase();
  const [rows] = await pool.query("SELECT word FROM sensitive_words WHERE is_active = 1");
  const matched = rows.map((row) => row.word).filter((word) => normalized.includes(String(word).toLowerCase()));

  if (matched.length) {
    // Do not expose any match details to the client — aids moderation evasion.
    // The error code SENSITIVE_WORD_DETECTED is sufficient for client handling.
    throw new ApiError(400, "SENSITIVE_WORD_DETECTED", "Content contains restricted words");
  }
}

function decodeAndValidateImage({ base64Data, mimeType, sizeBytes }) {
  if (!ALLOWED_IMAGE_TYPES.includes(mimeType)) {
    throw new ApiError(400, "INVALID_IMAGE_TYPE", "Image must be PNG or JPEG");
  }

  if (!Number.isInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_IMAGE_BYTES) {
    throw new ApiError(400, "INVALID_IMAGE_SIZE", "Image size must be between 1 byte and 5 MB");
  }

  const buffer = Buffer.from(String(base64Data || ""), "base64");
  if (!buffer.length) {
    throw new ApiError(400, "INVALID_IMAGE_PAYLOAD", "Image payload is empty");
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new ApiError(400, "INVALID_IMAGE_SIZE", "Decoded image exceeds 5 MB");
  }

  return buffer;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

async function ensureImageHashAllowed(hash) {
  const [rows] = await pool.query("SELECT id FROM image_hash_denylist WHERE sha256_hash = ? LIMIT 1", [hash]);
  if (rows.length) {
    throw new ApiError(400, "IMAGE_HASH_DENIED", "Image hash is deny-listed");
  }
}

const DAILY_REVIEW_CAP = 2;

async function enforceDailyPublishCap(userId, connection) {
  if (!connection) {
    throw new Error("enforceDailyPublishCap requires a transactional connection");
  }

  // Atomic increment-and-check: the UNIQUE KEY (user_id, quota_date) guarantees
  // that concurrent transactions serialize on the same row via the implicit
  // exclusive lock from INSERT ... ON DUPLICATE KEY UPDATE.
  const [result] = await connection.query(
    `
      INSERT INTO daily_review_quota (user_id, quota_date, used_count)
      VALUES (?, CURRENT_DATE, 1)
      ON DUPLICATE KEY UPDATE used_count = used_count + 1
    `,
    [userId]
  );

  // After the upsert, read back the authoritative count under the row lock.
  const [rows] = await connection.query(
    `
      SELECT used_count
      FROM daily_review_quota
      WHERE user_id = ? AND quota_date = CURRENT_DATE
    `,
    [userId]
  );

  const currentCount = Number(rows[0]?.used_count || 0);
  if (currentCount > DAILY_REVIEW_CAP) {
    // Roll back the increment by throwing — the caller's transaction will rollback.
    throw new ApiError(429, "DAILY_REVIEW_LIMIT", "User can publish at most 2 review items per day");
  }
}

module.exports = {
  ensureUserNotBlacklisted,
  checkSensitiveWords,
  decodeAndValidateImage,
  sha256,
  ensureImageHashAllowed,
  enforceDailyPublishCap,
  ALLOWED_IMAGE_TYPES,
  MAX_IMAGE_BYTES
};
