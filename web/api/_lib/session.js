/*
 * ArmBar BI - shared security helpers (runs on Vercel's servers, never in the browser).
 * Uses the Web Crypto API, so the same code works in Node functions and in Edge middleware.
 *
 * Environment variables (set in Vercel → Project → Settings → Environment Variables):
 *   ARMBAR_USER       login username, e.g. "admin"
 *   ARMBAR_PASS_HASH  output of `node tools/make-password-hash.mjs "<password>"`  (pbkdf2$<iter>$<salt>$<hash>)
 *   ARMBAR_SECRET     long random string used to sign session cookies
 */
const enc = new TextEncoder();
export const COOKIE = "armbar_session";
export const TTL = { session: 12 * 3600, remember: 7 * 24 * 3600 };   // seconds

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** constant-time comparison, so response time doesn't leak how many characters matched */
export function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacKey(secret) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

/** Create a signed session token:  base64url(payload).base64url(HMAC-SHA256) */
export async function createToken(user, maxAgeSec, secret) {
  const payload = b64url(enc.encode(JSON.stringify({ u: user, exp: Math.floor(Date.now() / 1000) + maxAgeSec })));
  const sig = b64url(await crypto.subtle.sign("HMAC", await hmacKey(secret), enc.encode(payload)));
  return `${payload}.${sig}`;
}

/** Verify a token; returns { u, exp } or null if missing, forged or expired */
export async function verifyToken(token, secret) {
  if (!token || !secret || typeof token !== "string") return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await hmacKey(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const data = JSON.parse(new TextDecoder().decode(fromB64url(payload)));
    return data && data.exp > Math.floor(Date.now() / 1000) ? data : null;
  } catch { return null; }
}

/** Check a password against "pbkdf2$<iterations>$<saltB64>$<hashB64>" */
export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || "").split("$");
  if (alg !== "pbkdf2" || !iter || !salt || !hash) return false;
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64(salt), iterations: +iter }, key, 256));
  return safeEqual(bits, fromB64(hash));
}

export function readCookie(cookieHeader, name = COOKIE) {
  for (const part of String(cookieHeader || "").split(";")) {
    const i = part.indexOf("=");
    if (i > -1 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

export function cookieHeader(value, maxAgeSec, secure = true) {
  return [`${COOKIE}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Strict", secure ? "Secure" : "",
          `Max-Age=${maxAgeSec}`].filter(Boolean).join("; ");
}
