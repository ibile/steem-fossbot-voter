# Traction Circle

Real-time driving telematics in a web page. It reads your phone's GPS,
accelerometer and gyroscope while you drive, flags harsh braking, harsh
acceleration, sharp cornering and speeding as they happen, and scores the trip
the way an insurance telematics app does.

Everything runs in the browser. No account, no server, no upload — trips are
saved in this browser's local storage and only leave the device if you export
them yourself.

## Running it

Sensors need a **secure origin**, so `file://` will not do for live tracking.

| How | Command | Notes |
|---|---|---|
| Local server | `npx serve telematics`, open on `localhost` | Plain `http://` to a LAN IP is **not** a secure context — sensors stay blocked |
| GitHub Pages | enable Pages for the repo, open `/telematics/` | Easiest way to get it on a phone |
| Single file | open `dist/traction-circle.html` | Demo mode works anywhere; live tracking still needs HTTPS |

**Embedded viewers block location.** Opened inside another app's in-app browser
or an iframe without a geolocation grant, the page cannot read your position and
a trip records nothing. The app now says so before you start and again, out
loud, within seconds of starting. Open it from its own web address to track a
real drive.

On iOS, motion access requires an explicit tap — that is what the
**Start tracking a drive** button is for. Answer both prompts (motion and
location) with allow.

**Demo mode needs no sensors at all.** Setup → Run the demo drive replays a
simulated 17-minute journey through the real pipeline, so you can see the
scoring behave before you drive anywhere.

## Speed limits

Limits are looked up automatically. Roughly once a kilometre the app fetches the
roads around you from OpenStreetMap (via Overpass), map-matches your position
and heading to one of them, and reads its published limit. Heading is part of
the match, which is what separates a dual carriageway from the side road
running beside it. Nothing to tap while driving.

Only ways that actually carry a `maxspeed` or `maxspeed:type` tag are
requested, which keeps responses small — one request covers a 1.8 km radius.
Where a road publishes no limit, that stretch is **left out of the speed score**
rather than guessed at, and the trip summary tells you what percentage of the
drive had a known limit.

Implied national limits are honoured where the code is unambiguous
(`GB:nsl_single` → 60, `GB:nsl_dual` and `GB:motorway` → 70, `GB:zone20` → 20).
Values that state no scoreable number — `none`, `signals`, `variable`,
conditional lists — are treated as unknown rather than forced into a number.

Tap the limit roundel at any time to override for the current road, or to
switch back to automatic. Setup → Speed limits offers Auto / Manual / Off, and
Setup → Run check performs a live lookup at your current position and reports
exactly what came back.

## How the measurements are made

The awkward part of phone telematics is that the accelerometer reports in the
*device* frame — which depends on however the phone is lying in the cradle —
while scoring needs the *vehicle* frame. Three things solve that:

1. **Vertical axis from gravity.** Gravity is low-passed out of
   `accelerationIncludingGravity`, but only while the reading is plausibly
   static (stopped, or coasting at ~1 g with no turn). Averaging through a hard
   brake is what tilts the axis and corrupts every later reading. The estimate
   is then renormalised to 9.80665 m/s², since any drift in magnitude is error.

2. **Lateral g with no calibration at all.** Yaw rate is the gyroscope
   component along that vertical axis — rotation about vertical is yaw however
   the phone is turned — and lateral acceleration is simply `v × yawRate`. The
   sign convention of `accelerationIncludingGravity` is inconsistent across
   browsers (iOS has reported it inverted), so the sign is *learned* by
   correlating against GPS heading change rather than assumed.

3. **Forward axis by correlation.** The horizontal accelerometer vector is
   correlated against the GPS-derived longitudinal acceleration during
   straight-line speed changes. Once converged, high-frequency accelerometer
   detail is blended onto the low-frequency GPS trend with a complementary
   filter — GPS supplies drift-free truth, the IMU supplies the sharp onset of
   a brake that 1 Hz sampling would smear away.

Speed itself comes from a constant-acceleration Kalman filter over GPS, which
yields longitudinal g as a state rather than by differentiating noisy samples.

Degradation is graceful: no gyroscope falls back to GPS heading rate; no motion
sensors at all still scores from GPS alone.

## How the score is built

