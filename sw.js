var CACHE = "sagarsoft-v104";
const PRECACHE_URLS = [
  "./",
  "./login.html",
  "./dashboard.html",
  "./css/base.css?v=20260817c",
  "./css/dashboard.css?v=20260817c",
  "./js/online-config.js?v=20260817a",
  "./js/crypto-utils.js?v=20260817a",
  "./js/utils.js?v=20260817a",
  "./js/storage.js?v=20260817a",
  "./js/enterprise.js?v=20260817a",
  "./js/auth.js?v=20260817a",
  "./js/login.js?v=20260817a",
  "./js/dashboard.js?v=20260817a",
  "./assets/SagarSoft.logo.png",
  "./assets/parents.png",
  "./manifest.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return Promise.all(
        PRECACHE_URLS.map(function (url) {
          return cache.add(url).catch(function () { return null; });
        })
      );
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) { return key !== CACHE; }).map(function (key) { return caches.delete(key); })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

self.addEventListener("fetch", function (event) {
  if (event.request.method !== "GET") return;
  var url = new URL(event.request.url);

  if (url.pathname.match(/\.(?:png|ico|svg|jpg|jpeg|gif|woff2?|ttf|eot)$/)) {
    event.respondWith(
      caches.match(event.request).then(function (hit) {
        return hit || fetch(event.request).catch(function () { return new Response("", { status: 404 }); });
      })
    );
    return;
  }

  if (url.pathname.indexOf(".html") >= 0 || url.pathname === "/" || url.pathname === "") {
    event.respondWith(
      fetch(event.request).then(function (response) {
        if (response && response.status === 200) {
          var clone = response.clone();
          caches.open(CACHE).then(function (cache) { cache.put(event.request, clone); });
        }
        return response;
      }).catch(function () {
        return caches.match(event.request).then(function (hit) {
          return hit || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } });
        });
      })
    );
    return;
  }

  event.respondWith(
    fetch(event.request, { cache: "no-store" }).then(function (response) {
      if (response && response.status === 200) {
        var clone = response.clone();
        caches.open(CACHE).then(function (cache) { cache.put(event.request, clone); });
      }
      return response;
    }).catch(function () {
      return caches.match(event.request).then(function (hit) {
        return hit || new Response("", { status: 503 });
      });
    })
  );
});
