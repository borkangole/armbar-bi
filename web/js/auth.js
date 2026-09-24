/*
 * ArmBar BI - browser side of the login. Holds NO passwords or hashes:
 * credentials are checked on the server (api/login.js) and the session lives in an
 * HttpOnly cookie that this script cannot read. The dashboard itself is protected by
 * middleware.js on Vercel.
 */
(function () {
  "use strict";
  var offline = location.protocol === "file:";
  function call(path, opts) {
    if (offline) return Promise.resolve({ ok: false, status: 0, data: { error: "Log in on the live site (armbar.site) or run the site with `npx vercel dev`." } });
    return fetch(path, Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, opts || {}))
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return { ok: r.ok, status: r.status, data: d }; }); })
      .catch(function () { return { ok: false, status: 0, data: { error: "Can't reach the server. Check your connection." } }; });
  }
  window.ArmBarAuth = {
    offline: offline,
    signIn: function (username, password, remember) {
      return call("/api/login", { method: "POST", body: JSON.stringify({ username: username, password: password, remember: !!remember }) });
    },
    session: function () { return call("/api/session"); },
    signOut: function () { return call("/api/logout", { method: "POST" }); },
  };
})();
