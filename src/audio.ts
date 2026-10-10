export type MeowKind = "meow" | "mew" | "mrrp" | "yowl";

interface Voice {
  dur: number;
  loud: number;
  trill?: boolean;
  /** [time 0..1, Hz] */
  pitch: [number, number][];
  /** [time 0..1, lip lowpass Hz, formant 1 Hz, formant 2 Hz] */
  mouth: [number, number, number, number][];
}

const VOICES: Record<MeowKind, Voice> = {
  meow: {
    dur: 0.62,
    loud: 0.42,
    pitch: [[0, 640], [0.3, 920], [0.6, 820], [1, 560]],
    mouth: [[0, 700, 450, 1800], [0.25, 2600, 700, 2100], [0.55, 4200, 1050, 1650], [1, 1100, 480, 950]],
  },
  mew: {
    dur: 0.3,
    loud: 0.34,
    pitch: [[0, 900], [0.35, 1150], [1, 820]],
    mouth: [[0, 900, 500, 2000], [0.4, 3800, 900, 2200], [1, 1500, 600, 1400]],
  },
  mrrp: {
    dur: 0.32,
    loud: 0.36,
    trill: true,
    pitch: [[0, 480], [0.6, 640], [1, 820]],
    mouth: [[0, 900, 450, 1500], [0.6, 1600, 600, 1700], [1, 2800, 800, 1900]],
  },
  yowl: {
    dur: 1.05,
    loud: 0.4,
    pitch: [[0, 520], [0.3, 760], [0.65, 860], [1, 480]],
    mouth: [[0, 650, 420, 1600], [0.35, 2200, 700, 1900], [0.7, 3600, 950, 1500], [1, 900, 450, 850]],
  },
};

/** Cosine-eased curve through [time 0..1, value] keypoints, for setValueCurveAtTime. */
function smoothCurve(points: [number, number][], shape: (u: number) => number = () => 1, steps = 96): Float32Array {
  const out = new Float32Array(steps);
  for (let i = 0; i < steps; i++) {
    const u = i / (steps - 1);
    let j = 0;
    while (j < points.length - 2 && u > points[j + 1][0]) j++;
    const [t0, a] = points[j];
    const [t1, b] = points[j + 1];
    const k = Math.min(1, Math.max(0, (u - t0) / (t1 - t0)));
    out[i] = (a + (b - a) * (0.5 - 0.5 * Math.cos(Math.PI * k))) * shape(u);
  }
  return out;
}

