/**
 * The AMBIT logo animation that plays when the app is opened.
 *
 * A tiny script at the very top of <body> runs before the page is drawn, so the first thing on
 * screen is the animation, not the page. It shows once per opening (launching the home-screen
 * app or opening the site), not on every page, reload or sign-in hop. Tap to skip.
 * Customers' approval links skip it. Phones get the tall version, computers the wide one.
 */
const SCRIPT = `(function () {
  try {
    var d = document, w = window, p = location.pathname;
    if (/^\\/(approve|auth)(\\/|$)/.test(p)) return;
    var nav = (performance.getEntriesByType && performance.getEntriesByType("navigation")[0]) || {};
    if (nav.type && nav.type !== "navigate") return;
    if (d.referrer) { try { if (new URL(d.referrer).origin === location.origin) return; } catch (e) {} }
    var KEY = "ambit-splash", now = Date.now(), last = 0;
    try { last = Number(sessionStorage.getItem(KEY)) || 0; sessionStorage.setItem(KEY, String(now)); } catch (e) { return; }
    if (now - last < 10 * 60 * 1000) return;

    var tall = w.innerHeight > w.innerWidth, v = tall ? "tall" : "wide";
    var still = (w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches)
      || (navigator.connection && navigator.connection.saveData);

    var el = d.createElement("div");
    el.id = "ambit-splash";
    el.setAttribute("aria-hidden", "true");
    el.style.backgroundImage = "url(/splash/start-" + v + ".jpg)";
    d.body.appendChild(el);

    var done = false, timers = [];
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function finish() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      el.className = "out";
      setTimeout(function () { el.remove(); }, 600);
    }
    function showEnd(ms) {
      el.style.backgroundImage = "url(/splash/end-" + v + ".jpg)";
      if (vid) vid.style.opacity = "0";
      later(finish, ms);
    }
    el.addEventListener("click", finish);
    w.addEventListener("pageshow", function (e) { if (e.persisted) finish(); });

    var vid = null;
    if (still) { showEnd(900); return; }

    vid = d.createElement("video");
    vid.muted = true; vid.defaultMuted = true; vid.playsInline = true; vid.autoplay = true;
    vid.setAttribute("muted", ""); vid.setAttribute("playsinline", ""); vid.setAttribute("webkit-playsinline", "");
    vid.preload = "auto";
    vid.poster = "/splash/start-" + v + ".jpg";
    vid.src = "/splash/intro-" + v + ".mp4";
    var started = false;
    vid.addEventListener("playing", function () { started = true; vid.style.opacity = "1"; });
    vid.addEventListener("ended", function () { el.style.backgroundImage = "url(/splash/end-" + v + ".jpg)"; finish(); });
    vid.addEventListener("error", function () { if (!done) showEnd(600); });
    el.appendChild(vid);
    var pr = vid.play();
    if (pr && pr.catch) pr.catch(function () { if (!started && !done) showEnd(900); });
    // Slow connection: don't keep people waiting for the video.
    later(function () { if (!started && !done) showEnd(500); }, 2500);
    // Hard stop, whatever happens.
    later(finish, 6000);
  } catch (e) {
    var s = document.getElementById("ambit-splash");
    if (s) s.remove();
  }
})();`;

export function Splash() {
  return <script id="ambit-splash-boot" dangerouslySetInnerHTML={{ __html: SCRIPT }} />;
}
