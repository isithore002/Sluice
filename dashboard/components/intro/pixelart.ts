/* The stick man, the bitmap letters for his speech and the cloud he speaks in. All of it is plain data and pure functions,
 * so the canvas code in Intro.tsx only has to place and paint it. Sprite and cloud pixels are in their own small grids. */

export type Px = { x: number; y: number; c: string };

const INK = "#120609";
const FACE = "#fff6d8";

// A stick man on a small grid, facing right: a ring for a head, a line each for the body, arms and legs.
export const MAN_W = 13;
export const MAN_H = 22;
/** Where his mouth is, so the cloud can come out of it. */
export const MOUTH_COL = 8;
export const MOUTH_ROW = 4;

export type ManPose = { step: number; walking: boolean; talking: boolean; waving: boolean };

/** The stick man for one frame: solid dark lines and a solid head, with a light eye and mouth. */
export function buildMan({ step, walking, talking, waving }: ManPose): Px[] {
  const g = new Map<string, string>();
  const dot = (x: number, y: number, c: string = INK) => g.set(`${x},${y}`, c);
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      dot(x0, y0);
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

  // head: a solid disc, with a light eye and a mouth that opens while he talks
  for (let y = 0; y <= 6; y++) {
    for (let x = 3; x <= 9; x++) if (Math.hypot(x - 6, y - 3) <= 3.4) dot(x, y);
  }
  dot(7, 2, FACE);
  if (talking) {
    dot(7, MOUTH_ROW, FACE);
    dot(MOUTH_COL, MOUTH_ROW, FACE);
  }
  // body
  line(6, 7, 6, 14);
  // arms
  const sw = walking ? [-1, 0, 1, 0][step % 4] : 0;
  line(6, 9, 4 - sw, 13);
  if (waving) {
    const up = step % 2 === 0;
    line(6, 9, 9, 8);
    line(9, 8, 10, up ? 4 : 5);
  } else {
    line(6, 9, 8 + sw, 13);
  }
  // legs: they stride while he walks and stand together when he stops
  const lift = walking && sw === 0 ? (step % 4 === 1 ? 1 : 2) : 0; // which foot is off the ground as the legs pass
  const left = walking ? 4 + 2 * sw : 4;
  const right = walking ? 8 - 2 * sw : 8;
  line(6, 14, left, lift === 1 ? 20 : 21);
  line(6, 14, right, lift === 2 ? 20 : 21);
  dot(left + 1, lift === 1 ? 20 : 21);
  dot(right + 1, lift === 2 ? 20 : 21);

  return [...g].map(([k, c]) => {
    const [x, y] = k.split(",").map(Number);
    return { x, y, c };
  });
}

/** A blocky 4 x 5 font for the speech (W is 5 wide), plus a chevron for "down". */
const FONT: Record<string, string[]> = {
  S: [".###", "#...", ".##.", "...#", "###."],
  C: [".###", "#...", "#...", "#...", ".###"],
  R: ["###.", "#..#", "###.", "#.#.", "#..#"],
  O: [".##.", "#..#", "#..#", "#..#", ".##."],
  L: ["#...", "#...", "#...", "#...", "####"],
  D: ["###.", "#..#", "#..#", "#..#", "###."],
  W: ["#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
  N: ["#..#", "##.#", "#.##", "#..#", "#..#"],
};
export const CHEVRON = ["#...#", ".#.#.", "..#.."];

export const SPEECH = ["SCROLL", "DOWN"];
export const SPEECH_CHARS = SPEECH.join("").length;
const GLYPH_H = 5;
const LINE_GAP = 2;
const CHEVRON_GAP = 2; // empty rows between the lines of speech and the chevron

/** Width of a line of speech in pixels: its letters, with one empty column between them. */
export const textWidth = (s: string) => [...s].reduce((w, ch) => w + FONT[ch][0].length, 0) + (s.length - 1);

/** Height of the whole message: the lines, then a gap and the chevron. */
export const MESSAGE_H = SPEECH.length * GLYPH_H + (SPEECH.length - 1) * LINE_GAP + CHEVRON_GAP + CHEVRON.length;

/** The lit pixels of the speech lines, each line centred on `cx`, starting at row `y0`, for the first `shown` letters. */
export function speechPixels(cx: number, y0: number, shown: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let n = 0;
  SPEECH.forEach((line, li) => {
    let x = Math.round(cx - textWidth(line) / 2);
    const y = y0 + li * (GLYPH_H + LINE_GAP);
    for (const ch of line) {
      if (n++ >= shown) return;
      FONT[ch].forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#") out.push({ x: x + rx, y: y + ry });
      });
      x += FONT[ch][0].length + 1;
    }
  });
  return out;
}

