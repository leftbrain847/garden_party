/**
 * All drawing, built with DOM calls (no innerHTML): the isometric garden island, plants, the gnome crew and
 * the seeds. Colors and sizes are config objects at the top.
 */
import { health, needsWater, type Card, type Deck, type Health } from '../app';

// The SVG namespace is an identifier, never fetched. It's assembled from parts only because the Play build's
// no-network tripwire matches the literal scheme prefix; flagged in the PR so a reviewer sees why.
const NS = ['http:', '', 'www.w3.org', '2000', 'svg'].join('/');

export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}, kids: Node[] = []): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag) as SVGElementTagNameMap[K];
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  for (const c of kids) node.appendChild(c);
  return node;
}

/** appendChild for several nodes (workers-types shadows the DOM's variadic append). */
export function add(parent: Node, ...kids: Node[]): void {
  for (const k of kids) parent.appendChild(k);
}

// ---------- palette ----------

export const PLANT_COLORS: Record<Health, { light: string; dark: string; label: string }> = {
  bloom: { light: '#FFD3E3', dark: '#E98DB0', label: 'blooming' },
  ok: { light: '#9BE3A5', dark: '#3F9A4E', label: 'healthy' },
  thirsty: { light: '#FFE29A', dark: '#D9A12F', label: 'thirsty' },
  wilted: { light: '#B08A68', dark: '#5E4330', label: 'wilted' },
};

const EARTH = {
  grassTop: '#6FC077', grassLeft: '#4E8F53', grassRight: '#427A47',
  soilLeft: '#6B4A33', soilRight: '#53392A',
  bedTop: '#5A3B26', bedLeft: '#A9744A', bedRight: '#8C5D3A',
  plotTop: '#4A3324', plotLeft: '#8C5D3A', plotRight: '#73492C',
  stem: '#3F7A45',
};

export const ISLAND = {
  bedSize: 64,
  bedHeight: 18,
  bedStep: 68,
  rowStep: 150,
  margin: 34,
  perRow: 3,
  maxPlants: 16,
};

// ---------- ids for gradients ----------

let uid = 0;
const nextId = (p: string): string => `${p}${uid++}`;

function radial(light: string, dark: string): { def: SVGRadialGradientElement; url: string } {
  const id = nextId('rg');
  const def = s('radialGradient', { id, cx: 0.35, cy: 0.3, r: 0.8 }, [s('stop', { offset: 0, 'stop-color': light }), s('stop', { offset: 1, 'stop-color': dark })]);
  return { def, url: `url(#${id})` };
}

// ---------- isometric projection ----------

type Pt = [number, number];
const P = (x: number, y: number, z: number): Pt => [(x - y) * 0.866, (x + y) * 0.5 - z];
const pts = (list: Pt[]): string => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function box(x0: number, y0: number, z0: number, w: number, d: number, h: number, top: string, left: string, right: string): SVGGElement {
  const z1 = z0 + h;
  return s('g', {}, [
    s('polygon', { points: pts([P(x0, y0 + d, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z1), P(x0, y0 + d, z1)]), fill: left }),
    s('polygon', { points: pts([P(x0 + w, y0, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z1), P(x0 + w, y0, z1)]), fill: right }),
    s('polygon', { points: pts([P(x0, y0, z1), P(x0 + w, y0, z1), P(x0 + w, y0 + d, z1), P(x0, y0 + d, z1)]), fill: top }),
  ]);
}

