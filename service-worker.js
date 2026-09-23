// Minimal service worker: no offline caching, just enough of a fetch
// handler for Chrome to consider this site an installable app. All
// requests pass straight through to the network unchanged.
self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  self.clients.claim();
});

self.addEventListener('fetch', function(event) {
  event.respondWith(fetch(event.request));
});