/** All sounds are synthesized with Web Audio, so there are no audio assets to load or license. */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private purrGain!: GainNode;
  private noise!: AudioBuffer;
  private muted = false;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    const ctx = (this.ctx = new Ctor());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    // Gentle limiter so overlapping meows, crashes and purrs never clip
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -10;
    limiter.ratio.value = 8;
    this.master.connect(limiter).connect(ctx.destination);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.purrGain = this.buildPurr(ctx, this.master);
  }

  /** Purr graph; returns its level gain (0 = silent). */
  buildPurr(ctx: BaseAudioContext, dest: AudioNode): GainNode {
    // Purr: a ~25 Hz buzz (its harmonics are what you actually hear, also on phone speakers)
    // plus gritty noise pulsed at the same rate, swelling with slow in/out breaths.
    const buzz = ctx.createOscillator();
    buzz.type = "sawtooth";
    buzz.frequency.value = 25;
    const buzzFilter = ctx.createBiquadFilter();
    buzzFilter.type = "lowpass";
    buzzFilter.frequency.value = 520;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0.55;
    buzz.connect(buzzFilter).connect(buzzGain);

    const grit = ctx.createBufferSource();
    grit.buffer = this.noise;
    grit.loop = true;
    const gritFilter = ctx.createBiquadFilter();
    gritFilter.type = "bandpass";
    gritFilter.frequency.value = 280;
    gritFilter.Q.value = 1.1;
    const gritPulse = ctx.createGain();
    gritPulse.gain.value = 0.5;
    const pulse = ctx.createOscillator();
    pulse.type = "square";
    pulse.frequency.value = 25;
    const pulseDepth = ctx.createGain();
    pulseDepth.gain.value = 0.5;
    pulse.connect(pulseDepth).connect(gritPulse.gain);
    grit.connect(gritFilter).connect(gritPulse);

    const breath = ctx.createGain();
    breath.gain.value = 0.65;
    const breathLfo = ctx.createOscillator();
    breathLfo.frequency.value = 0.42;
    const breathDepth = ctx.createGain();
    breathDepth.gain.value = 0.35;
    breathLfo.connect(breathDepth).connect(breath.gain);
    // The buzz rate drifts a little with the breath, like a real purr
    const drift = ctx.createGain();
    drift.gain.value = 2;
    breathLfo.connect(drift).connect(buzz.frequency);
    drift.connect(pulse.frequency);

    // Phone speakers can't play the sub-bass anyway; spend the loudness on the 200-500 Hz rumble
    const lowCut = ctx.createBiquadFilter();
    lowCut.type = "highpass";
    lowCut.frequency.value = 110;
    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 320;
    presence.gain.value = 9;
    const level = ctx.createGain();
    level.gain.value = 0;
    buzzGain.connect(breath);
    gritPulse.connect(breath);
    breath.connect(lowCut).connect(presence).connect(level).connect(dest);
    for (const src of [buzz, grit, pulse, breathLfo]) src.start();
    return level;
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx) this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  purr(level: number) {
    if (!this.ctx) return;
    this.purrGain.gain.setTargetAtTime(level * 0.8, this.ctx.currentTime, 0.25);
  }

  private env(gain: GainNode, t: number, peak: number, attack: number, release: number) {
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  }

  /**
   * Cat voice: a soft harmonic source (not a buzzy sawtooth, which reads as a sheep) at a high pitch,
   * shaped by a mouth that opens and closes ("m-i-a-u") with no vibrato.
   */
  meow(pitch = 1, kind: MeowKind = "meow") {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const v = VOICES[kind];
    const jitter = 0.94 + Math.random() * 0.12;
    const dur = v.dur * (0.9 + Math.random() * 0.25);

    const osc = ctx.createOscillator();
    osc.setPeriodicWave(this.voiceWave(ctx));
    // Smooth curve with a slight random wander (not periodic, that would be vibrato)
    const wander = Math.random() * 10;
    osc.frequency.setValueCurveAtTime(
      smoothCurve(v.pitch.map(([at, f]) => [at, f * pitch * jitter]), (u) => 1 + Math.sin(u * 7 + wander) * Math.sin(u * 3.3) * 0.015),
      t,
      dur,
    );

    // Mouth: lowpass opening plus two vowel formants
    const lip = ctx.createBiquadFilter();
    lip.type = "lowpass";
    lip.Q.value = 0.8;
    const f1 = ctx.createBiquadFilter();
    f1.type = "peaking";
    f1.Q.value = 1.6;
    f1.gain.value = 9;
    const f2 = ctx.createBiquadFilter();
    f2.type = "peaking";
    f2.Q.value = 2.2;
    f2.gain.value = 7;
    lip.frequency.setValueCurveAtTime(smoothCurve(v.mouth.map((m) => [m[0], m[1]])), t, dur);
    f1.frequency.setValueCurveAtTime(smoothCurve(v.mouth.map((m) => [m[0], m[2]])), t, dur);
    f2.frequency.setValueCurveAtTime(smoothCurve(v.mouth.map((m) => [m[0], m[3]])), t, dur);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(v.loud, t + 0.06);
    out.gain.setValueAtTime(v.loud, t + dur * 0.7);
    out.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    // Rolled "rrr" for trills: quick amplitude flutter at the start
    if (v.trill) {
      const flutter = ctx.createOscillator();
      flutter.frequency.value = 30;
      const depth = ctx.createGain();
      depth.gain.setValueAtTime(0.9, t);
      depth.gain.linearRampToValueAtTime(0, t + dur * 0.55);
      const trem = ctx.createGain();
      trem.gain.value = 1;
      flutter.connect(depth).connect(trem.gain);
      osc.connect(trem).connect(lip);
      flutter.start(t);
      flutter.stop(t + dur);
    } else {
      osc.connect(lip);
    }
    lip.connect(f1).connect(f2).connect(out).connect(this.master);

    // A little breath on top
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    const airFilter = ctx.createBiquadFilter();
    airFilter.type = "highpass";
    airFilter.frequency.value = 3000;
    const airGain = ctx.createGain();
    this.env(airGain, t, v.loud * 0.06, 0.05, dur);
    air.connect(airFilter).connect(airGain).connect(this.master);

    osc.start(t);
    osc.stop(t + dur + 0.05);
    air.start(t, Math.random());
    air.stop(t + dur + 0.05);
  }

  private wave: PeriodicWave | null = null;
  private voiceWave(ctx: AudioContext): PeriodicWave {
    if (!this.wave) {
      const n = 20;
      const real = new Float32Array(n);
      const imag = new Float32Array(n);
      for (let k = 1; k < n; k++) imag[k] = 1 / k ** 1.7;
      this.wave = ctx.createPeriodicWave(real, imag);
    }
    return this.wave;
  }

  pop() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const f = 700 + Math.random() * 250;
    osc.frequency.setValueAtTime(f, t);
    osc.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.06);
    this.env(g, t, 0.05, 0.01, 0.08);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  coin() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    [988, 1319, 1760].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "triangle";
      const g = ctx.createGain();
      osc.frequency.value = freq;
      this.env(g, t + i * 0.07, 0.2, 0.01, 0.25);
      osc.connect(g).connect(this.master);
      osc.start(t + i * 0.07);
      osc.stop(t + i * 0.07 + 0.3);
    });
  }

  private noiseBurst(t: number, freq: number, q: number, peak: number, release: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    this.env(g, t, peak, 0.005, release);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + release + 0.05);
    return f;
  }

  crash() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    this.noiseBurst(t, 2600, 0.8, 0.5, 0.35);
    const thud = ctx.createOscillator();
    const tg = ctx.createGain();
    thud.frequency.setValueAtTime(140, t);
    thud.frequency.exponentialRampToValueAtTime(50, t + 0.15);
    this.env(tg, t, 0.5, 0.005, 0.2);
    thud.connect(tg).connect(this.master);
    thud.start(t);
    thud.stop(t + 0.25);
    for (let i = 0; i < 5; i++) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      const s = t + Math.random() * 0.12;
      osc.frequency.value = 1800 + Math.random() * 2600;
      this.env(g, s, 0.06, 0.003, 0.2 + Math.random() * 0.4);
      osc.connect(g).connect(this.master);
      osc.start(s);
      osc.stop(s + 0.7);
    }
  }

  whoosh() {
    const ctx = this.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const f = this.noiseBurst(t, 500, 1.5, 0.25, 0.25);
    f.frequency.exponentialRampToValueAtTime(2200, t + 0.2);
  }

  shutter() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst(t, 3000, 1, 0.3, 0.06);
    this.noiseBurst(t + 0.08, 2000, 1, 0.25, 0.08);
  }
}
