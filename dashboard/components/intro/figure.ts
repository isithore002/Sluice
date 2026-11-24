/* The stick man: a jointed figure drawn with smooth strokes. He is built from real proportions (a head about a seventh of his
 * height, thigh and shin of equal length, an elbow and a knee) and moves by joint angles, so he walks with a believable stride
 * (knees bend as the leg swings through, arms swing against the legs, the body bobs and leans a little) and his feet stay
 * planted on the boardwalk instead of sliding. */

const INK = "#0d0507";
const FACE = "#fff6d8";

export type FigureOpts = {
  /** Where his hips are, horizontally, in canvas px. */
  x: number;
  /** The boardwalk surface he stands on, in canvas px. */
  ground: number;
  /** His height, head to heel, in canvas px. */
  height: number;
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

/** Draws him and returns where his mouth is, so his speech cloud can come out of it. */
export function drawFigure(ctx: CanvasRenderingContext2D, o: FigureOpts): { mouth: { x: number; y: number } } {
  const L = o.height / 0.97;
  const lw = Math.max(4, Math.round(L * 0.068));
  const thigh = L * 0.235;
  const shin = L * 0.235;
  const torso = L * 0.3;
  const neck = L * 0.03;
  const headR = L * 0.07;
  const upper = L * 0.16;
  const fore = L * 0.15;
  const toe = L * 0.055;
  const w = o.walk;

  // each leg: the hip swings, and the knee bends as the leg swings forward through the stride
  const leg = (p: number, stand: number) => {
    const hip = 0.5 * w * Math.sin(p) + stand * (1 - w);
    const bend = 0.8 * w * Math.max(0, Math.cos(p));
    return { hip, shin: hip - bend };
  };
  const legs = [leg(o.phase, -0.05), leg(o.phase + Math.PI, 0.07)];

  // find where the ankles land with the hips at height 0, then lower the whole body so the lower foot is on the ground
  const rel = legs.map((l) => {
    const knee = away([0, 0], thigh, l.hip);
    const ankle = away(knee, shin, l.shin);
    return { knee, ankle };
  });
  const drop = Math.max(rel[0].ankle[1], rel[1].ankle[1]);
  const bob = Math.abs(Math.cos(o.phase)) * L * 0.012 * w; // the body is highest as the legs pass under it
  const hipY = o.ground - drop - bob;
  const hip: P = [o.x, hipY];

  const lean = 0.03 + 0.06 * w;
  const shoulder: P = [hip[0] + Math.sin(lean) * torso, hip[1] - Math.cos(lean) * torso];
  const nod = o.talking ? Math.sin(o.t * 13) * L * 0.006 : Math.sin(o.t * 1.6) * L * 0.002;
  const head: P = [shoulder[0] + Math.sin(lean) * (neck + headR), shoulder[1] - Math.cos(lean) * (neck + headR) + nod];

  // arms swing against the legs; the front arm lifts and waves while he talks
  const arm = (p: number, front: boolean) => {
    let ang = -0.55 * w * Math.sin(p) + 0.06 * (1 - w) * (front ? 1 : -1);
    let bend = 0.3 + 0.35 * w * Math.max(0, -Math.sin(p)) + 0.15 * (1 - w);
    if (front && o.wave > 0) {
      const up = 2.25;
      const flap = Math.sin(o.t * 7.5) * 0.4;
      ang += (up - ang) * o.wave;
      bend += (0.5 + flap - bend) * o.wave;
    }
    const elbow = away(shoulder, upper, ang);
    const hand = away(elbow, fore, ang + bend);
    return { elbow, hand };
  };
  const armBack = arm(o.phase, false);
  const armFront = arm(o.phase + Math.PI, true);

  const place = (i: number) => {
    const knee = away(hip, thigh, legs[i].hip);
    const ankle = away(knee, shin, legs[i].shin);
    return { knee, ankle };
  };
  const stroke = (pts: P[], alpha = 1) => {
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.stroke();
    ctx.globalAlpha = 1;
  };

  // a soft shadow on the boards
  ctx.fillStyle = "rgba(0, 0, 0, 0.3)";
  ctx.beginPath();
  ctx.ellipse(o.x + L * 0.02, o.ground + lw * 0.3, L * 0.22, L * 0.022, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = lw;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // the far limbs sit slightly back, so he reads as having depth
  const a = place(0);
  stroke([hip, a.knee, a.ankle, [a.ankle[0] + toe, a.ankle[1]]], 0.78);
  stroke([shoulder, armBack.elbow, armBack.hand], 0.78);
  // body
  stroke([hip, shoulder]);
  // near leg and arm
  const b = place(1);
  stroke([hip, b.knee, b.ankle, [b.ankle[0] + toe, b.ankle[1]]]);
  stroke([shoulder, armFront.elbow, armFront.hand]);
  // head: a solid disc, with a light eye and a mouth that opens while he talks
  ctx.beginPath();
  ctx.arc(head[0], head[1], headR, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = FACE;
  ctx.beginPath();
  ctx.arc(head[0] + headR * 0.42, head[1] - headR * 0.18, Math.max(1.4, headR * 0.15), 0, Math.PI * 2);
  ctx.fill();
  if (o.talking) {
    ctx.beginPath();
    ctx.ellipse(head[0] + headR * 0.5, head[1] + headR * 0.42, Math.max(1.4, headR * 0.2), Math.max(1.2, headR * 0.15), 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return { mouth: { x: head[0] + headR * 0.95, y: head[1] + headR * 0.42 } };
}
