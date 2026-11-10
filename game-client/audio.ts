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
let lastStep = 0;
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
  function note(
    freq: number,
    delay = 0,
    duration = 0.12,
    type: OscillatorType = "sine",
    gain = 0.14,
  ) {
    const osc = c.createOscillator(),
      env = c.createGain(),
      at = c.currentTime + delay;
    osc.type = type;
    osc.frequency.setValueAtTime(freq, at);
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, at + duration);
    osc.connect(env);
    env.connect(bus);
    osc.start(at);
    osc.stop(at + duration + 0.02);
    osc.onended = () => {
      osc.disconnect();
      env.disconnect();
    };
  }
  if (sound === "step") {
    if (performance.now() - lastStep < 85) return;
    lastStep = performance.now();
    note(190, 0, 0.055, "triangle", 0.1);
  } else if (sound === "roll")
    [0, 0.07, 0.15, 0.25, 0.38].forEach((d, i) =>
      note(160 + i * 37, d, 0.06, "triangle", 0.13),
    );
  else if (sound === "gain")
    [660, 880, 1100].forEach((f, i) => note(f, i * 0.065, 0.18));
  else if (sound === "spend")
    [440, 310].forEach((f, i) => note(f, i * 0.07, 0.16, "triangle"));
  else if (sound === "buy" || sound === "build")
    [330, 495, 660].forEach((f, i) => note(f, i * 0.07, 0.2, "triangle"));
  else if (sound === "card") {
    note(240, 0, 0.1, "triangle");
    note(900, 0.12, 0.09, "triangle");
    note(780, 1.2, 0.18);
  } else if (sound === "turn") {
    note(520);
    note(780, 0.13, 0.22);
  } else if (sound === "finish")
    [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.12, 0.4));
}
