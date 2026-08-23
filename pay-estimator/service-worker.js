/* Offline shell for the installed app. Bump CACHE when index.html changes. */
var CACHE = "rota-payslip-v1";
var SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png"];

self.addEventListener("install", function(e){
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); })
    .then(function(){ return self.skipWaiting(); }));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(keys){
    return Promise.all(keys.map(function(k){ return k === CACHE ? null : caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

function keep(req, res){
  if(res && (res.ok || res.type === "opaque")){
    var copy = res.clone();
    caches.open(CACHE).then(function(c){ c.put(req, copy); }).catch(function(){});
  }
  return res;
}

self.addEventListener("fetch", function(e){
  var req = e.request;
  if(req.method !== "GET") return;

  /* the page itself: network first, so an update lands as soon as there's signal */
  if(req.mode === "navigate"){
    e.respondWith(fetch(req).then(function(res){ return keep(req, res); })
      .catch(function(){
        return caches.match("./index.html").then(function(r){ return r || caches.match("./"); });
      }));
    return;
  }

  /* everything else, fonts included: cache first, then fill the cache as we go */
  e.respondWith(caches.match(req).then(function(hit){
    return hit || fetch(req).then(function(res){ return keep(req, res); }).catch(function(){ return hit; });
  }));
});
