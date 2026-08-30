/* Shared math + formatting helpers. Global namespace, no modules, so the
   app also runs from a plain file:// open for the demo mode. */
(function (TL) {
  'use strict';

  var G = 9.80665;                 // m/s^2
  var MPS_TO_MPH = 2.2369362920544;
  var MPS_TO_KMH = 3.6;
  var EARTH_R = 6371000;           // m

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function toRad(d) { return d * Math.PI / 180; }
  function toDeg(r) { return r * 180 / Math.PI; }

  /* Great-circle distance in metres. */
  function haversine(lat1, lon1, lat2, lon2) {
    var dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /* Initial bearing lat1,lon1 -> lat2,lon2, degrees clockwise from north. */
  function bearing(lat1, lon1, lat2, lon2) {
    var y = Math.sin(toRad(lon2 - lon1)) * Math.cos(toRad(lat2));
    var x = Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
            Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(toRad(lon2 - lon1));
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
  }

  /* Shortest signed difference a-b in degrees, in (-180, 180]. */
  function angleDiff(a, b) {
    var d = (a - b + 540) % 360 - 180;
    return d;
  }

  /* Offset a lat/lon by a local east/north displacement in metres. */
  function offsetLatLon(lat, lon, east, north) {
    return {
      lat: lat + toDeg(north / EARTH_R),
      lon: lon + toDeg(east / (EARTH_R * Math.cos(toRad(lat))))
    };
  }

  function vLen(v) { return Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]); }
  function vDot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function vCross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function vSub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function vScale(a, s) { return [a[0] * s, a[1] * s, a[2] * s]; }
  function vNorm(a) {
    var l = vLen(a);
    return l > 1e-9 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  }
  /* Component of a perpendicular to unit vector u. */
  function vReject(a, u) { return vSub(a, vScale(u, vDot(a, u))); }

  /* Exponential moving average coefficient for a time constant, given dt. */
  function emaAlpha(dt, tau) {
    if (!(tau > 0)) return 1;
    return 1 - Math.exp(-dt / tau);
  }

  function speedIn(mps, units) {
    return mps * (units === 'kmh' ? MPS_TO_KMH : MPS_TO_MPH);
  }
  function speedFrom(val, units) {
    return val / (units === 'kmh' ? MPS_TO_KMH : MPS_TO_MPH);
  }
  function speedUnit(units) { return units === 'kmh' ? 'km/h' : 'mph'; }

  function fmtSpeed(mps, units, dp) {
    var v = speedIn(mps || 0, units);
    return v.toFixed(dp == null ? 0 : dp);
  }
  function fmtDist(m, units) {
    if (units === 'kmh') {
      return m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
    }
    var mi = m / 1609.344;
    return mi < 0.1 ? Math.round(m * 3.28084) + ' ft' : mi.toFixed(mi < 10 ? 2 : 1) + ' mi';
  }
  function distUnit(units) { return units === 'kmh' ? 'km' : 'mi'; }
  function distIn(m, units) { return units === 'kmh' ? m / 1000 : m / 1609.344; }

  function fmtDuration(ms) {
    var s = Math.max(0, Math.round(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    function p(n) { return n < 10 ? '0' + n : '' + n; }
    return h > 0 ? h + ':' + p(m) + ':' + p(ss) : m + ':' + p(ss);
  }
  function fmtClock(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  function fmtDate(ts) {
    var d = new Date(ts);
    return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
  }
  function fmtG(a) { return (Math.abs(a) / G).toFixed(2); }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* Seeded PRNG so a demo profile replays identically when you want it to. */
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  TL.util = {
    G: G, MPS_TO_MPH: MPS_TO_MPH, MPS_TO_KMH: MPS_TO_KMH,
    clamp: clamp, toRad: toRad, toDeg: toDeg,
    haversine: haversine, bearing: bearing, angleDiff: angleDiff, offsetLatLon: offsetLatLon,
    vLen: vLen, vDot: vDot, vCross: vCross, vSub: vSub, vScale: vScale, vNorm: vNorm, vReject: vReject,
    emaAlpha: emaAlpha,
    speedIn: speedIn, speedFrom: speedFrom, speedUnit: speedUnit, fmtSpeed: fmtSpeed,
    fmtDist: fmtDist, distUnit: distUnit, distIn: distIn,
    fmtDuration: fmtDuration, fmtClock: fmtClock, fmtDate: fmtDate, fmtG: fmtG,
    uid: uid, mulberry32: mulberry32
  };
})(window.TL = window.TL || {});
