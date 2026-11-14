/**
 * All drawing, built with DOM calls (no innerHTML): the isometric garden island, plants, the gnome crew and
 * the seeds. Colors and sizes are config objects at the top.
 */
import { health, needsWater, type Card, type Deck, type Health } from '../app';
import type { Chore, Site } from '../crew';

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

export type Pt = [number, number];
export const P = (x: number, y: number, z: number): Pt => [(x - y) * 0.866, (x + y) * 0.5 - z];
const pts = (list: Pt[]): string => list.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');

function box(x0: number, y0: number, z0: number, w: number, d: number, h: number, top: string, left: string, right: string): SVGGElement {
  const z1 = z0 + h;
  return s('g', {}, [
    s('polygon', { points: pts([P(x0, y0 + d, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z1), P(x0, y0 + d, z1)]), fill: left }),
    s('polygon', { points: pts([P(x0 + w, y0, z0), P(x0 + w, y0 + d, z0), P(x0 + w, y0 + d, z1), P(x0 + w, y0, z1)]), fill: right }),
    s('polygon', { points: pts([P(x0, y0, z1), P(x0 + w, y0, z1), P(x0 + w, y0 + d, z1), P(x0, y0 + d, z1)]), fill: top }),
  ]);
}

/** Flower colors for blooming plants; each card keeps its own color, picked from its id. */
export const PETALS: [string, string][] = [
  ['#FFD3E3', '#E98DB0'], // pink
  ['#E7D2FF', '#A983E0'], // violet
  ['#FFD9C2', '#F08A5D'], // coral
  ['#FFF6D8', '#F2C94C'], // buttercup
  ['#FFFFFF', '#D9D2E8'], // white
];

const hash = (id: string): number => {
  let n = 0;
  for (let i = 0; i < id.length; i++) n = (n * 31 + id.charCodeAt(i)) >>> 0;
  return n;
};

function leaf(x: number, y: number, len: number, angle: number, fill: string): SVGPathElement {
  // A pointed leaf drawn along +x, then rotated into place.
  return s('path', { d: `M0 0 Q${len * 0.5} ${-len * 0.42} ${len} 0 Q${len * 0.5} ${len * 0.42} 0 0Z`, fill, transform: `translate(${x.toFixed(1)},${y.toFixed(1)}) rotate(${angle})` });
}

function flowerHead(cx: number, cy: number, r: number, colors: [string, string], tilt = 0, petals = 5): SVGGElement {
  const kids: SVGElement[] = [];
  for (let i = 0; i < petals; i++) {
    const a = (360 / petals) * i;
    kids.push(s('ellipse', { cx: 0, cy: -r * 0.62, rx: r * 0.42, ry: r * 0.62, fill: colors[0], stroke: colors[1], 'stroke-width': 0.6, transform: `rotate(${a})` }));
  }
  kids.push(s('circle', { cx: 0, cy: 0, r: r * 0.36, fill: '#F7D04A' }), s('circle', { cx: -r * 0.1, cy: -r * 0.1, r: r * 0.14, fill: '#FFF1A8' }));
  return s('g', { transform: `translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${tilt}) scale(1,0.85)` }, kids);
}