/** Where the chevron sits (top-left), centred on `cx`, below the lines that start at `y0`. */
export const chevronAt = (cx: number, y0: number) => ({
  x: Math.round(cx - CHEVRON[0].length / 2),
  y: y0 + SPEECH.length * GLYPH_H + (SPEECH.length - 1) * LINE_GAP + CHEVRON_GAP,
});

/* ---- the cloud ---- */

const OX = 2; // the cloud's shapes are drawn on a small grid and nudged in from the edge by this much
const OY = 2;
export const CLOUD_W = 48;
export const CLOUD_H = 35;
/** The message is centred on this column and starts on this row, so it sits in the middle of the cloud. */
export const TEXT_CX = 22 + OX;
export const TEXT_Y0 = Math.floor(14 + OY - MESSAGE_H / 2);
/** Where the tail of small bubbles leaves the cloud, in cloud pixels. */
export const TAIL_FROM = { x: 12, y: 31 };

const CIRCLES: [number, number, number][] = (
  [
    [8, 9, 5], [36, 9, 5], [8, 19, 5], [36, 19, 5], // the corners
    [14, 4, 4], [22, 2.5, 4.5], [30, 4, 4], // bumps along the top
    [13, 24, 4], [22, 26, 4.5], [31, 24, 4], // and the bottom
    [4, 14, 5], [40, 14, 5], // and the sides
  ] as [number, number, number][]
).map(([x, y, r]) => [x + OX, y + OY, r]);
const RECTS: [number, number, number, number][] = [
  [8 + OX, 4 + OY, 36 + OX, 24 + OY],
  [3 + OX, 9 + OY, 41 + OX, 19 + OY],
];

export type CloudCell = { x: number; y: number; edge: boolean; d: number };

/**
 * The cloud and its tail as pixels, in cloud coordinates (the tail reaches to `mouth`, usually left of and below the cloud).
 * Each cell carries its distance from the mouth, so the cloud can grow outward from it when it pops up.
 */
export function cloudCells(mouth: { x: number; y: number }): { cells: CloudCell[]; maxD: number } {
  const tail: [number, number, number][] = [0.3, 0.6, 0.85].map((t, i) => [
    TAIL_FROM.x + (mouth.x - TAIL_FROM.x) * t,
    TAIL_FROM.y + (mouth.y - TAIL_FROM.y) * t,
    [3.2, 2.3, 1.6][i],
  ]);
  const inside = (x: number, y: number) => {
    const px = x + 0.5;
    const py = y + 0.5;
    for (const [x0, y0, x1, y1] of RECTS) if (px >= x0 && px <= x1 && py >= y0 && py <= y1) return true;
    for (const [cx, cy, r] of [...CIRCLES, ...tail]) if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) return true;
    return false;
  };
  const minX = Math.floor(Math.min(0, mouth.x - 3));
  const maxX = CLOUD_W;
  const maxY = Math.ceil(Math.max(CLOUD_H, mouth.y + 3));
  const cells: CloudCell[] = [];
  let maxD = 1;
  for (let y = 0; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      if (!inside(x, y)) continue;
      const edge = !inside(x + 1, y) || !inside(x - 1, y) || !inside(x, y + 1) || !inside(x, y - 1);
      const d = Math.hypot(x - mouth.x, y - mouth.y);
      if (d > maxD) maxD = d;
      cells.push({ x, y, edge, d });
    }
  }
  return { cells, maxD };
}

export const CLOUD_COLORS = { fill: "#ffffff", edge: "#1a0a14", ink: "#1a0a14", arrow: "#6b6b75" };
