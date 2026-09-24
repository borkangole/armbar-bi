/* POST /api/logout  ->  clears the session cookie */
import { cookieHeader } from "./_lib/session.js";

export default function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ ok: false }); }
  res.setHeader("Set-Cookie", cookieHeader("", 0));
  return res.status(200).json({ ok: true });
}
