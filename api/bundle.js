/**
 * Rev-IQ paid bundle downloads.
 *
 * GET /api/bundle?session_id=cs_...                              -> JSON: what this purchase can download
 * GET /api/bundle?session_id=cs_...&platform=claude&file=<key>    -> the decrypted .zip
 *
 * A download is released only when Stripe confirms the Checkout Session is complete and paid,
 * and the session maps to a bundle (Payment Link metadata "bundle", or BUNDLE_PAYMENT_LINKS).
 * Bundles marked "allow_free" in the manifest (the book) also release on a fully discounted
 * session, which Stripe reports as payment_status "no_payment_required".
 * Files are stored encrypted in /private/bundles (AES-256-GCM) and decrypted here with BUNDLE_KEY,
 * or with the environment variable named in the bundle's "key_env" (the book uses BOOK_KEY).
 *
 * Environment variables (Vercel project settings):
 *   STRIPE_SECRET_KEY      Restricted key with read access to Checkout Sessions (rk_live_... or rk_test_...)
 *   BUNDLE_KEY             Base64 32-byte key used by review/build_bundle_packages.py
 *   BOOK_KEY               Base64 32-byte key for the Decisions We Live With ebook files
 *   BUNDLE_PAYMENT_LINKS   Optional JSON map, e.g. {"plink_123":"founder-led-sales-kit"}
 *   DOWNLOAD_DAYS          Optional, days a purchase link keeps working (default 365)
 *   STRIPE_API_BASE        Optional, for local testing only
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = [path.join(__dirname, "..", "private", "bundles"), path.join(process.cwd(), "private", "bundles")]
  .find((p) => fs.existsSync(path.join(p, "manifest.json")));
const MANIFEST = ROOT ? JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8")) : { bundles: {} };
const PLATFORMS = ["claude", "chatgpt", "perplexity"];
const SESSION_RE = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;
const KEY_RE = /^[a-z0-9-]{1,80}$/;
const TYPES = { ".epub": "application/epub+zip", ".pdf": "application/pdf", ".zip": "application/zip" };

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.end(JSON.stringify(body));
}

function linkMap() {
  try { return JSON.parse(process.env.BUNDLE_PAYMENT_LINKS || "{}"); } catch (e) { return {}; }
}

async function getSession(id) {
  const base = process.env.STRIPE_API_BASE || "https://api.stripe.com";
  const r = await fetch(`${base}/v1/checkout/sessions/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`stripe ${r.status}`);
  return r.json();
}

function decrypt(buf, keyEnv) {
  const key = Buffer.from(process.env[keyEnv || "BUNDLE_KEY"] || "", "base64");
  if (key.length !== 32) throw new Error("bad key");
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "method_not_allowed" });
  const q = new URL(req.url, "http://x").searchParams;
  const sid = q.get("session_id") || "";
  if (!SESSION_RE.test(sid)) return send(res, 400, { error: "missing_or_invalid_session" });
  if (!process.env.STRIPE_SECRET_KEY || !process.env.BUNDLE_KEY || !ROOT) return send(res, 503, { error: "not_configured" });

  let s;
  try { s = await getSession(sid); } catch (e) { return send(res, 502, { error: "payment_check_failed" }); }
  if (!s) return send(res, 404, { error: "session_not_found" });
  const slug = (s.metadata && s.metadata.bundle) || linkMap()[s.payment_link] || "";
  const bundle = MANIFEST.bundles[slug];
  const paid = s.payment_status === "paid" || (bundle && bundle.allow_free === true && s.payment_status === "no_payment_required");
  if (s.status !== "complete" || !paid) return send(res, 402, { error: "not_paid" });
  if (!bundle) return send(res, 404, { error: "bundle_not_found" });
  const plats = bundle.type === "book" ? Object.keys(bundle.platforms || {}) : PLATFORMS;

  const days = parseInt(process.env.DOWNLOAD_DAYS || "365", 10);
  const expires = (s.created || 0) + days * 86400;
  if (Date.now() / 1000 > expires) return send(res, 410, { error: "expired", bundle: slug });

  const platform = q.get("platform");
  const file = q.get("file");
  if (!platform && !file) {
    const hint = plats.includes(s.client_reference_id) ? s.client_reference_id : (bundle.type === "book" ? plats[0] : null);
    return send(res, 200, {
      bundle: slug, name: bundle.name, type: bundle.type || "skills", platform_hint: hint,
      expires: new Date(expires * 1000).toISOString(),
      files: Object.fromEntries(plats.map((p) => [p, (bundle.platforms[p] || []).map((f) => ({ key: f.key, label: f.label, filename: f.filename, bytes: f.bytes }))])),
    });
  }
  if (!plats.includes(platform) || !KEY_RE.test(file || "")) return send(res, 400, { error: "invalid_file" });
  const entry = (bundle.platforms[platform] || []).find((f) => f.key === file);
  if (!entry) return send(res, 404, { error: "file_not_found" });

  let data;
  try { data = decrypt(fs.readFileSync(path.join(ROOT, slug, platform, `${file}.enc`)), bundle.key_env); }
  catch (e) { return send(res, 500, { error: "file_unavailable" }); }
  if (crypto.createHash("sha256").update(data).digest("hex") !== entry.sha256) return send(res, 500, { error: "file_unavailable" });

  res.statusCode = 200;
  res.setHeader("Content-Type", TYPES[path.extname(entry.filename).toLowerCase()] || "application/zip");
  res.setHeader("Content-Length", String(data.length));
  res.setHeader("Content-Disposition", `attachment; filename="${entry.filename}"`);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Robots-Tag", "noindex");
  res.end(req.method === "HEAD" ? undefined : data);
};
