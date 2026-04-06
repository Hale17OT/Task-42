const logger = require("../logger");
const { errorResponse } = require("../utils/api-response");

// Whitelist of error fields safe to log. Prevents sensitive data
// (request bodies, DB connection strings, user PII) from leaking into logs.
function sanitizeErrorForLog(error) {
  return {
    type: error.constructor?.name || "Error",
    message: error.message,
    stack: error.stack,
    name: error.name,
    status: error.status,
    code: error.code,
    // Omit error.details intentionally — may contain user input or matched
    // sensitive words. Log the code which is sufficient for triage.
    details: error.details != null ? "[redacted]" : null
  };
}

// Error codes whose details must never reach the client (moderation/governance).
const REDACTED_DETAIL_CODES = new Set([
  "SENSITIVE_WORD_DETECTED",
  "IMAGE_HASH_DENIED",
  "REVIEW_BLACKLISTED"
]);

async function errorHandler(ctx, next) {
  try {
    await next();
  } catch (error) {
    const status = error.status || 500;
    const code = error.code || (status === 500 ? "INTERNAL_ERROR" : "REQUEST_ERROR");
    const suppressDetails = status === 500 || REDACTED_DETAIL_CODES.has(code);
    ctx.status = status;
    ctx.body = errorResponse({
      code,
      message: status === 500 ? "Internal Server Error" : error.message,
      details: suppressDetails ? null : (error.details || null),
      requestId: ctx.state.requestId || null
    });

    logger.error(
      {
        err: sanitizeErrorForLog(error),
        requestId: ctx.state.requestId,
        status,
        path: ctx.path,
        method: ctx.method
      },
      "Request failed"
    );
  }
}

module.exports = errorHandler;
