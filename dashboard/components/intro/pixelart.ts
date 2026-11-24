/* The pixel man, the bitmap letters for his speech and the cloud he speaks in. All of it is plain data and pure functions,
 * so the canvas code in Intro.tsx only has to place and paint it. Sprite and cloud pixels are in their own small grids. */

export type Px = { x: number; y: number; c: string };

const C = {
  h: "#2a1620", // hair
  s: "#f8c8b0", // skin
  e: "#1a0a14", // eye
  m: "#9a3a40", // open mouth
  r: "#e0505a", // scarf
  c: "#ffe8d0", // coat
  b: "#7a2420", // belt
  p: "#5a2a52", // trousers
  o: "#1a0a14", // boots
  out: "#1a0a14", // outline
} as const;

export const MAN_W = 10;
export const MAN_H = 18;

// Head, scarf, coat and belt, facing right. Legs and arms are added per frame.
const BODY = [
  "...hhhh...",
  "..hhhhhh..",
  "..hhhhss..",
  "..hhssss..",
  "..hhsess..",
  "...hsssss.",
  "....ssss..", // row 6 is the mouth row
  "...rrrrr..",
  "..cccccc..",
  "..cccccc..",
  "..cccccc..",
  "..cccccc..",
  "..bbbbbb..",
  "..pppppp..",
];
export const MOUTH_ROW = 6;
export const MOUTH_COL = 5;

export type ManPose = { step: number; walking: boolean; talking: boolean; waving: boolean };

/** The man for one frame, outlined so he reads against a bright sky. */
export function buildMan({ step, walking, talking, waving }: ManPose): Px[] {
  const g = new Map<string, string>();
  const set = (x: number, y: number, c: string) => g.set(`${x},${y}`, c);
  BODY.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const k = row[x];
      if (k !== ".") set(x, y, C[k as keyof typeof C]);
    }
  });
  if (talking) set(MOUTH_COL, MOUTH_ROW, C.m);

  const phase = walking ? step % 4 : 0;
  const swing = walking ? [-1, 0, 1, 0][phase] : 0;
  // back arm
  for (let y = 9; y <= 11; y++) set(1 + (walking ? -swing : 0), y, C.c);
  set(1 + (walking ? -swing : 0), 12, C.s);
  // front arm: swings while walking, waves while talking
  if (waving) {
    const up = step % 2 === 0;
    for (let y = up ? 5 : 6; y <= 9; y++) set(9, y, C.c);
    set(9, up ? 4 : 5, C.s);
  } else {
    for (let y = 9; y <= 11; y++) set(8 + (walking ? swing : 0), y, C.c);
    set(8 + (walking ? swing : 0), 12, C.s);
  }
  // legs
  const lx = walking ? swing : 0;
  for (const [x0, off] of [[3, lx], [5, -lx]] as const) {
    for (let y = 14; y <= 16; y++) {
      set(x0 + off, y, C.p);
      set(x0 + off + 1, y, C.p);
    }
    set(x0 + off, 17, C.o);
    set(x0 + off + 1, 17, C.o);
  }

  const px: Px[] = [];
  const solid = [...g.keys()]; // a snapshot: the outline is added after it, never while walking it
  for (const k of solid) {
    const [x, y] = k.split(",").map(Number);
    px.push({ x, y, c: g.get(k)! });
  }
  const edge = new Set<string>();
  for (const k of solid) {
    const [x, y] = k.split(",").map(Number);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nk = `${x + dx},${y + dy}`;
      if (!g.has(nk) && !edge.has(nk)) {
        edge.add(nk);
        px.push({ x: x + dx, y: y + dy, c: C.out });
      }
    }
  }
  return px;
}

/** 5 x 7 letters for the speech, plus a chevron for "down". */
const FONT: Record<string, string[]> = {
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  C: [".###.", "#...#", "#....", "#....", "#....", "#...#", ".###."],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  N: ["#...#", "##..#", "##..#", "#.#.#", "#..##", "#..##", "#...#"],
};
export const CHEVRON = ["#.....#", ".#...#.", "..#.#..", "...#..."];

export const SPEECH = ["SCROLL", "DOWN"];
export const SPEECH_CHARS = SPEECH.join("").length;

export const textWidth = (s: string) => s.length * 6 - 1;

/** The lit pixels of the speech lines, centred on `cx`, starting at row `y0`, for the first `shown` letters. */
export function speechPixels(cx: number, y0: number, shown: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let n = 0;
  SPEECH.forEach((line, li) => {
    const x0 = Math.round(cx - textWidth(line) / 2);
    const y = y0 + li * 9;
    for (let i = 0; i < line.length; i++) {
      if (n++ >= shown) return;
      FONT[line[i]].forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#") out.push({ x: x0 + i * 6 + rx, y: y + ry });
      });
    }
  });
  return out;
}

/** Where the chevron sits (top-left), for a cloud centred on `cx`, below the two lines that start at `y0`. */
export const chevronAt = (cx: number, y0: number) => ({ x: Math.round(cx - CHEVRON[0].length / 2), y: y0 + 9 * SPEECH.length + 1 });

/* ---- the cloud ---- */

export const CLOUD_W = 52;
export const CLOUD_H = 38;
/** The cloud's text is centred on this column and starts on this row. */
export const TEXT_CX = 26;
export const TEXT_Y0 = 6;
/** Where the tail of small bubbles leaves the cloud, in cloud pixels. */
export const TAIL_FROM = { x: 12, y: 35 };

const CIRCLES: [number, number, number][] = [
  [10, 11, 6], [41, 11, 6], [10, 25, 6], [41, 25, 6], // the corners
  [17, 5, 5], [26, 3, 6], [35, 5, 5], // bumps along the top
  [16, 31, 5], [26, 33, 5.5], [36, 31, 5], // and the bottom
  [5, 18, 6], [46, 18, 6], // and the sides
];
const RECTS: [number, number, number, number][] = [[10, 5, 41, 31], [4, 11, 47, 25]];

export type CloudCell = { x: number; y: number; edge: boolean; d: number };

/**
 * The cloud and its tail as pixels, in cloud coordinates (the tail reaches to `mouth`, usually left of and below the cloud).
 * Each cell carries its distance from the mouth, so the cloud can grow outward from it when it pops up.
 */
export function cloudCells(mouth: { x: number; y: number }): { cells: CloudCell[]; maxD: number } {
  const tail: [number, number, number][] = [0.3, 0.6, 0.85].map((t, i) => [
    TAIL_FROM.x + (mouth.x - TAIL_FROM.x) * t,
    TAIL_FROM.y + (mouth.y - TAIL_FROM.y) * t,
    [3.6, 2.5, 1.7][i],
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

export const CLOUD_COLORS = { fill: "#fff6d8", edge: "#1a0a14", ink: "#2a1620", arrow: "#c0606a" };
