/* Hardware access + honest capability reporting.
 *
 * Everything here can legitimately fail: an insecure origin, a browser that
 * never shipped DeviceMotion, iOS wanting an explicit gesture-bound grant, or
 * an embedding page whose permissions policy silently withholds the sensors.
 * The app is only useful if it says which of those happened, so probe() runs
 * real requests and reports what actually came back rather than guessing from
 * feature detection alone. */
(function (TL) {
  'use strict';

  var geoWatch = null, motionHandler = null, wakeLock = null;

  function inIframe() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  function statics() {
    var hasMotionApi = typeof window.DeviceMotionEvent !== 'undefined';
    return {
      secure: window.isSecureContext !== false,
      protocol: location.protocol,
      geoApi: 'geolocation' in navigator,
      motionApi: hasMotionApi,
      motionNeedsGesture: hasMotionApi &&
        typeof window.DeviceMotionEvent.requestPermission === 'function',
      wakeLockApi: 'wakeLock' in navigator,
      vibrateApi: !!navigator.vibrate,
      iframe: inIframe(),
      storage: TL.storage.available()
    };
  }

  /* Ask for motion permission. Must be called synchronously from a tap. */
  function requestMotion() {
    var hasApi = typeof window.DeviceMotionEvent !== 'undefined';
    if (!hasApi) return Promise.resolve({ ok: false, state: 'unsupported' });
    if (typeof window.DeviceMotionEvent.requestPermission !== 'function') {
      return Promise.resolve({ ok: true, state: 'granted' });
    }
    return window.DeviceMotionEvent.requestPermission()
      .then(function (r) { return { ok: r === 'granted', state: r }; })
      .catch(function (e) { return { ok: false, state: 'error', message: String(e && e.message || e) }; });
  }

  /* Listen for one real devicemotion event; silence means blocked or absent. */
  function probeMotion(timeoutMs) {
    return new Promise(function (resolve) {
      if (typeof window.DeviceMotionEvent === 'undefined') {
        resolve({ ok: false, reason: 'No DeviceMotion API in this browser.' });
        return;
      }
      var done = false;
      function onEvt(e) {
        if (done) return;
        done = true;
        window.removeEventListener('devicemotion', onEvt);
        clearTimeout(timer);
        var a = e.accelerationIncludingGravity;
        var r = e.rotationRate;
        var hasAcc = !!(a && (a.x !== null || a.y !== null || a.z !== null));
        var hasGyro = !!(r && (r.alpha !== null || r.beta !== null || r.gamma !== null));
        resolve({
          ok: hasAcc, gyro: hasGyro,
          interval: e.interval || null,
          reason: hasAcc ? null : 'Events fire but carry no accelerometer values.'
        });
      }
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        window.removeEventListener('devicemotion', onEvt);
        resolve({
          ok: false,
          reason: inIframe()
            ? 'No motion events arrived. The page is embedded, and the embedding page must allow accelerometer and gyroscope.'
            : 'No motion events arrived. The device may have no motion sensors, or permission was refused.'
        });
      }, timeoutMs || 1800);
      window.addEventListener('devicemotion', onEvt);
    });
  }

  function probeGeo(timeoutMs) {
    return new Promise(function (resolve) {
      if (!('geolocation' in navigator)) {
        resolve({ ok: false, reason: 'No Geolocation API in this browser.' });
        return;
      }
      var done = false;
      var timer = setTimeout(function () {
        if (done) return;
        done = true;
        resolve({ ok: false, reason: 'Timed out waiting for a position fix.' });
      }, (timeoutMs || 12000) + 500);
      navigator.geolocation.getCurrentPosition(function (pos) {
        if (done) return;
        done = true; clearTimeout(timer);
        resolve({
          ok: true,
          lat: pos.coords.latitude, lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          hasSpeed: pos.coords.speed !== null && pos.coords.speed !== undefined,
          hasHeading: pos.coords.heading !== null && pos.coords.heading !== undefined
        });
      }, function (err) {
        if (done) return;
        done = true; clearTimeout(timer);
        var reason;
        if (err.code === 1) {
          reason = inIframe()
            ? 'Location was denied. Either you declined the prompt, or the embedding page does not allow geolocation.'
            : 'Location was denied. Allow location for this site in your browser settings.';
        } else if (err.code === 2) {
          reason = 'Position unavailable — no satellite or network fix yet. Outdoors with a clear view of the sky works best.';
        } else {
          reason = 'Timed out waiting for a position fix.';
        }
        resolve({ ok: false, code: err.code, reason: reason });
      }, { enableHighAccuracy: true, timeout: timeoutMs || 12000, maximumAge: 0 });
    });
  }

  function probe() {
    var s = statics();
    if (!s.secure) {
      return Promise.resolve({
        statics: s, geo: { ok: false, reason: 'Sensors need a secure origin. Open the page over https:// or on localhost.' },
        motion: { ok: false, reason: 'Sensors need a secure origin.' }
      });
    }
    return Promise.all([probeGeo(12000), probeMotion(1800)]).then(function (r) {
      return { statics: s, geo: r[0], motion: r[1] };
    });
  }

  /* --- live streams ------------------------------------------------------ */
  function startGeo(onFix, onError) {
    stopGeo();
    if (!('geolocation' in navigator)) {
      if (onError) onError({ code: 0, message: 'Geolocation unsupported' });
      return false;
    }
    geoWatch = navigator.geolocation.watchPosition(function (pos) {
      var c = pos.coords;
      onFix({
        t: Date.now(),
        lat: c.latitude, lon: c.longitude,
        speed: (c.speed === null || c.speed === undefined || isNaN(c.speed)) ? null : c.speed,
        heading: (c.heading === null || c.heading === undefined || isNaN(c.heading)) ? null : c.heading,
        accuracy: c.accuracy,
        speedAccuracy: c.speedAccuracy != null ? c.speedAccuracy : null
      });
    }, function (err) { if (onError) onError(err); },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
    return true;
  }
  function stopGeo() {
    if (geoWatch != null && navigator.geolocation) navigator.geolocation.clearWatch(geoWatch);
    geoWatch = null;
  }

  function startMotion(onMotion) {
    stopMotion();
    if (typeof window.DeviceMotionEvent === 'undefined') return false;
    motionHandler = function (e) {
      var a = e.accelerationIncludingGravity;
      if (!a || a.x === null) return;
      var r = e.rotationRate;
      onMotion({
        t: Date.now(),
        ax: a.x, ay: a.y, az: a.z,
        // DeviceMotion names rotation by Euler angle: alpha about z, beta
        // about x, gamma about y. Reorder into a plain (x, y, z) vector.
        rx: r && r.beta != null ? r.beta : null,
        ry: r && r.gamma != null ? r.gamma : null,
        rz: r && r.alpha != null ? r.alpha : null
      });
    };
    window.addEventListener('devicemotion', motionHandler);
    return true;
  }
  function stopMotion() {
    if (motionHandler) window.removeEventListener('devicemotion', motionHandler);
    motionHandler = null;
  }

  function keepAwake(on) {
    if (!('wakeLock' in navigator)) return Promise.resolve(false);
    if (!on) {
      if (wakeLock) { try { wakeLock.release(); } catch (e) {} wakeLock = null; }
      return Promise.resolve(false);
    }
    return navigator.wakeLock.request('screen').then(function (l) {
      wakeLock = l;
      l.addEventListener('release', function () { wakeLock = null; });
      return true;
    }).catch(function () { return false; });
  }
  function reacquireWakeLock() {
    if (document.visibilityState === 'visible' && wakeLock === null) keepAwake(true);
  }

  TL.sensors = {
    statics: statics, probe: probe, probeGeo: probeGeo, probeMotion: probeMotion,
    requestMotion: requestMotion,
    startGeo: startGeo, stopGeo: stopGeo,
    startMotion: startMotion, stopMotion: stopMotion,
    keepAwake: keepAwake, reacquireWakeLock: reacquireWakeLock,
    inIframe: inIframe
  };
})(window.TL = window.TL || {});
