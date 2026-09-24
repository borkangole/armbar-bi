/*
 * Creates the values for Vercel's environment variables.
 *   node tools/make-password-hash.mjs "YourStrongPassword"
 * Paste the printed ARMBAR_PASS_HASH and ARMBAR_SECRET into Vercel → Settings → Environment Variables.
 * The password itself is never stored anywhere - only this salted PBKDF2 hash.
 */
import { webcrypto as crypto, randomBytes } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error('Usage: node tools/make-password-hash.mjs "YourStrongPassword"   (at least 10 characters)');
  process.exit(1);
}
const ITER = 210000;
const salt = randomBytes(16);
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const hash = Buffer.from(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256));
console.log("\nARMBAR_PASS_HASH = " + `pbkdf2$${ITER}$${salt.toString("base64")}$${hash.toString("base64")}`);
console.log("ARMBAR_SECRET    = " + randomBytes(48).toString("base64url"));
console.log("\nAlso add ARMBAR_USER (your username, e.g. admin).\n");
