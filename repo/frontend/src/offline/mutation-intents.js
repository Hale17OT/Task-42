const OFFLINE_INTENTS_KEY = "trailforge:offline:intents";
const MAX_INTENTS = 30;

function canUseStorage() {
  return typeof window !== "undefined" && Boolean(window.localStorage);
}

function readIntents() {
  if (!canUseStorage()) {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(OFFLINE_INTENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeIntents(intents) {
  if (!canUseStorage()) {
    return;
  }
  try {
    window.localStorage.setItem(OFFLINE_INTENTS_KEY, JSON.stringify(intents.slice(-MAX_INTENTS)));
  } catch {
  }
}

export function isLikelyOfflineError(error) {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return true;
  }

  const message = String(error?.message || "").toLowerCase();
  return message.includes("failed to fetch") || message.includes("networkerror") || message.includes("network error");
}

export function recordOfflineIntent(action, context = {}) {
  const intents = readIntents();
  intents.push({
    id: `${Date.now()}-${Math.random()}`,
    action,
    context,
    createdAt: new Date().toISOString()
  });
  writeIntents(intents);
  return intents.length;
}

export function getOfflineIntentCount() {
  return readIntents().length;
}

export function clearOfflineIntents() {
  writeIntents([]);
}

export function buildOfflineRetryMessage(actionLabel) {
  return `${actionLabel} was not sent while offline. Reconnect and retry.`;
}

// Replay recorded intents sequentially. The handler must be idempotent —
// server APIs accept idempotency keys for mutations where needed.
// Returns { succeeded, failed, remaining } counts.
export async function replayOfflineIntents(handler) {
  if (typeof handler !== "function") {
    throw new Error("replayOfflineIntents requires a handler function");
  }

  const intents = readIntents();
  if (!intents.length) {
    return { succeeded: 0, failed: 0, remaining: 0 };
  }

  const remaining = [];
  let succeeded = 0;
  let failed = 0;

  for (const intent of intents) {
    try {
      await handler(intent);
      succeeded += 1;
    } catch (error) {
      // If still offline, stop processing and keep remaining intents.
      if (isLikelyOfflineError(error)) {
        remaining.push(intent);
        const idx = intents.indexOf(intent);
        for (let i = idx + 1; i < intents.length; i += 1) {
          remaining.push(intents[i]);
        }
        break;
      }
      // Non-network errors: drop the intent (will not replay indefinitely).
      failed += 1;
    }
  }

  writeIntents(remaining);
  return { succeeded, failed, remaining: remaining.length };
}

// Install a window 'online' listener that triggers replayOfflineIntents.
// Returns a cleanup function.
export function installReplayOnReconnect(handler, options = {}) {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onReconnect = async () => {
    try {
      const result = await replayOfflineIntents(handler);
      if (options.onReplayComplete) {
        options.onReplayComplete(result);
      }
    } catch (error) {
      if (options.onReplayError) {
        options.onReplayError(error);
      }
    }
  };

  window.addEventListener("online", onReconnect);
  return () => window.removeEventListener("online", onReconnect);
}