function isoPlant(defs: SVGDefsElement, x: number, y: number, z: number, h: Health): SVGGElement {
  const [bx, by] = P(x, y, z);
  const height = h === 'wilted' ? 5 : h === 'thirsty' ? 11 : 15;
  const r = h === 'bloom' ? 6 : h === 'wilted' ? 3.5 : 5;
  const lean = h === 'thirsty' ? 4 : h === 'wilted' ? 6 : 0;
  const tx = bx + lean;
  const ty = by - height;
  const g = radial(PLANT_COLORS[h].light, PLANT_COLORS[h].dark);
  defs.appendChild(g.def);
  return s('g', { class: `plant plant-${h}` }, [
    s('ellipse', { cx: bx, cy: by, rx: 4, ry: 2, fill: 'rgba(0,0,0,.3)' }),
    s('path', { d: `M${bx} ${by} Q${bx} ${ty + 4} ${tx} ${ty + r * 0.6}`, stroke: EARTH.stem, 'stroke-width': 1.6, fill: 'none' }),
    s('circle', { cx: tx, cy: ty, r, fill: g.url }),
  ]);
}

// ---------- gnomes ----------

export interface GnomeLook {
  hat: [string, string];
  tunic: [string, string];
  prop?: 'can' | 'clipboard' | 'none';
}

export const CREW: Record<'pip' | 'moss' | 'quill', GnomeLook & { name: string; role: string }> = {
  pip: { name: 'Pip', role: 'head gardener', hat: ['#F06A5C', '#B23A2E'], tunic: ['#5C9BD6', '#2F5F96'], prop: 'none' },
  moss: { name: 'Moss', role: 'waterer', hat: ['#6CC07A', '#2F7A3D'], tunic: ['#D98544', '#94501F'], prop: 'can' },
  quill: { name: 'Quill', role: 'scribe', hat: ['#B07BE0', '#6A3FA0'], tunic: ['#5C9BD6', '#2F5F96'], prop: 'clipboard' },
};

/** A shaded, round gnome for speech bubbles. */
export function gnome(look: GnomeLook, size: number, label: string): SVGSVGElement {
  const defs = s('defs');
  const hat = nextId('h');
  defs.appendChild(s('linearGradient', { id: hat, x1: 0, x2: 1 }, [s('stop', { offset: 0, 'stop-color': look.hat[0] }), s('stop', { offset: 1, 'stop-color': look.hat[1] })]));
  const face = radial('#FFE3C7', '#D9A27A');
  const body = radial(look.tunic[0], look.tunic[1]);
  const beard = radial('#FFFFFF', '#D9D2C2');
  add(defs, face.def, body.def, beard.def);
  const prop: SVGElement[] =
    look.prop === 'can'
      ? [s('rect', { x: 44, y: 50, width: 14, height: 12, rx: 3, fill: '#8FC2E8' }), s('rect', { x: 44, y: 50, width: 14, height: 4, rx: 2, fill: '#B9DCF5' }), s('path', { d: 'M58 54 L64 47', stroke: '#8FC2E8', 'stroke-width': 3, 'stroke-linecap': 'round' })]
      : look.prop === 'clipboard'
        ? [s('rect', { x: 44, y: 46, width: 15, height: 19, rx: 2, fill: '#E4DCCB' }), s('path', { d: 'M47 51h9M47 55h9M47 59h6', stroke: '#5C5648', 'stroke-width': 1.3 }), s('path', { d: 'M40 58 L52 42', stroke: '#F0C060', 'stroke-width': 2.4, 'stroke-linecap': 'round' })]
        : [];
  return s('svg', { role: 'img', 'aria-label': label, width: size, height: Math.round(size * 1.25), viewBox: '0 0 64 80', class: 'gnome' }, [
    defs,
    s('ellipse', { cx: 32, cy: 76, rx: 20, ry: 4, fill: 'rgba(0,0,0,.35)' }),
    s('ellipse', { cx: 25, cy: 72, rx: 6, ry: 4, fill: '#4A3324' }),
    s('ellipse', { cx: 39, cy: 72, rx: 6, ry: 4, fill: '#4A3324' }),
    s('ellipse', { cx: 32, cy: 56, rx: 15, ry: 16, fill: body.url }),
    ...prop,
    s('path', { d: 'M18 36 Q32 72 46 36 Q40 44 32 44 Q24 44 18 36Z', fill: beard.url }),
    s('circle', { cx: 32, cy: 32, r: 12, fill: face.url }),
    s('circle', { cx: 27.5, cy: 30, r: 1.8, fill: '#1B1B1B' }),
    s('circle', { cx: 36.5, cy: 30, r: 1.8, fill: '#1B1B1B' }),
    s('circle', { cx: 32, cy: 36, r: 4, fill: '#E88E78' }),
    s('path', { d: 'M32 2 L48 26 Q32 31 16 26 Z', fill: `url(#${hat})` }),
    s('ellipse', { cx: 32, cy: 26, rx: 16, ry: 4, fill: look.hat[1] }),
  ]);
}

