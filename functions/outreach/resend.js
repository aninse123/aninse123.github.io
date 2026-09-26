// Outreach module — thin Resend REST client (Node 20's global fetch, no SDK).
//
// Send responses carry x-resend-daily-quota / x-resend-monthly-quota — the
// *used* counts for the whole account (warm-up, investor emails and received
// mail included); read-only calls don't (V7, 2026-09-24). Each call returns
// whatever it got so the caller can feed the usage bar (spec §7.6).

const API = "https://api.resend.com";

function readQuota(headers) {
  const n = (h) => {
    const v = parseInt(headers.get(h), 10);
    return Number.isFinite(v) ? v : null;
  };
  return { daily: n("x-resend-daily-quota"), monthly: n("x-resend-monthly-quota") };
}

class ResendError extends Error {
  constructor(message, { status, name, quota } = {}) {
    super(message);
    this.status = status;
    this.resendName = name; // e.g. "daily_quota_exceeded", "validation_error"
    this.quota = quota;
  }
}

async function call(key, method, path, body, extraHeaders = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...extraHeaders },
    body: body ? JSON.stringify(body) : undefined,
  });
  const quota = readQuota(res.headers);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (e) { data = { raw: text }; }
  if (!res.ok) {
    throw new ResendError(data?.message || `Resend API error ${res.status}`, { status: res.status, name: data?.name, quota });
  }
  return { data, quota };
}

// Idempotency-Key = our message id, so a retried call can never send twice.
function sendEmail(key, payload, idempotencyKey) {
  return call(key, "POST", "/emails", payload, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
}

// Up to 100 emails in one call (Phase 5c relationship sends).
function sendBatch(key, emails, idempotencyKey) {
  return call(key, "POST", "/emails/batch", emails, idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {});
}

function getEmail(key, id) {
  return call(key, "GET", `/emails/${encodeURIComponent(id)}`);
}

function getReceivedEmail(key, id) {
  return call(key, "GET", `/emails/receiving/${encodeURIComponent(id)}`);
}

function listReceivedAttachments(key, id) {
  return call(key, "GET", `/emails/receiving/${encodeURIComponent(id)}/attachments?limit=100`);
}

// Phase 3d: open/click tracking is a per-domain setting in Resend.
function listDomains(key) {
  return call(key, "GET", "/domains");
}
function updateDomain(key, id, body) {
  return call(key, "PATCH", `/domains/${encodeURIComponent(id)}`, body);
}

module.exports = { ResendError, sendEmail, sendBatch, getEmail, getReceivedEmail, listReceivedAttachments, listDomains, updateDomain };
