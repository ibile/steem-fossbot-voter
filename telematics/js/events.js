/* Event detection.
 *
 * Every channel is a hysteresis state machine rather than a bare threshold
 * compare: a sample must stay over the entry threshold for a minimum duration
 * before an event opens, and must fall below a lower exit threshold before it
 * closes. That is what stops one noisy GPS sample from logging a "harsh brake",
 * and what stops a single long brake from being logged as fifteen of them.
 */
(function (TL) {
  'use strict';
  var U = TL.util, G = U.G;

  // Entry thresholds in g. These sit in the range the industry generally uses
  // (roughly 0.3 g noticeable, 0.4 g harsh, 0.5 g+ severe).
  var BASE = {
    brake:  { mild: 0.30, harsh: 0.40, severe: 0.52, minMs: 400, minSpeed: 4.5 },
    accel:  { mild: 0.28, harsh: 0.37, severe: 0.48, minMs: 400, minSpeed: 4.5 },
    corner: { mild: 0.32, harsh: 0.42, severe: 0.55, minMs: 700, minSpeed: 4.0 }
  };
  var SENSITIVITY = { lenient: 1.18, standard: 1.0, strict: 0.86 };

  var SPEED_MIN_MS = 4000;      // sustained before it counts as speeding
  var EXIT_RATIO = 0.72;
  var EXIT_HOLD_MS = 350;
  var COOLDOWN_MS = 2500;

  function thresholdsFor(sensitivity) {
    var k = SENSITIVITY[sensitivity] || 1;
    var out = {};
    Object.keys(BASE).forEach(function (ch) {
      var b = BASE[ch];
      out[ch] = {
        mild: b.mild * k * G, harsh: b.harsh * k * G, severe: b.severe * k * G,
        minMs: b.minMs, minSpeed: b.minSpeed
      };
    });
    return out;
  }

  function severityOf(peak, th) {
    var a = Math.abs(peak);
    if (a >= th.severe) return 'severe';
    if (a >= th.harsh) return 'harsh';
    return 'mild';
  }

  function Detector(cfg) {
    this.configure(cfg || {});
    this.reset();
  }

  Detector.prototype.configure = function (cfg) {
    this.sensitivity = cfg.sensitivity || 'standard';
    this.th = thresholdsFor(this.sensitivity);
  };

  Detector.prototype.reset = function () {
    var self = this;
    this.ch = {};
    ['brake', 'accel', 'corner'].forEach(function (name) {
      self.ch[name] = { active: false, candT: null, t0: null, peak: 0, belowT: null, lastEnd: -1e12, snap: null };
    });
    this.speed = { active: false, candT: null, t0: null, peakOver: 0, belowT: null, lastEnd: -1e12, snap: null, peakSpeed: 0 };
    this.events = [];
  };

  /* metricFor returns the signed value being tested for each channel. */
  function metric(name, s) {
    if (name === 'brake') return s.aLong < 0 ? -s.aLong : 0;
    if (name === 'accel') return s.aLong > 0 ? s.aLong : 0;
    return Math.abs(s.aLat);
  }

  Detector.prototype._runChannel = function (name, s, out) {
    var th = this.th[name], st = this.ch[name];
    var m = metric(name, s);
    var eligible = s.speed >= th.minSpeed;
    var over = eligible && m >= th.mild;

    if (!st.active) {
      if (over && (s.t - st.lastEnd) > COOLDOWN_MS) {
        if (st.candT == null) { st.candT = s.t; st.peak = m; st.snap = snapshot(s); }
        st.peak = Math.max(st.peak, m);
        if (s.t - st.candT >= th.minMs) {
          st.active = true; st.t0 = st.candT; st.belowT = null;
        }
      } else {
        st.candT = null; st.peak = 0;
      }
      return;
    }

    st.peak = Math.max(st.peak, m);
    if (m < th.mild * EXIT_RATIO || !eligible) {
      if (st.belowT == null) st.belowT = s.t;
      if (s.t - st.belowT >= EXIT_HOLD_MS) {
        out.push(this._close(name, st, s));
      }
    } else {
      st.belowT = null;
    }
  };

  function snapshot(s) {
    return { lat: s.lat, lon: s.lon, speed: s.speed, heading: s.heading, dist: s.distance };
  }

  Detector.prototype._close = function (name, st, s) {
    var th = this.th[name];
    var ev = {
      id: U.uid(),
      type: name,
      severity: severityOf(st.peak, th),
      t0: st.t0,
      t1: st.belowT,
      durMs: Math.max(0, st.belowT - st.t0),
      peak: st.peak,
      peakG: st.peak / G,
      speedStart: st.snap ? st.snap.speed : s.speed,
      speedEnd: s.speed,
      lat: st.snap ? st.snap.lat : s.lat,
      lon: st.snap ? st.snap.lon : s.lon,
      dir: name === 'corner' ? (s.aLat >= 0 ? 'right' : 'left') : null,
      distanceAt: s.distance
    };
    st.active = false; st.candT = null; st.peak = 0; st.belowT = null;
    st.lastEnd = s.t; st.snap = null;
    this.events.push(ev);
    return ev;
  };

  /* Speeding is a different shape of event: not a spike, a sustained state. */
  Detector.prototype._runSpeeding = function (s, limit, out) {
    var st = this.speed;
    if (limit == null || !(limit > 0)) {
      if (st.active) { st.active = false; st.candT = null; }
      return;
    }
    // Allow 5% plus ~1 mph before calling it speeding: GPS speed has real
    // error, and flagging someone at 31 in a 30 would be noise, not insight.
    var trigger = limit * 1.05 + 0.45;
    var over = s.speed > trigger;

    if (!st.active) {
      if (over) {
        if (st.candT == null) { st.candT = s.t; st.snap = snapshot(s); st.peakSpeed = s.speed; }
        st.peakSpeed = Math.max(st.peakSpeed, s.speed);
        if (s.t - st.candT >= SPEED_MIN_MS) { st.active = true; st.t0 = st.candT; st.belowT = null; st.limit = limit; }
      } else { st.candT = null; }
      return;
    }
    st.peakSpeed = Math.max(st.peakSpeed, s.speed);
    st.limit = Math.max(st.limit || limit, limit);
    if (s.speed <= limit * 1.01) {
      if (st.belowT == null) st.belowT = s.t;
      if (s.t - st.belowT >= 1500) {
        var pctOver = (st.peakSpeed - st.limit) / st.limit * 100;
        var ev = {
          id: U.uid(), type: 'speeding',
          severity: pctOver >= 20 ? 'severe' : (pctOver >= 10 ? 'harsh' : 'mild'),
          t0: st.t0, t1: st.belowT, durMs: Math.max(0, st.belowT - st.t0),
          peak: st.peakSpeed, peakG: 0,
          limit: st.limit, pctOver: pctOver,
          speedStart: st.snap ? st.snap.speed : s.speed, speedEnd: s.speed,
          lat: st.snap ? st.snap.lat : s.lat, lon: st.snap ? st.snap.lon : s.lon,
          distanceAt: s.distance
        };
        st.active = false; st.candT = null; st.belowT = null; st.snap = null; st.peakSpeed = 0;
        this.events.push(ev);
        out.push(ev);
      }
    } else {
      st.belowT = null;
    }
  };

  /* Feed one fused sample. Returns events that COMPLETED on this sample. */
  Detector.prototype.update = function (s, limit) {
    var out = [];
    this._runChannel('brake', s, out);
    this._runChannel('accel', s, out);
    this._runChannel('corner', s, out);
    this._runSpeeding(s, limit, out);
    return out;
  };

  /* Anything still open when the trip ends. */
  Detector.prototype.flush = function (s) {
    var out = [], self = this;
    ['brake', 'accel', 'corner'].forEach(function (name) {
      var st = self.ch[name];
      if (st.active) { st.belowT = s.t; out.push(self._close(name, st, s)); }
    });
    return out;
  };

  /* Live 0..1 intensity per channel, for the HUD meters. */
  Detector.prototype.intensity = function (s) {
    var self = this;
    var r = {};
    ['brake', 'accel', 'corner'].forEach(function (n) {
      r[n] = U.clamp(metric(n, s) / self.th[n].severe, 0, 1.4);
    });
    return r;
  };

  TL.Detector = Detector;
  TL.detectorThresholds = thresholdsFor;
  TL.SEVERITY_ORDER = { mild: 1, harsh: 2, severe: 3 };
})(window.TL = window.TL || {});
