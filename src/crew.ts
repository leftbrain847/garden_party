/**
 * The gnome crew's planner: where each background gnome walks and what it works on next.
 *
 * Pure and deterministic (randomness comes from the rng passed in), so the routes are testable. Coordinates
 * are the island's ground plane (x, y) plus height z. Beds and plots are boxes; a gnome climbs into one,
 * walks to a plant, works it, climbs out by the same front corner, and walks to the next.
 * Ground walking only ever happens in front of the beds (between their front corners), so no route passes
 * through a bed.
 */
import type { Health } from './app';

export type Chore = 'water' | 'hoe' | 'plant' | 'weed';

export interface V3 {
  x: number;
  y: number;
  z: number;
}

export interface Cell {
  x: number;
  y: number;
  health: Health | null; // null = bare soil (a plot)
}

export interface Site {
  id: string;
  x0: number;
  y0: number;
  w: number;
  d: number;
  h: number;
  cells: Cell[];
  /** Plots are bare soil the planter seeds; beds hold the cards' plants. */
  kind: 'bed' | 'plot';
}

export type Leg =
  | { kind: 'walk'; from: V3; to: V3; seconds: number; siteId: string | null }
  | { kind: 'work'; at: V3; target: { x: number; y: number }; chore: Chore; seconds: number; siteId: string };

export interface CrewRules {
  /** Walking speed, ground units per second. */
  speed: number;
  /** How long each chore takes at one plant, seconds. */
  work: Record<Chore, number>;
  /** How far out from a box's front corner a gnome stands before climbing in. */
  doorGap: number;
  /** How far inside the front corner a gnome lands after climbing. */
  entryGap: number;
  /** Where the gnome stands to work a plant: `reach` along one ground axis and `side` along the other, so it
   * is in front of the plant (never hidden by it) and a tool's length to its left or right on screen. */
  reach: number;
  side: number;
  /** Chance the planter heads for a plot rather than replanting a wilted bed plant. */
  plotChance: number;
}

export const CREW_RULES: CrewRules = {
  speed: 24,
  work: { water: 3.2, hoe: 3.6, plant: 4.2, weed: 3 },
  doorGap: 8,
  entryGap: 6,
  reach: 16,
  side: 2,
  plotChance: 0.5,
};

/** A small seeded generator (mulberry32). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const door = (s: Site, r: CrewRules = CREW_RULES): V3 => ({ x: s.x0 + s.w + r.doorGap, y: s.y0 + s.d + r.doorGap, z: 0 });
export const entry = (s: Site, r: CrewRules = CREW_RULES): V3 => ({ x: s.x0 + s.w - r.entryGap, y: s.y0 + s.d - r.entryGap, z: s.h });

export function stand(s: Site, c: Cell, r: CrewRules = CREW_RULES): V3 {
  const edge = 3;
  // Prefer standing to the plant's screen-right; if that's off the bed, stand to its screen-left.
  if (c.x + r.reach <= s.x0 + s.w - edge) return { x: c.x + r.reach, y: Math.min(c.y + r.side, s.y0 + s.d - edge), z: s.h };
  return { x: Math.min(c.x + r.side, s.x0 + s.w - edge), y: Math.min(c.y + r.reach, s.y0 + s.d - edge), z: s.h };
}

export const inside = (s: Site, x: number, y: number, pad = 0): boolean => x > s.x0 - pad && x < s.x0 + s.w + pad && y > s.y0 - pad && y < s.y0 + s.d + pad;

const dist = (a: V3, b: V3): number => Math.hypot(b.x - a.x, b.y - a.y);

function pick<T>(list: readonly T[], next: () => number): T | undefined {
  return list.length ? list[Math.floor(next() * list.length)] : undefined;
}

const cellKey = (siteId: string, c: Cell): string => `${siteId}:${c.x.toFixed(1)},${c.y.toFixed(1)}`;

/** Which site and plant a gnome heads to next. Waterers go to thirsty and wilted plants first. */
export function chooseTarget(chore: Chore, sites: readonly Site[], next: () => number, busy: ReadonlySet<string>, r: CrewRules = CREW_RULES): { site: Site; cell: Cell } | null {
  const beds = sites.filter((s) => s.kind === 'bed' && s.cells.length > 0);
  const plots = sites.filter((s) => s.kind === 'plot' && s.cells.length > 0);
  const free = (s: Site, cells: readonly Cell[]): Cell[] => cells.filter((c) => !busy.has(cellKey(s.id, c)));
  const from = (pool: readonly Site[], want: (c: Cell) => boolean): { site: Site; cell: Cell } | null => {
    const options = pool.flatMap((site) => free(site, site.cells.filter(want)).map((cell) => ({ site, cell })));
    return pick(options, next) ?? null;
  };
  const any = (): { site: Site; cell: Cell } | null => from(beds, () => true);
  switch (chore) {
    case 'water':
      return from(beds, (c) => c.health === 'thirsty' || c.health === 'wilted') ?? any();
    case 'plant':
      return (plots.length > 0 && next() < r.plotChance ? from(plots, () => true) : from(beds, (c) => c.health === 'wilted')) ?? from(plots, () => true) ?? any();
    case 'hoe':
    case 'weed':
      return any();
  }
}

