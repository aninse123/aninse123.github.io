// Claude connector — sign-in (OAuth 2.1) for Claude's own clients only.
//
//   GET  /.well-known/oauth-protected-resource      where to sign in (RFC 9728)
//   GET  /.well-known/oauth-authorization-server     the sign-in server (RFC 8414)
//   GET  /.well-known/openid-configuration           the same document (clients try both)
//   POST /register     Dynamic Client Registration (RFC 7591), Claude's return addresses only
//   GET  /authorize    checks the request, keeps it on the server, sends the person to
//                      portal/claude-connect.html?r=<request id>
//   POST /token        authorization_code (+PKCE S256) and refresh_token (rotated)
//   POST /revoke       RFC 7009
//
// The Allow step itself is the claudeConnect callable (connect.js), which turns a
// request into a one-time code once the signed-in person may use the connector.
// Every code and token is stored only as a SHA-256 hash in claudeTokens.

const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const U = require("./util");
const P = require("../access/perms");

const CODE_TTL = 5 * 60 * 1000;
const REQUEST_TTL = 10 * 60 * 1000;
const REUSE_GRACE = 2 * 60 * 1000; // a refresh token reused this soon is a client retry
const ACCESS_TTL = 60 * 60 * 1000;
const CIMD_TTL = 24 * 60 * 60 * 1000;

// ── Claude's return addresses ──
const HOSTED_REDIRECTS = ["https://claude.ai/api/mcp/auth_callback", "https://claude.com/api/mcp/auth_callback"];
const CIMD_HOSTS = ["claude.ai", "claude.com"];
function parseUrl(s) { try { return new URL(String(s)); } catch (e) { return null; } }
// Claude Code: http://localhost or http://127.0.0.1, any port, path /callback, nothing else.
function isLoopback(uri) {
  const u = parseUrl(uri);
  return !!u && u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1") && u.pathname === "/callback" && !u.search && !u.hash && !u.username && !u.password;
}
function isAllowedRedirect(uri) { return HOSTED_REDIRECTS.includes(String(uri)) || isLoopback(uri); }
// The request's return address against the client's registered ones; loopback
// ports are ignored (RFC 8252 §7.3, and Anthropic asks the same for localhost).
function redirectMatches(requested, registered) {
  if (!isAllowedRedirect(requested)) return false;
  for (const r of registered || []) {
    if (r === requested) return true;
    if (isLoopback(r) && isLoopback(requested)) {
      const a = new URL(r), b = new URL(requested);
      if (a.hostname === b.hostname && a.pathname === b.pathname) return true;
    }
  }
  return false;
}
function surfaceOf(clientName, redirectUri) { return isLoopback(redirectUri) ? "Claude Code" : /code/i.test(clientName || "") ? "Claude Code" : "claude.ai"; }

// PKCE S256: BASE64URL(SHA256(verifier)) === challenge.
function pkceOk(verifier, challenge) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(String(verifier || ""))) return false;
  const h = require("crypto").createHash("sha256").update(String(verifier)).digest();
  return U.b64url(h) === String(challenge || "");
}
// The resource Claude names must be this connector (case-insensitive host, no trailing slash).
function resourceOk(resource) {
  if (resource == null || resource === "") return true; // older clients may omit it; the token is ours anyway
  const u = parseUrl(resource);
  if (!u) return false;
  const norm = (x) => `${x.protocol}//${x.host.toLowerCase()}${x.pathname.replace(/\/+$/, "")}`;
  return norm(u) === norm(new URL(U.BASE));
}

