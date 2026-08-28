/* Trip: owns the pipeline for one journey.
   raw samples -> Kinematics (fusion) -> Detector (events) -> accumulators.
   Live driving and the demo replay both run through this exact object, so the
   demo is a genuine test of the scoring path rather than a mock-up of it. */
(function (TL) {
  'use strict';
  var U = TL.util;

  var ROUTE_INTERVAL_MS = 1000;
  var MAX_ROUTE_POINTS = 5000;
  var MOVING_SPEED = 0.7;          // m/s

  function Trip(settings) {
    this.settings = settings || {};
    this.kin = new TL.Kinematics();
    this.det = new TL.Detector({ sensitivity: this.settings.sensitivity || 'standard' });
    this.reset();
  }

  Trip.prototype.reset = function () {
    this.kin.reset();
    this.det.reset();
    this.startedAt = null;       // wall clock ms
    this.t0 = null;              // pipeline clock ms
    this.lastT = null;
    this.endedAt = null;
    this.limit = null;           // m/s, or null when unknown
    this.limitSource = 'none';
    this.route = [];
    this.lastRouteT = null;
    this.acc = {
      distanceM: 0, movingMs: 0, idleMs: 0, totalMs: 0,
      maxSpeed: 0, limitKnownMs: 0,
      overMs: { mild: 0, harsh: 0, severe: 0 },
      maxOverPct: 0, excessPctMs: 0, nightMs: 0, interactions: 0,
      jerkSqSum: 0, jerkMs: 0, events: []
    };
    this.finished = false;
  };

  Trip.prototype.start = function (tMs, wallMs) {
    this.t0 = tMs;
    this.lastT = tMs;
    this.startedAt = wallMs == null ? Date.now() : wallMs;
    this.finished = false;
  };

  Trip.prototype.setSensitivity = function (s) {
    this.det.configure({ sensitivity: s });
  };

  Trip.prototype.setLimit = function (mps, source) {
    this.limit = (mps != null && mps > 0) ? mps : null;
    this.limitSource = source || (this.limit ? 'manual' : 'none');
  };

  Trip.prototype.noteInteraction = function () {
    if (this.finished) return;
    var s = this.kin.sample(this.lastT || 0);
    if (s.speed > 4.0) this.acc.interactions++;
  };

  Trip.prototype.feedPosition = function (p) { this.kin.pushPosition(p); };
  Trip.prototype.feedMotion = function (m) { this.kin.pushMotion(m); };

  /* Advance to time t, fold in accumulators, return what happened. */
  Trip.prototype.tick = function (tMs) {
    if (this.t0 == null) this.start(tMs);
    var s = this.kin.tick(tMs);
    var dt = this.lastT == null ? 0 : U.clamp(tMs - this.lastT, 0, 2000);
    this.lastT = tMs;

    var a = this.acc;
    a.totalMs = tMs - this.t0;
    a.distanceM = s.distance;
    var moving = s.speed > MOVING_SPEED;
    if (moving) {
      a.movingMs += dt;
      a.maxSpeed = Math.max(a.maxSpeed, s.speed);
      a.jerkSqSum += s.jerk * s.jerk * dt;
      a.jerkMs += dt;
      var wall = this.startedAt + (tMs - this.t0);
      var hr = new Date(wall).getHours();
      if (hr >= 23 || hr < 5) a.nightMs += dt;
      if (this.limit) {
        a.limitKnownMs += dt;
        var trigger = this.limit * 1.05 + 0.45;
        if (s.speed > trigger) {
          var pct = (s.speed - this.limit) / this.limit * 100;
          a.maxOverPct = Math.max(a.maxOverPct, pct);
          // Integrate how far over, above the 5% tolerance, so the measure
          // scales with severity instead of being a binary over/not-over.
          a.excessPctMs += Math.max(0, pct - 5) * dt;
          if (pct >= 20) a.overMs.severe += dt;
          else if (pct >= 10) a.overMs.harsh += dt;
          else a.overMs.mild += dt;
        }
      }
    } else {
      a.idleMs += dt;
    }

    var newEvents = this.det.update(s, this.limit);
    if (newEvents.length) a.events = a.events.concat(newEvents);

    if (this.lastRouteT == null || tMs - this.lastRouteT >= ROUTE_INTERVAL_MS) {
      this.lastRouteT = tMs;
      if (s.lat != null) {
        this.route.push({
          t: Math.round(tMs - this.t0),
          lat: Math.round(s.lat * 1e5) / 1e5,
          lon: Math.round(s.lon * 1e5) / 1e5,
          v: Math.round(s.speed * 10) / 10,
          al: Math.round(s.aLong * 100) / 100,
          at: Math.round(s.aLat * 100) / 100,
          lim: this.limit ? Math.round(this.limit * 10) / 10 : null
        });
        if (this.route.length > MAX_ROUTE_POINTS) {
          // Halve resolution rather than dropping the tail: the whole journey
          // stays on the chart, just coarser.
          this.route = this.route.filter(function (_, i) { return i % 2 === 0; });
        }
      }
    }

    return { sample: s, events: newEvents, intensity: this.det.intensity(s) };
  };

  Trip.prototype.stop = function (tMs) {
    if (this.finished) return this.summary();
    var t = tMs == null ? this.lastT : tMs;
    var s = this.kin.sample(t);
    var tail = this.det.flush(s);
    if (tail.length) this.acc.events = this.acc.events.concat(tail);
    this.endedAt = this.startedAt + (t - this.t0);
    this.finished = true;
    return this.summary();
  };

  Trip.prototype.summary = function () {
    var a = this.acc;
    var out = {
      distanceM: a.distanceM, movingMs: a.movingMs, idleMs: a.idleMs,
      totalMs: a.totalMs, maxSpeed: a.maxSpeed, limitKnownMs: a.limitKnownMs,
      overMs: { mild: a.overMs.mild, harsh: a.overMs.harsh, severe: a.overMs.severe },
      maxOverPct: a.maxOverPct, excessPctMs: a.excessPctMs,
      meanExcessPct: a.limitKnownMs > 0 ? a.excessPctMs / a.limitKnownMs : 0,
      nightMs: a.nightMs, interactions: a.interactions,
      jerkRms: a.jerkMs > 0 ? Math.sqrt(a.jerkSqSum / a.jerkMs) : 0,
      events: a.events.slice(),
      avgSpeed: a.movingMs > 0 ? a.distanceM / (a.movingMs / 1000) : 0
    };
    return out;
  };

  /* A saveable record: summary + score + route + provenance. */
  Trip.prototype.record = function (meta) {
    var acc = this.summary();
    var score = TL.scoring.scoreTrip(acc);
    return {
      id: U.uid(),
      startedAt: this.startedAt,
      endedAt: this.endedAt || Date.now(),
      source: (meta && meta.source) || 'live',
      profile: meta && meta.profile,
      sensitivity: this.settings.sensitivity || 'standard',
      limitSource: this.limitSource,
      acc: acc,
      score: { overall: score.overall, band: score.band.key, provisional: score.provisional },
      route: this.route.slice(),
      quality: {
        hasMotion: this.kin.hasMotion,
        hasGyro: this.kin.hasGyro,
        calConf: Math.round(this.kin.calConf * 100) / 100,
        fixes: this.kin.fixCount
      }
    };
  };

  TL.Trip = Trip;
})(window.TL = window.TL || {});
