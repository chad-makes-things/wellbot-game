// audio.js — Synthesized sound effects and music (Web Audio API)
// All sounds are generated procedurally — no external audio files needed.

export class AudioManager {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._muted = false;
    this._initialized = false;
    this._musicGain = null;
    this._musicPlaying = false;
  }

  // Must be called on first user interaction (browser autoplay policy)
  init() {
    if (this._initialized) return;
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = 0.3;
      this._masterGain.connect(this._ctx.destination);
      this._musicGain = this._ctx.createGain();
      this._musicGain.gain.value = 0.12;
      this._musicGain.connect(this._masterGain);
      this._initialized = true;
    } catch (e) {
      // Web Audio not available
    }
  }

  toggleMute() {
    this._muted = !this._muted;
    if (this._masterGain) {
      this._masterGain.gain.value = this._muted ? 0 : 0.3;
    }
    return this._muted;
  }

  get isMuted() { return this._muted; }

  play(name) {
    if (!this._initialized || this._muted) return;
    this.init(); // ensure context is resumed
    if (this._ctx.state === 'suspended') this._ctx.resume();

    switch (name) {
      case 'pistol':    this._pistol(); break;
      case 'shotgun':   this._shotgun(); break;
      case 'rocket':    this._rocket(); break;
      case 'sword':     this._sword(); break;
      case 'coin':      this._coin(); break;
      case 'enemyDeath': this._enemyDeath(); break;
      case 'damage':    this._damage(); break;
      case 'bomb':      this._bomb(); break;
      case 'explosion': this._explosion(); break;
      case 'grapple':   this._grapple(); break;
      case 'purchase':  this._purchase(); break;
      case 'fail':      this._fail(); break;
      case 'shopOpen':  this._shopOpen(); break;
    }
  }

  // ─── Sound generators ───

  _pistol() {
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(880, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(220, this._ctx.currentTime + 0.08);
    g.gain.setValueAtTime(0.3, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.1);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.1);
  }

  _shotgun() {
    // Low-frequency burst
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(200, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(60, this._ctx.currentTime + 0.15);
    g.gain.setValueAtTime(0.4, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.15);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.15);
    // Add noise burst
    this._noiseBurst(0.08, 0.25);
  }

  _rocket() {
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(100, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(40, this._ctx.currentTime + 0.3);
    g.gain.setValueAtTime(0.3, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.3);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.3);
  }

  _sword() {
    this._noiseBurst(0.06, 0.35);
  }

  _coin() {
    // Bright ascending ding
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(800, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1600, this._ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.25, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.2);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.2);
  }

  _enemyDeath() {
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(300, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(80, this._ctx.currentTime + 0.2);
    g.gain.setValueAtTime(0.2, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.2);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.2);
  }

  _damage() {
    // Soft cartoon bonk
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(250, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(100, this._ctx.currentTime + 0.12);
    g.gain.setValueAtTime(0.2, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.15);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.15);
  }

  _bomb() {
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(400, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(150, this._ctx.currentTime + 0.15);
    g.gain.setValueAtTime(0.2, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.15);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.15);
  }

  _explosion() {
    this._noiseBurst(0.3, 0.4);
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(80, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(20, this._ctx.currentTime + 0.4);
    g.gain.setValueAtTime(0.35, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.4);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.4);
  }

  _grapple() {
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'square';
    o.frequency.setValueAtTime(600, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(1200, this._ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.15, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.12);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.12);
  }

  _purchase() {
    // Cheerful ascending chime
    const times = [0, 0.08, 0.16];
    const freqs = [523, 659, 784]; // C5, E5, G5
    for (let i = 0; i < 3; i++) {
      const o = this._ctx.createOscillator();
      const g = this._ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freqs[i];
      g.gain.setValueAtTime(0, this._ctx.currentTime + times[i]);
      g.gain.linearRampToValueAtTime(0.2, this._ctx.currentTime + times[i] + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + times[i] + 0.2);
      o.connect(g); g.connect(this._masterGain);
      o.start(this._ctx.currentTime + times[i]);
      o.stop(this._ctx.currentTime + times[i] + 0.2);
    }
  }

  _fail() {
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(200, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(100, this._ctx.currentTime + 0.2);
    g.gain.setValueAtTime(0.15, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.25);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.25);
  }

  _shopOpen() {
    const o = this._ctx.createOscillator();
    const g = this._ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(400, this._ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(600, this._ctx.currentTime + 0.1);
    g.gain.setValueAtTime(0.1, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.15);
    o.connect(g); g.connect(this._masterGain);
    o.start(); o.stop(this._ctx.currentTime + 0.15);
  }

  // Noise burst helper
  _noiseBurst(duration, volume) {
    const bufferSize = this._ctx.sampleRate * duration;
    const buffer = this._ctx.createBuffer(1, bufferSize, this._ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1);
    }
    const source = this._ctx.createBufferSource();
    source.buffer = buffer;
    const g = this._ctx.createGain();
    g.gain.setValueAtTime(volume, this._ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + duration);
    source.connect(g); g.connect(this._masterGain);
    source.start(); source.stop(this._ctx.currentTime + duration);
  }

  // ─── Background Music ───
  startMusic() {
    if (!this._initialized || this._musicPlaying) return;
    this._musicPlaying = true;

    // Simple chiptune loop: C-Am-F-G progression at 120 BPM
    const bpm = 120;
    const beatLen = 60 / bpm;
    const barLen = beatLen * 4;
    const chords = [
      [261.6, 329.6], // C4, E4
      [220.0, 329.6], // A3, E4
      [174.6, 261.6], // F3, C4
      [196.0, 293.7], // G3, D4
    ];

    const loopDuration = barLen * 4; // 8 seconds

    const playLoop = () => {
      if (!this._musicPlaying) return;
      const now = this._ctx.currentTime;

      for (let bar = 0; bar < 4; bar++) {
        const [root, third] = chords[bar];
        const barStart = now + bar * barLen;

        // Bass note (whole bar)
        const bass = this._ctx.createOscillator();
        const bg = this._ctx.createGain();
        bass.type = 'triangle';
        bass.frequency.value = root / 2;
        bg.gain.setValueAtTime(0.15, barStart);
        bg.gain.setValueAtTime(0.15, barStart + barLen - 0.05);
        bg.gain.linearRampToValueAtTime(0, barStart + barLen);
        bass.connect(bg); bg.connect(this._musicGain);
        bass.start(barStart); bass.stop(barStart + barLen);

        // Melody arpeggios (eighth notes)
        for (let beat = 0; beat < 8; beat++) {
          const t = barStart + beat * beatLen / 2;
          const freq = beat % 2 === 0 ? root : third;
          const mel = this._ctx.createOscillator();
          const mg = this._ctx.createGain();
          mel.type = 'square';
          mel.frequency.value = freq * 2;
          mg.gain.setValueAtTime(0.06, t);
          mg.gain.exponentialRampToValueAtTime(0.001, t + beatLen / 2 - 0.02);
          mel.connect(mg); mg.connect(this._musicGain);
          mel.start(t); mel.stop(t + beatLen / 2);
        }
      }

      // Schedule next loop
      setTimeout(() => playLoop(), (loopDuration - 0.1) * 1000);
    };

    playLoop();
  }

  stopMusic() {
    this._musicPlaying = false;
  }
}