// ── Discovery documents ──
function protectedResourceMetadata() {
  return { resource: U.BASE, authorization_servers: [U.BASE], scopes_supported: [U.SCOPE], bearer_methods_supported: ["header"], resource_name: `${P.identity().orgName || "Team"} (read only)` };
}
function authServerMetadata() {
  return {
    issuer: U.BASE,
    authorization_endpoint: `${U.BASE}/authorize`,
    token_endpoint: `${U.BASE}/token`,
    registration_endpoint: `${U.BASE}/register`,
    revocation_endpoint: `${U.BASE}/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    client_id_metadata_document_supported: true,
    scopes_supported: [U.SCOPE],
  };
}
// The same document under openid-configuration, which is the only discovery path
// a client can reach on the cloudfunctions.net address (the root isn't ours). OpenID
// discovery requires a key list, subject types and ID-token algorithms (Claude Code
// rejects the document without them); no ID tokens are ever issued, the key list is empty.
function openIdConfiguration() {
  return { ...authServerMetadata(), jwks_uri: `${U.BASE}/jwks`, subject_types_supported: ["public"], id_token_signing_alg_values_supported: ["RS256"] };
}
const resourceMetadataUrl = () => `${U.BASE}/.well-known/oauth-protected-resource`;
function wwwAuthenticate(error) {
  return `Bearer resource_metadata="${resourceMetadataUrl()}", scope="${U.SCOPE}"${error ? `, error="${error}"` : ""}`;
}

// ── Clients ──
const cleanName = (s) => String(s || "").replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, 80);
async function registerClient(body, { now = Date.now() } = {}) {
  const b = body && typeof body === "object" ? body : {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String) : [];
  if (!uris.length || uris.length > 5) return { status: 400, body: { error: "invalid_redirect_uri", error_description: "Give one to five redirect_uris." } };
  const bad = uris.find((u) => !isAllowedRedirect(u));
  if (bad) return { status: 400, body: { error: "invalid_redirect_uri", error_description: "Only Claude's own return addresses are accepted." } };
  const method = b.token_endpoint_auth_method || "none";
  if (method !== "none") return { status: 400, body: { error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method none) are supported." } };
  const clientId = "dcr_" + U.randomToken(18);
  const clientName = cleanName(b.client_name) || "Claude";
  await U.db().doc(`claudeClients/${clientId}`).set({ kind: "dcr", clientName, redirectUris: uris, createdAt: FieldValue.serverTimestamp(), lastUsedAt: null });
  return { status: 201, body: { client_id: clientId, client_id_issued_at: Math.floor(now / 1000), client_name: clientName, redirect_uris: uris, grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" } };
}
// A Client ID Metadata Document, only from claude.ai / claude.com (never any other address).
function isCimdId(clientId) {
  const u = parseUrl(clientId);
  return !!u && u.protocol === "https:" && CIMD_HOSTS.includes(u.hostname) && u.pathname.length > 1 && !u.username && !u.port;
}
const cimdDocId = (clientId) => "cimd_" + U.sha256(clientId).slice(0, 40);
async function fetchCimd(clientId, fetchImpl) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 5000);
  try {
    const res = await fetchImpl(clientId, { signal: ctl.signal, redirect: "error", headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const text = await res.text();
    if (text.length > 20000) return null;
    const doc = JSON.parse(text);
    if (doc.client_id !== clientId || !Array.isArray(doc.redirect_uris) || !doc.redirect_uris.length) return null;
    return doc;
  } catch (e) { return null; } finally { clearTimeout(t); }
}
// → { clientId, clientName, redirectUris } or null.
async function loadClient(clientId, { fetchImpl = globalThis.fetch, now = Date.now() } = {}) {
  const id = String(clientId || "");
  if (/^dcr_[A-Za-z0-9_-]{10,40}$/.test(id)) {
    const s = await U.db().doc(`claudeClients/${id}`).get();
    return s.exists ? { clientId: id, docId: id, clientName: s.data().clientName, redirectUris: s.data().redirectUris || [], kind: "dcr" } : null;
  }
  if (!isCimdId(id)) return null;
  const ref = U.db().doc(`claudeClients/${cimdDocId(id)}`);
  const s = await ref.get();
  const cur = s.exists ? s.data() : null;
  if (cur && now - (U.ms(cur.fetchedAt) || 0) < CIMD_TTL) return { clientId: id, docId: ref.id, clientName: cur.clientName, redirectUris: cur.redirectUris || [], kind: "cimd" };
  const doc = await fetchCimd(id, fetchImpl);
  if (!doc) return cur ? { clientId: id, docId: ref.id, clientName: cur.clientName, redirectUris: cur.redirectUris || [], kind: "cimd" } : null;
  const uris = doc.redirect_uris.map(String).filter(isAllowedRedirect);
  const rec = { kind: "cimd", clientIdUrl: id, clientName: cleanName(doc.client_name) || "Claude", redirectUris: uris, fetchedAt: Timestamp.fromMillis(now) };
  await ref.set(cur ? { ...rec, lastUsedAt: cur.lastUsedAt || null } : { ...rec, createdAt: FieldValue.serverTimestamp(), lastUsedAt: null }, { merge: true });
  return { clientId: id, docId: ref.id, clientName: rec.clientName, redirectUris: uris, kind: "cimd" };
}

// ── Release switch → which sign-in page ──
// Test: the staging page (the only one that has it while testing); On: the live site.
function connectPageUrl(state) {
  const inst = P.identity();
  const prodHosts = inst.productionHosts || [];
  const origins = inst.portalOrigins || [];
  const isProd = (o) => { try { return prodHosts.includes(new URL(o).hostname); } catch (e) { return false; } };
  const origin = state === "on" ? (origins.find(isProd) || origins[0]) : (origins.find((o) => !isProd(o)) || origins[0]);
  return `${origin}/portal/claude-connect.html`;
}

// ── /authorize ──
// → { redirect } (302) or { status, html } for problems we can't send back to the client.
async function authorize(q, { switchState, now = Date.now(), fetchImpl } = {}) {
  const problem = (msg) => ({ status: 400, html: msg });
  const client = await loadClient(q.client_id, { fetchImpl, now });
  if (!client) return problem("This sign-in request doesn't come from a Claude client the Douro connector knows.");
  const redirectUri = String(q.redirect_uri || "");
  if (!redirectUri || !redirectMatches(redirectUri, client.redirectUris)) return problem("This sign-in request has a return address that isn't Claude's.");
  const back = (error, description) => {
    const u = new URL(redirectUri);
    u.searchParams.set("error", error);
    if (description) u.searchParams.set("error_description", description);
    if (q.state) u.searchParams.set("state", String(q.state));
    u.searchParams.set("iss", U.BASE);
    return { redirect: u.toString() };
  };
  if (q.response_type !== "code") return back("unsupported_response_type", "Only response_type=code.");
  if (q.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(String(q.code_challenge || ""))) return back("invalid_request", "PKCE with S256 is required.");
  if (!resourceOk(q.resource)) return back("invalid_target", "This sign-in server only issues tokens for the Douro connector.");
  if (switchState === "off") return back("access_denied", "The Douro connector is switched off.");
  const raw = U.randomToken(24);
  await U.db().doc(`claudeTokens/${U.sha256(raw)}`).set({
    type: "request", clientId: client.clientId, clientName: client.clientName, redirectUri, codeChallenge: String(q.code_challenge),
    state: q.state != null ? String(q.state).slice(0, 500) : null, resource: q.resource ? String(q.resource) : null, scope: U.SCOPE,
    createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + REQUEST_TTL), usedAt: null,
  });
  return { redirect: `${connectPageUrl(switchState)}?r=${encodeURIComponent(raw)}` };
}

// ── Codes and tokens ──
async function issueTokens(conn, { now = Date.now(), family = null } = {}) {
  const access = U.randomToken(32), refresh = U.randomToken(32);
  const fam = family || U.randomToken(12);
  const base = { connectionId: conn.id, clientId: conn.clientId, email: conn.email, createdAt: Timestamp.fromMillis(now), usedAt: null };
  const batch = U.db().batch();
  batch.set(U.db().doc(`claudeTokens/${U.sha256(access)}`), { ...base, type: "access", expiresAt: Timestamp.fromMillis(now + ACCESS_TTL) });
  batch.set(U.db().doc(`claudeTokens/${U.sha256(refresh)}`), { ...base, type: "refresh", family: fam, expiresAt: conn.expiresAt });
  await batch.commit();
  return { access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL / 1000, refresh_token: refresh, scope: U.SCOPE };
}
async function revokeConnection(connectionId, reason, by = null) {
  const ref = U.db().doc(`claudeConnections/${connectionId}`);
  const s = await ref.get();
  if (!s.exists || s.data().revokedAt) return false;
  await ref.update({ revokedAt: FieldValue.serverTimestamp(), revokeReason: reason, revokedBy: by });
  return true;
}
// A connection that may still be used: not revoked, not past its sign-in days.
function connectionLive(c, now = Date.now()) { return !!c && !c.revokedAt && (U.ms(c.expiresAt) || 0) > now; }

const tokenError = (error, description, status = 400) => ({ status, body: { error, error_description: description } });
async function token(form, { now = Date.now() } = {}) {
  const f = form || {};
  const settings = await U.getSettings();
  const days = settings.signInDays * 86400000;
  if (f.grant_type === "authorization_code") {
    if (!resourceOk(f.resource)) return tokenError("invalid_target", "Tokens are only issued for the Douro connector.");
    const ref = U.db().doc(`claudeTokens/${U.sha256(f.code || "")}`);
    const s = await ref.get();
    const c = s.exists ? s.data() : null;
    if (!c || c.type !== "code") return tokenError("invalid_grant", "Unknown sign-in code.");
    if (c.usedAt) { await revokeConnection(c.connectionId, "code_reuse"); return tokenError("invalid_grant", "This sign-in code was already used."); }
    if ((U.ms(c.expiresAt) || 0) <= now) return tokenError("invalid_grant", "This sign-in code has expired. Connect again.");
    if (c.clientId !== String(f.client_id || "")) return tokenError("invalid_grant", "This code belongs to another client.");
    if (c.redirectUri !== String(f.redirect_uri || "")) return tokenError("invalid_grant", "The return address doesn't match the sign-in request.");
    if (!pkceOk(f.code_verifier, c.codeChallenge)) return tokenError("invalid_grant", "PKCE check failed.");
    await ref.update({ usedAt: Timestamp.fromMillis(now) });
    const connRef = U.db().doc(`claudeConnections/${c.connectionId}`);
    const conn = (await connRef.get()).data();
    if (!connectionLive(conn, now)) return tokenError("invalid_grant", "This connection has ended.");
    const expiresAt = Timestamp.fromMillis(now + days);
    await connRef.update({ lastUsedAt: Timestamp.fromMillis(now), expiresAt, exchangedAt: Timestamp.fromMillis(now) });
    return { status: 200, body: await issueTokens({ id: c.connectionId, clientId: c.clientId, email: c.email, expiresAt }, { now }) };
  }
  if (f.grant_type === "refresh_token") {
    const ref = U.db().doc(`claudeTokens/${U.sha256(f.refresh_token || "")}`);
    const s = await ref.get();
    const t = s.exists ? s.data() : null;
    if (!t || t.type !== "refresh") return tokenError("invalid_grant", "Unknown refresh token.");
    if (f.client_id && t.clientId !== String(f.client_id)) return tokenError("invalid_grant", "This token belongs to another client.");
    // Claude retries a renewal it didn't get an answer for (seen 13 Nov: the same refresh token
    // 11 s apart). Within REUSE_GRACE that's a retry, answered with a fresh pair; later reuse
    // looks like theft and ends the connection.
    if (t.usedAt && now - (U.ms(t.usedAt) || 0) > REUSE_GRACE) { await revokeConnection(t.connectionId, "refresh_reuse"); return tokenError("invalid_grant", "This refresh token was already used; the connection has been ended for safety. Connect again."); }
    const connRef = U.db().doc(`claudeConnections/${t.connectionId}`);
    const conn = (await connRef.get()).data();
    if (!connectionLive(conn, now)) {
      if (conn && !conn.revokedAt) await revokeConnection(t.connectionId, "expired");
      return tokenError("invalid_grant", "This connection has ended. Connect again.");
    }
    if (!t.usedAt) await ref.update({ usedAt: Timestamp.fromMillis(now) }); // a retry keeps the first use time (the grace doesn't slide)
    const expiresAt = Timestamp.fromMillis(now + days);
    await connRef.update({ lastUsedAt: Timestamp.fromMillis(now), expiresAt });
    return { status: 200, body: await issueTokens({ id: t.connectionId, clientId: t.clientId, email: t.email, expiresAt }, { now, family: t.family }) };
  }
  return tokenError("unsupported_grant_type", "Use authorization_code or refresh_token.");
}
async function revoke(form) {
  const s = await U.db().doc(`claudeTokens/${U.sha256((form || {}).token || "")}`).get();
  if (s.exists && (s.data().type === "access" || s.data().type === "refresh")) await revokeConnection(s.data().connectionId, "client_revoked");
  return { status: 200, body: {} };
}

// The Allow step (called by connect.js once the person may connect): a one-time code.
async function issueCode(reqDoc, { email, key }, { now = Date.now() } = {}) {
  const settings = await U.getSettings();
  const connRef = U.db().collection("claudeConnections").doc();
  await connRef.set({
    email, key, clientId: reqDoc.clientId, clientName: reqDoc.clientName || "Claude", surface: surfaceOf(reqDoc.clientName, reqDoc.redirectUri),
    redirectHost: new URL(reqDoc.redirectUri).host, createdAt: Timestamp.fromMillis(now), lastUsedAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + settings.signInDays * 86400000), exchangedAt: null, revokedAt: null, revokedBy: null, revokeReason: null,
  });
  const code = U.randomToken(32);
  await U.db().doc(`claudeTokens/${U.sha256(code)}`).set({
    type: "code", connectionId: connRef.id, clientId: reqDoc.clientId, email, redirectUri: reqDoc.redirectUri, codeChallenge: reqDoc.codeChallenge,
    createdAt: Timestamp.fromMillis(now), expiresAt: Timestamp.fromMillis(now + CODE_TTL), usedAt: null,
  });
  const u = new URL(reqDoc.redirectUri);
  u.searchParams.set("code", code);
  if (reqDoc.state != null) u.searchParams.set("state", reqDoc.state);
  u.searchParams.set("iss", U.BASE);
  return { redirect: u.toString(), connectionId: connRef.id };
}
function denyRedirect(reqDoc) {
  const u = new URL(reqDoc.redirectUri);
  u.searchParams.set("error", "access_denied");
  u.searchParams.set("error_description", "The person declined.");
  if (reqDoc.state != null) u.searchParams.set("state", reqDoc.state);
  u.searchParams.set("iss", U.BASE);
  return u.toString();
}

// Bearer token → { conn, connectionId, email } or { error }.
async function checkAccessToken(bearer, { now = Date.now() } = {}) {
  if (!bearer) return { error: "missing" };
  const s = await U.db().doc(`claudeTokens/${U.sha256(bearer)}`).get();
  const t = s.exists ? s.data() : null;
  if (!t || t.type !== "access" || (U.ms(t.expiresAt) || 0) <= now) return { error: "invalid_token" };
  const cs = await U.db().doc(`claudeConnections/${t.connectionId}`).get();
  const conn = cs.exists ? cs.data() : null;
  if (!connectionLive(conn, now)) return { error: "invalid_token" };
  return { conn: { id: t.connectionId, ...conn }, connectionId: t.connectionId, email: t.email };
}

module.exports = {
  HOSTED_REDIRECTS, ACCESS_TTL, REUSE_GRACE, CODE_TTL, REQUEST_TTL, isLoopback, isAllowedRedirect, redirectMatches, surfaceOf, pkceOk, resourceOk, isCimdId,
  protectedResourceMetadata, authServerMetadata, openIdConfiguration, wwwAuthenticate, resourceMetadataUrl, registerClient, loadClient, connectPageUrl,
  authorize, token, revoke, issueCode, denyRedirect, revokeConnection, connectionLive, checkAccessToken,
};
