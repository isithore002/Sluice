const GLYPHS = {
  // small 7 x 7 pixel marks, drawn here so nothing is borrowed from anyone's brand
  disc: ["..###..", ".#####.", "#######", "#######", "#######", ".#####.", "..###.."],
  bolt: ["...###.", "..###..", ".###...", ".#####.", "...###.", "..##...", ".#....."],
  wing: ["##...##", "###.###", "#######", ".#####.", "#######", "###.###", "##...##"],
  diamond: ["...#...", "..###..", ".#####.", "#######", ".#####.", "..###..", "...#..."],
} as const;

export type GlyphName = keyof typeof GLYPHS;

/** A tiny pixel-art mark, in the colour of the text around it unless told otherwise. */
export function PixelGlyph({ name, className }: { name: GlyphName; className?: string }) {
  const rows = GLYPHS[name];
  return (
    <svg className={className} viewBox="0 0 7 7" width="22" height="22" aria-hidden="true" shapeRendering="crispEdges">
      {rows.flatMap((row, y) => [...row].map((c, x) => (c === "#" ? <rect key={`${x}-${y}`} x={x} y={y} width="1" height="1" fill="currentColor" /> : null)))}
    </svg>
  );
}
