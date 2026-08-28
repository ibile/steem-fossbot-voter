/* Synthetic drive generator.
 *
 * This is not a mock: it integrates a vehicle model, mounts a virtual phone at
 * an arbitrary angle in the cradle, adds GPS and sensor noise, and emits the
 * same DeviceMotion / Geolocation shaped samples the real hardware would. The
 * demo therefore exercises the actual fusion, detection and scoring code —
 * if the demo scores you harshly, the road will too.
 */
(function (TL) {
  'use strict';
  var U = TL.util, G = U.G;
  var MPH = 0.44704;

  var PROFILES = {
    smooth: {
      label: 'Careful', blurb: 'Gentle inputs, reads the road ahead, sits on the limit.',
      accel: 1.4, brake: 2.2, jerkLimit: 1.6, cornerG: 0.20,
      overFactor: 0.01, overVar: 0.02, incidentRate: 0.22, incidentBrake: 3.7
    },
    average: {
      label: 'Typical', blurb: 'Ordinary commuting: brisk pull-aways, a bit over on the fast roads.',
      accel: 2.2, brake: 3.1, jerkLimit: 2.8, cornerG: 0.29,
      overFactor: 0.07, overVar: 0.05, incidentRate: 0.35, incidentBrake: 4.6
    },
    aggressive: {
      label: 'Hurried', blurb: 'Late braking, quick turn-in, consistently over the limit.',
      accel: 3.4, brake: 4.8, jerkLimit: 5.5, cornerG: 0.44,
      overFactor: 0.17, overVar: 0.07, incidentRate: 0.85, incidentBrake: 6.2
    }
  };

  /* A UK-shaped commute: estate roads, an A-road, a stretch of motorway, then
     back into town. Limits in mph, converted on the way in. */
  function buildPlan(prof, rnd) {
    var p = [];
    function over(limit) {
      var f = prof.overFactor + (rnd() - 0.5) * 2 * prof.overVar;
      return limit * (1 + Math.max(-0.08, f));
    }
    function road(limitMph, holdS, opts) {
      opts = opts || {};
      var lim = limitMph * MPH;
      p.push({ op: 'limit', v: lim });
      // Real roads bend continuously. Faster roads are built straighter, so
      // curvature falls as the limit rises. This is well under any cornering
      // threshold — which is the point: ordinary road curvature must not be
      // mistaken for a harsh corner.
      var bend = limitMph <= 30 ? 0.090 : (limitMph <= 40 ? 0.072
               : (limitMph <= 50 ? 0.050 : (limitMph <= 60 ? 0.038 : 0.020)));
      p.push({
        op: 'target', v: over(lim), hold: holdS, traffic: opts.traffic !== false,
        bend: bend, phase: rnd() * 6.283, period: 9 + rnd() * 14 + limitMph * 0.35
      });
    }
    function junction(deg, entryMph) {
      p.push({ op: 'target', v: entryMph * MPH, hold: 0 });
      p.push({ op: 'turn', deg: deg, g: prof.cornerG * (0.9 + rnd() * 0.3) });
    }
    function lights(waitS) {
      p.push({ op: 'target', v: 0, hold: waitS });
    }

    p.push({ op: 'idle', hold: 4 });
    road(30, 25);                       // pull out of the estate
    junction(-85, 15);                  // left at the end of the road
    road(30, 30);
    junction(70, 14);                   // right onto the through road
    road(30, 35);
    lights(12);                         // red light
    road(30, 20);
    junction(150, 18);                  // roundabout, second exit
    road(40, 40);
    junction(-40, 30);
    road(40, 35);
    road(60, 80);                       // A-road
    junction(-25, 45);                  // sweeping bend, taken at speed
    road(60, 70);
    junction(30, 42);
    road(60, 55);
    road(70, 100, { traffic: false });  // motorway
    p.push({ op: 'lane' });             // lane change
    road(70, 90, { traffic: false });
    p.push({ op: 'lane' });
    road(50, 40);                       // exit slip
    junction(120, 16);                  // roundabout at the top
    road(40, 60);
    junction(-75, 14);
    road(30, 65);
    junction(50, 13);
    road(30, 45);
    lights(9);
    road(30, 40);
    junction(88, 12);                   // right into the street
    road(20, 30);
    p.push({ op: 'target', v: 0, hold: 3 });
    return p;
  }

  /* Vehicle + phone-mount simulation. Returns a flat, time-ordered sample list. */
  function generate(profileKey, seed) {
    var prof = PROFILES[profileKey] || PROFILES.average;
    var rnd = U.mulberry32(seed == null ? 20260828 : seed);
    var plan = buildPlan(prof, rnd);

    // Phone sits in a cradle: rotated in its holder and tilted back. The
    // algorithm has to work this out for itself.
    var psi = U.toRad(-38 + rnd() * 76);      // rotation in the cradle
    var theta = U.toRad(18 + rnd() * 30);     // tilt back from vertical
    var M = mountMatrix(psi, theta);

    var dt = 0.05, t = 0;
    var v = 0, heading = 20 + rnd() * 320, lat = 51.4816 + rnd() * 0.02, lon = -2.6 + rnd() * 0.02;
    var a = 0, yaw = 0, targetV = 0, limit = null;
    var samples = [], idx = 0, stepT = 0, turned = 0, laneT = 0;
    var nextIncident = 20 + rnd() * 60;
    var incidentT = -1, incidentA = 0;
    var gpsT = 0;

    function cur() { return plan[idx]; }

    while (idx < plan.length && t < 3600) {
      var c = cur();
      var done = false;
      yaw = 0;

      if (c.op === 'limit') { limit = c.v; idx++; continue; }

      if (c.op === 'idle') {
        targetV = 0;
        if (stepT >= c.hold) done = true;
      } else if (c.op === 'target') {
        targetV = c.v;
        // Traffic: the car in front slows, you react.
        if (c.traffic && t > nextIncident && v > 8) {
          if (rnd() < prof.incidentRate * dt * 2) {
            incidentT = t + 1.2 + rnd() * 2.0;
            incidentA = -prof.incidentBrake * (0.75 + rnd() * 0.35);
            nextIncident = t + 35 + rnd() * 90;
          }
        }
        // Follow the curve of the road while cruising.
        if (c.bend && v > 3) {
          var w = 2 * Math.PI / c.period;
          var curve = c.bend * (0.7 * Math.sin(t * w + c.phase) +
                                0.3 * Math.sin(t * w * 2.7 + c.phase * 1.9));
          yaw = (curve * G) / Math.max(v, 4);
        }
        var settled = Math.abs(v - targetV) < Math.max(0.5, targetV * 0.06);
        if (settled && stepT >= (c.hold || 0)) done = true;
        if (c.hold === 0 && settled) done = true;
      } else if (c.op === 'turn') {
        targetV = Math.max(v, 3);
        var sgn = c.deg >= 0 ? 1 : -1;
        // Hold the profile's lateral g; yaw rate follows from current speed.
        var wanted = (c.g * G) / Math.max(v, 3);
        yaw = sgn * Math.min(wanted, U.toRad(45));
        turned += Math.abs(U.toDeg(yaw)) * dt;
        if (turned >= Math.abs(c.deg)) { turned = 0; done = true; }
      } else if (c.op === 'lane') {
        laneT += dt;
        yaw = U.toRad(3.2) * Math.sin(laneT * Math.PI / 1.6);
        if (laneT >= 3.2) { laneT = 0; done = true; }
      }

      // Longitudinal controller with a jerk limit, so pedal inputs ramp.
      var desired;
      if (incidentT > 0 && t < incidentT) {
        desired = incidentA;
      } else {
        if (incidentT > 0 && t >= incidentT) incidentT = -1;
        var err = targetV - v;
        desired = U.clamp(err * 0.55, -prof.brake, prof.accel);
        if (v < 0.3 && targetV < 0.3) desired = 0;
      }
      // Cornering costs a little speed, as it does in a real car.
      if (Math.abs(yaw) > U.toRad(6)) desired = Math.min(desired, 0.4);
      var maxDa = prof.jerkLimit * dt;
      a += U.clamp(desired - a, -maxDa, maxDa);
      a += (rnd() - 0.5) * 0.10;

      v = Math.max(0, v + a * dt);
      if (v === 0) a = Math.max(a, 0);
      heading = (heading - U.toDeg(yaw) * dt + 360) % 360;
      var pnt = U.offsetLatLon(lat, lon,
        v * dt * Math.sin(U.toRad(heading)), v * dt * Math.cos(U.toRad(heading)));
      lat = pnt.lat; lon = pnt.lon;

      // --- emit IMU sample (device frame, with gravity and noise) ---
      var aLat = -v * yaw;                       // +ve = accelerating right
      var accVeh = [aLat, a, (rnd() - 0.5) * 0.55];   // z: road surface buzz
      var accDev = mul(M, accVeh);
      var gDev = mul(M, [0, 0, G]);
      var wDev = mul(M, [0, 0, U.toDeg(yaw)]);
      samples.push({
        k: 'm', t: Math.round(t * 1000),
        ax: accDev[0] + gDev[0] + nz(rnd, 0.09),
        ay: accDev[1] + gDev[1] + nz(rnd, 0.09),
        az: accDev[2] + gDev[2] + nz(rnd, 0.09),
        rx: wDev[0] + nz(rnd, 0.25), ry: wDev[1] + nz(rnd, 0.25), rz: wDev[2] + nz(rnd, 0.25)
      });

      // --- emit a GPS fix once a second, with realistic error ---
      if (t >= gpsT) {
        gpsT += 1.0;
        var acc = 4 + rnd() * 6;
        var jitter = acc * 0.35;
        var jp = U.offsetLatLon(lat, lon, nz(rnd, jitter), nz(rnd, jitter));
        samples.push({
          k: 'g', t: Math.round(t * 1000), lat: jp.lat, lon: jp.lon,
          speed: Math.max(0, v + nz(rnd, 0.35)),
          heading: v > 1.5 ? (heading + nz(rnd, 3)) % 360 : null,
          accuracy: acc, limit: limit
        });
      }

      stepT += dt; t += dt;
      if (done) { idx++; stepT = 0; }
    }

    return {
      profile: profileKey, label: prof.label, blurb: prof.blurb,
      samples: samples, durationMs: Math.round(t * 1000), seed: seed
    };
  }

  function nz(rnd, s) { return (rnd() + rnd() + rnd() - 1.5) * s; }

  /* Orthonormal vehicle->device rotation: yaw in the cradle, then tilt back. */
  function mountMatrix(psi, theta) {
    var cz = Math.cos(psi), sz = Math.sin(psi);
    var cx = Math.cos(theta), sx = Math.sin(theta);
    var Rz = [[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]];
    var Rx = [[1, 0, 0], [0, cx, -sx], [0, sx, cx]];
    return matmul(Rx, Rz);
  }
  function matmul(A, B) {
    var C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var i = 0; i < 3; i++) for (var j = 0; j < 3; j++) {
      C[i][j] = A[i][0] * B[0][j] + A[i][1] * B[1][j] + A[i][2] * B[2][j];
    }
    return C;
  }
  function mul(M, v) {
    return [
      M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
      M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
      M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
    ];
  }

  /* Player: pushes a generated drive into a Trip on a virtual clock. */
  function Player(trip, drive, opts) {
    this.trip = trip; this.drive = drive;
    this.rate = (opts && opts.rate) || 10;
    this.onTick = opts && opts.onTick;
    this.onEvent = opts && opts.onEvent;
    this.onDone = opts && opts.onDone;
    this.i = 0; this.vt = 0; this.raf = null; this.running = false;
  }

  Player.prototype.start = function () {
    var self = this;
    this.running = true;
    this.trip.start(0, Date.now());
    var last = performance.now();
    function frame(now) {
      if (!self.running) return;
      var real = Math.min(now - last, 250);
      last = now;
      self.advance(self.vt + real * self.rate);
      if (self.i >= self.drive.samples.length) { self.finish(); return; }
      self.raf = requestAnimationFrame(frame);
    }
    this.raf = requestAnimationFrame(frame);
  };

  /* Feed every sample up to virtual time vt, ticking the trip as we go. */
  Player.prototype.advance = function (vt) {
    var s = this.drive.samples, lastTick = this.vt;
    while (this.i < s.length && s[this.i].t <= vt) {
      var smp = s[this.i++];
      if (smp.k === 'm') {
        this.trip.feedMotion(smp);
      } else {
        if (smp.limit != null) this.trip.setLimit(smp.limit, 'demo');
        this.trip.feedPosition(smp);
      }
      if (smp.t - lastTick >= 50) {
        var r = this.trip.tick(smp.t);
        lastTick = smp.t;
        if (r.events.length && this.onEvent) this.onEvent(r.events);
        if (this.onTick) this.onTick(r);
      }
    }
    this.vt = vt;
  };

  /* Score the whole drive with no animation, for instant comparisons. */
  Player.prototype.runInstant = function () {
    this.trip.start(0, Date.now());
    this.advance(this.drive.durationMs + 1000);
    this.trip.stop(this.drive.durationMs);
    return this.trip;
  };

  Player.prototype.finish = function () {
    if (!this.running) return;
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.trip.stop(this.drive.durationMs);
    if (this.onDone) this.onDone(this.trip);
  };

  Player.prototype.stop = function () {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
  };

  TL.simulate = { PROFILES: PROFILES, generate: generate, Player: Player };
})(window.TL = window.TL || {});
