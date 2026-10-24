/**
 * The opening screen: the AMBIT atom spins together out of two halves, locks with a hit
 * (flash, shock ring, sparks), AMBITION rises in letter by letter, a loading line fills, and
 * then the screen opens from the middle into the app.
 *
 * A tiny script at the very top of <body> runs before the page is drawn, so the first thing on
 * screen is this, not the page. It shows once per opening (launching the home-screen app or
 * opening the site), not on every page, reload or sign-in hop. It waits for the page to finish
 * loading (at most a few seconds) and a tap skips it. Customers' approval links skip it.
 * Everything is drawn with code and three small logo files, so it's sharp on any screen.
 * Styles: "Opening animation" in app/globals.css.
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

    var still = !!((w.matchMedia && w.matchMedia("(prefers-reduced-motion: reduce)").matches)
      || (navigator.connection && navigator.connection.saveData));

    var word = "AMBITION", letters = "";
    for (var i = 0; i < word.length; i++) {
      letters += '<span class="' + (i >= 5 ? "r" : "") + '" style="--i:' + i + '">' + word[i] + "</span>";
    }
    var sparks = "";
    for (var k = 0; k < 14; k++) {
      var ang = (k / 14) * 360 + (k % 2 ? 9 : -9), dist = 110 + (k * 37) % 90;
      sparks += '<i style="--a:' + ang + "deg;--d:" + dist + "px;--s:" + (0.6 + ((k * 7) % 5) / 6) + '"></i>';
    }

    var el = d.createElement("div");
    el.id = "ambit-splash";
    el.setAttribute("aria-hidden", "true");
    if (still) el.className = "still";
    el.innerHTML =
      '<div class="sp-grid"></div><div class="sp-glow"></div>' +
      '<div class="sp-stage">' +
        '<div class="sp-atom">' +
          '<div class="sp-streak"></div><div class="sp-ring"></div><div class="sp-ring two"></div><div class="sp-flash"></div>' +
          '<div class="sp-sparks">' + sparks + "</div>" +
          '<div class="sp-mark">' +
            '<img class="sp-w" src="/splash/atom-white.svg" alt="">' +
            '<img class="sp-r" src="/splash/atom-red.svg" alt="">' +
            '<img class="sp-c" src="/splash/atom-core.svg" alt="">' +
          "</div>" +
        "</div>" +
        '<div class="sp-word">' + letters + "</div>" +
        '<div class="sp-tag">AMBIT POLYURETHANE</div>' +
        '<div class="sp-load"><i></i></div>' +
      "</div>";
    d.body.appendChild(el);

    var done = false, started = 0, timers = [];
    function later(fn, ms) { timers.push(setTimeout(fn, ms)); }
    function finish() {
      if (done) return;
      done = true;
      timers.forEach(clearTimeout);
      el.classList.add("out");
      setTimeout(function () { el.remove(); }, 900);
    }
    // The animation runs about 2.3 seconds; after that it leaves as soon as the page has loaded.
    var MIN = still ? 900 : 2300;
    function ready() {
      if (done) return;
      var left = MIN - (Date.now() - started);
      if (left > 0) return later(ready, left);
      if (d.readyState !== "complete") return later(ready, 120);
      finish();
    }
    function go() {
      if (started) return;
      started = Date.now();
      el.classList.add("go");
      later(ready, MIN);
    }
    el.addEventListener("click", finish);
    w.addEventListener("pageshow", function (e) { if (e.persisted) finish(); });

    // Start once the logo files are in (they're tiny and cached after the first time).
    var imgs = el.querySelectorAll("img"), loaded = 0;
    for (var j = 0; j < imgs.length; j++) {
      if (imgs[j].complete) { loaded++; continue; }
      imgs[j].addEventListener("load", function () { if (++loaded >= imgs.length) go(); });
      imgs[j].addEventListener("error", go);
    }
    if (loaded >= imgs.length) go();
    later(go, 700);
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
