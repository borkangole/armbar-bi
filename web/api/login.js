/*
 * POST /api/login   body: { "username": "...", "password": "...", "remember": true|false }
 * On success sets an HttpOnly, Secure, SameSite=Strict signed session cookie.
 */
import { createToken, verifyPassword, safeEqual, cookieHeader, TTL } from "./_lib/session.js";

const MAX_TRIES = 5, LOCK_MS = 15 * 60 * 1000;          // 5 wrong tries -> locked for 15 minutes
const attempts = new Map();                               // per server instance (best effort)
const enc = new TextEncoder();
const DUMMY = "pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false, error: "Method not allowed" }); }

  // only accept logins sent from our own site
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ ok: false, error: "Forbidden" });

  const { ARMBAR_USER, ARMBAR_PASS_HASH, ARMBAR_SECRET } = process.env;
  if (!ARMBAR_USER || !ARMBAR_PASS_HASH || !ARMBAR_SECRET || ARMBAR_SECRET.length < 32)
    return res.status(500).json({ ok: false, error: "Login is not configured on the server yet." });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  const now = Date.now(), rec = attempts.get(ip);
  if (rec && rec.until > now) {
    res.setHeader("Retry-After", Math.ceil((rec.until - now) / 1000));
    return res.status(429).json({ ok: false, error: `Too many attempts. Try again in ${Math.ceil((rec.until - now) / 60000)} min.` });
  }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const username = String(body?.username || "").trim().toLowerCase().slice(0, 100);
  const password = String(body?.password || "").slice(0, 200);
  const remember = body?.remember === true;

  // always run the (slow) password check, even for a wrong username, so timing reveals nothing
  const userOk = safeEqual(enc.encode(username), enc.encode(ARMBAR_USER.toLowerCase()));
  const passOk = await verifyPassword(password, userOk ? ARMBAR_PASS_HASH : DUMMY);

  if (!(userOk && passOk)) {
    const r = attempts.get(ip) || { count: 0, until: 0 };
    r.count += 1;
    if (r.count >= MAX_TRIES) { r.until = now + LOCK_MS; r.count = 0; }
    attempts.set(ip, r);
    await sleep(400 + Math.random() * 300);              // slow down guessing
    return res.status(401).json({ ok: false, error: "Wrong username or password." });
  }

  attempts.delete(ip);
  const maxAge = remember ? TTL.remember : TTL.session;
  res.setHeader("Set-Cookie", cookieHeader(await createToken(username, maxAge, ARMBAR_SECRET), maxAge));
  return res.status(200).json({ ok: true, user: username });
}
