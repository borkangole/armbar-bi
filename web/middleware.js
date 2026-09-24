/*
 * Vercel Routing Middleware - runs on Vercel's servers BEFORE a protected file is sent.
 * Without a valid signed session cookie:
 *   - the dashboard page redirects to the home page with the login overlay open
 *   - the data file and dashboard script return 401 (cannot be downloaded)
 */
import { verifyToken, readCookie } from "./api/_lib/session.js";

export const config = {
  matcher: ["/dashboard.html", "/dashboard", "/data/:path*", "/js/dashboard.js"],
};

const next = () => new Response(null, { headers: { "x-middleware-next": "1" } });   // = next() from @vercel/functions

export default async function middleware(request) {
  const session = await verifyToken(readCookie(request.headers.get("cookie")), process.env.ARMBAR_SECRET);
  if (session) return next();

  const url = new URL(request.url);
  if (url.pathname === "/dashboard.html" || url.pathname === "/dashboard") {
    return Response.redirect(new URL("/#login", url), 307);
  }
  return new Response("Unauthorized", { status: 401, headers: { "Cache-Control": "no-store", "Content-Type": "text/plain" } });
}
