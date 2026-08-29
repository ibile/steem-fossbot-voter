/* Scoring model.
 *
 * Shape of the model, and why:
 *  - Events are normalised per 100 km, not counted raw. Two harsh brakes on a
 *    200 km motorway run is careful driving; two on a 2 km trip is not.
 *  - Severity is weighted (mild 1, harsh 2.5, severe 5) so one emergency stop
 *    does not read the same as one firm one.
 *  - Each channel decays exponentially: score = 100 * exp(-k * rate). No cliff
 *    edges, no way to reach zero from a single bad moment, and the marginal
 *    cost of the tenth event is smaller than the first. Constants are set so a
 *    rate of 5 weighted events per 100 km lands on 80.
 *  - Short trips get an exposure floor and are flagged provisional, because a
 *    per-100 km rate computed over 400 m is not a measurement.
 */
(function (TL) {
  'use strict';
  var U = TL.util;

  var SEV_WEIGHT = { mild: 1, harsh: 2.5, severe: 5 };
  var SPEED_SEV_WEIGHT = { mild: 1, harsh: 2, severe: 3.5 };
  var EXPOSURE_FLOOR_KM = 2;

  var WEIGHTS = {
    speeding: 0.25, braking: 0.22, cornering: 0.20,
    acceleration: 0.15, smoothness: 0.08, focus: 0.06, context: 0.04
  };
  // Anchored against how the industry generally reads event rates: roughly
  // 3 weighted events per 100 km is good driving (~90), 10 is mediocre (~70),
  // 25 is poor (~40). Acceleration decays more gently — harsh acceleration is
  // a weaker crash predictor than harsh braking.
  var DECAY = { braking: 0.0357, cornering: 0.0357, acceleration: 0.0300 };
  var SPEED_DECAY = 0.0329;   // mean excess of 10% over the limit -> ~72
  

  var LABELS = {
    speeding: 'Speed', braking: 'Braking', cornering: 'Cornering',
    acceleration: 'Acceleration', smoothness: 'Smoothness',
    focus: 'Focus', context: 'Context'
  };

  function decayScore(rate, k) {
    return U.clamp(100 * Math.exp(-k * Math.max(0, rate)), 0, 100);
  }

  function weightedCount(events, type, table) {
    var n = 0;
    for (var i = 0; i < events.length; i++) {
      if (events[i].type === type) n += (table[events[i].severity] || 1);
    }
    return n;
  }
  function rawCount(events, type) {
    var n = 0;
    for (var i = 0; i < events.length; i++) if (events[i].type === type) n++;
    return n;
  }

  function band(score) {
    if (score >= 90) return { key: 'excellent', label: 'Excellent', tone: 'good' };
    if (score >= 80) return { key: 'good', label: 'Good', tone: 'good' };
    if (score >= 70) return { key: 'fair', label: 'Fair', tone: 'warn' };
    if (score >= 60) return { key: 'work', label: 'Needs work', tone: 'warn' };
    return { key: 'risk', label: 'High risk', tone: 'crit' };
  }

  /* acc = accumulators produced by Trip.summary() */
  function scoreTrip(acc) {
    var events = acc.events || [];
    var km = acc.distanceM / 1000;
    var exposure100 = Math.max(km, EXPOSURE_FLOOR_KM) / 100;
    var movingH = acc.movingMs / 3600000;
    var comps = [];

    ['braking', 'cornering', 'acceleration'].forEach(function (key) {
      var type = key === 'braking' ? 'brake' : (key === 'acceleration' ? 'accel' : 'corner');
      var w = weightedCount(events, type, SEV_WEIGHT);
      var rate = w / exposure100;
      comps.push({
        key: key, label: LABELS[key], weight: WEIGHTS[key],
        score: decayScore(rate, DECAY[key]),
        rate: rate, count: rawCount(events, type),
        unit: 'per 100 km', available: true
      });
    });

    // Speeding: only meaningful where a limit was actually known. The measure
    // is the time-weighted mean exceedance, so sitting 2 mph over for an hour
    // and sitting 25 mph over for five minutes land in very different places.
    var limitCoverage = acc.movingMs > 0 ? acc.limitKnownMs / acc.movingMs : 0;
    var speedAvailable = limitCoverage >= 0.4 && acc.limitKnownMs > 20000;
    var meanExcess = acc.meanExcessPct != null ? acc.meanExcessPct
      : (acc.limitKnownMs > 0 ? (acc.excessPctMs || 0) / acc.limitKnownMs : 0);
    var pctPlain = acc.limitKnownMs > 0 ?
      ((acc.overMs.mild + acc.overMs.harsh + acc.overMs.severe) / acc.limitKnownMs) * 100 : 0;
    comps.push({
      key: 'speeding', label: LABELS.speeding, weight: WEIGHTS.speeding,
      score: decayScore(meanExcess, SPEED_DECAY),
      rate: pctPlain, count: rawCount(events, 'speeding'),
      unit: '% of time over limit', available: speedAvailable,
      coverage: limitCoverage, meanExcess: meanExcess,
      maxOverPct: acc.maxOverPct || 0
    });

    // Smoothness: RMS jerk, the texture between the discrete events. Floored
    // at 55 on purpose — it is a secondary signal measured on a noisy channel,
    // so it should nudge a score, never drive it.
    var jerk = acc.jerkRms || 0;
    comps.push({
      key: 'smoothness', label: LABELS.smoothness, weight: WEIGHTS.smoothness,
      score: U.clamp(decayScore(Math.max(0, jerk - 0.30), 0.372), 55, 100),
      rate: jerk, count: null, unit: 'm/s³ RMS jerk',
      available: acc.movingMs > 30000
    });

    // Focus: taps on this app while the vehicle is moving. A weak proxy for
    // phone handling — it cannot see the rest of your phone — so it is
    // softened and floored at 45 rather than allowed to sink a whole trip.
    var perHour = movingH > 0.02 ? (acc.interactions || 0) / movingH : 0;
    comps.push({
      key: 'focus', label: LABELS.focus, weight: WEIGHTS.focus,
      score: U.clamp(decayScore(perHour, 0.0271), 45, 100),
      rate: perHour, count: acc.interactions || 0, unit: 'taps in this app per hour',
      available: acc.movingMs > 60000
    });

    // Context: night driving and time at the wheel without a break.
    var nightFrac = acc.movingMs > 0 ? (acc.nightMs || 0) / acc.movingMs : 0;
    var fatigue = Math.max(0, movingH - 2) * 12;
    comps.push({
      key: 'context', label: LABELS.context, weight: WEIGHTS.context,
      score: U.clamp(100 - 25 * nightFrac - fatigue, 0, 100),
      rate: nightFrac * 100, count: null, unit: '% at night (23:00–05:00)',
      available: true
    });

    // Renormalise over whatever could actually be measured.
    var totalW = 0, sum = 0;
    comps.forEach(function (c) {
      c.score = Math.round(c.score * 10) / 10;
      if (c.available) { totalW += c.weight; sum += c.weight * c.score; }
    });
    var overall = totalW > 0 ? sum / totalW : 100;
    comps.forEach(function (c) {
      c.effectiveWeight = c.available && totalW > 0 ? c.weight / totalW : 0;
      c.loss = c.available ? c.effectiveWeight * (100 - c.score) : 0;
    });

    var provisional = acc.distanceM < 1600 || acc.movingMs < 180000;
    var ranked = comps.filter(function (c) { return c.available; })
                      .slice().sort(function (a, b) { return b.loss - a.loss; });

    return {
      overall: Math.round(overall),
      exact: overall,
      band: band(overall),
      components: comps,
      provisional: provisional,
      biggestLoss: ranked.length && ranked[0].loss > 0.4 ? ranked[0] : null,
      speedMeasured: speedAvailable
    };
  }

  /* Tip text for the component costing the most points. */
  function advice(comp) {
    if (!comp) return 'Nothing stands out — this trip scored evenly across every measure.';
    switch (comp.key) {
      case 'braking':
        return 'Braking costs you the most here. Most harsh braking is a following-distance problem rather than a braking problem — lift earlier and the pedal work disappears.';
      case 'cornering':
        return 'Cornering costs you the most here. Lateral g builds with the square of speed, so shedding a few mph before the turn-in cuts it sharply.';
      case 'acceleration':
        return 'Acceleration costs you the most here. Pulling away more gradually from junctions and lights is the single easiest score to move.';
      case 'speeding':
        return 'Time over the limit costs you the most here. Sustained speeding is weighted by how far over you were, so the fast stretches matter more than brief overshoots.';
      case 'smoothness':
        return 'Smoothness costs you the most here. The inputs are jerky even where no single event tripped a threshold — steadier pedal pressure helps.';
      case 'focus':
        return 'Screen taps while moving cost you the most here. Set the app running before you pull away and leave it alone.';
      case 'context':
        return 'Context costs you the most here — night driving and long unbroken stints carry more risk regardless of how well you drove.';
      default:
        return '';
    }
  }

  /* Aggregate across trips by summing exposure first, then scoring once.
     Averaging per-trip scores would let a 500 m trip outvote a 200 km one. */
  function aggregate(trips) {
    if (!trips.length) return null;
    var acc = {
      distanceM: 0, movingMs: 0, totalMs: 0, limitKnownMs: 0,
      overMs: { mild: 0, harsh: 0, severe: 0 },
      events: [], interactions: 0, nightMs: 0, maxOverPct: 0, excessPctMs: 0,
      jerkSum: 0, jerkW: 0
    };
    trips.forEach(function (t) {
      var a = t.acc;
      if (!a) return;
      acc.distanceM += a.distanceM; acc.movingMs += a.movingMs; acc.totalMs += a.totalMs;
      acc.limitKnownMs += a.limitKnownMs || 0;
      acc.overMs.mild += a.overMs.mild; acc.overMs.harsh += a.overMs.harsh; acc.overMs.severe += a.overMs.severe;
      acc.events = acc.events.concat(a.events || []);
      acc.interactions += a.interactions || 0;
      acc.nightMs += a.nightMs || 0;
      acc.maxOverPct = Math.max(acc.maxOverPct, a.maxOverPct || 0);
      acc.excessPctMs += a.excessPctMs || 0;
      acc.jerkSum += (a.jerkRms || 0) * (a.movingMs || 0);
      acc.jerkW += (a.movingMs || 0);
    });
    acc.jerkRms = acc.jerkW > 0 ? acc.jerkSum / acc.jerkW : 0;
    acc.meanExcessPct = acc.limitKnownMs > 0 ? acc.excessPctMs / acc.limitKnownMs : 0;
    var res = scoreTrip(acc);
    res.trips = trips.length;
    res.acc = acc;
    return res;
  }

  TL.scoring = {
    scoreTrip: scoreTrip, aggregate: aggregate, band: band, advice: advice,
    WEIGHTS: WEIGHTS, SEV_WEIGHT: SEV_WEIGHT, LABELS: LABELS
  };
})(window.TL = window.TL || {});
