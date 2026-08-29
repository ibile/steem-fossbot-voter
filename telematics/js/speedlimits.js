/* Automatic speed limits by map-matching against OpenStreetMap.
 *
 * Asking the driver to tap the limit every time it changes is both distracting
 * and unreliable — miss one change and the trip is scored against the wrong
 * number. So the limit is looked up instead: fetch the roads around the car
 * once every kilometre or so, match the current position and heading to a road,
 * and read its maxspeed tag.
 *
 * Only ways that actually carry a limit tag are requested, which keeps the
 * responses small and means "no data" is reported honestly rather than guessed.
 */
(function (TL) {
  'use strict';
  var U = TL.util;
  var MPH = 0.44704, KMH = 1 / 3.6;

  var ENDPOINTS = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
    'https://overpass.osm.jp/api/interpreter'
  ];

  var RADIUS_M = 1800;        // how much road to pull in one go
  var REFETCH_M = 1000;       // travel from the fetch centre before refreshing
  var LOOK_AHEAD_M = 500;     // bias the centre along the direction of travel
  var MATCH_BASE_M = 26;      // how close a road must be to be a candidate
  var MIN_GAP_MS = 15000;     // never hammer the endpoint
  var TIMEOUT_MS = 14000;

  /* --- tag parsing ------------------------------------------------------- */
  /* Returns m/s, or null when the tag does not state a usable numeric limit. */
  function parseMaxspeed(tags) {
    var raw = tags.maxspeed;
    if (raw != null) {
      var s = String(raw).trim().toLowerCase();
      // "none" (unlimited autobahn), "signals"/"variable" (gantry-controlled)
      // and conditional lists are all real values we cannot score against.
      if (s === 'none' || s === 'signals' || s === 'variable') return null;
      if (s === 'walk' || s === 'foot') return 5 * KMH;
      if (s.indexOf(';') >= 0 || s.indexOf('@') >= 0) return null;
      var m = s.match(/^([0-9]+(?:\.[0-9]+)?)\s*(mph|km\/h|kmh|kph)?$/);
      if (m) {
        var n = parseFloat(m[1]);
        if (!isFinite(n) || n <= 0 || n > 90) return null;   // 90 m/s sanity cap
        return m[2] === 'mph' ? n * MPH : n * KMH;
      }
      // Some ways carry an implied-limit code directly in maxspeed.
      var implied = parseImplied(s);
      if (implied) return implied;
    }
    var t = tags['maxspeed:type'] || tags['source:maxspeed'] || tags['zone:maxspeed'];
    return t ? parseImplied(String(t).trim().toLowerCase()) : null;
  }

  /* Implied national limits. Only codes whose meaning is unambiguous are
     honoured — a wrong limit is worse than no limit. */
  function parseImplied(t) {
    if (t.indexOf('gb:motorway') >= 0) return 70 * MPH;
    if (t.indexOf('gb:nsl_dual') >= 0) return 70 * MPH;
    if (t.indexOf('gb:nsl_single') >= 0) return 60 * MPH;
    var gbZone = t.match(/gb:zone[:_]?([0-9]{2})/);
    if (gbZone) return parseFloat(gbZone[1]) * MPH;
    // "<country>:zone30" style, metric.
    var zone = t.match(/^[a-z]{2}:zone[:_]?([0-9]{2,3})$/);
    if (zone) return parseFloat(zone[1]) * KMH;
    return null;
  }

  function roadRank(highway) {
    switch (highway) {
      case 'motorway': case 'motorway_link': return 6;
      case 'trunk': case 'trunk_link': return 5;
      case 'primary': case 'primary_link': return 4;
      case 'secondary': case 'secondary_link': return 3;
      case 'tertiary': case 'tertiary_link': return 2;
      default: return 1;
    }
  }

  /* --- provider ---------------------------------------------------------- */
  function SpeedLimits() {
    this.reset();
  }

  SpeedLimits.prototype.reset = function () {
    this.ways = [];
    this.origin = null;
    this.center = null;
    this.status = 'idle';       // idle | fetching | ok | error | offline
    this.error = null;
    this.lastFetchT = 0;
    this.backoffMs = 0;
    this.failures = 0;
    this.current = null;        // {limit, name, highway, dist}
    this.lastWayKey = null;
    this.fetchCount = 0;
    this.abort = null;
  };

  SpeedLimits.prototype.stop = function () {
    if (this.abort) { try { this.abort.abort(); } catch (e) {} this.abort = null; }
  };

  /* Equirectangular projection is exact enough over a couple of kilometres
     and keeps matching to cheap plane geometry. */
  SpeedLimits.prototype._local = function (lat, lon) {
    var o = this.origin;
    var kx = 111320 * Math.cos(U.toRad(o.lat));
    return [(lon - o.lon) * kx, (lat - o.lat) * 110540];
  };

  /* Feed every position fix. Returns the current match (or null). */
  SpeedLimits.prototype.update = function (fix) {
    var need = false;
    if (!this.center) {
      need = true;
    } else {
      var d = U.haversine(fix.lat, fix.lon, this.center.lat, this.center.lon);
      if (d > REFETCH_M) need = true;
    }
    if (need) this._maybeFetch(fix);
    return this.match(fix);
  };

  SpeedLimits.prototype._maybeFetch = function (fix) {
    var now = Date.now();
    if (this.status === 'fetching') return;
    if (now - this.lastFetchT < Math.max(MIN_GAP_MS, this.backoffMs)) return;
    if (typeof fetch !== 'function') {
      this.status = 'offline';
      this.error = 'This browser cannot make the network request.';
      return;
    }
    this.lastFetchT = now;
    this._fetch(fix);
  };

  SpeedLimits.prototype._fetch = function (fix) {
    var self = this;
    // Look ahead: by the time the data lands the car has moved on.
    var c = { lat: fix.lat, lon: fix.lon };
    if (fix.heading != null && fix.speed > 8) {
      var p = U.offsetLatLon(fix.lat, fix.lon,
        LOOK_AHEAD_M * Math.sin(U.toRad(fix.heading)),
        LOOK_AHEAD_M * Math.cos(U.toRad(fix.heading)));
      c = { lat: p.lat, lon: p.lon };
    }

    var q = '[out:json][timeout:25];(' +
      'way(around:' + RADIUS_M + ',' + c.lat.toFixed(5) + ',' + c.lon.toFixed(5) + ')["highway"]["maxspeed"];' +
      'way(around:' + RADIUS_M + ',' + c.lat.toFixed(5) + ',' + c.lon.toFixed(5) + ')["highway"]["maxspeed:type"];' +
      ');out tags geom;';

    var endpoint = ENDPOINTS[this.failures % ENDPOINTS.length];
    this.status = 'fetching';
    this.error = null;

    var ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
    this.abort = ctrl;
    var timer = setTimeout(function () { if (ctrl) try { ctrl.abort(); } catch (e) {} }, TIMEOUT_MS);

    return fetch(endpoint, {
      method: 'POST',
      body: 'data=' + encodeURIComponent(q),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }).then(function (json) {
      clearTimeout(timer);
      self.abort = null;
      self._ingest(json, c);
    }).catch(function (err) {
      clearTimeout(timer);
      self.abort = null;
      self.failures++;
      self.backoffMs = Math.min(120000, 20000 * self.failures);
      self.status = 'error';
      self.error = describeFetchError(err);
    });
  };

  /* One-off lookup at a fixed point, for the diagnostics screen. Always
     resolves — the result says whether it worked. */
  SpeedLimits.prototype.testLookup = function (lat, lon) {
    var self = this;
    this.lastFetchT = Date.now();
    return this._fetch({ lat: lat, lon: lon, heading: null, speed: 0 }).then(function () {
      var m = self.match({ lat: lat, lon: lon, heading: null, speed: 0, accuracy: 12 });
      return {
        ok: self.status === 'ok' && self.ways.length > 0,
        status: self.status, ways: self.ways.length,
        match: m, error: self.error
      };
    });
  };

  function describeFetchError(err) {
    var msg = String((err && err.message) || err || '');
    if (/abort/i.test(msg)) return 'The lookup timed out.';
    if (/HTTP 429/.test(msg)) return 'The map service is rate limiting; it will retry shortly.';
    if (/HTTP 50/.test(msg)) return 'The map service is temporarily unavailable.';
    if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
      return 'Could not reach the map service — no connection, or this page is not allowed to make the request.';
    }
    return msg || 'Lookup failed.';
  }

  SpeedLimits.prototype._ingest = function (json, center) {
    var els = (json && json.elements) || [];
    if (!Array.isArray(els)) { this.status = 'error'; this.error = 'Unexpected response.'; return; }

    this.origin = { lat: center.lat, lon: center.lon };
    var ways = [];
    for (var i = 0; i < els.length; i++) {
      var e = els[i];
      if (!e || e.type !== 'way' || !e.tags || !Array.isArray(e.geometry)) continue;
      var limit = parseMaxspeed(e.tags);
      if (!(limit > 0)) continue;
      var g = e.geometry, xs = [], ys = [];
      for (var j = 0; j < g.length; j++) {
        var pt = g[j];
        if (!pt || typeof pt.lat !== 'number' || typeof pt.lon !== 'number') continue;
        var l = this._local(pt.lat, pt.lon);
        xs.push(l[0]); ys.push(l[1]);
      }
      if (xs.length < 2) continue;
      ways.push({
        key: 'w' + e.id,
        limit: limit,
        name: e.tags.name || e.tags.ref || null,
        highway: e.tags.highway || '',
        rank: roadRank(e.tags.highway),
        xs: xs, ys: ys
      });
    }
    this.ways = ways;
    this.center = { lat: center.lat, lon: center.lon };
    this.fetchCount++;
    this.failures = 0;
    this.backoffMs = 0;
    this.status = 'ok';
    this.error = ways.length ? null : 'No roads with a published limit near here.';
  };

  /* Squared distance from a point to a segment, plus the segment's bearing. */
  function segDist2(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var len2 = dx * dx + dy * dy;
    var t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var cx = ax + t * dx, cy = ay + t * dy;
    return { d2: (px - cx) * (px - cx) + (py - cy) * (py - cy), dx: dx, dy: dy };
  }

  SpeedLimits.prototype.match = function (fix) {
    if (!this.origin || !this.ways.length) { this.current = null; return null; }
    var p = this._local(fix.lat, fix.lon);
    var px = p[0], py = p[1];
    var tol = Math.max(MATCH_BASE_M, Math.min(60, (fix.accuracy || 12) * 1.6));
    var best = null, prev = null;

    for (var i = 0; i < this.ways.length; i++) {
      var w = this.ways[i];
      var bd2 = Infinity, bdx = 0, bdy = 0;
      for (var j = 1; j < w.xs.length; j++) {
        var r = segDist2(px, py, w.xs[j - 1], w.ys[j - 1], w.xs[j], w.ys[j]);
        if (r.d2 < bd2) { bd2 = r.d2; bdx = r.dx; bdy = r.dy; }
      }
      var dist = Math.sqrt(bd2);
      if (dist > tol) continue;

      // Prefer a road running the way we are actually travelling: it separates
      // a dual carriageway from the side road beside it.
      var align = 1;
      if (fix.heading != null && fix.speed > 4) {
        var segBearing = U.toDeg(Math.atan2(bdx, bdy));
        var diff = Math.abs(U.angleDiff(segBearing, fix.heading));
        if (diff > 90) diff = 180 - diff;              // roads are bidirectional
        align = Math.cos(U.toRad(diff));
      }
      var cost = dist + 45 * (1 - align) - w.rank * 1.5;
      var cand = { way: w, dist: dist, cost: cost };
      if (!best || cost < best.cost) best = cand;
      if (w.key === this.lastWayKey) prev = cand;
    }

    // Stickiness: only leave the road we were on when something is clearly
    // better, or the score flickers between parallel roads at every fix.
    var chosen = best;
    if (prev && best && prev !== best && prev.cost < best.cost + 12) chosen = prev;
    if (!chosen) { this.current = null; this.lastWayKey = null; return null; }

    this.lastWayKey = chosen.way.key;
    this.current = {
      limit: chosen.way.limit,
      name: chosen.way.name,
      highway: chosen.way.highway,
      dist: chosen.dist
    };
    return this.current;
  };

  SpeedLimits.prototype.describe = function () {
    if (this.status === 'fetching' && !this.ways.length) return 'Looking up roads nearby…';
    if (this.status === 'error' || this.status === 'offline') return this.error || 'Lookup unavailable.';
    if (!this.ways.length) return this.error || 'No limit data loaded yet.';
    if (!this.current) return 'No mapped limit for this road.';
    return this.current.name || (this.current.highway || 'road').replace(/_/g, ' ');
  };

  TL.SpeedLimits = SpeedLimits;
  TL.parseMaxspeed = parseMaxspeed;
})(window.TL = window.TL || {});
