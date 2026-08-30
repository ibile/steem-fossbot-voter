/* Kinematics: turns raw GPS + IMU samples into vehicle-frame motion.
 *
 * The hard problem in phone telematics is that the accelerometer reports in the
 * DEVICE frame (which depends on how the phone happens to be lying) while the
 * scoring needs the VEHICLE frame (forward / lateral). Three tricks are used:
 *
 *  1. Gravity, low-pass filtered out of accelerationIncludingGravity, gives the
 *     vertical axis "u" for free, whatever the mounting angle.
 *  2. Yaw rate is the component of the gyro vector along u. Rotation about the
 *     vertical axis is yaw regardless of how the phone is rotated, so lateral
 *     acceleration = v * yawRate needs no calibration at all.
 *  3. The forward axis is solved for by correlating the horizontal accelerometer
 *     vector against GPS-derived longitudinal acceleration during straight-line
 *     speed changes. Once that correlation is confident, high-rate accelerometer
 *     detail is blended onto the low-rate GPS trend with a complementary filter.
 *
 * If there is no motion sensor at all, everything still works from GPS alone
 * (speed differentiation + heading rate), just with coarser event timing.
 */
(function (TL) {
  'use strict';
  var U = TL.util, G = U.G;

  function Kinematics(opts) {
    opts = opts || {};
    this.reset();
  }

  Kinematics.prototype.reset = function () {
    // Constant-acceleration Kalman filter on speed: x = [v, a]
    this.x = [0, 0];
    this.P = [[25, 0], [0, 9]];
    this.qJerk = 1.6;            // process noise, m/s^3
    this.lastPredictT = null;

    this.pos = null;             // last accepted fix
    this.prevPos = null;
    this.heading = null;         // deg
    this.headingT = null;
    this.yawRateGps = 0;         // rad/s, +ve = turning left
    this.accuracy = null;
    this.gpsAgeT = null;
    this.fixCount = 0;

    // IMU
    this.gravity = null;         // [x,y,z] device frame
    this.gravSamples = 0;
    this.omega = [0, 0, 0];      // rad/s device frame
    this.gyroBias = [0, 0, 0];
    this.gyroBiasN = 0;
    this.hasMotion = false;
    this.hasGyro = false;
    this.yawSignAcc = 0;
    this.yawSign = 1;
    this.motionT = null;
    this.motionRate = 0;

    // Forward-axis solver
    this.fwdAcc = [0, 0, 0];     // correlation accumulator
    this.fwdMag = 0;             // normalisation for confidence
    this.forward = null;         // unit vector, device frame
    this.calConf = 0;            // 0..1

    // Fused outputs
    this.aLong = 0;              // +ve = accelerating, m/s^2
    this.aLat = 0;               // +ve = accelerating to vehicle's right
    this.yawRate = 0;            // rad/s, +ve = left
    this.jerk = 0;               // m/s^3
    this.aLongGps = 0;
    this.aLongImu = 0;
    this.aLongImuLp = 0;
    this.aLongGpsLp = 0;
    this.aLatImu = 0;
    this.prevALong = 0;
    this.aLongSmooth = 0;
    this.vibSq = 0;
    this.vibMs = 0;
    this.vibRms = 0;
    this.distance = 0;
    this.tickT = null;
  };

  /* --- 2x2 Kalman helpers ------------------------------------------------ */
  Kinematics.prototype._predict = function (dt) {
    if (!(dt > 0)) return;
    dt = Math.min(dt, 2.5);
    var x = this.x, P = this.P;
    x[0] = x[0] + x[1] * dt;
    // F = [[1,dt],[0,1]] -> P = F P F' + Q
    var p00 = P[0][0] + dt * (P[1][0] + P[0][1]) + dt * dt * P[1][1];
    var p01 = P[0][1] + dt * P[1][1];
    var p10 = P[1][0] + dt * P[1][1];
    var p11 = P[1][1];
    var q = this.qJerk * this.qJerk;
    P[0][0] = p00 + q * dt * dt * dt * dt / 4;
    P[0][1] = p01 + q * dt * dt * dt / 2;
    P[1][0] = p10 + q * dt * dt * dt / 2;
    P[1][1] = p11 + q * dt * dt;
    if (x[0] < 0) { x[0] = 0; if (x[1] < 0) x[1] = 0; }
  };

  Kinematics.prototype._updateSpeed = function (z, sigma) {
    var P = this.P, x = this.x;
    var R = sigma * sigma;
    var S = P[0][0] + R;
    var k0 = P[0][0] / S, k1 = P[1][0] / S;
    var y = z - x[0];
    x[0] += k0 * y;
    x[1] += k1 * y;
    var p00 = P[0][0], p01 = P[0][1];
    P[0][0] = (1 - k0) * p00;
    P[0][1] = (1 - k0) * p01;
    P[1][0] = P[1][0] - k1 * p00;
    P[1][1] = P[1][1] - k1 * p01;
    if (x[0] < 0) x[0] = 0;
  };

  /* --- GPS --------------------------------------------------------------- */
  /* p = {t, lat, lon, speed|null (m/s), heading|null (deg), accuracy (m),
          speedAccuracy|null} */
  Kinematics.prototype.pushPosition = function (p) {
    var t = p.t / 1000;
    if (this.lastPredictT != null) this._predict(t - this.lastPredictT);
    this.lastPredictT = t;

    var acc = (p.accuracy == null || !isFinite(p.accuracy)) ? 15 : p.accuracy;
    this.accuracy = acc;

    // Speed: prefer the receiver's Doppler speed, else differentiate position.
    var z = null, sigma = null;
    if (p.speed != null && isFinite(p.speed) && p.speed >= 0) {
      z = p.speed;
      sigma = (p.speedAccuracy != null && isFinite(p.speedAccuracy))
        ? Math.max(0.25, p.speedAccuracy) : Math.max(0.4, acc / 12);
    } else if (this.pos) {
      var dtp = t - this.pos.t / 1000;
      if (dtp > 0.2) {
        var d = U.haversine(this.pos.lat, this.pos.lon, p.lat, p.lon);
        z = d / dtp;
        // Position differencing inherits the fix noise on both ends.
        sigma = Math.max(0.8, (acc + (this.pos.accuracy || acc)) / dtp / 2);
      }
    }
    if (z != null) this._updateSpeed(z, sigma);

    // Distance travelled, gated on fix quality so a jittering stationary fix
    // does not accumulate phantom miles.
    if (this.pos) {
      var dm = U.haversine(this.pos.lat, this.pos.lon, p.lat, p.lon);
      var dts = t - this.pos.t / 1000;
      if (dm > Math.max(2, acc * 0.5) && dts > 0 && dm / dts < 90) this.distance += dm;
    }

    // Heading: receiver value when moving, else bearing between fixes.
    var newHeading = null;
    if (p.heading != null && isFinite(p.heading) && this.x[0] > 2.0) {
      newHeading = p.heading;
    } else if (this.pos) {
      var dd = U.haversine(this.pos.lat, this.pos.lon, p.lat, p.lon);
      if (dd > Math.max(4, acc)) newHeading = U.bearing(this.pos.lat, this.pos.lon, p.lat, p.lon);
    }
    if (newHeading != null) {
      if (this.heading != null && this.headingT != null) {
        var dth = t - this.headingT;
        if (dth > 0.15 && dth < 4 && this.x[0] > 2.0) {
          // +ve yaw rate = turning left = decreasing compass bearing.
          var dHead = U.angleDiff(newHeading, this.heading);
          var yr = -U.toRad(dHead) / dth;
          if (Math.abs(yr) < 2.0) this.yawRateGps = yr;
        }
      }
      this.heading = newHeading;
      this.headingT = t;
    }

    this.prevPos = this.pos;
    this.pos = { t: p.t, lat: p.lat, lon: p.lon, accuracy: acc };
    this.gpsAgeT = t;
    this.fixCount++;
  };

  /* --- IMU --------------------------------------------------------------- */
  /* m = {t, ax, ay, az (incl. gravity, m/s^2), rx, ry, rz (deg/s) | null} */
  Kinematics.prototype.pushMotion = function (m) {
    var t = m.t / 1000;
    var dt = this.motionT == null ? 0.02 : U.clamp(t - this.motionT, 0.001, 0.2);
    this.motionT = t;
    this.motionRate = this.motionRate * 0.95 + (1 / dt) * 0.05;
    this.hasMotion = true;

    var a = [m.ax, m.ay, m.az];
    if (!isFinite(a[0]) || !isFinite(a[1]) || !isFinite(a[2])) return;

    // 1. Gravity by low-pass, with two corrections that matter a lot in
    //    practice. Stopped, the measured vector IS gravity, so track it fast
    //    and lock the axis; moving, track very slowly or a sustained pull (a
    //    long motorway on-ramp) gets absorbed into "gravity" and tilts the
    //    vertical axis. Then renormalise: we know |g| = 9.80665, so any drift
    //    in magnitude is error, not gravity.
    if (!this.gravity) { this.gravity = a.slice(); this.gravSamples = 0; }
    // Only refresh the estimate when the reading is plausibly pure gravity:
    // stopped, or coasting with total magnitude near 1 g and no turn in
    // progress. Pulling the average during a hard brake is what tilts the
    // axis and makes every later reading wrong.
    var mag = U.vLen(a);
    var stopped = this.x[0] < 0.8;
    var quasiStatic = Math.abs(mag - G) < 0.6 &&
                      Math.abs(this.x[1]) < 0.8 &&
                      Math.abs(this.yawRate) < U.toRad(4);
    if (stopped || quasiStatic) {
      var ag = U.emaAlpha(dt, stopped ? 0.5 : 4.0);
      this.gravity[0] += ag * (a[0] - this.gravity[0]);
      this.gravity[1] += ag * (a[1] - this.gravity[1]);
      this.gravity[2] += ag * (a[2] - this.gravity[2]);
      this.gravSamples = Math.min((this.gravSamples || 0) + 1, 100000);
    }
    // |g| is known, so any drift in magnitude is error rather than gravity.
    var gl = U.vLen(this.gravity);
    if (gl > 1e-6) {
      var gk = G / gl;
      this.gravity[0] *= gk; this.gravity[1] *= gk; this.gravity[2] *= gk;
    }
    var u = U.vNorm(this.gravity);            // unit vertical, device frame

    // Linear acceleration, then its horizontal part.
    var lin = U.vSub(a, this.gravity);
    var aH = U.vReject(lin, u);

    // 2. Yaw rate = spin about the vertical axis. No calibration needed.
    if (m.rx != null && isFinite(m.rx)) {
      this.hasGyro = true;
      var w = [U.toRad(m.rx), U.toRad(m.ry), U.toRad(m.rz)];
      // Learn gyro bias while genuinely stopped.
      if (this.x[0] < 0.6) {
        this.gyroBiasN = Math.min(this.gyroBiasN + 1, 4000);
        var bw = 1 / this.gyroBiasN;
        this.gyroBias[0] += bw * (w[0] - this.gyroBias[0]);
        this.gyroBias[1] += bw * (w[1] - this.gyroBias[1]);
        this.gyroBias[2] += bw * (w[2] - this.gyroBias[2]);
      }
      this.omega = U.vSub(w, this.gyroBias);
      // Sign convention for accelerationIncludingGravity is not consistent
      // across browsers (iOS has historically reported it inverted), and the
      // phone may simply be mounted upside down. Either way "u" can point up
      // or down, which would silently mirror every corner. Rather than assume,
      // learn the sign by correlating against GPS heading change, which is
      // unambiguous. Defaults to +1 until enough turns have been seen.
      var yrRaw = U.vDot(this.omega, u);
      if (Math.abs(this.yawRateGps) > 0.05 && Math.abs(yrRaw) > 0.05) {
        this.yawSignAcc += yrRaw * this.yawRateGps * dt;
      }
      this.yawSign = this.yawSignAcc < -0.02 ? -1 : 1;
      this.yawRate = yrRaw * this.yawSign;
    } else {
      this.yawRate = this.yawRateGps;
    }

    // 3. Solve the forward axis by correlating horizontal accel with the GPS
    //    acceleration estimate. Only during straight-line speed changes, or
    //    cornering would drag the estimate sideways.
    var aGps = this.x[1];
    var straight = Math.abs(this.yawRate) < U.toRad(6);
    if (this.x[0] > 5 && Math.abs(aGps) > 0.5 && straight && this.accuracy != null && this.accuracy < 30) {
      var wgt = dt * Math.min(Math.abs(aGps), 4);
      this.fwdAcc[0] += aH[0] * aGps * wgt;
      this.fwdAcc[1] += aH[1] * aGps * wgt;
      this.fwdAcc[2] += aH[2] * aGps * wgt;
      this.fwdMag += U.vLen(aH) * Math.abs(aGps) * wgt;
      if (this.fwdMag > 0) {
        var f = U.vNorm(U.vReject(this.fwdAcc, u));
        if (U.vLen(f) > 0) this.forward = f;
        // Amplitude correlation tops out well below 1 even for a perfectly
        // solved axis, because the accelerometer only carries the AC part of
        // the signal. What matters is that the direction has settled, so
        // treat a ratio of 0.4 as fully converged and scale by how much
        // evidence has accumulated.
        var ratio = U.vLen(this.fwdAcc) / this.fwdMag;
        this.calConf = U.clamp(ratio / 0.40, 0, 1) * U.clamp(this.fwdMag / 20, 0, 1);
      }
    }

    if (this.forward) {
      this.aLongImu = U.vDot(aH, this.forward);
      var right = U.vScale(U.vCross(this.forward, u), this.yawSign);
      this.aLatImu = U.vDot(aH, right);
    }

    this._fuse(dt, t);
  };

  /* Complementary fusion: GPS supplies the low-frequency truth (no drift),
     the IMU supplies the fast detail (no 1 Hz smearing of a brake onset). */
  Kinematics.prototype._fuse = function (dt, t) {
    var aGps = this.x[1];
    var aLp = U.emaAlpha(dt, 2.0);
    this.aLongGpsLp += aLp * (aGps - this.aLongGpsLp);
    this.aLongImuLp += aLp * (this.aLongImu - this.aLongImuLp);

    var prev = this.aLong;
    var usable = this.hasMotion && this.forward && this.calConf > 0.35 && this._gpsFresh(t);
    if (usable) {
      var blend = U.clamp((this.calConf - 0.35) / 0.35, 0, 1);
      var fused = this.aLongGpsLp + (this.aLongImu - this.aLongImuLp);
      this.aLong = fused * blend + aGps * (1 - blend);
    } else {
      this.aLong = aGps;
    }
    this.aLongGps = aGps;

    // Lateral: v * yawRate is exact for planar vehicle motion, so it leads.
    var v = this.x[0];
    var latKin = -v * this.yawRate;            // +ve = accelerating right
    if (this.hasGyro) {
      this.aLat = latKin;
    } else if (this.forward && this.calConf > 0.5) {
      this.aLat = this.aLatImu;
    } else {
      this.aLat = -v * this.yawRateGps;
    }
    // Below walking pace lateral g is meaningless and mostly handling noise.
    if (v < 2.0) this.aLat *= U.clamp((v - 0.5) / 1.5, 0, 1);

    // Jerk, band-limited to where a driver's inputs actually live.
    //
    // Differentiating and then low-passing ONCE does not work: above the
    // cutoff the differentiator's gain (proportional to f) and the pole's
    // attenuation (proportional to 1/f) cancel exactly, so cradle rattle and
    // road buzz at 5-20 Hz pass straight through at full strength and get
    // scored as jerky driving. Pedal and steering inputs are all below about
    // 0.5 Hz, so smooth FIRST, differentiate the smoothed signal, then smooth
    // again — two poles after the differentiator roll vibration off as 1/f.
    var sa = U.emaAlpha(dt, 0.8);
    var prevSmooth = this.aLongSmooth;
    this.aLongSmooth += sa * (this.aLong - this.aLongSmooth);
    var rawJerk = dt > 0 ? (this.aLongSmooth - prevSmooth) / dt : 0;
    var jd = U.emaAlpha(dt, 0.6);
    this.jerk += jd * (U.clamp(rawJerk, -60, 60) - this.jerk);

    // What was filtered out is itself worth knowing: it measures how much the
    // phone is shaking, which is a property of the mount and the road surface
    // rather than of the driving. Reported, never scored.
    var resid = this.aLong - this.aLongSmooth;
    this.vibSq += resid * resid * dt;
    this.vibMs += dt;
    this.vibRms = this.vibMs > 0 ? Math.sqrt(this.vibSq / this.vibMs) : 0;
    this.tickT = t;
  };

  Kinematics.prototype._gpsFresh = function (t) {
    return this.gpsAgeT != null && (t - this.gpsAgeT) < 5;
  };

  /* Advance time when no IMU is present (or between IMU samples). */
  Kinematics.prototype.tick = function (tMs) {
    var t = tMs / 1000;
    if (this.lastPredictT != null) {
      var dt = t - this.lastPredictT;
      if (dt > 0) { this._predict(dt); this.lastPredictT = t; }
    } else {
      this.lastPredictT = t;
    }
    if (!this.hasMotion) {
      var dt2 = this.tickT == null ? 0.05 : U.clamp(t - this.tickT, 0.001, 1);
      this.yawRate = this.yawRateGps;
      this._fuse(dt2, t);
    }
    return this.sample(tMs);
  };

  Kinematics.prototype.sample = function (tMs) {
    return {
      t: tMs,
      speed: this.x[0],
      aLong: this.aLong,
      aLat: this.aLat,
      jerk: this.jerk,
      yawRate: this.yawRate,
      heading: this.heading,
      lat: this.pos ? this.pos.lat : null,
      lon: this.pos ? this.pos.lon : null,
      accuracy: this.accuracy,
      distance: this.distance,
      calConf: this.calConf,
      vibRms: this.vibRms,
      hasMotion: this.hasMotion,
      hasGyro: this.hasGyro,
      motionRate: this.motionRate,
      fixCount: this.fixCount,
      gpsFresh: this._gpsFresh(tMs / 1000)
    };
  };

  TL.Kinematics = Kinematics;
})(window.TL = window.TL || {});
