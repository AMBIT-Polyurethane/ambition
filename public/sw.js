/* AMBIT Intelligence: lets the crew's work orders (/ops/field) open with no signal.
 * - Pages: from the network as usual; when there's no network, the last copy of /ops/field.
 * - App files (/_next/static, which never change once built): from the phone once saved.
 * - Everything else (the database, sign-in, other sites) is left alone.
 * Registered by the field app only. */

const VERSION = "ambit-field-v1";
const PAGES = `${VERSION}-pages`;
const STATIC = `${VERSION}-static`;
const FIELD = "/ops/field";

self.addEventListener("install", (event) => {
  event.waitUntil(saveField().catch(() => {}).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ambit-field-") && k !== PAGES && k !== STATIC).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "save-field") event.waitUntil(saveField().catch(() => {}));
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(fromCacheFirst(req));
    return;
  }

  if (req.mode === "navigate") {
    // Signing out or in (maybe as someone else on a shared phone): forget the saved page.
    if (url.pathname === "/signin" || url.pathname.startsWith("/auth/")) {
      event.waitUntil(caches.delete(PAGES));
      return;
    }
    event.respondWith(page(req, url));
  }
});

async function page(req, url) {
  try {
    const res = await fetch(req);
    if (url.pathname === FIELD && res.ok && !res.redirected && (res.headers.get("content-type") || "").includes("text/html")) {
      const copy = res.clone();
      copy
        .text()
        .then((html) => keepField(html))
        .catch(() => {});
    }
    return res;
  } catch (e) {
    const cache = await caches.open(PAGES);
    const hit = await cache.match(FIELD, { ignoreVary: true, ignoreSearch: true });
    // Any page with no signal goes to the work orders (the one page that works offline).
    if (hit) return url.pathname === FIELD ? hit : Response.redirect(new URL(FIELD, self.location.origin).href, 302);
    return new Response(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title>' +
        '<body style="font-family:system-ui;background:#0a0a0b;color:#eee;padding:32px"><h2>No signal</h2>' +
        "<p>Open Work orders once while you have signal and it will work offline after that.</p></body>",
      { headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
}

async function fromCacheFirst(req) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone()).then(trim).catch(() => {});
  return res;
}

// Saves the field page and every app file it uses.
async function saveField() {
  const res = await fetch(FIELD, { credentials: "same-origin", redirect: "follow" });
  if (!res.ok || res.redirected || !(res.headers.get("content-type") || "").includes("text/html")) return;
  const html = await res.text();
  await keepField(html);
}

async function keepField(html) {
  const pages = await caches.open(PAGES);
  await pages.put(FIELD, new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }));
  const found = new Set();
  const re = /(?:\/_next\/)?static\/(?:chunks|css|media)\/[^"'\\\s)<>]+/g;
  let m;
  while ((m = re.exec(html))) {
    const p = m[0].startsWith("/_next/") ? m[0] : `/_next/${m[0]}`;
    found.add(p);
  }
  const cache = await caches.open(STATIC);
  await Promise.all(
    [...found].map(async (p) => {
      if (await cache.match(p)) return;
      try {
        const r = await fetch(p, { credentials: "same-origin" });
        if (r.ok) await cache.put(p, r);
      } catch (e) {
        /* next time */
      }
    }),
  );
  await trim();
}

// Old app files from earlier versions: keep the newest 600.
async function trim() {
  const cache = await caches.open(STATIC);
  const keys = await cache.keys();
  if (keys.length <= 600) return;
  await Promise.all(keys.slice(0, keys.length - 600).map((k) => cache.delete(k)));
}
