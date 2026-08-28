/* Persistence. Everything stays in this browser — no account, no upload,
   no server. That is a deliberate property of the app, not a limitation. */
(function (TL) {
  'use strict';
  var SETTINGS_KEY = 'tl.settings.v1';
  var TRIPS_KEY = 'tl.trips.v1';
  var MAX_TRIPS = 200;

  var DEFAULTS = {
    units: 'mph',
    sensitivity: 'standard',
    voice: true,
    beeps: true,
    vibrate: true,
    keepAwake: true,
    limitMode: 'manual',        // 'manual' | 'off'
    defaultLimit: 30,           // in display units
    demoRate: 12,
    demoProfile: 'average'
  };

  function safeGet(key) {
    try { return window.localStorage.getItem(key); } catch (e) { return null; }
  }
  function safeSet(key, val) {
    try { window.localStorage.setItem(key, val); return true; }
    catch (e) { return false; }
  }

  function loadSettings() {
    var raw = safeGet(SETTINGS_KEY), out = {};
    Object.keys(DEFAULTS).forEach(function (k) { out[k] = DEFAULTS[k]; });
    if (raw) {
      try {
        var o = JSON.parse(raw);
        Object.keys(DEFAULTS).forEach(function (k) {
          if (o[k] !== undefined) out[k] = o[k];
        });
      } catch (e) { /* corrupt settings should not brick the app */ }
    }
    return out;
  }
  function saveSettings(s) { safeSet(SETTINGS_KEY, JSON.stringify(s)); }

  function loadTrips() {
    var raw = safeGet(TRIPS_KEY);
    if (!raw) return [];
    try {
      var a = JSON.parse(raw);
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }

  function writeTrips(trips) {
    if (safeSet(TRIPS_KEY, JSON.stringify(trips))) return true;
    // Out of quota: drop route geometry from the oldest trips first. Scores
    // and events are the valuable part; the map line is not.
    var copy = trips.map(function (t) { return t; });
    for (var i = copy.length - 1; i >= 0; i--) {
      if (copy[i].route && copy[i].route.length) {
        copy[i] = Object.assign({}, copy[i], { route: [], routeDropped: true });
        if (safeSet(TRIPS_KEY, JSON.stringify(copy))) {
          trips.length = 0; Array.prototype.push.apply(trips, copy);
          return true;
        }
      }
    }
    while (copy.length > 1) {
      copy.pop();
      if (safeSet(TRIPS_KEY, JSON.stringify(copy))) {
        trips.length = 0; Array.prototype.push.apply(trips, copy);
        return true;
      }
    }
    return false;
  }

  function saveTrip(rec) {
    var trips = loadTrips();
    trips.unshift(rec);
    while (trips.length > MAX_TRIPS) trips.pop();
    return writeTrips(trips) ? trips : null;
  }
  function deleteTrip(id) {
    var trips = loadTrips().filter(function (t) { return t.id !== id; });
    writeTrips(trips);
    return trips;
  }
  function clearTrips() {
    safeSet(TRIPS_KEY, '[]');
    return [];
  }
  function available() {
    try {
      window.localStorage.setItem('tl.probe', '1');
      window.localStorage.removeItem('tl.probe');
      return true;
    } catch (e) { return false; }
  }

  TL.storage = {
    DEFAULTS: DEFAULTS, loadSettings: loadSettings, saveSettings: saveSettings,
    loadTrips: loadTrips, saveTrip: saveTrip, deleteTrip: deleteTrip,
    clearTrips: clearTrips, available: available
  };
})(window.TL = window.TL || {});