const clearPath = (a: V3, b: V3, sites: readonly Site[]): boolean => {
  const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
  for (let i = 0; i <= n; i++) {
    const k = i / n;
    const x = a.x + (b.x - a.x) * k;
    const y = a.y + (b.y - a.y) * k;
    if (sites.some((s) => inside(s, x, y, 2))) return false;
  }
  return true;
};

/**
 * The shortest way across open ground from one point to another, going around beds and plots: a straight
 * line if it's clear, otherwise via the points just outside the boxes' corners.
 */
export function groundRoute(from: V3, to: V3, sites: readonly Site[], r: CrewRules = CREW_RULES): V3[] {
  if (clearPath(from, to, sites)) return [to];
  const g = r.doorGap;
  const nodes: V3[] = [from, to];
  for (const s of sites) {
    for (const [x, y] of [[s.x0 - g, s.y0 - g], [s.x0 + s.w + g, s.y0 - g], [s.x0 - g, s.y0 + s.d + g], [s.x0 + s.w + g, s.y0 + s.d + g]] as const) {
      const p = { x, y, z: 0 };
      if (!sites.some((o) => inside(o, x, y, 2))) nodes.push(p);
    }
  }
  const best = nodes.map(() => Infinity);
  const prev = nodes.map(() => -1);
  const done = nodes.map(() => false);
  best[0] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < nodes.length; i++) if (!done[i] && best[i]! < Infinity && (u < 0 || best[i]! < best[u]!)) u = i;
    if (u < 0 || u === 1) break;
    done[u] = true;
    for (let v = 0; v < nodes.length; v++) {
      if (done[v]) continue;
      const nu = nodes[u]!;
      const nv = nodes[v]!;
      const cost = best[u]! + dist(nu, nv);
      if (cost < best[v]! && clearPath(nu, nv, sites)) {
        best[v] = cost;
        prev[v] = u;
      }
    }
  }
  if (prev[1] === -1) return [to]; // boxed in: shouldn't happen on the island; walk straight rather than freeze
  const path: V3[] = [];
  for (let v = 1; v !== 0; v = prev[v]!) path.unshift(nodes[v]!);
  return path;
}

function walk(from: V3, to: V3, siteId: string | null, r: CrewRules): Leg {
  return { kind: 'walk', from, to, seconds: Math.max(0.15, dist(from, to) / r.speed), siteId };
}

/**
 * The legs for one task: climb out of the current site if in one, walk along the front to the target site,
 * climb in, walk to the plant, work it. Each leg starts exactly where the last one ended.
 */
export function planTask(
  chore: Chore,
  pos: V3,
  currentSite: Site | null,
  target: { site: Site; cell: Cell },
  sites: readonly Site[],
  r: CrewRules = CREW_RULES,
): Leg[] {
  const legs: Leg[] = [];
  let at = pos;
  const go = (to: V3, siteId: string | null): void => {
    if (dist(at, to) > 0.01 || at.z !== to.z) legs.push(walk(at, to, siteId, r));
    at = to;
  };
  const { site, cell } = target;
  if (!currentSite || currentSite.id !== site.id) {
    if (currentSite) {
      go(entry(currentSite, r), currentSite.id);
      go(door(currentSite, r), currentSite.id);
    }
    for (const p of groundRoute(at, door(site, r), sites, r)) go(p, null);
    go(entry(site, r), site.id);
  }
  const spot = stand(site, cell, r);
  go(spot, site.id);
  legs.push({ kind: 'work', at: spot, target: { x: cell.x, y: cell.y }, chore, seconds: r.work[chore], siteId: site.id });
  return legs;
}

export { cellKey };
