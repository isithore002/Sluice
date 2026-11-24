/* The bitmap letters for the stick man's speech and the cloud he speaks in. All of it is plain data and pure functions, so the
 * canvas code in Intro.tsx only has to place and paint it. */

/** A small blocky 4 x 5 font for the speech (W is 5 wide). */
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
const CHEVRON = ["#...#", ".#.#.", "..#.."];

export const SPEECH = ["SCROLL", "DOWN"];
export const SPEECH_CHARS = SPEECH.join("").length;
const GLYPH_H = 5;
const LINE_GAP = 2;
const CHEVRON_GAP = 3; // empty rows between the lines of speech and the chevron

/** Width of a line of speech in pixels: its letters, with one empty column between them. */
const lineWidth = (s: string) => [...s].reduce((w, ch) => w + FONT[ch][0].length, 0) + (s.length - 1);

/** The lines of speech fill a box this many font pixels wide and tall: that box is what gets centred in the cloud. */
export const MESSAGE_W = Math.max(...SPEECH.map(lineWidth));
export const MESSAGE_H = SPEECH.length * GLYPH_H + (SPEECH.length - 1) * LINE_GAP;

export type Dot = { x: number; y: number };

/**
 * The message as lit pixels, measured from the top-left of the lines' box (MESSAGE_W x MESSAGE_H), with each line centred in
 * it. `shown` is how many letters have been typed so far. The chevron sits below the box and arrives with the last letter,
 * so the words themselves are what sit in the middle of the cloud.
 */
export function speechLayout(shown: number): { text: Dot[]; chevron: Dot[] } {
  const text: Dot[] = [];
  let n = 0;
  SPEECH.forEach((line, li) => {
    let x = (MESSAGE_W - lineWidth(line)) / 2;
    const y = li * (GLYPH_H + LINE_GAP);
    for (const ch of line) {
      if (n++ >= shown) return;
      FONT[ch].forEach((row, ry) => {
        for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#") text.push({ x: x + rx, y: y + ry });
      });
      x += FONT[ch][0].length + 1;
    }
  });
  const chevron: Dot[] = [];
  if (shown >= SPEECH_CHARS) {
    const cx = (MESSAGE_W - CHEVRON[0].length) / 2;
    const cy = MESSAGE_H + CHEVRON_GAP;
    CHEVRON.forEach((row, ry) => {
      for (let rx = 0; rx < row.length; rx++) if (row[rx] === "#") chevron.push({ x: cx + rx, y: cy + ry });
    });
  }
  return { text, chevron };
}

/* ---- the cloud ---- */

const K = 1.1; // the size of the cloud, relative to the base shapes below
const OX = 2; // the shapes are nudged in from the edge by this much
const OY = 2;
export const CLOUD_W = 46;
export const CLOUD_H = 33;
/** The middle of the cloud's body, in cloud pixels: the words are centred exactly here. */
export const CLOUD_CENTER = { x: 19 * K + OX, y: 13 * K + OY };
/** Where the tail of small bubbles leaves the cloud, in cloud pixels. */
export const TAIL_FROM = { x: 11, y: 28 };

const CIRCLES: [number, number, number][] = (
  [
    [7, 8, 5], [31, 8, 5], [7, 18, 5], [31, 18, 5], // the corners
    [12, 3, 3.5], [19, 1.8, 4], [26, 3, 3.5], // bumps along the top
    [11, 21, 3.5], [19, 23, 4], [27, 21, 3.5], // and the bottom
    [3, 13, 4.5], [35, 13, 4.5], // and the sides
  ] as [number, number, number][]
).map(([x, y, r]) => [x * K + OX, y * K + OY, r * K]);
const RECTS: [number, number, number, number][] = (
  [
    [7, 3, 31, 23],
    [2, 8, 36, 18],
  ] as [number, number, number, number][]
).map(([x0, y0, x1, y1]) => [x0 * K + OX, y0 * K + OY, x1 * K + OX, y1 * K + OY]);

export type CloudCell = { x: number; y: number; edge: boolean; d: number };

/**
 * The cloud and its tail as pixels, in cloud coordinates (the tail reaches to `mouth`, usually left of and below the cloud).
 * Each cell carries its distance from the mouth, so the cloud can grow outward from it when it pops up.
 */
export function cloudCells(mouth: { x: number; y: number }): { cells: CloudCell[]; maxD: number } {
  const tail: [number, number, number][] = [0.3, 0.6, 0.85].map((t, i) => [
    TAIL_FROM.x + (mouth.x - TAIL_FROM.x) * t,
    TAIL_FROM.y + (mouth.y - TAIL_FROM.y) * t,
    [3, 2.2, 1.5][i],
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

export const CLOUD_COLORS = { fill: "#ffffff", edge: "#0d0507", ink: "#0d0507", arrow: "#55555f" };
