// All sound is synthesized with the Web Audio API: nothing to download.
// A looping band of filtered noise is the crowd; swells make it roar.
export function createAudio() {
  let ac = null, master = null, crowdGain = null, noiseBuf = null, muted = false;
    let volume = 0.9;
  function initAudio() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = muted ? 0 : volume; master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 650; bp.Q.value = 0.6;
      crowdGain = ac.createGain(); crowdGain.gain.value = 0.05;
      src.connect(bp); bp.connect(crowdGain); crowdGain.connect(master); src.start();
    } catch (e) { ac = null; }
  }
  function noise(dur, freq, q, gain, type) {
    if (!ac) return;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); const t = ac.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur);
  }
  function tone(type, f0, f1, dur, gain, delay) {
    if (!ac) return;
    const t = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur);
  }
  function swell(level, hold) {
    if (!crowdGain) return;
    const t = ac.currentTime, g = crowdGain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(level, t + 0.25); g.linearRampToValueAtTime(level * 0.8, t + 0.25 + hold);
    g.linearRampToValueAtTime(0.05, t + 1.2 + hold);
  }
  const sfx = {
    kick(p) { tone('sine', 150, 42, 0.16, 0.9 * p + 0.2); noise(0.05, 2400, 0.8, 0.35); },
    post() { tone('triangle', 960, 900, 0.7, 0.25); tone('triangle', 1430, 1400, 0.5, 0.15); },
    net() { noise(0.4, 2800, 0.7, 0.35); },
    save() { tone('sine', 110, 60, 0.12, 0.6); noise(0.08, 900, 0.9, 0.4); },
    whistle() { for (let i = 0; i < 3; i++) tone('sine', 2850, 2950, 0.12, 0.12, i * 0.04); },
    roar(big) { swell(big ? 0.5 : 0.28, big ? 1.4 : 0.6); },
    groan() { swell(0.16, 0.4); noise(1.2, 300, 0.5, 0.12, 'lowpass'); },
    pop() { noise(0.5, 380, 0.6, 0.28, 'lowpass'); noise(0.9, 4200, 0.5, 0.05); },
  };

  return {
    init: initAudio,
    sfx,
    get muted() { return muted; },
    setMuted(m) { muted = m; if (master) master.gain.value = muted ? 0 : volume; },
    // Freeze or resume every sound, e.g. while the game is paused.
    suspend() { if (ac && ac.state === 'running') ac.suspend(); },
    resume() { if (ac && ac.state === 'suspended') ac.resume(); },
  };
}
