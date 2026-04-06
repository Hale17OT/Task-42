const { pool } = require("../../db/pool");
const ApiError = require("../../errors/api-error");
const { canAppeal } = require("./review.rules");
const { ensureCanAccessReviewDetail } = require("./reviews.authorization");

function toReviewImagePreviews(imageRows) {
  const imagesByReview = new Map();
  for (const image of imageRows) {
    if (!imagesByReview.has(image.review_id)) {
      imagesByReview.set(image.review_id, []);
    }
    imagesByReview.get(image.review_id).push({
      id: image.id,
      mimeType: image.mime_type,
      url: `/api/v1/reviews/images/${image.id}`
    });
  }
  return imagesByReview;
}

function toFollowupsByReview(followupRows) {
  const followupByReview = new Map();
  for (const followup of followupRows) {
    followupByReview.set(followup.review_id, {
      id: followup.id,
      followupText: followup.followup_text,
      createdAt: followup.created_at
    });
  }
  return followupByReview;
}

async function getReviewDetail({ reviewId, requester }) {
  const [reviewRows] = await pool.query(
    `
      SELECT r.*, u.username, p.display_name
      FROM reviews r
      JOIN users u ON u.id = r.user_id
      LEFT JOIN user_profiles p ON p.user_id = r.user_id
      WHERE r.id = ?
      LIMIT 1
    `,
    [reviewId]
  );
  if (!reviewRows.length) {
    throw new ApiError(404, "REVIEW_NOT_FOUND", "Review not found");
  }

  const review = reviewRows[0];
  ensureCanAccessReviewDetail({ review, requester });

  const hidden = review.review_state === "under_arbitration";
  const displayName = review.anonymous_display ? "Anonymous User" : review.display_name || review.username;

  const [dimensionRows] = await pool.query(
    `
      SELECT ds.dimension_config_id, ds.score, dc.label, dc.key_name
      FROM review_dimension_scores ds
      JOIN review_dimension_configs dc ON dc.id = ds.dimension_config_id
      WHERE ds.review_id = ?
    `,
    [reviewId]
  );
  const [imageRows] = await pool.query(
    "SELECT id, mime_type, file_size_bytes, sort_order FROM review_images WHERE review_id = ? ORDER BY sort_order ASC, id ASC",
    [reviewId]
  );
  const [followupRows] = await pool.query("SELECT * FROM review_followups WHERE review_id = ? LIMIT 1", [reviewId]);
  const [replyRows] = await pool.query(
    `
      SELECT rr.id, rr.parent_reply_id, rr.reply_text, rr.created_at, rr.author_role, u.username
      FROM review_replies rr
      JOIN users u ON u.id = rr.author_user_id
      WHERE rr.review_id = ?
      ORDER BY rr.id ASC
    `,
    [reviewId]
  );
  const [appealRows] = await pool.query("SELECT * FROM appeals WHERE review_id = ? ORDER BY id DESC", [reviewId]);
  const appeal = appealRows[0] || null;

  let timeline = [];
  if (appeal) {
    const [timelineRows] = await pool.query(
      "SELECT event_type, event_status, event_note, created_at FROM appeal_timeline_events WHERE appeal_id = ? ORDER BY id ASC",
      [appeal.id]
    );
    timeline = timelineRows;
  }

  const hasOpenAppeal = appeal && (appeal.appeal_status === "submitted" || appeal.appeal_status === "under_review");
  const canAppealNow = requester && requester.id === review.user_id && canAppeal(review.published_at) && !hasOpenAppeal;

  return {
    id: review.id,
    orderId: review.order_id,
    userId: review.user_id,
    rating: review.rating,
    reviewState: review.review_state,
    displayName,
    anonymousDisplay: Boolean(review.anonymous_display),
    reviewText: hidden ? "Content hidden during arbitration" : review.review_text,
    publishedAt: review.published_at,
    dimensions: dimensionRows,
    images: hidden ? [] : imageRows,
    followup: hidden ? null : followupRows[0] || null,
    replies: replyRows,
    appeal: appeal
      ? {
          id: appeal.id,
          status: appeal.appeal_status,
          submittedAt: appeal.submitted_at,
          resolvedAt: appeal.resolved_at,
          timeline
        }
      : null,
    canAppeal: Boolean(canAppealNow)
  };
}

async function listUserReviews(userId) {
  const [rows] = await pool.query(
    `
      SELECT r.id, r.order_id, r.rating, r.review_state, r.anonymous_display, r.review_text, r.published_at, r.created_at,
             o.order_status
      FROM reviews r
      JOIN orders o ON o.id = r.order_id
      WHERE r.user_id = ?
      ORDER BY r.id DESC
    `,
    [userId]
  );

  if (!rows.length) {
    return [];
  }

  const reviewIds = rows.map((row) => row.id);
  const [imageRows] = await pool.query(
    `
      SELECT review_id, id, mime_type, sort_order
      FROM review_images
      WHERE review_id IN (?)
      ORDER BY review_id ASC, sort_order ASC, id ASC
    `,
    [reviewIds]
  );
  const [followupRows] = await pool.query(
    `
      SELECT id, review_id, followup_text, created_at
      FROM review_followups
      WHERE review_id IN (?)
    `,
    [reviewIds]
  );

  const imagesByReview = toReviewImagePreviews(imageRows);
  const followupByReview = toFollowupsByReview(followupRows);

  return rows.map((row) => {
    const hidden = row.review_state === "under_arbitration";
    const images = hidden ? [] : imagesByReview.get(row.id) || [];
    return {
      ...row,
      review_text: hidden ? "Content hidden during arbitration" : row.review_text,
      image_count: images.length,
      image_previews: images.slice(0, 3),
      followup: hidden ? null : followupByReview.get(row.id) || null
    };
  });
}

module.exports = {
  getReviewDetail,
  listUserReviews,
  toReviewImagePreviews,
  toFollowupsByReview
};