| Measure | Weight | Basis |
|---|---|---|
| Speed | 25% | time-weighted mean exceedance above the limit |
| Braking | 22% | severity-weighted events per 100 km |
| Cornering | 20% | severity-weighted events per 100 km |
| Acceleration | 15% | severity-weighted events per 100 km |
| Smoothness | 8% | RMS jerk, band-limited below driver-input frequencies (floored at 55) |
| Focus | 6% | deliberate taps on this app while moving (floored at 45) |
| Context | 4% | night driving, hours without a break |

- Events are **normalised per 100 km**, not counted raw. Two harsh brakes on a
  200 km run is careful driving; two on a 2 km trip is not.
- Severity is weighted (mild 1, harsh 2.5, severe 5) so an emergency stop and a
  firm one are not the same event.
- Each channel decays exponentially — `100 × exp(-k × rate)` — so there are no
  cliff edges and no way for one bad moment to zero you out. Constants are
  anchored so roughly 3 weighted events per 100 km scores ~90, 10 scores ~70
  and 25 scores ~40.
- Speeding uses **mean exceedance**, not time-over-limit. Sitting 2 mph over for
  an hour and 25 mph over for five minutes are very different risks.
- A measure that could not be observed is dropped and the weights renormalise,
  so a trip with no speed limit set is scored honestly on the rest rather than
  being given a free 100 or a silent 0.
- Trips under 1 mile or 3 minutes are flagged **provisional** — a per-100 km
  rate computed over 400 m is not a measurement.
- Multi-trip scores sum exposure first and score once, so a 500 m trip cannot
  outvote a 200 km one.

Thresholds sit where the industry generally puts them — about 0.30 g
noticeable, 0.40 g harsh, 0.52 g severe — adjustable in Setup.

### Smoothness must measure driving, not the mount

Jerk is the derivative of acceleration, and differentiation amplifies high
frequencies — which is exactly where a rattling cradle and a rough road surface
live (roughly 5–20 Hz), while a driver's pedal and steering inputs are all
below about 0.5 Hz.

Differentiating and then low-passing *once* does not separate them: above the
cutoff the differentiator's gain (∝ f) and the pole's attenuation (∝ 1/f)
cancel, so vibration passes through at full strength at any frequency. Measured
on a steady cruise with zero driver input, 0.5 m/s² of vibration alone was
enough to drag smoothness from 100 to 64.

The signal is therefore smoothed *before* differentiating and again after, so
two poles follow the differentiator and vibration rolls off as 1/f. The same
test now moves jerk by 0.02 instead of 1.5 — about 75× less — while the
Careful / Typical / Hurried profiles still separate cleanly at 100 / 91 / 78.

What gets filtered out is not thrown away: its RMS is reported on each trip as
mount vibration, so you can see whether your holder is shaking without it ever
affecting your score.

## What this is not

- **It cannot track in the background.** A browser tab is not a native app: the
  screen must stay on and the page must stay open. It will not silently log
  every journey.
- **Its speed limits are only as good as OpenStreetMap.** Coverage varies, and
  a road with no published limit is not scored for speed at all. It has no
  commercial limit database and does not know about temporary or variable
  limits. Automatic lookup also needs a data connection.
- **Focus is a weak measure.** It counts taps on *this app*, so it cannot see
  the rest of your phone. It is deliberately floored so it nudges a score
  rather than sinking one.
- **It is not accepted by any insurer.** It is a mirror of your own driving,
  useful for seeing what these apps measure and how it feels to be scored —
  not a substitute for their telemetry.

## Layout

```
telematics/
  index.html           app shell
  css/app.css
  js/
    util.js            math, formatting
    kinematics.js      sensor fusion, vehicle-frame motion
    events.js          hysteresis event detection
    scoring.js         the scoring model
    trip.js            per-journey pipeline and accumulators
    storage.js         local persistence
    alerts.js          tones, speech, vibration
    sensors.js         hardware access and capability probing
    speedlimits.js     OpenStreetMap lookup and map matching
    simulate.js        synthetic drive generator
    exporters.js       GPX / CSV / JSON
    charts.js          canvas instruments
    app.js             screens and wiring
  build.js             inlines everything into dist/
  dist/                single-file builds
```

`node build.js` regenerates `dist/traction-circle.html` (standalone document)
and `dist/artifact.html` (body content only, for hosts that supply the shell).

## Exports

GPX (route plus events as waypoints), CSV (one row per event) and JSON (the
full record including every accumulator). If the browser blocks downloads —
some embedded viewers do — the copy-to-clipboard button returns the same data.
