/* ==========================================================================
   SMALL WORLD - Procedural Web Audio Engine
   Zero external audio files, zero dependencies. Synthesizes ambient nature,
   seasonal weather, and event Foley directly using the browser Web Audio API.
   ========================================================================== */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  const API = window.SmallWorld;
  if (!API) return;

  let ctx = null;
  let masterGain = null;
  let ambientGain = null;
  let sfxGain = null;
  let muted = localStorage.getItem('smallworld.muted') === '1';
  let audioReady = false;

  // Active ambient nodes
  let windNode = null, windFilter = null, windGain = null;
  let rainNode = null, rainGain = null;
  let cricketInterval = null, birdInterval = null;

  // ---------------------------------------------------------------- Web Audio Init
  function initAudio() {
    if (ctx) return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      ctx = new AudioCtx();

      masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(muted ? 0 : 0.6, ctx.currentTime);
      masterGain.connect(ctx.destination);

      ambientGain = ctx.createGain();
      ambientGain.gain.setValueAtTime(0.35, ctx.currentTime);
      ambientGain.connect(masterGain);

      sfxGain = ctx.createGain();
      sfxGain.gain.setValueAtTime(0.7, ctx.currentTime);
      sfxGain.connect(masterGain);

      startAmbientWind();
      startAmbientRain();
      startProceduralWildlife();
      audioReady = true;
    } catch (e) {
      console.warn('Audio init warning:', e);
    }
  }

  function ensureRunning() {
    if (!ctx) initAudio();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
  }

  // ---------------------------------------------------------------- Noise Generator
  function createWhiteNoiseBuffer(seconds) {
    if (!ctx) return null;
    const len = ctx.sampleRate * (seconds || 2);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buf;
  }

  // ---------------------------------------------------------------- Ambient Loops
  function startAmbientWind() {
    if (!ctx) return;
    const buf = createWhiteNoiseBuffer(3);
    if (!buf) return;

    windNode = ctx.createBufferSource();
    windNode.buffer = buf;
    windNode.loop = true;

    windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.setValueAtTime(320, ctx.currentTime);
    windFilter.Q.setValueAtTime(3.0, ctx.currentTime);

    windGain = ctx.createGain();
    windGain.gain.setValueAtTime(0.08, ctx.currentTime);

    windNode.connect(windFilter);
    windFilter.connect(windGain);
    windGain.connect(ambientGain);
    windNode.start();
  }

  function startAmbientRain() {
    if (!ctx) return;
    const buf = createWhiteNoiseBuffer(2);
    if (!buf) return;

    rainNode = ctx.createBufferSource();
    rainNode.buffer = buf;
    rainNode.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1100, ctx.currentTime);
    filter.Q.setValueAtTime(0.8, ctx.currentTime);

    rainGain = ctx.createGain();
    rainGain.gain.setValueAtTime(0, ctx.currentTime);

    rainNode.connect(filter);
    filter.connect(rainGain);
    rainGain.connect(ambientGain);
    rainNode.start();
  }

  function startProceduralWildlife() {
    birdInterval = setInterval(() => {
      if (!ctx || muted || ctx.state !== 'running') return;
      const w = window.SmallWorldInstance;
      if (!w || w.isNight || (w.season !== 'Spring' && w.season !== 'Summer')) return;
      if (Math.random() < 0.45) playBirdChirp();
    }, 4500);

    cricketInterval = setInterval(() => {
      if (!ctx || muted || ctx.state !== 'running') return;
      const w = window.SmallWorldInstance;
      if (!w || !w.isNight || w.season === 'Winter') return;
      if (Math.random() < 0.6) playCricketChirp();
    }, 2800);
  }

  // ---------------------------------------------------------------- Procedural Sound Effects
  function playBirdChirp() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';

    const baseFreq = 2200 + Math.random() * 800;
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq + 700, now + 0.08);
    osc.frequency.exponentialRampToValueAtTime(baseFreq - 200, now + 0.16);

    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.04, now + 0.03);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.22);
  }

  function playCricketChirp() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(4600 + Math.random() * 300, now);

    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.025, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.1);
  }

  function playWoodChop() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(140, now);
    osc.frequency.exponentialRampToValueAtTime(45, now + 0.09);

    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  function playHammer() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(260, now + 0.06);

    g.gain.setValueAtTime(0.12, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 0.09);
  }

  function playHarvest() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const buf = createWhiteNoiseBuffer(0.15);
    if (!buf) return;
    const node = ctx.createBufferSource();
    node.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2400, now);
    filter.Q.setValueAtTime(2.0, now);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.08, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    node.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    node.start(now);
  }

  function playBellChime(freqs) {
    if (!ctx || muted) return;
    freqs = freqs || [523.25, 659.25, 783.99];
    const now = ctx.currentTime;
    freqs.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      const t = now + idx * 0.08;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.15, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);

      osc.connect(g);
      g.connect(sfxGain);
      osc.start(t);
      osc.stop(t + 1.3);
    });
  }

  function playDeathToll() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(130.81, now);
    osc.frequency.exponentialRampToValueAtTime(110.0, now + 2.0);

    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.2, now + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 2.4);

    osc.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 2.5);
  }

  function playWarHorn() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(185, now);
    osc.frequency.linearRampToValueAtTime(220, now + 0.4);
    osc.frequency.linearRampToValueAtTime(185, now + 0.9);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(650, now);

    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.25, now + 0.1);
    g.gain.linearRampToValueAtTime(0.18, now + 0.7);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.1);

    osc.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    osc.start(now);
    osc.stop(now + 1.2);
  }

  function playThunder() {
    if (!ctx || muted) return;
    const now = ctx.currentTime;
    const buf = createWhiteNoiseBuffer(1.8);
    if (!buf) return;
    const node = ctx.createBufferSource();
    node.buffer = buf;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(140, now);
    filter.frequency.linearRampToValueAtTime(80, now + 1.5);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.01, now);
    g.gain.linearRampToValueAtTime(0.3, now + 0.15);
    g.gain.exponentialRampToValueAtTime(0.001, now + 1.7);

    node.connect(filter);
    filter.connect(g);
    g.connect(sfxGain);
    node.start(now);
  }

  // ---------------------------------------------------------------- Seasonal & Weather Updates
  function updateWeatherAudio(w) {
    if (!ctx || !windGain || !windFilter || !rainGain) return;
    const now = ctx.currentTime;

    if (w.season === 'Winter') {
      windFilter.frequency.setTargetAtTime(650, now, 1.0);
      windGain.gain.setTargetAtTime(0.18, now, 1.0);
    } else if (w.season === 'Autumn') {
      windFilter.frequency.setTargetAtTime(420, now, 1.0);
      windGain.gain.setTargetAtTime(0.12, now, 1.0);
    } else {
      windFilter.frequency.setTargetAtTime(280, now, 1.0);
      windGain.gain.setTargetAtTime(0.06, now, 1.0);
    }

    const isRaining = (w.m && w.m.dis && w.m.dis.storm) || (w.m && w.m.weather && w.m.weather.rain);
    if (isRaining) {
      rainGain.gain.setTargetAtTime(0.22, now, 0.5);
      if (Math.random() < 0.08) playThunder();
    } else {
      rainGain.gain.setTargetAtTime(0, now, 0.8);
    }
  }

  // ---------------------------------------------------------------- Hook into Small World
  let lastWorkSoundTick = 0;

  API.audio = {
    init: initAudio,
    ensure: ensureRunning,
    playWoodChop,
    playHammer,
    playHarvest,
    playBellChime,
    playDeathToll,
    playWarHorn,
    playThunder,
    isMuted: () => muted,
    setMuted: (val) => {
      muted = !!val;
      localStorage.setItem('smallworld.muted', muted ? '1' : '0');
      if (masterGain && ctx) {
        masterGain.gain.setValueAtTime(muted ? 0 : 0.6, ctx.currentTime);
      }
    },
    toggleMute: () => {
      API.audio.setMuted(!muted);
      return muted;
    }
  };

  API.mods.push({
    tick(w) {
      window.SmallWorldInstance = w;
      if (w.tick % 40 === 0) {
        updateWeatherAudio(w);
      }
    },
    work(w, a, kind) {
      if (w.tick - lastWorkSoundTick < 12) return;
      lastWorkSoundTick = w.tick;

      if (kind === 'chop' || a.job === 'woodcutter') {
        playWoodChop();
      } else if (kind === 'build' || a.job === 'builder' || kind === 'forge') {
        playHammer();
      } else if (kind === 'farm' || a.job === 'farmer' || kind === 'forage') {
        playHarvest();
      }
    },
    child(w) {
      playBellChime([523.25, 659.25, 783.99, 1046.5]);
    },
    die(w, a, cause) {
      playDeathToll();
    },
    event(w, ev) {
      if (ev === 'wolves' || ev === 'raid' || ev === 'bandits') {
        playWarHorn();
      } else if (ev === 'storm') {
        playThunder();
      } else if (ev === 'feast' || ev === 'harvest') {
        playBellChime([440, 554.37, 659.25]);
      }
    }
  });

  window.addEventListener('pointerdown', ensureRunning, { once: true });
  window.addEventListener('keydown', ensureRunning, { once: true });
})();
