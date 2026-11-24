/* The pixel stick man. He is worked out like a jointed figure (a head, a body, arms with elbows, legs with knees) and moves by
 * joint angles, so he walks with a real stride: the knees bend as each leg swings through, the arms swing against the legs, and
 * his feet stay planted instead of sliding. Every limb is then drawn one sprite pixel wide on a pixel grid, so he stays pixel art. */

const INK = "#0d0507";
const FAR = "#3b1e24"; // the limbs on his far side, a shade lighter, so a one-pixel figure still has depth
const FACE = "#fff6d8";

export type FigureOpts = {
  /** Where his hips are, horizontally, in canvas px. */
  x: number;
  /** The boardwalk surface he stands on, in canvas px. */
  ground: number;
  /** One sprite pixel, in canvas px. He is FIGURE_H sprite pixels tall. */
  pitch: number;
  /** The walk cycle, in radians: one full turn is two steps. It only matters while `walk` is above zero. */
  phase: number;
  /** 0 standing, 1 walking at full stride: eased so he settles into standing rather than snapping. */
  walk: number;
  /** 0 arms at his side, 1 front arm raised and waving. */
  wave: number;
  /** Mouth open. */
  talking: boolean;
  /** Seconds, for the small idle motions. */
  t: number;
};

type P = [number, number];

/** A point `len` away from `from` at angle `ang`, measured from straight down, positive toward +x (the way he faces). */
const away = ([x, y]: P, len: number, ang: number): P => [x + Math.sin(ang) * len, y + Math.cos(ang) * len];

// proportions, in sprite pixels
const THIGH = 7;
const SHIN = 7;
const TORSO = 9;
const NECK = 1.5;
const HEAD_R = 2.6;
const UPPER = 5;
const FORE = 4.5;
/** His height from heel to top of head, in sprite pixels. */
export const FIGURE_H = 30;

/** Draws him and returns where his mouth is (canvas px), so his speech cloud can come out of it. */
export function drawFigure(ctx: CanvasRenderingContext2D, o: FigureOpts): { mouth: { x: number; y: number } } {
  const u = o.pitch;
  const w = o.walk;
  const cells = new Map<string, string>();
  const set = (x: number, y: number, c: string) => cells.set(`${Math.round(x)},${Math.round(y)}`, c);
  const line = (a: P, b: P, c: string) => {
    let x0 = Math.round(a[0]);
    let y0 = Math.round(a[1]);
    const x1 = Math.round(b[0]);
    const y1 = Math.round(b[1]);
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      set(x0, y0, c);
      set(x0 + 1, y0, c); // two pixels thick, so the limbs read at a glance
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  };

  // each leg: the hip swings, and the knee bends as the leg swings forward through the stride
  const leg = (p: number, stand: number) => {
    const hip = 0.5 * w * Math.sin(p) + stand * (1 - w);
    const bend = 0.8 * w * Math.max(0, Math.cos(p));
    return { hip, shin: hip - bend };
  };
  const legs = [leg(o.phase, -0.2), leg(o.phase + Math.PI, 0.22)];

  // where the ankles land with the hips at row 0, so the body can be set down with the lower foot exactly on the ground
  const rel = legs.map((l) => away(away([0, 0], THIGH, l.hip), SHIN, l.shin));
  const drop = Math.max(rel[0][1], rel[1][1]);
  const groundRow = Math.round(o.ground / u);
  const bob = Math.abs(Math.cos(o.phase)) * 0.7 * w; // the body is highest as the legs pass under it
  const hip: P = [o.x / u, groundRow - 1 - drop - bob];

  const lean = 0.03 + 0.06 * w;
  const shoulder: P = [hip[0] + Math.sin(lean) * TORSO, hip[1] - Math.cos(lean) * TORSO];
  const nod = o.talking ? Math.sin(o.t * 13) * 0.4 : 0;
  const head: P = [shoulder[0] + Math.sin(lean) * (NECK + HEAD_R), shoulder[1] - Math.cos(lean) * (NECK + HEAD_R) + nod];

  // arms swing against the legs; the front arm lifts and waves while he talks
  const arm = (p: number, front: boolean) => {
    let ang = -0.55 * w * Math.sin(p) + 0.06 * (1 - w) * (front ? 1 : -1);
    let bend = 0.3 + 0.35 * w * Math.max(0, -Math.sin(p)) + 0.15 * (1 - w);
    if (front && o.wave > 0) {
      const flap = Math.sin(o.t * 7.5) * 0.4;
      ang += (2.25 - ang) * o.wave;
      bend += (0.5 + flap - bend) * o.wave;
    }
    const elbow = away(shoulder, UPPER, ang);
    return { elbow, hand: away(elbow, FORE, ang + bend) };
  };
  const armBack = arm(o.phase, false);
  const armFront = arm(o.phase + Math.PI, true);

  const limb = (i: number, c: string) => {
    const knee = away(hip, THIGH, legs[i].hip);
    const ankle = away(knee, SHIN, legs[i].shin);
    line(hip, knee, c);
    line(knee, ankle, c);
    line(ankle, [ankle[0] + 2, ankle[1]], c); // the foot points the way he faces
  };

  // far side first, then the body, then the near side, then the head, so nearer pixels paint over farther ones
  limb(0, FAR);
  line(shoulder, armBack.elbow, FAR);
  line(armBack.elbow, armBack.hand, FAR);
  line(hip, shoulder, INK);
  limb(1, INK);
  line(shoulder, armFront.elbow, INK);
  line(armFront.elbow, armFront.hand, INK);
  const hx = Math.round(head[0]);
  const hy = Math.round(head[1]);
  for (let dy = -HEAD_R; dy <= HEAD_R; dy++) {
    for (let dx = -HEAD_R; dx <= HEAD_R; dx++) if (dx * dx + dy * dy <= HEAD_R * HEAD_R + 1) set(hx + dx, hy + dy, INK);
  }
  set(hx + 1, hy - 1, FACE); // an eye (one pixel, on the side he faces)
  if (o.talking) {
    set(hx + 1, hy + 1, FACE); // and an open mouth
  }

  // a flat shadow on the boards, then the figure
  ctx.fillStyle = "rgba(0, 0, 0, 0.28)";
  ctx.fillRect(Math.round((hip[0] - 7) * u), groundRow * u, 14 * u, u);
  for (const [k, c] of cells) {
    const [x, y] = k.split(",").map(Number);
    ctx.fillStyle = c;
    ctx.fillRect(x * u, y * u, u, u);
  }
  return { mouth: { x: (hx + 3) * u, y: (hy + 1.5) * u } };
}