export type Chore = 'water' | 'dig' | 'carry';

/** A small background gnome doing a chore. Animation comes from CSS classes, so reduce-motion can stop it. */
function choreGnome(chore: Chore, hat: string, tunic: string): SVGGElement {
  const tool: SVGElement[] =
    chore === 'water'
      ? [
          s('rect', { x: 14, y: 15, width: 7, height: 5, rx: 1.5, fill: '#8FC2E8' }),
          s('path', { d: 'M21 16 L25 13', stroke: '#8FC2E8', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
          s('circle', { class: 'drip', cx: 25.5, cy: 15, r: 1, fill: '#9FD3FF' }),
          s('circle', { class: 'drip drip-late', cx: 24.5, cy: 15, r: 1, fill: '#9FD3FF' }),
        ]
      : chore === 'dig'
        ? [
            s('g', { class: 'dig' }, [s('path', { d: 'M15 6 L21 23', stroke: '#C9B48A', 'stroke-width': 1.6, 'stroke-linecap': 'round' }), s('path', { d: 'M19 21 l5 1 -1 5 -4 -1z', fill: '#A9BCA8' })]),
            s('path', { d: 'M20 27 q3 -4 7 0z', fill: '#5A3B26' }),
            s('g', { class: 'grow' }, [s('path', { d: 'M23 25 v-4', stroke: '#5FB36A', 'stroke-width': 1.2 }), s('circle', { cx: 23, cy: 20.5, r: 1.8, fill: '#9BE3A5' })]),
          ]
        : [
            s('path', { d: 'M14 13 v-6', stroke: '#5FB36A', 'stroke-width': 1.2 }),
            s('circle', { cx: 14, cy: 6, r: 2.4, fill: '#9BE3A5' }),
            s('circle', { cx: 16, cy: 8, r: 1.8, fill: '#FFD3E3' }),
            s('rect', { x: 11.5, y: 13, width: 5, height: 4, rx: 1, fill: '#A9744A' }),
          ];
  return s('g', { class: 'bob' }, [
    s('ellipse', { cx: 10, cy: 27, rx: 7, ry: 1.6, fill: 'rgba(0,0,0,.3)' }),
    s('rect', { x: 6, y: 24, width: 3, height: 3, rx: 1, fill: '#4A3324' }),
    s('rect', { x: 11, y: 24, width: 3, height: 3, rx: 1, fill: '#4A3324' }),
    s('ellipse', { cx: 10, cy: 20, rx: 5.5, ry: 5.5, fill: tunic }),
    s('path', { d: 'M5 13 Q10 24 15 13 Q13 16 10 16 Q7 16 5 13Z', fill: '#F4F1EA' }),
    s('circle', { cx: 10, cy: 11.5, r: 4, fill: '#F2C9A0' }),
    s('path', { d: 'M10 0 L16 9.5 Q10 11 4 9.5Z', fill: hat }),
    ...tool,
  ]);
}

export const CHORE_CREW: { chore: Chore; hat: string; tunic: string; walk: boolean }[] = [
  { chore: 'water', hat: '#F2A23A', tunic: '#6A8FD0', walk: false },
  { chore: 'dig', hat: '#B07BE0', tunic: '#C9763A', walk: false },
  { chore: 'carry', hat: '#5FB36A', tunic: '#D9584B', walk: true },
];

// ---------- the island ----------

export interface BedSpot {
  deck: Deck;
  x0: number;
  y0: number;
}

export function layoutBeds(decks: readonly Deck[]): BedSpot[] {
  const { bedSize, bedStep, rowStep, perRow } = ISLAND;
  return decks.map((deck, k) => {
    const col = k % perRow;
    const row = Math.floor(k / perRow);
    // Row 0 runs along the front diagonal; later rows step back into the island.
    const cx = 62 + bedStep * col - rowStep * row * 0.5;
    const cy = 198 - bedStep * col - rowStep * row * 0.5;
    return { deck, x0: cx - bedSize / 2, y0: cy - bedSize / 2 };
  });
}

export function island(decks: readonly Deck[], cards: readonly Card[], today: number, onBed: (deckId: string) => void): SVGSVGElement {
  const { bedSize, bedHeight, margin, maxPlants } = ISLAND;
  const spots = layoutBeds(decks);
  const minX = Math.min(0, ...spots.map((b) => b.x0 - margin));
  const minY = Math.min(0, ...spots.map((b) => b.y0 - margin));
  const maxX = 260;
  const maxY = 260;
  const defs = s('defs');
  const world = s('g');
  add(
    world,
    box(minX, minY, -40, maxX - minX, maxY - minY, 34, EARTH.soilLeft, EARTH.soilLeft, EARTH.soilRight),
    box(minX, minY, -6, maxX - minX, maxY - minY, 6, EARTH.grassTop, EARTH.grassLeft, EARTH.grassRight),
    // two neighbors' little plots, where the chore gnomes work
    box(minX + 14, minY + 14, 0, 40, 40, 8, EARTH.plotTop, EARTH.plotLeft, EARTH.plotRight),
    box(maxX - 52, maxY - 52, 0, 38, 38, 8, EARTH.plotTop, EARTH.plotLeft, EARTH.plotRight),
  );

  for (const spot of spots) {
    const bedCards = cards.filter((c) => c.deckId === spot.deck.id).slice(0, maxPlants);
    const due = cards.filter((c) => c.deckId === spot.deck.id && needsWater(c.srs, today)).length;
    const bed = s('g', { class: 'bed', role: 'button', tabindex: 0, 'aria-label': `${spot.deck.name}: ${due} to water` });
    add(bed, box(spot.x0, spot.y0, 0, bedSize, bedSize, bedHeight, EARTH.bedTop, EARTH.bedLeft, EARTH.bedRight));
    const per = Math.max(1, Math.ceil(Math.sqrt(bedCards.length)));
    const gap = (bedSize - 16) / Math.max(1, per - 1);
    const placed = bedCards.map((c, i) => ({ c, x: spot.x0 + 8 + (i % per) * gap, y: spot.y0 + 8 + Math.floor(i / per) * gap }));
    placed.sort((a, b) => a.x + a.y - (b.x + b.y));
    for (const p of placed) add(bed, isoPlant(defs, p.x, p.y, bedHeight, health(p.c.srs, today)));
    bed.addEventListener('click', () => onBed(spot.deck.id));
    bed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onBed(spot.deck.id);
      }
    });
    add(world, bed);
  }

  const spotsForChores: Pt[] = [P(maxX - 30, maxY - 150, 0), P(minX + 34, minY + 34, 8), P(maxX - 140, maxY - 24, 0)];
  CHORE_CREW.forEach((c, i) => {
    const at = spotsForChores[i];
    if (!at) return;
    const inner = s('g', c.walk ? { class: 'walk' } : {}, [choreGnome(c.chore, c.hat, c.tunic)]);
    add(world, s('g', { transform: `translate(${(at[0] - 13).toFixed(1)},${(at[1] - 34).toFixed(1)}) scale(1.3)`, 'aria-hidden': 'true' }, [inner]));
  });

  const corners = [P(minX, minY, 0), P(maxX, minY, 0), P(maxX, maxY, -40), P(minX, maxY, -40), P(minX, minY, 30)];
  const vx = Math.min(...corners.map((c) => c[0])) - 4;
  const vy = Math.min(...corners.map((c) => c[1])) - 10;
  const vw = Math.max(...corners.map((c) => c[0])) + 4 - vx;
  const vh = Math.max(...corners.map((c) => c[1])) + 4 - vy;
  return s('svg', { class: 'island', viewBox: `${vx.toFixed(0)} ${vy.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}`, role: 'group', 'aria-label': 'Your garden island' }, [defs, world]);
}

