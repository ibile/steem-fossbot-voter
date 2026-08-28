/* Your data, in formats other tools actually read. Trips never leave the
   device unless you export them yourself. */
(function (TL) {
  'use strict';
  var U = TL.util;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function toGPX(trip) {
    var name = 'Drive ' + new Date(trip.startedAt).toISOString();
    var pts = (trip.route || []).map(function (p) {
      var t = new Date(trip.startedAt + p.t).toISOString();
      return '      <trkpt lat="' + p.lat + '" lon="' + p.lon + '">\n' +
             '        <time>' + t + '</time>\n' +
             '        <extensions><speed>' + p.v + '</speed></extensions>\n' +
             '      </trkpt>';
    }).join('\n');
    var wpts = (trip.acc.events || []).filter(function (e) { return e.lat != null; })
      .map(function (e) {
        return '  <wpt lat="' + e.lat + '" lon="' + e.lon + '">\n' +
               '    <name>' + esc(e.severity + ' ' + e.type) + '</name>\n' +
               '    <time>' + new Date(trip.startedAt + (e.t0 || 0)).toISOString() + '</time>\n' +
               '  </wpt>';
      }).join('\n');
    return '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<gpx version="1.1" creator="Driving Telematics" xmlns="http://www.topografix.com/GPX/1/1">\n' +
      (wpts ? wpts + '\n' : '') +
      '  <trk><name>' + esc(name) + '</name><trkseg>\n' + pts + '\n  </trkseg></trk>\n</gpx>\n';
  }

  function eventsCSV(trips, units) {
    var rows = [['trip_started', 'event_time', 'type', 'severity', 'peak_g',
                 'duration_s', 'speed_' + (units === 'kmh' ? 'kmh' : 'mph'),
                 'limit_' + (units === 'kmh' ? 'kmh' : 'mph'), 'pct_over', 'lat', 'lon']];
    trips.forEach(function (t) {
      (t.acc.events || []).forEach(function (e) {
        rows.push([
          new Date(t.startedAt).toISOString(),
          new Date(t.startedAt + (e.t0 || 0)).toISOString(),
          e.type, e.severity,
          e.type === 'speeding' ? '' : (e.peakG || 0).toFixed(3),
          ((e.durMs || 0) / 1000).toFixed(1),
          U.speedIn(e.type === 'speeding' ? e.peak : e.speedStart, units).toFixed(1),
          e.limit != null ? U.speedIn(e.limit, units).toFixed(0) : '',
          e.pctOver != null ? e.pctOver.toFixed(1) : '',
          e.lat != null ? e.lat.toFixed(6) : '',
          e.lon != null ? e.lon.toFixed(6) : ''
        ]);
      });
    });
    return rows.map(function (r) {
      return r.map(function (c) {
        var s = String(c);
        return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
      }).join(',');
    }).join('\n');
  }

  function tripsJSON(trips) {
    return JSON.stringify({
      exported: new Date().toISOString(),
      app: 'Driving Telematics',
      trips: trips
    }, null, 2);
  }

  /* Some embedded viewers block downloads outright, so always offer the
     clipboard as a fallback rather than failing silently. */
  function download(filename, text, mime) {
    try {
      var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 400);
      return true;
    } catch (e) { return false; }
  }

  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(function () { return true; })
        .catch(function () { return legacyCopy(text); });
    }
    return Promise.resolve(legacyCopy(text));
  }
  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  }

  TL.exporters = {
    toGPX: toGPX, eventsCSV: eventsCSV, tripsJSON: tripsJSON,
    download: download, copy: copy
  };
})(window.TL = window.TL || {});
