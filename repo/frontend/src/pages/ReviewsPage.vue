<template>
  <section class="card page reviews-page">
    <div class="page-header">
      <div>
        <h2>Reviews</h2>
        <p class="meta">
          View published reviews, follow-ups, appeals, and staff replies.
        </p>
      </div>
      <div class="toolbar">
        <router-link class="nav-link" to="/reviews/new"
          >Create Review</router-link
        >
        <button class="ghost" @click="bootstrap">Refresh</button>
      </div>
    </div>

    <p v-if="loading" class="meta">Loading reviews...</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <section v-else-if="!reviews.length" class="empty-state">
      <h3>No reviews yet</h3>
      <p class="meta">Complete an order, then publish your first review.</p>
      <div class="toolbar" style="justify-content: center">
        <router-link class="nav-link" to="/reviews/new"
          >Create Review</router-link
        >
      </div>
    </section>

    <ul v-else class="list section-surface">
      <li v-for="review in reviews" :key="review.id" class="card">
        <div class="row between">
          <strong
            >Review #{{ review.id }} · Order #{{ review.order_id }}</strong
          >
          <span
            class="status-pill"
            :class="reviewStateClass(review.review_state)"
            >{{ readableReviewState(review.review_state) }}</span
          >
        </div>
        <p class="meta">Rating {{ review.rating }}/5</p>
        <p>{{ review.review_text }}</p>

        <section v-if="review.image_previews?.length" class="image-strip">
          <img
            v-for="image in review.image_previews"
            :key="image.id"
            :src="imageSrc(image)"
            alt="Review image"
            loading="lazy"
            @error="hideBrokenImage"
          />
          <span v-if="review.image_count > review.image_previews.length" class="chip muted">
            +{{ review.image_count - review.image_previews.length }} more
          </span>
        </section>

        <section v-if="review.followup" class="followup-display">
          <p class="meta"><strong>Follow-up:</strong></p>
          <p>{{ review.followup.followupText }}</p>
        </section>

        <div class="row gap wrap">
          <button class="ghost" @click="loadDetail(review.id)">
            View Detail
          </button>
          <button class="ghost" :disabled="Boolean(review.followup)" @click="toggleFollowupEditor(review.id)">
            {{ review.followup ? "Follow-up Added" : "Add Follow-up" }}
          </button>
          <button class="ghost" :disabled="appealLoadingByReviewId[review.id] || !isAppealAllowed(review)" @click="appeal(review.id)">
            {{ appealLoadingByReviewId[review.id] ? "Submitting Appeal..." : "Appeal" }}
          </button>
        </div>
        <p v-if="!isAppealAllowed(review)" class="meta">{{ appealBlockedReason(review) }}</p>

        <section v-if="followupOpenByReviewId[review.id] && !review.followup" class="followup-editor">
          <label>
            Follow-up Text
            <textarea
              v-model="followupDraftByReviewId[review.id]"
              maxlength="3000"
              placeholder="Add context after your original review"
            />
          </label>
          <div class="table-actions">
            <button :disabled="followupLoadingByReviewId[review.id]" @click="submitFollowup(review.id)">
              {{ followupLoadingByReviewId[review.id] ? "Submitting..." : "Submit Follow-up" }}
            </button>
            <button class="ghost" @click="toggleFollowupEditor(review.id)">Cancel</button>
          </div>
        </section>

        <section v-if="detailByReviewId[review.id]" class="detail-panel">
          <p>
            <strong>Display Name:</strong>
            {{ detailByReviewId[review.id].displayName }}
          </p>
          <p>
            <strong>Can Appeal:</strong>
            {{ detailByReviewId[review.id].canAppeal ? "Yes" : "No" }}
          </p>

          <p><strong>Timeline:</strong></p>
          <ul
            class="coords-list"
            v-if="detailByReviewId[review.id].appeal?.timeline?.length"
          >
            <li
              v-for="event in detailByReviewId[review.id].appeal.timeline"
              :key="event.created_at + event.event_status"
            >
              {{ event.event_status }} -
              {{ event.event_note || event.event_type }}
            </li>
          </ul>
          <p v-else class="meta">No arbitration timeline yet.</p>

          <p><strong>Replies:</strong></p>
          <ul
            class="coords-list"
            v-if="
              flattenReplies(detailByReviewId[review.id].replies || []).length
            "
          >
            <li
              v-for="reply in flattenReplies(
                detailByReviewId[review.id].replies || [],
              )"
              :key="reply.id"
            >
              {{ "— ".repeat(reply.depth) }}[{{ reply.author_role }}]
              {{ reply.username }}: {{ reply.reply_text }}
            </li>
          </ul>
          <p v-else class="meta">No staff replies yet.</p>
        </section>
      </li>
    </ul>
  </section>
