/* The sound of the stick man's footsteps on the boardwalk, made with the Web Audio API so there are no audio files to ship.
 * Browsers only let a page make sound after the visitor has interacted with it, so the audio context is created and resumed
 * on a gesture (or straight away if the visitor has already interacted with this site). */

type Ctor = typeof AudioContext;

export function createFootsteps() {
  let ctx: AudioContext | null = null;
  let noise: AudioBuffer | null = null;
  let muted = false;

  const ensure = () => {
    if (ctx) return ctx;
    const AC: Ctor | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: Ctor }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    // a short burst of noise, for the scuff of a boot on wood
    const len = Math.floor(ctx.sampleRate * 0.08);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return ctx;
  };

  return {
    /** Start (or resume) the audio. Resolves to whether sound can play now. */
    async resume() {
      const c = ensure();
      if (!c) return false;
      if (c.state !== "running") await c.resume().catch(() => {});
      return c.state === "running";
    },
    /** True if the visitor has already interacted with this site, so audio may start without a new gesture. */
    mayAutoplay() {
      return Boolean((navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive);
    },
    setMuted(m: boolean) {
      muted = m;
    },
    running() {
      return ctx?.state === "running";
    },
    /** One footfall: a low wooden knock with a little scuff. `alt` alternates the pitch between left and right foot. */
    step(alt: boolean) {
      if (muted || !ctx || ctx.state !== "running" || !noise) return;
      const t = ctx.currentTime;
      const out = ctx.createGain();
      out.gain.value = 0.9;
      out.connect(ctx.destination);

      const knock = ctx.createOscillator();
      const kg = ctx.createGain();
      knock.type = "triangle";
      knock.frequency.setValueAtTime(alt ? 150 : 128, t);
      knock.frequency.exponentialRampToValueAtTime(52, t + 0.1);
      kg.gain.setValueAtTime(0.0001, t);
      kg.gain.exponentialRampToValueAtTime(0.85, t + 0.006);
      kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
      knock.connect(kg).connect(out);
      knock.start(t);
      knock.stop(t + 0.15);

      const scuff = ctx.createBufferSource();
      scuff.buffer = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = "bandpass";
      bp.frequency.value = alt ? 1500 : 1200;
      bp.Q.value = 0.9;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.4, t);
      sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      scuff.connect(bp).connect(sg).connect(out);
      scuff.start(t);
    },
    close() {
      void ctx?.close();
      ctx = null;
    },
  };
}