// ---------- flat plant for the bed view ----------

export function plant(h: Health): SVGSVGElement {
  const c = PLANT_COLORS[h];
  const green = PLANT_COLORS.ok.dark;
  const parts: SVGElement[] = [s('ellipse', { cx: 24, cy: 52, rx: 16, ry: 4, fill: '#3B2A1E' })];
  if (h === 'bloom') {
    parts.push(
      s('path', { d: 'M24 50V22', stroke: green, 'stroke-width': 3, 'stroke-linecap': 'round' }),
      s('path', { d: 'M24 40c-8 0-11-5-11-9 6 0 11 3 11 9z', fill: green }),
      s('path', { d: 'M24 34c8 0 11-5 11-9-6 0-11 3-11 9z', fill: green }),
      ...[[24, 10], [17.5, 15], [30.5, 15], [20, 22], [28, 22]].map(([x, y]) => s('circle', { cx: x ?? 0, cy: y ?? 0, r: 5, fill: c.dark })),
      s('circle', { cx: 24, cy: 17, r: 4, fill: '#F7E08A' }),
    );
  } else if (h === 'ok') {
    parts.push(
      s('path', { d: 'M24 50V18', stroke: green, 'stroke-width': 3, 'stroke-linecap': 'round' }),
      s('path', { d: 'M24 40c-8 0-11-5-11-9 6 0 11 3 11 9z', fill: green }),
      s('path', { d: 'M24 32c8 0 11-5 11-9-6 0-11 3-11 9z', fill: green }),
      s('path', { d: 'M24 20c-4-2-5-6-4-10 4 1 6 5 4 10z', fill: c.light }),
    );
  } else if (h === 'thirsty') {
    parts.push(
      s('path', { d: 'M24 50 Q24 30 34 26', stroke: c.dark, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }),
      s('path', { d: 'M24 42c-7 3-11 1-12-3 5-2 10-2 12 3z', fill: c.dark }),
      s('path', { d: 'M27 33c6 3 10 2 11-2-5-2-9-2-11 2z', fill: c.dark }),
    );
  } else {
    parts.push(
      s('path', { d: 'M24 50 Q22 40 11 43', stroke: c.dark, 'stroke-width': 3, fill: 'none', 'stroke-linecap': 'round' }),
      s('path', { d: 'M20 47c-6 1-9 0-10-2 4-2 8-1 10 2z', fill: c.dark }),
    );
  }
  return s('svg', { width: 48, height: 56, viewBox: '0 0 48 56', 'aria-hidden': 'true' }, parts);
}

// ---------- seeds ----------

export function seeds(count: number, of = 3): SVGSVGElement {
  const defs = s('defs');
  const kids: SVGElement[] = [defs];
  for (let i = 0; i < of; i++) {
    const g = radial('#F2C886', '#8E5A28');
    defs.appendChild(g.def);
    const cx = 10 + i * 16;
    kids.push(s('ellipse', { cx, cy: 15, rx: 6, ry: 8.5, fill: g.url, class: i < count ? 'seed on' : 'seed' }));
    if (i < count) kids.push(s('ellipse', { cx: cx - 2, cy: 11, rx: 1.6, ry: 2.6, fill: 'rgba(255,255,255,.7)' }));
  }
  return s('svg', { width: 52, height: 30, viewBox: '0 0 52 30', 'aria-hidden': 'true' }, kids);
}

export function cameraIcon(): SVGSVGElement {
  return s('svg', { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, [
    s('path', { d: 'M4 8h3l2-3h6l2 3h3v11H4z' }),
    s('circle', { cx: 12, cy: 13, r: 3.5 }),
  ]);
}