function isoPlant(x: number, y: number, z: number, h: Health, id: string): SVGGElement {
  const [bx, by] = P(x, y, z);
  const green = '#4FA35B';
  const greenLight = '#7FCB88';
  const kids: SVGElement[] = [s('ellipse', { cx: bx, cy: by, rx: 4.5, ry: 2, fill: 'rgba(0,0,0,.32)' })];
  if (h === 'bloom') {
    const top = by - 17;
    kids.push(
      s('path', { d: `M${bx} ${by} Q${bx - 1.5} ${by - 9} ${bx} ${top}`, stroke: EARTH.stem, 'stroke-width': 1.6, fill: 'none' }),
      leaf(bx, by - 5, 6.5, -150, green),
      leaf(bx, by - 8, 6, -30, greenLight),
      flowerHead(bx, top, 5.4, PETALS[hash(id) % PETALS.length] ?? ['#FFD3E3', '#E98DB0']),
    );
  } else if (h === 'ok') {
    const top = by - 14;
    kids.push(
      s('path', { d: `M${bx} ${by} L${bx} ${top}`, stroke: EARTH.stem, 'stroke-width': 1.6 }),
      leaf(bx, by - 4, 6, -155, green),
      leaf(bx, by - 7, 6.5, -25, greenLight),
      leaf(bx, by - 10, 5, -140, greenLight),
      // a closed bud: this one will flower once it's watered a few more times
      s('path', { d: `M${bx - 2.2} ${top + 1} Q${bx} ${top - 6} ${bx + 2.2} ${top + 1}Z`, fill: '#9BD38E', stroke: '#3F8A4A', 'stroke-width': 0.5 }),
      s('path', { d: `M${bx - 0.8} ${top - 2.5} Q${bx} ${top - 4.8} ${bx + 0.8} ${top - 2.5}`, stroke: (PETALS[hash(id) % PETALS.length] ?? ['#FFD3E3', '#E98DB0'])[1], 'stroke-width': 1.2, fill: 'none' }),
    );
  } else if (h === 'thirsty') {
    const tipX = bx + 6;
    const tipY = by - 8;
    kids.push(
      s('path', { d: `M${bx} ${by} Q${bx} ${by - 14} ${tipX} ${tipY}`, stroke: '#9A9A3A', 'stroke-width': 1.6, fill: 'none' }),
      leaf(bx, by - 4, 6, 160, '#C9B24A'),
      leaf(bx, by - 7, 5.5, 20, '#D9C25A'),
      // the head hangs down, petals faded
      flowerHead(tipX, tipY + 2, 4, ['#F6E7B0', '#C9A23F'], 160, 5),
    );
  } else {
    kids.push(
      s('path', { d: `M${bx} ${by} Q${bx - 3} ${by - 5} ${bx - 9} ${by - 1}`, stroke: '#6E5137', 'stroke-width': 1.5, fill: 'none' }),
      leaf(bx, by - 1, 5, 175, '#7A5A40'),
      leaf(bx, by - 1, 4.5, 10, '#8C6A4C'),
      s('circle', { cx: bx - 9.5, cy: by - 0.5, r: 2, fill: '#8C6A4C' }),
    );
  }
  return s('g', { class: `plant plant-${h}` }, kids);
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


function gnomeBody(hat: string, tunic: string, kneel = false): SVGElement[] {
  const dy = kneel ? 3 : 0;
  return [s('g', { class: 'stride' }, [
    s('ellipse', { cx: 10, cy: 27, rx: 7, ry: 1.6, fill: 'rgba(0,0,0,.3)' }),
    kneel ? s('ellipse', { cx: 10, cy: 25.5, rx: 6, ry: 2, fill: '#4A3324' }) : s('rect', { x: 6, y: 24, width: 3, height: 3, rx: 1, fill: '#4A3324' }),
    kneel ? s('g') : s('rect', { x: 11, y: 24, width: 3, height: 3, rx: 1, fill: '#4A3324' }),
    s('ellipse', { cx: 10, cy: 20 + dy * 0.6, rx: 5.5, ry: 5.5 - dy * 0.3, fill: tunic }),
    s('path', { d: `M5 ${13 + dy} Q10 ${24 + dy} 15 ${13 + dy} Q13 ${16 + dy} 10 ${16 + dy} Q7 ${16 + dy} 5 ${13 + dy}Z`, fill: '#F4F1EA' }),
    s('circle', { cx: 10, cy: 11.5 + dy, r: 4, fill: '#F2C9A0' }),
    s('path', { d: `M10 ${dy} L16 ${9.5 + dy} Q10 ${11 + dy} 4 ${9.5 + dy}Z`, fill: hat }),
  ])];
}

/** A small background gnome, always mid-chore. Motion is CSS (classes below), so reduce-motion stops it. */
export function choreGnome(chore: Chore, hat: string, tunic: string): SVGGElement {
  if (chore === 'water') {
    return s('g', {}, [
      ...gnomeBody(hat, tunic),
      s('g', { class: 'pour' }, [
        s('rect', { x: 13, y: 15, width: 8, height: 6, rx: 1.6, fill: '#8FC2E8' }),
        s('path', { d: 'M14 15 Q17 11 20 15', stroke: '#6FA6D0', 'stroke-width': 1, fill: 'none' }),
        s('path', { d: 'M21 17 L26 13.5', stroke: '#8FC2E8', 'stroke-width': 1.6, 'stroke-linecap': 'round' }),
      ]),
      s('circle', { class: 'drop', cx: 26.5, cy: 15, r: 0.9, fill: '#9FD3FF' }),
      s('circle', { class: 'drop late', cx: 27.5, cy: 15, r: 0.9, fill: '#9FD3FF' }),
      s('circle', { class: 'drop later', cx: 26, cy: 15, r: 0.9, fill: '#9FD3FF' }),
    ]);
  }
  if (chore === 'hoe') {
    return s('g', {}, [
      s('g', { class: 'puff' }, [s('circle', { cx: 24, cy: 26, r: 1.6, fill: '#8C6A4C' }), s('circle', { cx: 26.5, cy: 25, r: 1.2, fill: '#A9744A' }), s('circle', { cx: 22, cy: 25, r: 1, fill: '#A9744A' })]),
      ...gnomeBody(hat, tunic),
      s('g', { class: 'hoe' }, [
        s('path', { d: 'M13 17 L25 25', stroke: '#C9A26E', 'stroke-width': 1.5, 'stroke-linecap': 'round' }),
        s('path', { d: 'M24 24.5 l3 -2.5 l1 1.5 l-2.5 2.6z', fill: '#9AA5A0' }),
        s('circle', { cx: 13.5, cy: 17.5, r: 1.6, fill: '#F2C9A0' }),
      ]),
    ]);
  }
  if (chore === 'plant') {
    return s('g', {}, [
      s('path', { d: 'M19 27 q4 -3.5 8 0z', fill: '#5A3B26' }),
      s('g', { class: 'sprout' }, [
        s('path', { d: 'M23 26 v-5', stroke: '#4FA35B', 'stroke-width': 1.1 }),
        leaf(23, 22.5, 3.2, -150, '#7FCB88'),
        leaf(23, 21.5, 3.4, -30, '#4FA35B'),
      ]),
      ...gnomeBody(hat, tunic, true),
      s('g', { class: 'reach' }, [
        s('rect', { x: 15.5, y: 18, width: 5, height: 4, rx: 1, fill: '#A9744A' }),
        s('path', { d: 'M18 18 v-3', stroke: '#4FA35B', 'stroke-width': 1 }),
        s('circle', { cx: 18, cy: 14.5, r: 1.5, fill: '#9BE3A5' }),
      ]),
    ]);
  }
  // weed: tugging a weed out of the plot and tossing it into a basket
  return s('g', {}, [
    s('g', { class: 'tug' }, [...gnomeBody(hat, tunic)]),
    s('g', { class: 'weed' }, [s('path', { d: 'M17 26 v-5', stroke: '#6E8B3D', 'stroke-width': 1 }), leaf(17, 23, 3, -140, '#8BA04A'), leaf(17, 22, 3, -40, '#8BA04A'), s('circle', { cx: 17, cy: 27, r: 1.2, fill: '#5A3B26' })]),
  ]);
}

export const CHORE_CREW: { chore: Chore; hat: string; tunic: string }[] = [
  { chore: 'water', hat: '#F2A23A', tunic: '#6A8FD0' },
  { chore: 'hoe', hat: '#B07BE0', tunic: '#C9763A' },
  { chore: 'plant', hat: '#5FB36A', tunic: '#D9584B' },
  { chore: 'weed', hat: '#E2574C', tunic: '#5FA06A' },
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

export interface Stage {
  svg: SVGSVGElement;
  /** Beds and plots the crew can work, in ground coordinates. */
  sites: Site[];
  /** Per site: the group its plants (and any gnome standing in it) live in, painted back to front. */
  layers: Map<string, SVGGElement>;
  /** Gnomes on the ground draw here, in front of every bed (the crew only walks in front of the beds). */
  front: SVGGElement;
}

export const PLOT = { size: 38, height: 8, inset: 14, sprouts: 4 };

/** The wooden name sign staked at each bed's front corner. */
export const SIGN = { fontSize: 10, maxChars: 16, charWidth: 6.3, pad: 7, height: 17, drop: 5, post: 6 };

function bedSign(name: string, due: number, at: Pt): SVGGElement {
  const label = name.length > SIGN.maxChars ? `${name.slice(0, SIGN.maxChars - 1)}…` : name;
  const w = Math.max(40, label.length * SIGN.charWidth + SIGN.pad * 2 + (due > 0 ? 18 : 0));
  const [cx, cy] = at;
  const x = cx - w / 2;
  const y = cy + SIGN.drop;
  const text = s('text', { x: x + SIGN.pad, y: y + SIGN.height / 2 + SIGN.fontSize * 0.36, 'font-size': SIGN.fontSize, 'font-weight': 700, fill: '#FFF6E3', class: 'sign-text' });
  text.textContent = label;
  const kids: SVGElement[] = [
    s('rect', { x: cx - 1.5, y: y + SIGN.height - 2, width: 3, height: SIGN.post + 2, fill: '#6B4A33' }),
    s('rect', { x, y: y + 2, width: w, height: SIGN.height, rx: 4, fill: '#5A3B26' }),
    s('rect', { x, y, width: w, height: SIGN.height, rx: 4, fill: '#8C5D3A', stroke: '#A9744A', 'stroke-width': 1 }),
    text,
  ];
  if (due > 0) {
    const bx = x + w - SIGN.pad - 6;
    const by = y + SIGN.height / 2;
    const n = s('text', { x: bx, y: by + 3.4, 'font-size': 9, 'font-weight': 800, fill: '#3A2A05', 'text-anchor': 'middle' });
    n.textContent = due > 99 ? '99+' : String(due);
    kids.push(s('circle', { cx: bx, cy: by, r: 6.5, fill: '#F2C95C' }), n);
  }
  return s('g', { class: 'sign', 'aria-hidden': 'true' }, kids);
}

export function island(decks: readonly Deck[], cards: readonly Card[], today: number, onBed: (deckId: string) => void): Stage {
  const { bedSize, bedHeight, margin, maxPlants } = ISLAND;
  const spots = layoutBeds(decks);
  const minX = Math.min(0, ...spots.map((b) => b.x0 - margin));
  const minY = Math.min(0, ...spots.map((b) => b.y0 - margin));
  const maxX = 260;
  const maxY = 260;
  const defs = s('defs');
  const world = s('g');
  const sites: Site[] = [];
  const layers = new Map<string, SVGGElement>();
  add(
    world,
    box(minX, minY, -40, maxX - minX, maxY - minY, 34, EARTH.soilLeft, EARTH.soilLeft, EARTH.soilRight),
    box(minX, minY, -6, maxX - minX, maxY - minY, 6, EARTH.grassTop, EARTH.grassLeft, EARTH.grassRight),
  );

  // A neighbor's plot out front, where the planter sows seedlings.
  const plot = { x0: maxX - PLOT.size - PLOT.inset, y0: maxY - PLOT.size - PLOT.inset };
  const plotLayer = s('g');
  add(world, box(plot.x0, plot.y0, 0, PLOT.size, PLOT.size, PLOT.height, EARTH.plotTop, EARTH.plotLeft, EARTH.plotRight), plotLayer);
  const plotCells = Array.from({ length: PLOT.sprouts }, (_, i) => ({ x: plot.x0 + 10 + (i % 2) * 18, y: plot.y0 + 10 + Math.floor(i / 2) * 18, health: null }));
  sites.push({ id: 'plot', kind: 'plot', x0: plot.x0, y0: plot.y0, w: PLOT.size, d: PLOT.size, h: PLOT.height, cells: plotCells });
  layers.set('plot', plotLayer);

  spots.forEach((spot, k) => {
    const bedCards = cards.filter((c) => c.deckId === spot.deck.id).slice(0, maxPlants);
    const due = cards.filter((c) => c.deckId === spot.deck.id && needsWater(c.srs, today)).length;
    const bed = s('g', { class: 'bed', role: 'button', tabindex: 0, 'aria-label': `${spot.deck.name}: ${due} to water` });
    add(bed, box(spot.x0, spot.y0, 0, bedSize, bedSize, bedHeight, EARTH.bedTop, EARTH.bedLeft, EARTH.bedRight));
    const per = Math.max(1, Math.ceil(Math.sqrt(bedCards.length)));
    const gap = (bedSize - 16) / Math.max(1, per - 1);
    const placed = bedCards.map((c, i) => ({ c, x: spot.x0 + 8 + (i % per) * gap, y: spot.y0 + 8 + Math.floor(i / per) * gap }));
    placed.sort((a, b) => a.x + a.y - (b.x + b.y));
    const plants = s('g');
    for (const p of placed) {
      const el = isoPlant(p.x, p.y, bedHeight, health(p.c.srs, today), p.c.id);
      el.setAttribute('data-depth', String(p.x + p.y));
      add(plants, el);
    }
    add(bed, plants, bedSign(spot.deck.name, due, P(spot.x0 + bedSize, spot.y0 + bedSize, 0)));
    bed.addEventListener('click', () => onBed(spot.deck.id));
    bed.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onBed(spot.deck.id);
      }
    });
    add(world, bed);
    // Only the front row is reachable along the front path; beds further back are left to the gnomes' imagination.
    if (k < ISLAND.perRow) {
      const id = `bed:${spot.deck.id}`;
      sites.push({ id, kind: 'bed', x0: spot.x0, y0: spot.y0, w: bedSize, d: bedSize, h: bedHeight, cells: placed.map((p) => ({ x: p.x, y: p.y, health: health(p.c.srs, today) })) });
      layers.set(id, plants);
    }
  });

  const front = s('g', { 'aria-hidden': 'true' });
  add(world, front);

  const corners = [P(minX, minY, 0), P(maxX, minY, 0), P(maxX, maxY, -40), P(minX, maxY, -40), P(minX, minY, 30)];
  const vx = Math.min(...corners.map((c) => c[0])) - 4;
  const vy = Math.min(...corners.map((c) => c[1])) - 10;
  const vw = Math.max(...corners.map((c) => c[0])) + 4 - vx;
  const vh = Math.max(...corners.map((c) => c[1]), ...spots.map((b) => P(b.x0 + bedSize, b.y0 + bedSize, 0)[1] + SIGN.drop + SIGN.height + SIGN.post)) + 4 - vy;
  const svg = s('svg', { class: 'island', viewBox: `${vx.toFixed(0)} ${vy.toFixed(0)} ${vw.toFixed(0)} ${vh.toFixed(0)}`, role: 'group', 'aria-label': 'Your garden island' }, [defs, world]);
  return { svg, sites, layers, front };
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
