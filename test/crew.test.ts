import { describe, expect, it } from 'vitest';
import { CREW_RULES, cellKey, chooseTarget, door, inside, planTask, rng, stand, type Cell, type Leg, type Site, type V3 } from '../src/crew';
import { ISLAND, layoutBeds, PLOT } from '../src/client/art';

// The same layout the island draws: three front-row beds and the plot out front.
const decks = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];
const healths = ['bloom', 'ok', 'thirsty', 'wilted'] as const;
const beds: Site[] = layoutBeds(decks).map((b, k) => ({
  id: `bed:${b.deck.id}`,
  kind: 'bed',
  x0: b.x0,
  y0: b.y0,
  w: ISLAND.bedSize,
  d: ISLAND.bedSize,
  h: ISLAND.bedHeight,
  cells: Array.from({ length: 16 }, (_, i): Cell => ({ x: b.x0 + 8 + (i % 4) * 16, y: b.y0 + 8 + Math.floor(i / 4) * 16, health: healths[(i + k) % 4] ?? 'ok' })),
}));
const plot: Site = {
  id: 'plot', kind: 'plot', x0: 260 - PLOT.size - PLOT.inset, y0: 260 - PLOT.size - PLOT.inset, w: PLOT.size, d: PLOT.size, h: PLOT.height,
  cells: [{ x: 218, y: 218, health: null }],
};
const sites = [...beds, plot];

function samples(leg: Leg): V3[] {
  if (leg.kind === 'work') return [leg.at];
  return Array.from({ length: 21 }, (_, i) => {
    const k = i / 20;
    return { x: leg.from.x + (leg.to.x - leg.from.x) * k, y: leg.from.y + (leg.to.y - leg.from.y) * k, z: leg.from.z + (leg.to.z - leg.from.z) * k };
  });
}

describe('gnome routes', () => {
  const starts: { pos: V3; site: Site | null }[] = [
    ...sites.map((s) => ({ pos: door(s), site: null })),
    ...sites.flatMap((s) => s.cells.slice(0, 3).map((c) => ({ pos: stand(s, c), site: s }))),
  ];

  it('never walk through a bed or plot they are not climbing in or out of', () => {
    for (const start of starts) {
      for (const target of sites) {
        for (const cell of target.cells) {
          const legs = planTask('water', start.pos, start.site, { site: target, cell }, sites);
          for (const leg of legs) {
            const allowed = new Set([start.site?.id, target.id]);
            for (const p of samples(leg)) {
              for (const other of sites) {
                if (allowed.has(other.id)) continue;
                expect(inside(other, p.x, p.y, 1), `${JSON.stringify(p)} crosses ${other.id}`).toBe(false);
              }
            }
          }
        }
      }
    }
  });

  it('are continuous, and the work happens standing inside the target', () => {
    const start = starts[0]!;
    const target = { site: beds[2]!, cell: beds[2]!.cells[5]! };
    const legs = planTask('hoe', start.pos, start.site, target, sites);
    let at = start.pos;
    for (const leg of legs) {
      if (leg.kind === 'walk') {
        expect(leg.from).toEqual(at);
        at = leg.to;
      } else {
        expect(leg.at).toEqual(at);
        expect(inside(target.site, leg.at.x, leg.at.y)).toBe(true);
        expect(leg.at.z).toBe(target.site.h);
      }
    }
    expect(legs.at(-1)?.kind).toBe('work');
  });

  it('a gnome working stands in front of its plant (never hidden behind it)', () => {
    for (const site of beds) {
      for (const c of site.cells) {
        const p = stand(site, c);
        expect(inside(site, p.x, p.y)).toBe(true);
        expect(p.x + p.y).toBeGreaterThan(c.x + c.y);
      }
    }
  });

  it('climbing out of one bed and into another goes door to door', () => {
    const from = beds[0]!;
    const legs = planTask('weed', stand(from, from.cells[0]!), from, { site: beds[1]!, cell: beds[1]!.cells[0]! }, sites);
    const ground = legs.filter((l): l is Extract<Leg, { kind: 'walk' }> => l.kind === 'walk' && l.from.z === 0 && l.to.z === 0);
    expect(ground).toHaveLength(1);
    expect(ground[0]?.from).toEqual(door(from));
    expect(ground[0]?.to).toEqual(door(beds[1]!));
  });
});

describe('what each gnome works on', () => {
  it('waterers go to thirsty or wilted plants while there are any', () => {
    const next = rng(3);
    for (let i = 0; i < 40; i++) {
      const t = chooseTarget('water', sites, next, new Set());
      expect(['thirsty', 'wilted']).toContain(t?.cell.health);
    }
  });

  it('never sends two gnomes to the same plant', () => {
    const only = { ...beds[0]!, cells: beds[0]!.cells.slice(0, 1) };
    const busy = new Set([cellKey(only.id, only.cells[0]!)]);
    expect(chooseTarget('hoe', [only], rng(1), busy)).toBeNull();
  });

  it('planters sow the plot or replant wilted plants', () => {
    const next = rng(5);
    for (let i = 0; i < 40; i++) {
      const t = chooseTarget('plant', sites, next, new Set(), CREW_RULES);
      expect(t?.site.kind === 'plot' || t?.cell.health === 'wilted').toBe(true);
    }
  });
});
