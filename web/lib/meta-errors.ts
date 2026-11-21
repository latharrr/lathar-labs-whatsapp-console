/** Common Cloud API error codes. Check Meta's error-code reference when a code is missing here. */
export const META_ERRORS: Record<number, { meaning: string; retryable: boolean }> = {
  130429: { meaning: "Throughput rate limit hit", retryable: true },
  131056: { meaning: "Too many messages to this user too quickly", retryable: true },
  131000: { meaning: "Something went wrong at Meta", retryable: true },
  131016: { meaning: "Meta service temporarily unavailable", retryable: true },
  131026: { meaning: "Recipient cannot receive this message", retryable: false },
  131047: { meaning: "Outside the 24h window; a template is required", retryable: false },
  131049: { meaning: "Held back by Meta to protect engagement", retryable: false },
  131050: { meaning: "Recipient stopped marketing messages", retryable: false },
  131051: { meaning: "Unsupported message type", retryable: false },
  131052: { meaning: "Media download failed", retryable: false },
  131053: { meaning: "Media upload failed", retryable: false },
  131048: { meaning: "Spam rate limit reached", retryable: false },
  131031: { meaning: "Business account locked", retryable: false },
  131042: { meaning: "Payment method problem", retryable: false },
  132000: { meaning: "Template parameter count mismatch", retryable: false },
  132001: { meaning: "Template does not exist in that language", retryable: false },
  132015: { meaning: "Template paused for low quality", retryable: false },
  132016: { meaning: "Template disabled for low quality", retryable: false },
  133010: { meaning: "Phone number not registered", retryable: false },
  130472: { meaning: "Recipient is in a Meta experiment", retryable: false },
  131030: { meaning: "Recipient not in the allowed list (dev mode)", retryable: false },
  190: { meaning: "Access token expired or revoked", retryable: false },
};

export const describeError = (code: number | null) =>
  (code !== null && META_ERRORS[code]) || { meaning: "Unlisted error; see Meta's error codes page", retryable: false };
