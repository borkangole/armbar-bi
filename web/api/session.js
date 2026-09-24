/* GET /api/session  ->  200 { ok: true, user } when signed in, 401 otherwise */
import { verifyToken, readCookie } from "./_lib/session.js";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const data = await verifyToken(readCookie(req.headers.cookie), process.env.ARMBAR_SECRET);
  if (!data) return res.status(401).json({ ok: false });
  return res.status(200).json({ ok: true, user: data.u, expires: data.exp });
}