</template>

<script setup>
import { onMounted, reactive, ref } from "vue";
import {
  API_BASE,
  listMyReviews,
  addReviewFollowup,
  createAppeal,
  getReviewDetail,
} from "../api";
import { useToast } from "../toast";
import { isLikelyOfflineError, recordOfflineIntent, buildOfflineRetryMessage } from "../offline/mutation-intents";

const loading = ref(false);
const error = ref("");
const reviews = ref([]);
const detailByReviewId = reactive({});
const followupDraftByReviewId = reactive({});
const followupOpenByReviewId = reactive({});
const followupLoadingByReviewId = reactive({});
const appealLoadingByReviewId = reactive({});
const { pushToast } = useToast();
const APPEAL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

async function bootstrap() {
  loading.value = true;
  error.value = "";
  try {
    const response = await listMyReviews();
    reviews.value = response.data || [];
    await Promise.allSettled(reviews.value.map((review) => loadDetail(review.id, { silent: true })));
  } catch (err) {
    error.value = err.message || "Failed to load review data";
  } finally {
    loading.value = false;
  }
}

function toggleFollowupEditor(reviewId) {
  followupOpenByReviewId[reviewId] = !followupOpenByReviewId[reviewId];
  if (!followupOpenByReviewId[reviewId]) {
    followupDraftByReviewId[reviewId] = "";
  }
}

async function submitFollowup(reviewId) {
  if (followupLoadingByReviewId[reviewId]) {
    return;
  }

  const text = String(followupDraftByReviewId[reviewId] || "").trim();
  if (!text) {
    pushToast("Enter follow-up text before submitting", "error");
    return;
  }

  followupLoadingByReviewId[reviewId] = true;
  try {
    const response = await addReviewFollowup(reviewId, {
      followupText: text,
    });

    const idx = reviews.value.findIndex((item) => item.id === reviewId);
    if (idx >= 0) {
      reviews.value[idx] = {
        ...reviews.value[idx],
        followup: {
          id: response.data?.id,
          followupText: response.data?.followup_text,
          createdAt: response.data?.created_at,
        },
      };
    }

    pushToast("Follow-up added", "success");
    followupDraftByReviewId[reviewId] = "";
    followupOpenByReviewId[reviewId] = false;
    await loadDetail(reviewId);
  } catch (err) {
    if (isLikelyOfflineError(err)) {
      recordOfflineIntent("review_followup", { reviewId, followupText: text });
      pushToast(buildOfflineRetryMessage("Review follow-up"), "error");
    } else {
      pushToast(err.message || "Follow-up failed", "error");
    }
  } finally {
    followupLoadingByReviewId[reviewId] = false;
  }
}

