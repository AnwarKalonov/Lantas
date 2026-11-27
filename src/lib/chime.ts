import type { ChimeKind, ChimePreset } from "./types";

/**
 * Small synthesised cues, not shipped audio files.
 *
 * A cue is a few sine/triangle partials through a low-pass, with an
 * exponential tail. Everything is created on the first ring after a gesture,
 * so browsers do not block it, and a missing audio output can never break a
 * run. The user picks one preset per event, so a quiet bell can mean “done”
 * while a lower drop means “that failed”.
 */

let context: AudioContext | null = null;

interface Note {
  freq: number;
  at: number;
  gain: number;
  /** Seconds the note rings for. */
  hold?: number;
}

interface Voice {
  notes: Note[];
  /** Top of the low-pass, in Hz. */
  cutoff: number;
  /** Overall output level. */
  level: number;
  /** Extra sine an octave up, at this fraction of the note gain. */
  shimmer?: number;
  wave?: OscillatorType;
}

const VOICES: Record<Exclude<ChimePreset, "none">, Voice> = {
  // The original: D5 then A5, soft and long.
  soft: {
    notes: [
      { freq: 587.33, at: 0, gain: 0.7 },
      { freq: 880.0, at: 0.17, gain: 0.45 },
      { freq: 1174.66, at: 0.17, gain: 0.08 },
    ],
    cutoff: 2600,
    level: 0.14,
    shimmer: 0.12,
    wave: "sine",
  },
  // Lower and rounder, like a service bell across a room.
  bell: {
    notes: [
      { freq: 440.0, at: 0, gain: 0.62, hold: 2.4 },
      { freq: 659.25, at: 0.22, gain: 0.34, hold: 2.2 },
      { freq: 1318.5, at: 0.22, gain: 0.06, hold: 1.4 },
    ],
    cutoff: 2100,
    level: 0.16,
    shimmer: 0.1,
    wave: "sine",
  },
  // A rising three-note chime for when the whole task lands.
  chime: {
    notes: [
      { freq: 523.25, at: 0, gain: 0.34 },
      { freq: 659.25, at: 0.1, gain: 0.36 },
      { freq: 783.99, at: 0.2, gain: 0.4 },
      { freq: 1046.5, at: 0.2, gain: 0.08 },
    ],
    cutoff: 3200,
    level: 0.13,
    shimmer: 0.14,
    wave: "triangle",
  },
  // One short, bright ping. Good for a question that needs you.
  blip: {
    notes: [
      { freq: 1046.5, at: 0, gain: 0.5, hold: 0.32 },
      { freq: 1567.98, at: 0, gain: 0.1, hold: 0.26 },
    ],
    cutoff: 5200,
    level: 0.11,
    shimmer: 0.08,
    wave: "sine",
  },
  // Two notes falling. Reads as “something went wrong” without being harsh.
  drop: {
    notes: [
      { freq: 392.0, at: 0, gain: 0.45, hold: 0.5 },
      { freq: 261.63, at: 0.16, gain: 0.42, hold: 0.9 },
    ],
    cutoff: 1400,
    level: 0.15,
    shimmer: 0.06,
    wave: "triangle",
  },
};

export const CHIME_PRESETS: Array<{ id: ChimePreset; label: string }> = [
  { id: "soft", label: "Soft bell" },
  { id: "bell", label: "Low bell" },
  { id: "chime", label: "Rising chime" },
  { id: "blip", label: "Blip" },
  { id: "drop", label: "Low drop" },
  { id: "none", label: "Silent" },
];

export function playChime(preset: ChimePreset, kind: ChimeKind = "done") {
  try {
    if (preset === "none" || typeof window === "undefined") return;
    const voice = VOICES[preset];
    if (!voice) return;
    const Audio = window.AudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime + 0.02;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(voice.level, now + 0.045);
    master.gain.exponentialRampToValueAtTime(
      0.0001,
      now + Math.max(1.4, ...voice.notes.map((note) => note.at + (note.hold ?? 1.7))),
    );

    // Roll off the top so a cue sits behind a voice call, not over it.
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = voice.cutoff;
    tone.Q.value = 0.4;
    master.connect(tone).connect(context.destination);

    for (const note of voice.notes) {
      const hold = note.hold ?? 1.7;
      for (const [type, detune] of [
        [voice.wave ?? "sine", 0],
        ["triangle", 5],
      ] as const) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = type;
        osc.frequency.value = note.freq;
        osc.detune.value = detune;
        gain.gain.setValueAtTime(0.0001, now + note.at);
        gain.gain.exponentialRampToValueAtTime(note.gain, now + note.at + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + hold);
        osc.connect(gain).connect(master);
        osc.start(now + note.at);
        osc.stop(now + note.at + hold + 0.05);
      }
      if (voice.shimmer) {
        const partial = context.createOscillator();
        const gain = context.createGain();
        partial.type = "sine";
        partial.frequency.value = note.freq * 2;
        gain.gain.setValueAtTime(0.0001, now + note.at);
        gain.gain.exponentialRampToValueAtTime(
          note.gain * voice.shimmer,
          now + note.at + 0.02,
        );
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + hold * 0.7);
        partial.connect(gain).connect(master);
        partial.start(now + note.at);
        partial.stop(now + note.at + hold);
      }
    }
    // `kind` is part of the call signature so a future voice can differ by
    // event; today the preset itself carries the meaning.
    void kind;
  } catch {
    // Audio is a courtesy. A blocked or missing output must never break a run.
  }
}

/** Kept for callers that only know “the turn finished”. */
export function ringDone() {
  playChime("soft", "done");
}
