var CACHE = "sagarsoft-v5";
const PRECACHE_URLS = [
  "./",
  "./login.html",
  "./dashboard.html",
  "./css/base.css",
  "./css/login.css",
  "./css/dashboard.css",
  "./js/online-config.js",
  "./js/crypto-utils.js",
  "./js/storage.js",
  "./js/auth.js",
  "./js/login.js",
  "./js/dashboard.js",
  "./assets/app-icon-256.png",
  "./assets/SagarSoft.logo.png",
  "./manifest.json"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
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
    event.respondWith(caches.match(event.request).then(function (hit) { return hit || fetch(event.request); }));
    return;
  }
  if (url.pathname.indexOf(".html") >= 0 || url.pathname === "/" || url.pathname === "") {
    event.respondWith(
      fetch(event.request).then(function (response) {
        return caches.open(CACHE).then(function (cache) {
          if (response && response.status === 200) { cache.put(event.request, response.clone()); }
          return response;
        });
      }).catch(function () { return caches.match(event.request); })
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then(function (hit) {
      return hit || fetch(event.request).then(function (response) {
        return caches.open(CACHE).then(function (cache) {
          if (response && response.status === 200) {
            var clone = response.clone();
            cache.put(event.request, clone);
          }
          return response;
        });
      });
    })
  );
});