async function appeal(reviewId) {
  const review = reviews.value.find((item) => item.id === reviewId);
  if (review && !isAppealAllowed(review)) {
    pushToast(appealBlockedReason(review), "error");
    return;
  }

  if (appealLoadingByReviewId[reviewId]) {
    return;
  }

  appealLoadingByReviewId[reviewId] = true;
  try {
    const appealReason = "Requesting arbitration review from frontend";
    await createAppeal(reviewId, { reason: appealReason });
    pushToast("Appeal submitted", "success");
    await bootstrap();
    await loadDetail(reviewId);
  } catch (err) {
    if (isLikelyOfflineError(err)) {
      recordOfflineIntent("review_appeal", {
        reviewId,
        reason: "Requesting arbitration review from frontend"
      });
      pushToast(buildOfflineRetryMessage("Appeal"), "error");
    } else {
      pushToast(err.message || "Appeal failed", "error");
    }
  } finally {
    appealLoadingByReviewId[reviewId] = false;
  }
}

async function loadDetail(reviewId, options = {}) {
  try {
    const response = await getReviewDetail(reviewId);
    detailByReviewId[reviewId] = response.data;
  } catch (err) {
    if (!options.silent) {
      pushToast(err.message || "Failed to load review detail", "error");
    }
  }
}

function isAppealAllowed(review) {
  return appealEligibility(review).allowed;
}

function appealBlockedReason(review) {
  return appealEligibility(review).reason;
}

function appealEligibility(review) {
  const detail = detailByReviewId[review.id];
  if (typeof detail?.canAppeal === "boolean") {
    return {
      allowed: detail.canAppeal,
      reason: detail.canAppeal ? "" : "Appeal is not available for this review"
    };
  }

  const createdAt = new Date(review.created_at || review.createdAt || 0).getTime();
  if (!createdAt) {
    return {
      allowed: false,
      reason: "Appeal eligibility is unavailable"
    };
  }

  const withinWindow = Date.now() - createdAt <= APPEAL_WINDOW_MS;
  return {
    allowed: withinWindow,
    reason: withinWindow ? "" : "Appeal window has expired (7 days)"
  };
}

function flattenReplies(replies) {
  const byParent = new Map();
  for (const reply of replies || []) {
    const key = reply.parent_reply_id || 0;
    if (!byParent.has(key)) {
      byParent.set(key, []);
    }
    byParent.get(key).push(reply);
  }

  const out = [];
  function walk(parentId, depth) {
    for (const reply of byParent.get(parentId) || []) {
      out.push({ ...reply, depth });
      walk(reply.id, depth + 1);
    }
  }
  walk(0, 0);
  return out;
}

function reviewStateClass(state) {
  if (["published", "resolved"].includes(state)) {
    return "success";
  }
  if (["hidden"].includes(state)) {
    return "danger";
  }
  return "warning";
}

function readableReviewState(state) {
  const map = {
    published: "Published",
    hidden: "Hidden",
    under_arbitration: "Under Arbitration",
    resolved: "Resolved",
  };
  return map[state] || state;
}

function imageSrc(image) {
  if (!image?.url) {
    return "";
  }
  if (image.url.startsWith("http://") || image.url.startsWith("https://")) {
    return image.url;
  }
  return `${API_BASE}${image.url}`;
}

function hideBrokenImage(event) {
  event.target.style.display = "none";
}

onMounted(bootstrap);
</script>

<style scoped>
.detail-panel {
  margin-top: 0.65rem;
  padding-top: 0.65rem;
  border-top: 1px solid var(--border);
  display: grid;
  gap: 0.45rem;
}

.reviews-page .list {
  max-width: 920px;
}

.reviews-page .list > li.card {
  padding: 0.62rem;
}

.image-strip {
  display: flex;
  align-items: center;
  gap: 0.42rem;
  margin-top: 0.44rem;
  flex-wrap: wrap;
}

.image-strip img {
  width: 54px;
  height: 54px;
  object-fit: cover;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #15151a;
}

.followup-display,
.followup-editor {
  margin-top: 0.5rem;
  padding-top: 0.45rem;
  border-top: 1px dashed var(--border);
  display: grid;
  gap: 0.35rem;
}
</style>
