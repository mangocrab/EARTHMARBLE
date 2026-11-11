export type Sound =
  | "roll"
  | "step"
  | "gain"
  | "spend"
  | "buy"
  | "build"
  | "card"
  | "turn"
  | "finish";
let context: AudioContext | undefined, master: GainNode | undefined;
let volume = 0.4;
try {
  const saved = localStorage.getItem("earth-volume");
  if (saved !== null && Number.isFinite(+saved))
    volume = Math.max(0, Math.min(1, +saved));
} catch {}
export const getVolume = () => volume;
export function setVolume(value: number) {
  volume = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0.4));
  try {
    localStorage.setItem("earth-volume", String(volume));
  } catch {}
  if (context && master)
    master.gain.setTargetAtTime(volume, context.currentTime, 0.03);
}
export function unlockAudio() {
  try {
    if (!context) {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
    }
    if (context.state === "suspended") void context.resume().catch(() => {});
  } catch {}
}
let lastStep = -Infinity,
  stepCount = 0;
let grain: AudioBuffer | undefined;
export function playSound(sound: Sound) {
  if (
    !context ||
    !master ||
    context.state !== "running" ||
    volume === 0 ||
    document.hidden
  )
    return;
  const c = context,
    bus = master;
  // Quiet sine partials and a low-pass wooden tap keep every cue rounded.
  function note(freq: number, delay = 0, duration = 0.22, gain = 0.075) {
    const osc = c.createOscillator(),
      env = c.createGain(),
      at = c.currentTime + delay;
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + duration);
    osc.connect(env);
    env.connect(bus);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
  function wood(pitch: number, delay = 0, strength = 1) {
    note(pitch, delay, 0.115, 0.09 * strength);
    note(pitch * 1.47, delay + 0.002, 0.075, 0.035 * strength);
    note(pitch * 2.08, delay, 0.045, 0.012 * strength);
    if (!grain) {
      grain = c.createBuffer(1, Math.ceil(c.sampleRate * 0.04), c.sampleRate);
      const data = grain.getChannelData(0);
      for (let i = 0; i < data.length; i++)
        data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    }
    const source = c.createBufferSource(),
      filter = c.createBiquadFilter(),
      env = c.createGain(),
      at = c.currentTime + delay;
    source.buffer = grain;
    filter.type = "lowpass";
    filter.frequency.value = 1000;
    filter.Q.value = 0.45;
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(0.045 * strength, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.04);
    source.connect(filter);
    filter.connect(env);
    env.connect(bus);
    source.start(at);
    source.stop(at + 0.045);
    source.onended = () => {
      source.disconnect();
      filter.disconnect();
      env.disconnect();
    };
  }
  if (sound === "step") {
    if (performance.now() - lastStep < 50) return;
    lastStep = performance.now();
    wood(stepCount++ % 2 ? 490 : 420, 0, 0.72);
  } else if (sound === "roll") {
    [
      0, 0.06, 0.14, 0.23, 0.34, 0.47, 0.62, 0.79, 0.98, 1.19, 1.43, 1.69, 1.96,
      2.12,
    ].forEach((delay, i) =>
      wood([540, 460, 610, 500][i % 4], delay, 0.7 - i * 0.025),
    );
  } else if (sound === "gain")
    [523, 659, 784].forEach((f, i) => note(f, i * 0.09, 0.32));
  else if (sound === "spend")
    [523, 440].forEach((f, i) => note(f, i * 0.1, 0.25, 0.06));
  else if (sound === "buy" || sound === "build") {
    wood(380, 0, 0.5);
    [392, 523, 659].forEach((f, i) => note(f, 0.1 + i * 0.1, 0.32));
  } else if (sound === "card") {
    wood(530, 0, 0.35);
    wood(620, 0.13, 0.28);
    note(659, 1.2, 0.4, 0.065);
    note(784, 1.31, 0.38, 0.045);
  } else if (sound === "turn") {
    note(392, 0, 0.32, 0.06);
    note(523, 0.16, 0.4, 0.06);
  } else if (sound === "finish")
    [392, 523, 659, 784].forEach((f, i) => note(f, i * 0.18, 0.55, 0.07));
}
