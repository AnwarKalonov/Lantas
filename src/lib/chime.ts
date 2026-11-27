/**
 * A soft two-note bell for "this is finished".
 *
 * It is synthesised instead of shipped as a file: two clean tones a fifth
 * apart, a quiet octave above, and a long exponential tail. Long enough to be
 * heard across a room, soft enough not to startle. The context is created on
 * the first ring, after a user gesture, so browsers do not block it.
 */

let context: AudioContext | null = null;

export function ringDone() {
  try {
    if (typeof window === "undefined") return;
    const Audio = window.AudioContext;
    if (!Audio) return;
    context ??= new Audio();
    if (context.state === "suspended") void context.resume();

    const now = context.currentTime + 0.02;
    const master = context.createGain();
    master.gain.setValueAtTime(0.0001, now);
    master.gain.exponentialRampToValueAtTime(0.14, now + 0.05);
    master.gain.exponentialRampToValueAtTime(0.0001, now + 2.1);

    // Roll off the top so the bell sits behind the voice, not over it.
    const tone = context.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 2600;
    tone.Q.value = 0.4;
    master.connect(tone).connect(context.destination);

    const notes = [
      { freq: 587.33, at: 0, gain: 0.7 }, // D5
      { freq: 880.0, at: 0.17, gain: 0.45 }, // A5
      { freq: 1174.66, at: 0.17, gain: 0.1 }, // D6, barely there
    ];

    for (const note of notes) {
      for (const [type, detune] of [
        ["sine", 0],
        ["triangle", 5],
      ] as const) {
        const osc = context.createOscillator();
        const gain = context.createGain();
        osc.type = type;
        osc.frequency.value = note.freq;
        osc.detune.value = detune;
        gain.gain.setValueAtTime(0.0001, now + note.at);
        gain.gain.exponentialRampToValueAtTime(note.gain, now + note.at + 0.018);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + note.at + 1.7);
        osc.connect(gain).connect(master);
        osc.start(now + note.at);
        osc.stop(now + note.at + 1.8);
      }
    }
  } catch {
    // Audio is a courtesy. A blocked or missing output must never break a run.
  }
}
