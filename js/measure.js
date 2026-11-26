/**
 * Rev-IQ measurement (M-001). Sends GA4 events only; no new cookies or vendors.
 * - cta_click: any link or button with data-cta="<id>"; untagged links to /contact
 *   report as cta_id "untagged_contact" until data-cta attributes are added.
 * - calculator_complete: once per page view, 2s after a visitor's own input
 *   produces a full result on a /tools calculator (prefilled share links alone do not count).
 * - scroll_depth: homepage only, 25/50/75/90 percent, once each per page view.
 * Not loaded on /book/download or /skills/bundles/download.
 */
(function () {
  function send(name, params) {
    if (typeof window.gtag === "function") window.gtag("event", name, params || {});
  }
  var path = location.pathname.replace(/\/$/, "") || "/";

  // CTA clicks
  document.addEventListener("click", function (e) {
    var el = e.target.closest ? e.target.closest("a[data-cta], button[data-cta], a[href]") : null;
    if (!el) return;
    var id = el.getAttribute("data-cta");
    if (!id) {
      var u;
      try { u = new URL(el.href, location.href); } catch (err) { return; }
      if (u.host !== location.host || !/^\/contact(\.html)?$/.test(u.pathname)) return;
      id = "untagged_contact";
    }
    send("cta_click", {
      cta_id: id,
      link_url: el.getAttribute("href") || "",
      cta_text: (el.textContent || "").trim().slice(0, 80),
    });
  }, true);

  // Calculator completions
  var calc = document.getElementById("calc");
  if (calc && path.indexOf("/tools/") === 0) {
    var tool = path.split("/").pop().replace(/\.html$/, "");
    var timer = null, done = false;
    var hasResult = function () {
      var el = document.getElementById("o-pb") || document.getElementById("o-total");
      var t = el ? (el.textContent || "").trim() : "";
      return t !== "" && t !== "-";
    };
    var onInput = function (e) {
      if (done || !e.isTrusted) return;
      clearTimeout(timer);
      timer = setTimeout(function () {
        if (!done && hasResult()) { done = true; send("calculator_complete", { tool: tool }); }
      }, 2000);
    };
    calc.addEventListener("input", onInput);
    calc.addEventListener("change", onInput);
  }

  // Homepage scroll depth
  if (path === "/" || path === "/index.html") {
    var marks = [25, 50, 75, 90], sent = {};
    var onScroll = function () {
      var h = document.documentElement.scrollHeight - window.innerHeight;
      if (h <= 0) return;
      var pct = (window.scrollY / h) * 100;
      marks.forEach(function (m) {
        if (pct >= m && !sent[m]) { sent[m] = true; send("scroll_depth", { percent: m }); }
      });
      if (sent[90]) window.removeEventListener("scroll", onScroll);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
  }
})();
