<template>
  <FeedPanel
    :items="items"
    :loading="loading"
    :error="error"
    :preferences="preferences"
    :current-user-id="currentUserId"
    :followed-author-ids="followedAuthorIds"
    :follow-loading-ids="followLoadingIds"
    :action-loading-keys="actionLoadingKeys"
    :prefs-saving="prefsSaving"
    :showing-cached-feed="showingCachedFeed"
    :showing-cached-preferences="showingCachedPreferences"
    @refresh="loadFeed"
    @action="handleAction"
    @toggle-follow="handleToggleFollow"
    @save-preferences="savePreferences"
  />
</template>

<script setup>
import { computed, onMounted, ref } from "vue";
import { useSession } from "../session";
import FeedPanel from "../components/FeedPanel.vue";
import { getFeed, getFeedPreferences, updateFeedPreferences, sendFeedAction, listMyFollows, followUser, unfollowUser } from "../api";
import { useToast } from "../toast";
import {
  saveFeedSnapshot,
  loadFeedSnapshot,
  saveFeedPreferencesSnapshot,
  loadFeedPreferencesSnapshot
} from "../offline/persistence";
import { isLikelyOfflineError, recordOfflineIntent, buildOfflineRetryMessage } from "../offline/mutation-intents";

const items = ref([]);
const loading = ref(false);
const error = ref("");
const preferences = ref(null);
const prefsSaving = ref(false);
const followedAuthorIds = ref([]);
const followLoadingIds = ref([]);
const actionLoadingKeys = ref([]);
const showingCachedFeed = ref(false);
const showingCachedPreferences = ref(false);
const { state } = useSession();
const currentUserId = computed(() => Number(state.user?.id || 0));

const { pushToast } = useToast();

async function loadPreferences() {
  try {
    const response = await getFeedPreferences();
    preferences.value = response.data;
    saveFeedPreferencesSnapshot(currentUserId.value, preferences.value);
    showingCachedPreferences.value = false;
  } catch (err) {
    const cached = loadFeedPreferencesSnapshot(currentUserId.value);
    if (!cached?.data) {
      throw err;
    }
    preferences.value = cached.data;
    showingCachedPreferences.value = true;
  }
}

async function loadFollows() {
  const response = await listMyFollows();
  followedAuthorIds.value = (response.data || []).map((row) => Number(row.user_id));
}

async function loadFeed() {
  loading.value = true;
  error.value = "";
  try {
    const response = await getFeed(30);
    items.value = response.data || [];
    saveFeedSnapshot(currentUserId.value, items.value);
    showingCachedFeed.value = false;
  } catch (err) {
    const cached = loadFeedSnapshot(currentUserId.value);
    if (cached?.data?.length) {
      items.value = cached.data;
      showingCachedFeed.value = true;
      error.value = "";
    } else {
      error.value = err.message || "Failed to load feed";
    }
  } finally {
    loading.value = false;
  }
}

async function handleAction(payload) {
  if (actionLoadingKeys.value.includes(payload.localItemKey)) {
    return;
  }

  actionLoadingKeys.value = [...actionLoadingKeys.value, payload.localItemKey];
  const snapshot = [...items.value];
  const shouldRemoveImmediately = payload.action !== "clicked";
  if (shouldRemoveImmediately) {
    items.value = items.value.filter((item) => `${item.type}:${item.id}` !== payload.localItemKey);
  }
  pushToast(payload.action === "clicked" ? "Interaction saved" : "Feed updated", "success");
  try {
    await sendFeedAction(payload);
  } catch (err) {
    if (shouldRemoveImmediately) {
      items.value = snapshot;
    }
    if (isLikelyOfflineError(err)) {
      // Record the full API payload so replay can resend it verbatim.
      recordOfflineIntent("feed_action", { payload });
      pushToast(buildOfflineRetryMessage("Feed action"), "error");
    } else {
      pushToast(err.message || "Action failed", "error");
    }
  } finally {
    actionLoadingKeys.value = actionLoadingKeys.value.filter((key) => key !== payload.localItemKey);
  }
}

async function savePreferences(payload) {
  prefsSaving.value = true;
  try {
    const response = await updateFeedPreferences(payload);
    preferences.value = response.data;
    saveFeedPreferencesSnapshot(currentUserId.value, preferences.value);
    showingCachedPreferences.value = false;
    pushToast("Preferences saved", "success");
    await loadFeed();
  } catch (err) {
    if (isLikelyOfflineError(err)) {
      const optimistic = { ...(preferences.value || {}), ...payload };
      preferences.value = optimistic;
      saveFeedPreferencesSnapshot(currentUserId.value, optimistic);
      showingCachedPreferences.value = true;
      recordOfflineIntent("feed_preferences_update", { payload });
      pushToast(buildOfflineRetryMessage("Preferences update"), "error");
    } else {
      pushToast(err.message || "Failed to save preferences", "error");
    }
  } finally {
    prefsSaving.value = false;
  }
}

async function handleToggleFollow({ authorUserId, authorName, currentlyFollowed }) {
  if (!authorUserId) {
    return;
  }
  followLoadingIds.value = [...followLoadingIds.value, authorUserId];
  const previous = [...followedAuthorIds.value];
  if (currentlyFollowed) {
    followedAuthorIds.value = followedAuthorIds.value.filter((id) => id !== authorUserId);
  } else {
    followedAuthorIds.value = [...new Set([...followedAuthorIds.value, authorUserId])];
  }

  try {
    if (currentlyFollowed) {
      await unfollowUser(authorUserId);
      pushToast(`Unfollowed ${authorName}`, "success");
    } else {
      await followUser(authorUserId);
      pushToast(`Following ${authorName}`, "success");
    }
    await loadFeed();
  } catch (err) {
    followedAuthorIds.value = previous;
    if (isLikelyOfflineError(err)) {
      // Record the exact intent that failed so replay can resume it.
      recordOfflineIntent(currentlyFollowed ? "unfollow_user" : "follow_user", { userId: authorUserId });
      pushToast(buildOfflineRetryMessage("Follow update"), "error");
    } else {
      pushToast(err.message || "Failed to update follow", "error");
    }
  } finally {
    followLoadingIds.value = followLoadingIds.value.filter((id) => id !== authorUserId);
  }
}

onMounted(async () => {
  try {
    await loadPreferences();
    await loadFollows();
  } catch (err) {
    error.value = err.message || "Failed to load preferences";
  }
  await loadFeed();
});
</script>
