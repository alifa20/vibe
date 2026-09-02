/**
 * Serverless alternative to server.mjs — same contract, same form.
 *
 * Serverless filesystems are ephemeral, so this cannot append to messages.log.
 * It forwards the message instead:
 *
 *   CONTACT_WEBHOOK_URL   POST the message as JSON (Slack, Discord, Zapier,
 *                         n8n, your own inbox service — anything with a URL)
 *   unset                 write it to the function's runtime log
 *
 * Web-standard handler: runs on Vercel Functions, Netlify Edge, Cloudflare
 * Workers and Deno Deploy unchanged.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clean = (v, max) => String(v ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);

// Per-instance, best-effort. Real protection belongs at the edge
// (Vercel Firewall rate limiting, Cloudflare rules).
const hits = new Map();
const RATE_MAX = Number(process.env.RATE_MAX || 5);
const RATE_WINDOW = Number(process.env.RATE_WINDOW_MS || 10 * 60 * 1000);

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW);
  list.push(now);
  hits.set(ip, list);
  return list.length > RATE_MAX;
}

export default async function handler(request) {
  const wantsJson = (request.headers.get("accept") || "").includes("application/json");
  const origin = new URL(request.url).origin;

  const reply = (status, body) =>
    wantsJson
      ? new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" }
        })
      : body.ok
        ? Response.redirect(origin + "/thanks.html", 303)
        : new Response(body.error, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });

  if (request.method !== "POST") {
    return new Response("Method not allowed", { status: 405, headers: { Allow: "POST" } });
  }

  let fields = {};
  try {
    const type = request.headers.get("content-type") || "";
    if (type.includes("application/json")) fields = await request.json();
    else fields = Object.fromEntries(await request.formData());
  } catch {
    return reply(400, { ok: false, error: "That submission could not be read." });
  }

  const entry = {
    ts: new Date().toISOString(),
    name: clean(fields.name, 100),
    email: clean(fields.email, 200),
    message: clean(fields.message, 5000),
    ip: request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown",
    ua: clean(request.headers.get("user-agent"), 300)
  };

  // Honeypot: answer as though it worked so the bot learns nothing.
  if (clean(fields.company, 200)) {
    console.log("[contact] honeypot tripped", JSON.stringify({ ip: entry.ip, ua: entry.ua }));
    return reply(200, { ok: true });
  }

  if (!entry.name) return reply(422, { ok: false, error: "Please add your name." });
  if (!EMAIL.test(entry.email)) return reply(422, { ok: false, error: "That email address looks incomplete." });
  if (entry.message.length < 2) return reply(422, { ok: false, error: "Please add a message." });

  if (rateLimited(entry.ip)) {
    return reply(429, { ok: false, error: "That's a few too many messages — try again shortly." });
  }

  const webhook = process.env.CONTACT_WEBHOOK_URL;
  if (webhook) {
    const summary = `New message from ${entry.name} <${entry.email}>\n\n${entry.message}`;
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // `text` suits Slack, `content` suits Discord, the rest suits everything else.
      body: JSON.stringify({ text: summary, content: summary, ...entry })
    }).catch((e) => ({ ok: false, status: 0, statusText: e.message }));

    if (!res.ok) {
      console.error("[contact] webhook rejected the message", res.status, res.statusText);
      return reply(502, { ok: false, error: "The message could not be delivered." });
    }
  } else {
    // Visible in `vercel logs` / your platform's log viewer.
    console.log("[contact]", JSON.stringify(entry));
  }

  return reply(200, { ok: true });
}
