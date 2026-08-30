/* Real-time feedback. Deliberately restrained: an alert that fires constantly
   gets ignored, and an alert that demands attention at the wrong moment is a
   hazard. Tones are short, speech is throttled, and nothing repeats for the
   same ongoing event. */
(function (TL) {
  'use strict';

  var ctx = null;
  var settings = { voice: true, beeps: true, vibrate: true };
  var lastVoiceT = 0, lastBeepT = 0;
  var VOICE_GAP_MS = 5000;
  var BEEP_GAP_MS = 900;

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try { ctx = new AC(); } catch (e) { return null; }
    return ctx;
  }

  /* Must be called from a user gesture or iOS keeps the context suspended. */
  function unlock() {
    var c = ensureCtx();
    if (c && c.state === 'suspended') c.resume();
    return !!c;
  }

  function tone(freqs, durMs, gain) {
    var c = ensureCtx();
    if (!c || c.state === 'suspended') return;
    var now = c.currentTime, step = durMs / 1000 / freqs.length;
    var osc = c.createOscillator(), g = c.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freqs[0], now);
    for (var i = 1; i < freqs.length; i++) {
      osc.frequency.setValueAtTime(freqs[i], now + step * i);
    }
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(gain || 0.16, now + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durMs / 1000);
    osc.connect(g); g.connect(c.destination);
    osc.start(now); osc.stop(now + durMs / 1000 + 0.02);
  }

  var TONES = {
    brake:    { mild: [520, 400], harsh: [620, 400, 300], severe: [700, 460, 320, 240] },
    accel:    { mild: [400, 520], harsh: [380, 520, 660], severe: [360, 520, 700, 820] },
    corner:   { mild: [480, 560], harsh: [500, 620, 500], severe: [520, 660, 520, 660] },
    speeding: { mild: [660], harsh: [660, 660], severe: [740, 740, 740] }
  };
  var SPOKEN = {
    brake: 'Harsh braking', accel: 'Harsh acceleration',
    corner: 'Sharp corner', speeding: 'Over the limit'
  };
  var VIBE = { mild: [90], harsh: [110, 70, 110], severe: [150, 80, 150, 80, 150] };

  function configure(s) {
    settings.voice = !!s.voice;
    settings.beeps = !!s.beeps;
    settings.vibrate = !!s.vibrate;
  }

  function fire(ev) {
    var now = Date.now();
    if (settings.beeps && now - lastBeepT > BEEP_GAP_MS) {
      var set = TONES[ev.type];
      if (set) {
        tone(set[ev.severity] || set.mild,
             ev.severity === 'severe' ? 460 : (ev.severity === 'harsh' ? 340 : 200),
             ev.severity === 'mild' ? 0.12 : 0.2);
      }
      lastBeepT = now;
    }
    if (settings.vibrate && navigator.vibrate) {
      try { navigator.vibrate(VIBE[ev.severity] || VIBE.mild); } catch (e) {}
    }
    // Speak only for the events worth interrupting for.
    if (settings.voice && ev.severity !== 'mild' && now - lastVoiceT > VOICE_GAP_MS) {
      speak(SPOKEN[ev.type] || '');
      lastVoiceT = now;
    }
  }

  function speak(text) {
    if (!text || !window.speechSynthesis) return;
    try {
      var u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05; u.pitch = 1.0; u.volume = 0.9;
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function preview(type, severity) {
    fire({ type: type, severity: severity || 'harsh' });
  }

  TL.alerts = {
    unlock: unlock, configure: configure, fire: fire, speak: speak,
    preview: preview, tone: tone,
    supported: function () {
      return {
        audio: !!(window.AudioContext || window.webkitAudioContext),
        speech: !!window.speechSynthesis,
        vibrate: !!navigator.vibrate
      };
    }
  };
})(window.TL = window.TL || {});
