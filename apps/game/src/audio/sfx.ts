import type { Element } from '@grimoire/glyphs';

/**
 * Synthesised sound effects (WebAudio), used until the artist's sounds arrive, and the
 * artist's background music. Audio starts after the first touch, as mobile browsers require.
 */

export type Sound =
  | 'click'
  | 'cast'
  | 'hit'
  | 'weak'
  | 'resist'
  | 'parry'
  | 'fizzle'
  | 'hurt'
  | 'death'
  | 'windup'
  | 'record'
  | 'victory'
  | 'defeat';

let ctx: AudioContext | null = null;
let volume = 0.8;
/** Music sits under the effects. */
const MUSIC_LEVEL = 0.35;
let musicGain: GainNode | null = null;
let musicLoading = false;

export function setVolume(value: number): void {
  volume = Math.max(0, Math.min(1, value));
  if (musicGain) musicGain.gain.value = volume * MUSIC_LEVEL;
}

/** Loops the background music; call it after unlockAudio(). Missing or broken files stay silent. */
export function playMusic(url: string): void {
  const audio = ctx;
  if (!audio || musicLoading) return;
  musicLoading = true;
  void fetch(url)
    .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(`music ${response.status}`))))
    .then((data) => audio.decodeAudioData(data))
    .then((buffer) => {
      const source = audio.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      musicGain = audio.createGain();
      musicGain.gain.value = volume * MUSIC_LEVEL;
      source.connect(musicGain).connect(audio.destination);
      source.start();
    })
    .catch((e) => console.warn('music is off', e));
}

export function unlockAudio(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    ctx = null;
  }
}

function tone(freq: number, duration: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0): void {
  if (!ctx) return;
  const t = ctx.currentTime + delay;
  const osc = ctx.createOscillator();
  const amp = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
  amp.gain.setValueAtTime(gain * volume, t);
  amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
  osc.connect(amp).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + duration + 0.02);
}

function noise(duration: number, gain: number, filter: BiquadFilterType, frequency: number): void {
  if (!ctx) return;
  const length = Math.ceil(ctx.sampleRate * duration);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.value = frequency;
  const amp = ctx.createGain();
  amp.gain.value = gain * volume;
  source.connect(biquad).connect(amp).connect(ctx.destination);
  source.start();
}

const CAST: Record<Element, () => void> = {
  fire: () => {
    noise(0.35, 0.5, 'lowpass', 1400);
    tone(220, 0.3, 'sawtooth', 0.08, 90);
  },
  water: () => tone(700, 0.3, 'sine', 0.25, 260),
  air: () => noise(0.4, 0.45, 'highpass', 1800),
  earth: () => {
    tone(120, 0.35, 'square', 0.12, 55);
    noise(0.2, 0.3, 'lowpass', 400);
  },
};

export function sfx(sound: Sound, elements: readonly Element[] = []): void {
  if (!ctx || volume <= 0) return;
  switch (sound) {
    case 'click':
      tone(660, 0.05, 'square', 0.05);
      break;
    case 'cast':
      for (const e of elements) CAST[e]();
      break;
    case 'hit':
      tone(180, 0.12, 'square', 0.1, 90);
      break;
    case 'weak':
      tone(300, 0.15, 'square', 0.12, 120);
      tone(600, 0.1, 'square', 0.06, 300, 0.03);
      break;
    case 'resist':
      tone(140, 0.12, 'triangle', 0.12, 120);
      break;
    case 'parry':
      tone(880, 0.25, 'triangle', 0.18, 660);
      tone(1320, 0.2, 'sine', 0.1, 990, 0.04);
      break;
    case 'fizzle':
      tone(400, 0.25, 'sawtooth', 0.06, 80);
      break;
    case 'hurt':
      tone(110, 0.2, 'sawtooth', 0.14, 60);
      break;
    case 'death':
      noise(0.4, 0.3, 'lowpass', 900);
      break;
    case 'windup':
      tone(330, 0.5, 'sine', 0.05, 520);
      break;
    case 'record':
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.25, 'triangle', 0.1, undefined, i * 0.09));
      break;
    case 'victory':
      [392, 523, 659, 784].forEach((f, i) => tone(f, 0.35, 'square', 0.07, undefined, i * 0.12));
      break;
    case 'defeat':
      [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, 'triangle', 0.1, undefined, i * 0.15));
      break;
  }
}
