/* Canvas instruments. All of them are drawn from the same token palette as the
   page so the charts read as part of the interface rather than bolted on. */
(function (TL) {
  'use strict';
  var U = TL.util, G = U.G;

  var C = {
    ground: '#0B0E13', panel: '#141A21', line: '#212B36', line2: '#2C3844',
    ink: '#E9EEF4', muted: '#8494A5', dim: '#5A6875',
    accent: '#38C6E0', good: '#3FBF7F', warn: '#E9A13B', crit: '#EF4F4F'
  };
  var SEV = { mild: C.warn, harsh: C.warn, severe: C.crit };
  var TYPE_COLOR = { brake: C.crit, accel: C.accent, corner: C.warn, speeding: '#C77DFF' };

  /* Size a canvas for the device pixel ratio and return a ready 2D context. */
  function fit(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr; canvas.height = h * dpr;
    }
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // A canvas on a hidden screen measures 0x0. Report that rather than
    // drawing with negative radii and throwing.
    return { ctx: ctx, w: w, h: h, ok: r.width > 8 && r.height > 8 };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* --- g-g diagram ------------------------------------------------------- */
  /* The classic traction-circle plot: longitudinal g up/down, lateral g
     left/right. A smooth driver traces a small blob near the centre; a hurried
     one throws the dot out to the rings. */
  function gMeter(canvas, cur, trail, thresholds) {
    var f = fit(canvas);
    if (!f.ok) return;
    var ctx = f.ctx;
    var cx = f.w / 2, cy = f.h / 2;
    var R = Math.min(f.w, f.h) / 2 - 18;
    var maxG = 0.7;
    var scale = R / maxG;

    // Rings at the thresholds that actually matter, labelled.
    var rings = [
      { g: 0.2, c: C.line, label: null },
      { g: (thresholds && thresholds.mild) || 0.30, c: C.line2, label: 'mild' },
      { g: (thresholds && thresholds.harsh) || 0.40, c: 'rgba(233,161,59,0.45)', label: 'harsh' },
      { g: (thresholds && thresholds.severe) || 0.52, c: 'rgba(239,79,79,0.5)', label: 'severe' }
    ];
    rings.forEach(function (r) {
      ctx.beginPath();
      ctx.arc(cx, cy, r.g * scale, 0, Math.PI * 2);
      ctx.strokeStyle = r.c;
      ctx.lineWidth = 1;
      ctx.setLineDash(r.label ? [3, 4] : []);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Cross-hairs
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy);
    ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R);
    ctx.stroke();

    ctx.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.fillText('ACCEL', cx, cy - R - 6);
    ctx.fillText('BRAKE', cx, cy + R + 12);
    // Sit these inside the plot: at phone widths there is no room outside
    // the circle and they were being clipped by the canvas edge.
    ctx.textAlign = 'left';
    ctx.fillText('LEFT', cx - R + 2, cy - 7);
    ctx.textAlign = 'right';
    ctx.fillText('RIGHT', cx + R - 2, cy - 7);

    // Trail: recent history fading out, so you see the shape of the last
    // few seconds of driving, not just an instant.
    if (trail && trail.length > 1) {
      for (var i = 1; i < trail.length; i++) {
        var p0 = trail[i - 1], p1 = trail[i];
        var a = i / trail.length;
        ctx.beginPath();
        ctx.moveTo(cx + p0.x / G * scale, cy - p0.y / G * scale);
        ctx.lineTo(cx + p1.x / G * scale, cy - p1.y / G * scale);
        ctx.strokeStyle = 'rgba(56,198,224,' + (a * 0.5).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }

    // Combined-g readout, in the corner the circle never reaches.
    var combined = cur ? Math.sqrt(cur.x * cur.x + cur.y * cur.y) / G : 0;
    ctx.textAlign = 'left';
    ctx.font = '500 14px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = C.ink;
    ctx.fillText(combined.toFixed(2) + ' g', 6, 17);
    ctx.font = '500 8px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = C.dim;
    ctx.fillText('COMBINED', 6, 28);
    ctx.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';

    // Current point, coloured by how close it is to a threshold.
    if (cur) {
      var gx = cur.x / G, gy = cur.y / G;
      var mag = Math.sqrt(gx * gx + gy * gy);
      var col = mag >= ((thresholds && thresholds.harsh) || 0.4) ? C.crit
        : (mag >= ((thresholds && thresholds.mild) || 0.3) ? C.warn : C.accent);
      var px = cx + U.clamp(gx, -maxG, maxG) * scale;
      var py = cy - U.clamp(gy, -maxG, maxG) * scale;
      ctx.beginPath();
      ctx.arc(px, py, 13, 0, Math.PI * 2);
      ctx.fillStyle = col.replace(')', ',0.16)').replace('#', 'rgba(');
      ctx.fillStyle = hexA(col, 0.18);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, 5.5, 0, Math.PI * 2);
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = C.ground;
      ctx.stroke();
    }
  }

  function hexA(hex, a) {
    var h = hex.replace('#', '');
    var n = parseInt(h, 16);
    return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
  }

  /* --- score ring -------------------------------------------------------- */
  function scoreRing(canvas, score, tone) {
    var f = fit(canvas);
    if (!f.ok) return;
    var ctx = f.ctx;
    var cx = f.w / 2, cy = f.h / 2;
    var R = Math.min(f.w, f.h) / 2 - 10;
    var col = tone === 'good' ? C.good : (tone === 'warn' ? C.warn : C.crit);
    var start = -Math.PI / 2;
    var end = start + Math.PI * 2 * U.clamp(score / 100, 0, 1);

    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, R, start, end);
    ctx.strokeStyle = col;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  /* --- route trace ------------------------------------------------------- */
  function routeMap(canvas, route, events) {
    var f = fit(canvas);
    if (!f.ok) return;
    var ctx = f.ctx;
    if (!route || route.length < 2) {
      ctx.fillStyle = C.dim;
      ctx.font = '12px "IBM Plex Sans", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No position trace for this trip', f.w / 2, f.h / 2);
      return;
    }
    var pad = 16;
    var minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    route.forEach(function (p) {
      if (p.lat < minLat) minLat = p.lat; if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon; if (p.lon > maxLon) maxLon = p.lon;
    });
    // Correct for longitude convergence so the shape is not stretched.
    var latMid = (minLat + maxLat) / 2;
    var kx = Math.cos(U.toRad(latMid));
    var dLat = Math.max(maxLat - minLat, 1e-6);
    var dLon = Math.max((maxLon - minLon) * kx, 1e-6);
    var s = Math.min((f.w - pad * 2) / dLon, (f.h - pad * 2) / dLat);
    var ox = (f.w - dLon * s) / 2, oy = (f.h - dLat * s) / 2;
    function X(p) { return ox + (p.lon - minLon) * kx * s; }
    function Y(p) { return f.h - (oy + (p.lat - minLat) * s); }

    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    route.forEach(function (p, i) { i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p)); });
    ctx.strokeStyle = C.line2;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Start and end markers
    ctx.beginPath(); ctx.arc(X(route[0]), Y(route[0]), 4, 0, Math.PI * 2);
    ctx.fillStyle = C.good; ctx.fill();
    var last = route[route.length - 1];
    ctx.beginPath(); ctx.arc(X(last), Y(last), 4, 0, Math.PI * 2);
    ctx.fillStyle = C.ink; ctx.fill();

    (events || []).forEach(function (e) {
      if (e.lat == null) return;
      var p = { lat: e.lat, lon: e.lon };
      ctx.beginPath();
      ctx.arc(X(p), Y(p), e.severity === 'severe' ? 5.5 : 4.5, 0, Math.PI * 2);
      ctx.fillStyle = TYPE_COLOR[e.type] || C.warn;
      ctx.fill();
      ctx.strokeStyle = C.ground; ctx.lineWidth = 1.5; ctx.stroke();
    });
  }

  /* --- speed profile ----------------------------------------------------- */
  /* One measure, one axis. The limit is drawn on the same scale as the speed
     because it is the same quantity — never a second y-axis. */
  function speedProfile(canvas, route, events, units, hoverIdx) {
    var f = fit(canvas);
    if (!f.ok) return null;
    var ctx = f.ctx;
    var padL = 34, padR = 10, padT = 12, padB = 22;
    var W = f.w - padL - padR, H = f.h - padT - padB;
    if (!route || route.length < 2 || W <= 10) return null;

    var maxV = 0;
    route.forEach(function (p) {
      maxV = Math.max(maxV, U.speedIn(p.v, units), p.lim ? U.speedIn(p.lim, units) : 0);
    });
    maxV = Math.max(10, Math.ceil(maxV / 10) * 10 + 5);
    var tEnd = route[route.length - 1].t || 1;
    function X(t) { return padL + (t / tEnd) * W; }
    function Y(v) { return padT + H - (v / maxV) * H; }

    // Recessive grid
    ctx.strokeStyle = C.line;
    ctx.lineWidth = 1;
    ctx.font = '500 9px "IBM Plex Mono", ui-monospace, monospace';
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'right';
    var stepV = maxV > 90 ? 30 : (maxV > 45 ? 20 : 10);
    for (var v = 0; v <= maxV; v += stepV) {
      var y = Y(v);
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(padL + W, y); ctx.stroke();
      ctx.fillText(String(v), padL - 6, y + 3);
    }

    // Limit as a step line: it changes discontinuously at road boundaries.
    var hasLimit = route.some(function (p) { return p.lim != null; });
    if (hasLimit) {
      ctx.beginPath();
      var started = false, prevY = null;
      route.forEach(function (p) {
        if (p.lim == null) { started = false; return; }
        var y = Y(U.speedIn(p.lim, units)), x = X(p.t);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, prevY == null ? y : prevY); ctx.lineTo(x, y); }
        prevY = y;
      });
      ctx.strokeStyle = 'rgba(199,125,255,0.75)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Speed area + line
    ctx.beginPath();
    ctx.moveTo(X(route[0].t), Y(0));
    route.forEach(function (p) { ctx.lineTo(X(p.t), Y(U.speedIn(p.v, units))); });
    ctx.lineTo(X(route[route.length - 1].t), Y(0));
    ctx.closePath();
    var grad = ctx.createLinearGradient(0, padT, 0, padT + H);
    grad.addColorStop(0, hexA(C.accent, 0.28));
    grad.addColorStop(1, hexA(C.accent, 0.02));
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    route.forEach(function (p, i) {
      var x = X(p.t), y = Y(U.speedIn(p.v, units));
      i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
    });
    ctx.strokeStyle = C.accent;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.stroke();

    // Event markers on the baseline, so they never obscure the trace.
    (events || []).forEach(function (e) {
      if (e.t0 == null || e.t0 > tEnd) return;
      var x = X(e.t0);
      ctx.beginPath();
      ctx.moveTo(x, padT + H);
      ctx.lineTo(x, padT + H + 5);
      ctx.strokeStyle = TYPE_COLOR[e.type] || C.warn;
      ctx.lineWidth = e.severity === 'severe' ? 2.5 : 1.5;
      ctx.stroke();
    });

    // Crosshair for the hovered sample
    if (hoverIdx != null && route[hoverIdx]) {
      var hp = route[hoverIdx];
      var hx = X(hp.t), hy = Y(U.speedIn(hp.v, units));
      ctx.beginPath();
      ctx.moveTo(hx, padT); ctx.lineTo(hx, padT + H);
      ctx.strokeStyle = C.line2; ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = C.ink; ctx.fill();
      ctx.strokeStyle = C.ground; ctx.lineWidth = 2; ctx.stroke();
    }

    ctx.textAlign = 'left';
    ctx.fillStyle = C.dim;
    ctx.fillText('0:00', padL, padT + H + 15);
    ctx.textAlign = 'right';
    ctx.fillText(U.fmtDuration(tEnd), padL + W, padT + H + 15);

    return { padL: padL, W: W, tEnd: tEnd };
  }

  /* Map a pointer x to the nearest route index. */
  function indexAtX(route, geom, x) {
    if (!geom || !route || !route.length) return null;
    var frac = U.clamp((x - geom.padL) / geom.W, 0, 1);
    var t = frac * geom.tEnd;
    var lo = 0, hi = route.length - 1;
    while (lo < hi) {
      var mid = (lo + hi) >> 1;
      if (route[mid].t < t) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  TL.charts = {
    C: C, TYPE_COLOR: TYPE_COLOR, SEV: SEV, fit: fit, hexA: hexA,
    gMeter: gMeter, scoreRing: scoreRing, routeMap: routeMap,
    speedProfile: speedProfile, indexAtX: indexAtX, roundRect: roundRect
  };
})(window.TL = window.TL || {});
