/* Application shell: screens, live loop, rendering, settings. */
(function (TL) {
  'use strict';
  var U = TL.util, CH = TL.charts;
  function $(id) { return document.getElementById(id); }
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  var S = {
    settings: null, trips: [], trip: null, mode: 'idle', player: null,
    raf: null, trail: [], current: null, viewRecord: null, fromScreen: 'home',
    lastScoreT: 0, liveScore: null, ticker: [], profileGeom: null,
    hoverIdx: null, geoError: null, started: 0,
    firstFixT: 0, lastFixT: 0, alertState: null, alertSpokenFor: null,
    limits: null, manualLimit: undefined, lastRoadKey: null
  };

  var TYPE_NAME = { brake: 'Harsh braking', accel: 'Harsh acceleration', corner: 'Sharp cornering', speeding: 'Over the limit' };
  var LIMITS = { mph: [20, 30, 40, 50, 60, 70], kmh: [30, 50, 60, 80, 100, 120] };

  /* ---------------- screens ---------------- */
  function showScreen(name) {
    ['home', 'drive', 'summary', 'history', 'settings'].forEach(function (n) {
      var s = $('screen-' + n);
      if (s) s.classList.toggle('is-active', n === name);
    });
    var navFor = name === 'summary' ? 'history' : (name === 'drive' ? 'home' : name);
    Array.prototype.forEach.call(document.querySelectorAll('.nav button'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-nav') === navFor);
    });
    window.scrollTo(0, 0);
    if (name === 'drive') startRenderLoop(); else stopRenderLoop();
  }

  function setStatus(text, cls) {
    var d = $('statusDot');
    d.textContent = text;
    d.className = 'status-dot ' + (cls || '');
    var h = $('hudStatus');
    if (h) { h.textContent = text; h.className = 'status-dot ' + (cls || ''); }
  }

  /* ---------------- live tracking ---------------- */
  function startLive() {
    TL.alerts.unlock();
    TL.alerts.configure(S.settings);
    S.geoError = null;

    TL.sensors.requestMotion().then(function (r) {
      if (r.ok) {
        TL.sensors.startMotion(function (m) { if (S.trip) S.trip.feedMotion(m); });
      }
      beginTrip('live');
      S.firstFixT = 0; S.lastFixT = 0; S.alertState = null; S.alertSpokenFor = null;
      var ok = TL.sensors.startGeo(function (p) {
        if (S.trip) S.trip.feedPosition(p);
        S.geoError = null;
        S.lastFixT = Date.now();
        if (!S.firstFixT) S.firstFixT = S.lastFixT;
        applyLimits(p);
      }, function (err) {
        S.geoError = err;
        setStatus(err.code === 1 ? 'No location' : 'Weak signal', err.code === 1 ? 'is-off' : 'is-warn');
      });
      if (!ok) setStatus('No location', 'is-off');
      if (S.settings.keepAwake) TL.sensors.keepAwake(true);
    });
  }

  /* A trip that is recording nothing must say so loudly and early. Watching a
     status pill go red is not enough from the driver's seat — the failure mode
     this replaces was a 35-minute trip that captured no distance at all. */
  var NO_FIX_MS = 15000;      // never got a fix
  var STUCK_MS = 60000;       // still nothing, and no error to explain it
  var LOST_FIX_MS = 45000;    // had one, then lost it

  function checkFixHealth() {
    if (S.mode !== 'live' || !S.trip) { setDriveAlert(null); return; }
    var now = Date.now();
    if (!S.firstFixT) {
      var denied = S.geoError && S.geoError.code === 1;
      var waited = now - S.started;
      // Warn the instant a denial is known; otherwise give a fix a few
      // seconds to arrive before crying wolf.
      if (denied || waited > NO_FIX_MS) {
        var embedded = TL.sensors.inIframe();
        if (denied) {
          setDriveAlert({
            key: 'denied', hard: true, title: 'Location blocked',
            body: embedded
              ? 'Nothing is being recorded. This page is embedded inside another app, which is not letting it read your location. Open it from its own web address instead.'
              : 'Nothing is being recorded. Allow location for this site in your browser settings, then start again.',
            speak: 'Location blocked. Not recording.'
          });
        } else if (waited > STUCK_MS) {
          // No fix and no error either — a silently blocked frame looks exactly
          // like this, and "still waiting" after several minutes is a lie.
          setDriveAlert({
            key: 'stuck', hard: true, title: 'Still no location',
            body: 'Nothing recorded in ' + U.fmtDuration(waited) + '. Location is not reaching this page — most likely it is blocked here. Stop and check rather than keep driving.',
            speak: 'Still no location. Nothing is being recorded.'
          });
        } else {
          setDriveAlert({
            key: 'nofix', hard: true, title: 'No location yet',
            body: 'Nothing is being recorded yet — still waiting for a first fix. Outdoors with a clear view of the sky is fastest.',
            speak: 'No location yet. Not recording.'
          });
        }
        return;
      }
    } else if (now - S.lastFixT > LOST_FIX_MS) {
      setDriveAlert({
        key: 'lost', hard: false,
        title: 'Location lost',
        body: 'No fix for ' + U.fmtDuration(now - S.lastFixT) + '. This stretch is not being recorded.',
        speak: 'Location lost.'
      });
      return;
    }
    setDriveAlert(null);
  }

  function setDriveAlert(a) {
    var box = $('driveAlert');
    if (!a) {
      if (S.alertState) { box.classList.add('hidden'); S.alertState = null; }
      return;
    }
    if (S.alertState !== a.key) {
      S.alertState = a.key;
      box.classList.remove('hidden');
      box.classList.toggle('is-soft', !a.hard);
      $('driveAlertTitle').textContent = a.title;
      $('driveAlertBody').textContent = a.body;
      // Say it once per condition: eyes belong on the road.
      if (a.speak && S.alertSpokenFor !== a.key) {
        S.alertSpokenFor = a.key;
        TL.alerts.speak(a.speak);
        TL.alerts.tone([700, 460, 320], 420, 0.2);
      }
    } else if (a.key === 'lost' || a.key === 'stuck') {
      $('driveAlertBody').textContent = a.body;
    }
  }

  /* Decide the limit for this moment: an explicit override wins, otherwise
     the automatic lookup, otherwise nothing — and "nothing" is left unscored
     rather than guessed. */
  function applyLimits(fix) {
    if (!S.trip) return;
    var mode = S.settings.limitMode;
    if (mode === 'off') { S.trip.setLimit(null, 'none'); renderLimitBar(); return; }
    if (S.manualLimit !== undefined) {
      S.trip.setLimit(S.manualLimit, S.manualLimit == null ? 'none' : 'manual');
      renderLimitBar();
      return;
    }
    if (mode !== 'auto') { renderLimitBar(); return; }
    if (!S.limits) S.limits = new TL.SpeedLimits();
    var m = S.limits.update(fix);
    S.trip.setLimit(m ? m.limit : null, m ? 'auto' : 'none');
    renderLimitBar();
  }

  function renderLimitBar() {
    var src = $('limitSrc'), road = $('limitRoad');
    if (!src) return;
    var mode = S.settings.limitMode;
    if (S.mode === 'demo') {
      src.className = 'limitbar-src'; src.textContent = 'Demo';
      road.textContent = 'Limits come from the simulated route';
      return;
    }
    if (mode === 'off') {
      src.className = 'limitbar-src is-off'; src.textContent = 'Off';
      road.textContent = 'Speed is not being scored';
      return;
    }
    if (S.manualLimit !== undefined) {
      src.className = 'limitbar-src is-manual'; src.textContent = 'Manual';
      road.textContent = S.manualLimit == null ? 'No limit set' : 'Tap the roundel to return to automatic';
      return;
    }
    if (mode === 'manual') {
      src.className = 'limitbar-src is-manual'; src.textContent = 'Manual';
      road.textContent = 'Tap the roundel to set the limit';
      return;
    }
    var L = S.limits;
    var bad = L && (L.status === 'error' || L.status === 'offline');
    src.className = 'limitbar-src' + (bad ? ' is-bad' : '');
    src.textContent = bad ? 'Lookup failed' : 'Automatic';
    road.textContent = L ? L.describe() : 'Waiting for a fix…';
  }

  function beginTrip(mode) {
    S.mode = mode;
    S.trip = new TL.Trip({ sensitivity: S.settings.sensitivity });
    S.trail = []; S.ticker = []; S.current = null; S.liveScore = null;
    S.lastScoreT = 0; S.started = Date.now();
    if (mode === 'live') {
      S.trip.start(Date.now(), Date.now());
      var lim = S.settings.limitMode === 'manual' && S.settings.defaultLimit
        ? U.speedFrom(S.settings.defaultLimit, S.settings.units) : null;
      S.trip.setLimit(lim, lim ? 'manual' : 'none');
    }
    setDriveAlert(null);
    S.manualLimit = undefined;
    S.limits = new TL.SpeedLimits();
    $('limitPicker').classList.add('hidden');
    renderLimitBar();
    renderLimitPicker();
    renderTicker();
    updateCounts();
    setStatus(mode === 'demo' ? 'Demo' : 'Tracking', mode === 'demo' ? 'is-demo' : 'is-live');
    showScreen('drive');
    $('btnStop').textContent = mode === 'demo' ? 'Stop demo & score it' : 'End trip & score it';
    $('limitBar').classList.toggle('hidden', mode === 'demo' ? false : false);
  }

  function liveTick() {
    if (S.mode !== 'live' || !S.trip) return;
    var r = S.trip.tick(Date.now());
    S.current = r;
    if (r.events.length) onEvents(r.events);
  }

  function stopTrip() {
    if (!S.trip) return;
    if (S.player) { S.player.stop(); S.player = null; }
    if (S.mode === 'live') {
      TL.sensors.stopGeo(); TL.sensors.stopMotion(); TL.sensors.keepAwake(false);
      if (S.limits) S.limits.stop();
      S.trip.stop(Date.now());
    } else {
      S.trip.stop();
    }
    var rec = S.trip.record({ source: S.mode === 'demo' ? 'demo' : 'live', profile: S.demoProfile });
    var mode = S.mode;
    S.mode = 'idle'; S.trip = null;
    setStatus('Idle', '');
    // A trip with no meaningful movement is noise, not a record.
    if (rec.acc.distanceM < 40 && rec.acc.movingMs < 15000) {
      showScreen('home');
      renderHome();
      return;
    }
    var trips = TL.storage.saveTrip(rec);
    if (trips) S.trips = trips;
    S.fromScreen = mode === 'demo' ? 'settings' : 'home';
    openSummary(rec);
    renderHome();
  }

  function onEvents(list) {
    list.forEach(function (ev) {
      TL.alerts.fire(ev);
      flash(ev.severity);
      S.ticker.unshift(ev);
    });
    if (S.ticker.length > 40) S.ticker.length = 40;
    renderTicker();
    updateCounts();
  }

  var flashTimer = null;
  function flash(sev) {
    if (sev === 'mild') return;
    var f = $('flash');
    f.className = 'flash ' + (sev === 'severe' ? 'f-crit' : 'f-warn') + ' is-on';
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { f.className = 'flash'; }, 380);
  }

  /* ---------------- render loop ---------------- */
  function startRenderLoop() {
    if (S.raf) return;
    var loop = function () {
      S.raf = requestAnimationFrame(loop);
      if (S.mode === 'live') { liveTick(); checkFixHealth(); }
      renderHUD();
    };
    S.raf = requestAnimationFrame(loop);
  }
  function stopRenderLoop() {
    if (S.raf) cancelAnimationFrame(S.raf);
    S.raf = null;
  }

  function renderHUD() {
    var r = S.current;
    var units = S.settings.units;
    var s = r ? r.sample : null;

    if (s) {
      S.trail.push({ x: s.aLat, y: s.aLong });
      if (S.trail.length > 55) S.trail.shift();
      var spd = U.speedIn(s.speed, units);
      $('hudSpeed').textContent = Math.round(spd);
      var lim = S.trip ? S.trip.limit : null;
      $('hudSpeed').classList.toggle('is-over', !!lim && s.speed > lim * 1.05 + 0.45);
      $('hudTime').textContent = U.fmtDuration(S.trip ? S.trip.acc.totalMs : 0);
      $('hudDist').textContent = U.fmtDist(s.distance, units);
      $('hudAcc').textContent = s.accuracy != null ? Math.round(s.accuracy) + ' m' : '--';
      updateLimitSign();
    }
    $('hudSpeedUnit').textContent = U.speedUnit(units).toUpperCase();

    var th = TL.detectorThresholds(S.settings.sensitivity);
    CH.gMeter($('gMeter'), s ? { x: s.aLat, y: s.aLong } : null, S.trail, {
      mild: th.brake.mild / U.G, harsh: th.brake.harsh / U.G, severe: th.brake.severe / U.G
    });

    var now = Date.now();
    if (S.trip && now - S.lastScoreT > 1500) {
      S.lastScoreT = now;
      var acc = S.trip.summary();
      S.liveScore = TL.scoring.scoreTrip(acc);
      var enough = acc.movingMs > 20000;
      $('liveScore').textContent = enough ? S.liveScore.overall : '--';
      $('liveScore').style.color = enough ? toneColor(S.liveScore.band.tone) : 'var(--dim)';
      $('liveBand').textContent = enough ? S.liveScore.band.label : 'Gathering data';
      CH.scoreRing($('liveRing'), enough ? S.liveScore.overall : 0, enough ? S.liveScore.band.tone : 'good');
      if (S.mode === 'live') renderLimitBar();
    }
  }

  function toneColor(t) {
    return t === 'good' ? 'var(--good)' : (t === 'warn' ? 'var(--warn)' : 'var(--crit)');
  }

  function updateCounts() {
    if (!S.trip) return;
    var c = { brake: 0, accel: 0, corner: 0, speeding: 0 };
    S.trip.acc.events.forEach(function (e) { c[e.type] = (c[e.type] || 0) + 1; });
    $('cntBrake').textContent = c.brake;
    $('cntAccel').textContent = c.accel;
    $('cntCorner').textContent = c.corner;
    $('cntSpeed').textContent = c.speeding;
    $('evCount').textContent = S.trip.acc.events.length + ' total';
  }

  function updateLimitSign() {
    var sign = $('hudLimit');
    var lim = S.trip ? S.trip.limit : null;
    if (lim) {
      sign.classList.remove('is-unset');
      sign.textContent = Math.round(U.speedIn(lim, S.settings.units));
      return;
    }
    sign.classList.add('is-unset');
    if (S.mode === 'demo') { sign.textContent = 'AUTO'; return; }
    if (S.settings.limitMode === 'off') { sign.textContent = 'OFF'; return; }
    if (S.settings.limitMode === 'auto' && S.manualLimit === undefined) {
      sign.textContent = S.limits && S.limits.ways.length ? 'NONE' : 'AUTO';
      return;
    }
    sign.textContent = 'SET';
  }

  function renderLimitPicker() {
    var box = $('limitPicker');
    box.innerHTML = '';
    var units = S.settings.units;
    var vals = LIMITS[units] || LIMITS.mph;
    var override = S.manualLimit;
    var cur = override === undefined ? null
      : (override == null ? 'off' : Math.round(U.speedIn(override, units)));

    function choose(val) {
      // undefined = hand control back to the automatic lookup
      S.manualLimit = val;
      if (typeof val === 'number') {
        S.settings.defaultLimit = Math.round(U.speedIn(val, units));
        TL.storage.saveSettings(S.settings);
      }
      if (S.trip && val !== undefined) S.trip.setLimit(val, val == null ? 'none' : 'manual');
      renderLimitPicker(); updateLimitSign(); renderLimitBar();
    }

    if (S.settings.limitMode === 'auto') {
      var auto = el('button', 'limit-btn' + (override === undefined ? ' is-on' : ''), 'auto');
      auto.type = 'button';
      auto.addEventListener('click', function () { choose(undefined); });
      box.appendChild(auto);
    }
    vals.forEach(function (v) {
      var b = el('button', 'limit-btn' + (cur === v ? ' is-on' : ''), String(v));
      b.type = 'button';
      b.addEventListener('click', function () { choose(U.speedFrom(v, units)); });
      box.appendChild(b);
    });
    var off = el('button', 'limit-btn' + (cur === 'off' ? ' is-on' : ''), 'none');
    off.type = 'button';
    off.addEventListener('click', function () { choose(null); });
    box.appendChild(off);
  }

  function renderTicker() {
    var box = $('ticker');
    box.innerHTML = '';
    if (!S.ticker.length) {
      box.appendChild(el('div', 'ticker-empty', 'Nothing flagged yet.'));
      return;
    }
    S.ticker.slice(0, 12).forEach(function (ev) { box.appendChild(eventRow(ev)); });
  }

  function eventRow(ev) {
    var row = el('div', 'ev t-' + ev.type);
    row.appendChild(el('span', 'sev-tag sev-' + ev.severity, ev.severity));
    row.appendChild(el('span', 'ev-name', TYPE_NAME[ev.type] || ev.type));
    var val = ev.type === 'speeding'
      ? Math.round(U.speedIn(ev.peak, S.settings.units)) + ' in ' + Math.round(U.speedIn(ev.limit, S.settings.units))
      : ev.peakG.toFixed(2) + ' g' + (ev.dir ? ' ' + ev.dir : '');
    row.appendChild(el('span', 'ev-val', val));
    row.appendChild(el('span', 'ev-time', U.fmtDuration(ev.t0 - (S.trip ? S.trip.t0 : 0))));
    return row;
  }

  /* ---------------- demo ---------------- */
  function runDemo(profileKey) {
    TL.alerts.unlock();
    TL.alerts.configure(S.settings);
    S.demoProfile = profileKey;
    var drive = TL.simulate.generate(profileKey, Math.floor(Math.random() * 1e6));
    var rate = Number(S.settings.demoRate);

    if (!rate) {
      var t = new TL.Trip({ sensitivity: S.settings.sensitivity });
      new TL.simulate.Player(t, drive, {}).runInstant();
      var rec = t.record({ source: 'demo', profile: profileKey });
      var trips = TL.storage.saveTrip(rec);
      if (trips) S.trips = trips;
      S.fromScreen = 'settings';
      openSummary(rec);
      renderHome();
      return;
    }

    beginTrip('demo');
    S.player = new TL.simulate.Player(S.trip, drive, {
      rate: rate,
      onTick: function (r) { S.current = r; },
      onEvent: function (evs) { onEvents(evs); },
      onDone: function () { S.player = null; stopTrip(); }
    });
    S.player.start();
  }

  function compareProfiles() {
    var host = $('demoCompare');
    if (!host) {
      host = el('div', 'card');
      host.id = 'demoCompare';
      $('btnDemoAll').parentNode.parentNode.appendChild(host);
    }
    host.innerHTML = '';
    var head = el('div', 'card-head');
    head.appendChild(el('span', 'card-title', 'Same route, three drivers'));
    host.appendChild(head);
    host.appendChild(el('p', 'fine', 'Each is scored instantly on an identical road plan, so the only difference is how it was driven.'));
    var seed = Math.floor(Math.random() * 1e6);
    var list = el('div', 'triplist');
    list.style.marginTop = '12px';
    ['smooth', 'average', 'aggressive'].forEach(function (k) {
      var t = new TL.Trip({ sensitivity: S.settings.sensitivity });
      new TL.simulate.Player(t, TL.simulate.generate(k, seed), {}).runInstant();
      var acc = t.summary(), sc = TL.scoring.scoreTrip(acc);
      var c = { brake: 0, accel: 0, corner: 0, speeding: 0 };
      acc.events.forEach(function (e) { c[e.type] = (c[e.type] || 0) + 1; });
      var row = el('div', 'trip-row');
      row.style.cursor = 'default';
      var sn = el('div', 'trip-score tone-' + sc.band.tone, String(sc.overall));
      row.appendChild(sn);
      var main = el('div', 'trip-main');
      main.appendChild(el('div', 'trip-when', TL.simulate.PROFILES[k].label + ' — ' + sc.band.label));
      main.appendChild(el('div', 'trip-sub',
        c.brake + ' brake · ' + c.accel + ' accel · ' + c.corner + ' corner · ' + c.speeding + ' speeding'));
      row.appendChild(main);
      row.appendChild(el('div', 'trip-sub', U.fmtDist(acc.distanceM, S.settings.units)));
      list.appendChild(row);
    });
    host.appendChild(list);
    host.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  /* ---------------- summary ---------------- */
  function openSummary(rec) {
    S.viewRecord = rec;
    S.hoverIdx = null;
    showScreen('summary');
    renderSummary(rec);
  }

  function renderSummary(rec) {
    var units = S.settings.units;
    var acc = rec.acc;
    var sc = TL.scoring.scoreTrip(acc);

    $('sumWhen').textContent = U.fmtDate(rec.startedAt) + ', ' + U.fmtClock(rec.startedAt);
    $('sumDemoTag').classList.toggle('hidden', rec.source !== 'demo');
    if (rec.source === 'demo') {
      $('sumDemoTag').textContent = 'Demo · ' + (TL.simulate.PROFILES[rec.profile] ? TL.simulate.PROFILES[rec.profile].label : 'sim');
    }
    $('sumScore').textContent = sc.overall;
    $('sumScore').style.color = toneColor(sc.band.tone);
    $('sumBand').textContent = sc.band.label;
    $('sumBand').className = 'band tone-' + sc.band.tone;
    CH.scoreRing($('sumRing'), sc.overall, sc.band.tone);

    var q = rec.quality || {};
    var qbits = [];
    qbits.push(q.hasMotion ? (q.hasGyro ? 'GPS + accelerometer + gyro' : 'GPS + accelerometer') : 'GPS only');
    if (q.calConf != null && q.hasMotion) qbits.push('axis calibration ' + Math.round(q.calConf * 100) + '%');
    if (sc.speedMeasured) {
      var speedComp = null;
      sc.components.forEach(function (c) { if (c.key === 'speeding') speedComp = c; });
      var autoPct = acc.limitKnownMs > 0 ? (acc.limitAutoMs || 0) / acc.limitKnownMs * 100 : 0;
      var how = autoPct > 80 ? 'automatic' : (autoPct < 20 ? 'manual' : 'mixed');
      qbits.push('limits ' + how + ', known for ' +
        Math.round((speedComp ? speedComp.coverage : 0) * 100) + '% of the drive');
    } else {
      qbits.push('speed not scored — no limit was known');
    }
    $('sumSub').textContent = qbits.join(' · ');

    var prov = $('sumProvisional');
    if (sc.provisional) {
      prov.classList.remove('hidden');
      prov.textContent = 'Short trip. Rates per 100 km computed over this little distance are unstable, so treat this score as indicative only.';
    } else prov.classList.add('hidden');

    var stats = $('sumStats');
    stats.innerHTML = '';
    [['Distance', U.fmtDist(acc.distanceM, units), ''],
     ['Moving time', U.fmtDuration(acc.movingMs), ''],
     ['Average', Math.round(U.speedIn(acc.avgSpeed, units)), U.speedUnit(units)],
     ['Top speed', Math.round(U.speedIn(acc.maxSpeed, units)), U.speedUnit(units)]
    ].forEach(function (s) {
      var d = el('div', 'stat');
      d.appendChild(el('div', 'stat-label', s[0]));
      var v = el('div', 'stat-value');
      v.appendChild(document.createTextNode(s[1]));
      if (s[2]) { var sm = el('small', null, ' ' + s[2]); v.appendChild(sm); }
      d.appendChild(v);
      stats.appendChild(d);
    });

    renderComps($('sumComps'), sc, units);
    $('sumAdvice').textContent = TL.scoring.advice(sc.biggestLoss);

    var evs = acc.events.slice().sort(function (a, b) { return a.t0 - b.t0; });
    $('sumEvCount').textContent = evs.length ? evs.length + ' events' : 'clean';
    var box = $('sumEvents');
    box.innerHTML = '';
    if (!evs.length) box.appendChild(el('div', 'ticker-empty', 'No events were flagged on this trip.'));
    evs.forEach(function (ev) {
      var row = el('div', 'ev t-' + ev.type);
      row.appendChild(el('span', 'sev-tag sev-' + ev.severity, ev.severity));
      row.appendChild(el('span', 'ev-name', TYPE_NAME[ev.type] || ev.type));
      var val = ev.type === 'speeding'
        ? Math.round(U.speedIn(ev.peak, units)) + ' in ' + Math.round(U.speedIn(ev.limit, units)) + ' · ' + U.fmtDuration(ev.durMs)
        : ev.peakG.toFixed(2) + ' g' + (ev.dir ? ' ' + ev.dir : '');
      row.appendChild(el('span', 'ev-val', val));
      row.appendChild(el('span', 'ev-time', U.fmtDuration(ev.t0)));
      box.appendChild(row);
    });

    drawSummaryCharts(rec);
  }

  function drawSummaryCharts(rec) {
    CH.routeMap($('sumRoute'), rec.route, rec.acc.events);
    S.profileGeom = CH.speedProfile($('sumProfile'), rec.route, rec.acc.events, S.settings.units, S.hoverIdx);
  }

  function renderComps(host, sc, units) {
    host.innerHTML = '';
    sc.components.forEach(function (c) {
      var row = el('div', 'comp' + (c.available ? '' : ' is-na'));
      var name = el('div', 'comp-name');
      name.appendChild(document.createTextNode(c.label));
      var detail = '';
      if (c.key === 'speeding') {
        detail = c.available ? (c.meanExcess != null ? c.meanExcess.toFixed(1) + '% mean over' : '') : 'no limit set';
      } else if (c.key === 'smoothness') {
        detail = c.rate.toFixed(2) + ' m/s³';
      } else if (c.key === 'focus') {
        detail = c.count + ' taps';
      } else if (c.key === 'context') {
        detail = c.rate > 0.5 ? Math.round(c.rate) + '% at night' : 'daytime';
      } else {
        detail = c.count + ' · ' + c.rate.toFixed(1) + '/100km';
      }
      name.appendChild(el('small', null, detail));
      row.appendChild(name);
      var track = el('div', 'comp-track');
      var tone = c.score >= 80 ? 'good' : (c.score >= 60 ? 'warn' : 'crit');
      var fill = el('div', 'comp-fill tone-' + tone);
      fill.style.width = (c.available ? c.score : 0) + '%';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', c.available ? 'comp-score' : 'comp-na',
        c.available ? String(Math.round(c.score)) : 'n/a'));
      host.appendChild(row);
    });
  }

  /* ---------------- history ---------------- */
  function renderHistory() {
    var list = $('tripList');
    list.innerHTML = '';
    if (!S.trips.length) {
      var e = el('div', 'empty');
      e.appendChild(el('div', 'card-title', 'No trips yet'));
      e.appendChild(el('p', null, 'Record a drive, or run the demo from Setup, and it will appear here.'));
      list.appendChild(e);
      $('histAggCard').classList.add('hidden');
      $('histTools').classList.add('hidden');
      return;
    }
    $('histTools').classList.remove('hidden');
    S.trips.forEach(function (t) {
      var sc = TL.scoring.scoreTrip(t.acc);
      var row = el('button', 'trip-row');
      row.type = 'button';
      row.appendChild(el('div', 'trip-score tone-' + sc.band.tone, String(sc.overall)));
      var main = el('div', 'trip-main');
      var when = el('div', 'trip-when');
      when.appendChild(document.createTextNode(U.fmtDate(t.startedAt) + ', ' + U.fmtClock(t.startedAt)));
      if (t.source === 'demo') {
        var tag = el('span', 'trip-tag', 'demo');
        tag.style.marginLeft = '7px';
        when.appendChild(tag);
      }
      main.appendChild(when);
      main.appendChild(el('div', 'trip-sub',
        U.fmtDist(t.acc.distanceM, S.settings.units) + ' · ' + U.fmtDuration(t.acc.movingMs) +
        ' · ' + t.acc.events.length + ' events'));
      row.appendChild(main);
      row.appendChild(el('div', 'trip-sub', sc.band.label));
      row.addEventListener('click', function () { S.fromScreen = 'history'; openSummary(t); });
      list.appendChild(row);
    });

    var agg = TL.scoring.aggregate(S.trips);
    if (agg) {
      $('histAggCard').classList.remove('hidden');
      $('histScore').textContent = agg.overall;
      $('histScore').style.color = toneColor(agg.band.tone);
      $('histBand').textContent = agg.band.label;
      $('histBand').className = 'band tone-' + agg.band.tone;
      $('histCount').textContent = agg.trips + (agg.trips === 1 ? ' trip' : ' trips');
      $('histSub').textContent = U.fmtDist(agg.acc.distanceM, S.settings.units) + ' total · ' +
        agg.acc.events.length + ' events · exposure-weighted, not an average of trip scores';
      CH.scoreRing($('histRing'), agg.overall, agg.band.tone);
      renderComps($('histComps'), agg, S.settings.units);
    }
  }

  function renderHome() {
    S.trips = TL.storage.loadTrips();
    var agg = S.trips.length ? TL.scoring.aggregate(S.trips) : null;
    var card = $('cardRolling');
    if (agg) {
      card.classList.remove('hidden');
      $('rollScore').textContent = agg.overall;
      $('rollScore').style.color = toneColor(agg.band.tone);
      $('rollBand').textContent = agg.band.label;
      $('rollBand').className = 'band tone-' + agg.band.tone;
      $('rollingCount').textContent = agg.trips + (agg.trips === 1 ? ' trip' : ' trips');
      $('rollSub').textContent = U.fmtDist(agg.acc.distanceM, S.settings.units) + ' across every trip on this device.';
      CH.scoreRing($('rollRing'), agg.overall, agg.band.tone);
    } else card.classList.add('hidden');
  }

  function renderWeights() {
    var host = $('weightList');
    host.innerHTML = '';
    var W = TL.scoring.WEIGHTS, L = TL.scoring.LABELS;
    Object.keys(W).sort(function (a, b) { return W[b] - W[a]; }).forEach(function (k) {
      var row = el('div', 'comp');
      var name = el('div', 'comp-name');
      name.appendChild(document.createTextNode(L[k]));
      name.appendChild(el('small', null, Math.round(W[k] * 100) + '% of the score'));
      row.appendChild(name);
      var track = el('div', 'comp-track');
      var fill = el('div', 'comp-fill tone-good');
      fill.style.width = (W[k] / 0.25 * 100) + '%';
      fill.style.background = 'var(--accent)';
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'comp-score', Math.round(W[k] * 100) + '%'));
      host.appendChild(row);
    });
  }

  /* ---------------- settings ---------------- */
  var LIMIT_MODE_TEXT = {
    auto: 'Looked up automatically from OpenStreetMap',
    manual: 'You set the limit yourself as it changes',
    off: 'Speed is not scored at all'
  };
  var SENS_TEXT = {
    lenient: 'Lenient — harsh braking flags around 0.47 g',
    standard: 'Standard — harsh braking flags around 0.40 g',
    strict: 'Strict — harsh braking flags around 0.34 g'
  };

  function renderSettings() {
    var s = S.settings;
    segSet('segUnits', s.units);
    segSet('segSens', s.sensitivity);
    segSet('segLimit', s.limitMode);
    $('limitModeDesc').textContent = LIMIT_MODE_TEXT[s.limitMode] || '';
    segSet('segRate', String(s.demoRate));
    $('sensDesc').textContent = SENS_TEXT[s.sensitivity];
    $('swVoice').checked = !!s.voice;
    $('swBeeps').checked = !!s.beeps;
    $('swVibrate').checked = !!s.vibrate;
    $('swAwake').checked = !!s.keepAwake;

    var host = $('profileList');
    host.innerHTML = '';
    Object.keys(TL.simulate.PROFILES).forEach(function (k) {
      var p = TL.simulate.PROFILES[k];
      var b = el('button', 'profile-btn' + (s.demoProfile === k ? ' is-on' : ''));
      b.type = 'button';
      b.appendChild(el('span', 'profile-key', p.label));
      var t = el('span');
      t.appendChild(el('span', 't', p.label + ' driver'));
      t.appendChild(el('span', 'd', p.blurb));
      b.appendChild(t);
      b.addEventListener('click', function () {
        s.demoProfile = k;
        TL.storage.saveSettings(s);
        renderSettings();
      });
      host.appendChild(b);
    });
  }

  function segSet(id, val) {
    Array.prototype.forEach.call($(id).querySelectorAll('button'), function (b) {
      b.classList.toggle('is-on', b.getAttribute('data-v') === String(val));
    });
  }
  function segBind(id, handler) {
    $(id).addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      handler(b.getAttribute('data-v'));
    });
  }

  /* Say up front when tracking cannot work here, rather than letting someone
     tap Start, drive off, and find out later that nothing was recorded. */
  function checkTrackingAvailability() {
    if (!navigator.permissions || !navigator.permissions.query) return;
    try {
      navigator.permissions.query({ name: 'geolocation' }).then(function (st) {
        if (st.state === 'denied') {
          var n = $('homeBlocked');
          if (!TL.sensors.inIframe()) {
            n.innerHTML = '<strong>Location is blocked for this site.</strong> ' +
              'A trip would record nothing at all. Allow location in your browser ' +
              'settings for this page, then reload. The demo works either way.';
          }
          n.classList.remove('hidden');
          $('btnStart').classList.remove('btn-primary');
        }
      }).catch(function () {});
    } catch (e) { /* older browsers cannot query geolocation permission */ }
  }

  /* ---------------- diagnostics ---------------- */
  function runDiagnostics() {
    var host = $('diagList');
    host.innerHTML = '';
    host.appendChild(diagRow('Checking sensors', 'this can take a few seconds outdoors', 'Working', 'v-idle'));
    $('diagNotes').innerHTML = '';

    TL.sensors.probe().then(function (r) {
      host.innerHTML = '';
      var st = r.statics;
      host.appendChild(diagRow('Secure origin', st.protocol + '//', st.secure ? 'Yes' : 'No', st.secure ? 'v-ok' : 'v-no'));
      host.appendChild(diagRow('Location', r.geo.ok ? 'fix accurate to ' + Math.round(r.geo.accuracy) + ' m' : 'no fix',
        r.geo.ok ? 'Working' : 'Blocked', r.geo.ok ? 'v-ok' : 'v-no'));
      if (r.geo.ok) {
        host.appendChild(diagRow('Speed from GPS', r.geo.hasSpeed ? 'reported directly by the receiver' : 'will be derived from position changes',
          r.geo.hasSpeed ? 'Native' : 'Derived', r.geo.hasSpeed ? 'v-ok' : 'v-warn'));
      }
      host.appendChild(diagRow('Accelerometer', r.motion.ok ? 'motion events arriving' : 'no events',
        r.motion.ok ? 'Working' : 'Blocked', r.motion.ok ? 'v-ok' : 'v-no'));
      host.appendChild(diagRow('Gyroscope', r.motion.gyro ? 'used for lateral g' : 'falls back to GPS heading',
        r.motion.gyro ? 'Working' : 'Absent', r.motion.gyro ? 'v-ok' : 'v-warn'));
      if (r.geo.ok && S.settings.limitMode === 'auto') {
        var pending = diagRow('Speed limit lookup', 'asking the map service…', 'Checking', 'v-idle');
        host.appendChild(pending);
        new TL.SpeedLimits().testLookup(r.geo.lat, r.geo.lon).then(function (t) {
          var sub, val, cls;
          if (t.ok) {
            sub = t.match
              ? 'matched ' + (t.match.name || 'this road') + ' at ' +
                Math.round(U.speedIn(t.match.limit, S.settings.units)) + ' ' + U.speedUnit(S.settings.units) +
                ' (' + t.ways + ' roads loaded)'
              : t.ways + ' roads loaded nearby, but none matched this exact spot';
            val = t.match ? 'Working' : 'No match'; cls = t.match ? 'v-ok' : 'v-warn';
          } else {
            sub = t.error || 'The lookup did not return usable data.';
            val = 'Failed'; cls = 'v-no';
          }
          pending.replaceWith(diagRow('Speed limit lookup', sub, val, cls));
        });
      }
      host.appendChild(diagRow('Keep screen awake', st.wakeLockApi ? 'supported' : 'not supported — set your screen timeout longer',
        st.wakeLockApi ? 'Yes' : 'No', st.wakeLockApi ? 'v-ok' : 'v-warn'));
      host.appendChild(diagRow('Saving trips', st.storage ? 'local storage available' : 'local storage blocked — trips will not persist',
        st.storage ? 'Yes' : 'No', st.storage ? 'v-ok' : 'v-no'));
      if (st.iframe) {
        host.appendChild(diagRow('Embedded page', 'running inside a frame', 'Yes', 'v-warn'));
      }

      var notes = $('diagNotes');
      var canTrack = r.geo.ok;
      if (!canTrack) {
        notes.appendChild(note('warn',
          '<strong>Live tracking will not work here.</strong> ' + (r.geo.reason || '') +
          ' The demo drive still works fully &mdash; it needs no sensors at all.'));
      } else if (!r.motion.ok) {
        notes.appendChild(note('warn',
          '<strong>Running on GPS alone.</strong> ' + (r.motion.reason || '') +
          ' Speeding and cornering still score; braking and acceleration are measured from GPS speed changes, so brief events may be softened.'));
      } else {
        notes.appendChild(note('', '<strong>Everything needed is working.</strong> Mount the phone somewhere fixed, start a trip before you pull away, and leave the screen on.'));
      }
      S.diag = r;
    });
  }

  function diagRow(k, sub, v, cls) {
    var row = el('div', 'diag-row');
    var kd = el('div', 'k');
    kd.appendChild(document.createTextNode(k));
    if (sub) kd.appendChild(el('small', null, sub));
    row.appendChild(kd);
    row.appendChild(el('div', 'v ' + cls, v));
    return row;
  }
  function note(kind, html) {
    var n = el('div', 'note' + (kind ? ' ' + kind : ''));
    n.innerHTML = html;
    return n;
  }

  /* ---------------- export ---------------- */
  function stamp(rec) {
    return new Date(rec.startedAt).toISOString().replace(/[:.]/g, '-').slice(0, 19);
  }

  var EXPORT_MSG = {
    saved: 'Saved',
    copied: 'Copied to clipboard instead',
    declined: null,
    busy: 'Try that again in a moment',
    toobig: 'Too large to save',
    failed: 'Could not export'
  };

  function runExport(btn, filename, text, mime) {
    var label = btn.getAttribute('data-label') || btn.textContent;
    btn.setAttribute('data-label', label);
    btn.disabled = true;
    TL.exporters.deliver(filename, text, mime).then(function (r) {
      btn.disabled = false;
      var msg = r.why === 'format'
        ? 'Not saveable here — copied instead'
        : EXPORT_MSG[r.how];
      if (!msg) return;
      btn.textContent = msg;
      setTimeout(function () { btn.textContent = label; }, 2600);
    });
  }

  function exportGpx() {
    var r = S.viewRecord; if (!r) return;
    runExport($('btnGpx'), 'drive-' + stamp(r) + '.gpx', TL.exporters.toGPX(r), 'application/gpx+xml');
  }
  function exportCsv() {
    var r = S.viewRecord; if (!r) return;
    runExport($('btnCsv'), 'events-' + stamp(r) + '.csv',
      TL.exporters.eventsCSV([r], S.settings.units), 'text/csv');
  }
  function exportJson() {
    var r = S.viewRecord; if (!r) return;
    runExport($('btnJson'), 'drive-' + stamp(r) + '.json',
      TL.exporters.tripsJSON([r]), 'application/json');
  }

  /* ---------------- init ---------------- */
  function init() {
    S.settings = TL.storage.loadSettings();
    S.trips = TL.storage.loadTrips();
    TL.exporters.initHost();
    TL.alerts.configure(S.settings);

    document.querySelector('.nav').addEventListener('click', function (e) {
      var b = e.target.closest('button[data-nav]');
      if (!b) return;
      var n = b.getAttribute('data-nav');
      if (n === 'home') {
        if (S.mode !== 'idle') showScreen('drive');
        else { showScreen('home'); renderHome(); }
      } else if (n === 'history') { showScreen('history'); renderHistory(); }
      else { showScreen('settings'); renderSettings(); }
    });

    $('btnStart').addEventListener('click', startLive);
    $('btnAlertStop').addEventListener('click', stopTrip);
    $('btnAlertWhy').addEventListener('click', function () {
      showScreen('settings'); renderSettings(); runDiagnostics();
      $('diagList').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('btnStop').addEventListener('click', stopTrip);
    $('btnDemoHome').addEventListener('click', function () { runDemo(S.settings.demoProfile || 'average'); });
    $('btnCheck').addEventListener('click', function () {
      showScreen('settings'); renderSettings(); runDiagnostics();
      $('diagList').scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    $('btnDemo').addEventListener('click', function () { runDemo(S.settings.demoProfile || 'average'); });
    $('btnDemoAll').addEventListener('click', compareProfiles);
    $('btnDiag').addEventListener('click', runDiagnostics);

    $('btnSumBack').addEventListener('click', function () {
      if (S.fromScreen === 'history') { showScreen('history'); renderHistory(); }
      else if (S.fromScreen === 'settings') { showScreen('settings'); renderSettings(); }
      else { showScreen('home'); renderHome(); }
    });
    $('btnSumDelete').addEventListener('click', function () {
      if (!S.viewRecord) return;
      S.trips = TL.storage.deleteTrip(S.viewRecord.id);
      S.viewRecord = null;
      showScreen('history'); renderHome(); renderHistory();
    });
    $('btnGpx').addEventListener('click', exportGpx);
    $('btnCsv').addEventListener('click', exportCsv);
    $('btnJson').addEventListener('click', exportJson);
    $('btnCopy').addEventListener('click', function () {
      if (!S.viewRecord) return;
      var btn = $('btnCopy');
      TL.exporters.copy(TL.exporters.tripsJSON([S.viewRecord])).then(function (ok) {
        btn.textContent = ok ? 'Copied to clipboard' : 'Copy failed — select the text manually';
        setTimeout(function () { btn.textContent = 'Copy JSON to clipboard'; }, 2200);
      });
    });
    $('btnExportAll').addEventListener('click', function () {
      runExport($('btnExportAll'), 'all-trips-' + new Date().toISOString().slice(0, 10) + '.json',
        TL.exporters.tripsJSON(S.trips), 'application/json');
    });
    $('btnClearAll').addEventListener('click', function () {
      var b = $('btnClearAll');
      if (b.getAttribute('data-armed') !== '1') {
        b.setAttribute('data-armed', '1');
        b.textContent = 'Tap again to confirm';
        setTimeout(function () {
          b.removeAttribute('data-armed');
          b.textContent = 'Delete everything';
        }, 4000);
        return;
      }
      S.trips = TL.storage.clearTrips();
      b.removeAttribute('data-armed');
      b.textContent = 'Delete everything';
      renderHome(); renderHistory();
    });

    segBind('segUnits', function (v) {
      S.settings.units = v; TL.storage.saveSettings(S.settings);
      renderSettings(); renderHome(); renderLimitPicker();
      if (S.viewRecord) renderSummary(S.viewRecord);
    });
    segBind('segLimit', function (v) {
      S.settings.limitMode = v;
      TL.storage.saveSettings(S.settings);
      S.manualLimit = undefined;
      renderSettings(); renderLimitBar(); renderLimitPicker(); updateLimitSign();
    });
    segBind('segSens', function (v) {
      S.settings.sensitivity = v; TL.storage.saveSettings(S.settings);
      if (S.trip) S.trip.setSensitivity(v);
      renderSettings();
    });
    segBind('segRate', function (v) {
      S.settings.demoRate = Number(v); TL.storage.saveSettings(S.settings);
      renderSettings();
    });
    [['swVoice', 'voice'], ['swBeeps', 'beeps'], ['swVibrate', 'vibrate'], ['swAwake', 'keepAwake']]
      .forEach(function (p) {
        $(p[0]).addEventListener('change', function () {
          S.settings[p[1]] = $(p[0]).checked;
          TL.storage.saveSettings(S.settings);
          TL.alerts.configure(S.settings);
          if (p[1] === 'keepAwake' && S.mode === 'live') TL.sensors.keepAwake($(p[0]).checked);
        });
      });
    $('btnTestAlert').addEventListener('click', function () {
      TL.alerts.unlock();
      TL.alerts.configure(S.settings);
      TL.alerts.preview('brake', 'harsh');
      flash('harsh');
    });

    // Count deliberate taps while moving — never a scroll, a long press, or
    // any control the app itself requires. Counting scrolls was charging the
    // driver for reaching a control the app made them use.
    var tapStart = null;
    $('screen-drive').addEventListener('pointerdown', function (e) {
      tapStart = { x: e.clientX, y: e.clientY, t: Date.now() };
    });
    $('screen-drive').addEventListener('pointercancel', function () { tapStart = null; });
    $('screen-drive').addEventListener('pointerup', function (e) {
      var st = tapStart; tapStart = null;
      if (!st || !S.trip || S.mode !== 'live') return;
      var dx = e.clientX - st.x, dy = e.clientY - st.y;
      if (Math.sqrt(dx * dx + dy * dy) > 14) return;      // a scroll, not a tap
      if (Date.now() - st.t > 700) return;                // a long press
      if (e.target.closest('#limitBar, #limitPicker, #hudLimit, #btnStop, #driveAlert')) return;
      S.trip.noteInteraction();
    });

    $('hudLimit').addEventListener('click', function () {
      var pick = $('limitPicker');
      pick.classList.toggle('hidden');
      if (!pick.classList.contains('hidden')) renderLimitPicker();
    });

    // Speed profile hover
    var pc = $('sumProfile');
    pc.addEventListener('pointermove', function (e) {
      if (!S.viewRecord || !S.profileGeom) return;
      var rect = pc.getBoundingClientRect();
      var idx = CH.indexAtX(S.viewRecord.route, S.profileGeom, e.clientX - rect.left);
      if (idx === S.hoverIdx) return;
      S.hoverIdx = idx;
      drawSummaryCharts(S.viewRecord);
      var p = S.viewRecord.route[idx];
      var tip = $('profileTip');
      if (p) {
        tip.textContent = U.fmtDuration(p.t) + '  ' + Math.round(U.speedIn(p.v, S.settings.units)) +
          ' ' + U.speedUnit(S.settings.units) + (p.lim ? '  (limit ' + Math.round(U.speedIn(p.lim, S.settings.units)) + ')' : '');
        tip.classList.add('is-on');
        var tx = U.clamp(e.clientX - rect.left + 10, 4, rect.width - tip.offsetWidth - 4);
        tip.style.left = tx + 'px';
        tip.style.top = '6px';
      }
    });
    pc.addEventListener('pointerleave', function () {
      S.hoverIdx = null;
      $('profileTip').classList.remove('is-on');
      if (S.viewRecord) drawSummaryCharts(S.viewRecord);
    });

    window.addEventListener('resize', function () {
      if (S.viewRecord && $('screen-summary').classList.contains('is-active')) drawSummaryCharts(S.viewRecord);
      renderHome();
      if ($('screen-history').classList.contains('is-active')) renderHistory();
    });
    document.addEventListener('visibilitychange', function () {
      if (S.mode === 'live' && S.settings.keepAwake) TL.sensors.reacquireWakeLock();
    });
    window.addEventListener('beforeunload', function (e) {
      if (S.mode === 'live') { e.preventDefault(); e.returnValue = ''; }
    });

    checkTrackingAvailability();
    renderWeights();
    renderHome();
    renderSettings();
    showScreen('home');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else init();
})(window.TL = window.TL || {});
