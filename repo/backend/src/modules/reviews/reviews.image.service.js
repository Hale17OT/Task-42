const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { pool } = require("../../db/pool");
const ApiError = require("../../errors/api-error");
const { writeAuditEvent } = require("../../services/audit-log");
const { decodeAndValidateImage, sha256, ensureImageHashAllowed } = require("./moderation.service");
const { ensureCanAccessReviewImage } = require("./reviews.authorization");
const { withTransaction } = require("./reviews.shared");

const REVIEW_UPLOAD_DIR = path.resolve(process.cwd(), "uploads", "reviews");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

async function uploadReviewImage({ userId, reviewId, imagePayload, requestId }) {
  const buffer = decodeAndValidateImage(imagePayload);
  const hash = sha256(buffer);
  await ensureImageHashAllowed(hash);

  const insertId = await withTransaction(pool, async (connection) => {
    const [reviewRows] = await connection.query("SELECT id, user_id, review_state FROM reviews WHERE id = ? LIMIT 1 FOR UPDATE", [reviewId]);
    if (!reviewRows.length) {
      throw new ApiError(404, "REVIEW_NOT_FOUND", "Review not found");
    }

    const review = reviewRows[0];
    if (review.user_id !== userId) {
      throw new ApiError(403, "FORBIDDEN", "Cannot upload images to this review");
    }
    if (review.review_state === "under_arbitration") {
      throw new ApiError(400, "UNDER_ARBITRATION", "Cannot modify review while under arbitration");
    }

    const [countRows] = await connection.query("SELECT COUNT(*) AS total FROM review_images WHERE review_id = ?", [reviewId]);
    const currentCount = Number(countRows[0].total || 0);
    if (currentCount >= 5) {
      throw new ApiError(400, "IMAGE_LIMIT_REACHED", "At most 5 images are allowed per review");
    }

    ensureDir(REVIEW_UPLOAD_DIR);
    const reviewDir = path.join(REVIEW_UPLOAD_DIR, String(reviewId));
    ensureDir(reviewDir);

    const extension = imagePayload.mimeType === "image/png" ? "png" : "jpg";
    const fileName = `${crypto.randomUUID()}.${extension}`;
    const filePath = path.join(reviewDir, fileName);
    fs.writeFileSync(filePath, buffer);

    const [insert] = await connection.query(
      `
        INSERT INTO review_images (review_id, file_path, mime_type, file_size_bytes, sha256_hash, sort_order)
        VALUES (?, ?, ?, ?, ?, ?)
      `,
      [reviewId, filePath, imagePayload.mimeType, buffer.length, hash, currentCount + 1]
    );

    return insert.insertId;
  });

  await writeAuditEvent({
    actorUserId: userId,
    eventType: "review.image.uploaded",
    entityType: "review_image",
    entityId: String(insertId),
    requestId,
    payload: { reviewId, mimeType: imagePayload.mimeType }
  });

  const [rows] = await pool.query("SELECT id, review_id, mime_type, file_size_bytes, sort_order FROM review_images WHERE id = ? LIMIT 1", [
    insertId
  ]);
  return rows[0];
}

async function getReviewImage({ imageId, requester }) {
  const [rows] = await pool.query(
    `
      SELECT ri.id, ri.file_path, ri.mime_type, r.review_state, r.user_id AS review_user_id
      FROM review_images ri
      JOIN reviews r ON r.id = ri.review_id
      WHERE ri.id = ?
      LIMIT 1
    `,
    [imageId]
  );

  if (!rows.length) {
    throw new ApiError(404, "IMAGE_NOT_FOUND", "Review image not found");
  }

  const image = rows[0];
  if (image.review_state === "under_arbitration") {
    throw new ApiError(404, "IMAGE_NOT_FOUND", "Image is hidden during arbitration");
  }

  ensureCanAccessReviewImage({ image, requester });

  if (!fs.existsSync(image.file_path)) {
    throw new ApiError(404, "IMAGE_NOT_FOUND", "Image file not found on disk");
  }

  return image;
}

module.exports = {
  uploadReviewImage,
  getReviewImage
};
