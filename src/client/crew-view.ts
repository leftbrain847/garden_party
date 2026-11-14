/**
 * Brings the gnome crew to life on the island: each gnome follows the planner's legs (walk, climb in, walk to
 * a plant, work it), is painted in the right depth order among the plants, and faces what it's doing.
 * Under reduce-motion the gnomes stand still at their first job.
 */
import { cellKey, chooseTarget, door, inside, planTask, rng, type Chore, type Leg, type Site, type V3 } from '../crew';
import { CHORE_CREW, choreGnome, P, s, type Stage } from './art';

export const CREW_VIEW = { scale: 1.2, seed: 7, maxStep: 0.05 };

interface Gnome {
  chore: Chore;
  el: SVGGElement;
  flip: SVGGElement;
  pos: V3;
  site: Site | null;
  legs: Leg[];
  t: number;
  claim: string | null;
}

function place(g: Gnome, at: V3, faceLeft: boolean, stage: Stage): void {
  const [px, py] = P(at.x, at.y, at.z);
  g.el.setAttribute('transform', `translate(${px.toFixed(2)},${py.toFixed(2)})`);
  g.flip.setAttribute('transform', `scale(${faceLeft ? -CREW_VIEW.scale : CREW_VIEW.scale},${CREW_VIEW.scale}) translate(-10,-27)`);
  // Paint order: inside a bed, among its plants by depth; on the ground, in front of every bed.
  const host = stage.sites.find((site) => inside(site, at.x, at.y) && at.z > 0.5);
  const layer = host ? stage.layers.get(host.id) : stage.front;
  if (!layer) return;
  const depth = at.x + at.y;
  let before: Element | null = null;
  for (const child of Array.from(layer.children)) {
    if (child === g.el) continue;
    const d = Number(child.getAttribute('data-depth'));
    if (Number.isFinite(d) && d > depth) {
      before = child;
      break;
    }
  }
  g.el.setAttribute('data-depth', String(depth));
  if (g.el.parentNode !== layer || g.el.nextSibling !== before) layer.insertBefore(g.el, before);
}

const faceLeftOf = (from: V3, to: { x: number; y: number }, z: number): boolean => P(to.x, to.y, z)[0] < P(from.x, from.y, from.z)[0];

export function startCrew(stage: Stage): () => void {
  const next = rng(CREW_VIEW.seed);
  const busy = new Set<string>();
  const beds = stage.sites.filter((site) => site.kind === 'bed');
  if (beds.length === 0) return () => undefined;

  const crew: Gnome[] = CHORE_CREW.map((c, i) => {
    const inner = choreGnome(c.chore, c.hat, c.tunic);
    const flip = s('g', {}, [inner]);
    const el = s('g', { class: 'crew walking' }, [flip]);
    const startSite = beds[i % beds.length] ?? beds[0];
    const pos = startSite ? door(startSite) : { x: 200, y: 200, z: 0 };
    return { chore: c.chore, el, flip, pos, site: null, legs: [], t: 0, claim: null };
  });

  const assign = (g: Gnome): void => {
    if (g.claim) busy.delete(g.claim);
    const target = chooseTarget(g.chore, stage.sites, next, busy);
    if (!target) return;
    g.claim = cellKey(target.site.id, target.cell);
    busy.add(g.claim);
    g.legs = planTask(g.chore, g.pos, g.site, target, stage.sites);
    g.t = 0;
  };

  const show = (g: Gnome): void => {
    const leg = g.legs[0];
    if (!leg) return place(g, g.pos, false, stage);
    if (leg.kind === 'work') {
      g.el.setAttribute('class', 'crew working');
      place(g, leg.at, faceLeftOf(leg.at, leg.target, leg.at.z), stage);
      return;
    }
    g.el.setAttribute('class', 'crew walking');
    const k = Math.min(1, g.t / leg.seconds);
    const at = { x: leg.from.x + (leg.to.x - leg.from.x) * k, y: leg.from.y + (leg.to.y - leg.from.y) * k, z: leg.from.z + (leg.to.z - leg.from.z) * k };
    g.pos = at;
    const left = P(leg.to.x, leg.to.y, leg.to.z)[0] < P(leg.from.x, leg.from.y, leg.from.z)[0];
    place(g, at, left, stage);
  };

  for (const g of crew) {
    assign(g);
  }

  const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduced) {
    // Stand each gnome at its first job, mid-chore, and keep still.
    for (const g of crew) {
      g.legs = g.legs.filter((l) => l.kind === 'work');
      show(g);
    }
    return () => undefined;
  }

  let raf = 0;
  let last = 0;
  const tick = (now: number): void => {
    const dt = last ? Math.min(CREW_VIEW.maxStep, (now - last) / 1000) : 0;
    last = now;
    for (const g of crew) {
      g.t += dt;
      let leg = g.legs[0];
      while (leg && g.t >= leg.seconds) {
        g.t -= leg.seconds;
        if (leg.kind === 'walk') {
          const end = leg.to;
          g.pos = end;
          g.site = end.z > 0.5 ? (stage.sites.find((x) => inside(x, end.x, end.y)) ?? null) : null;
        } else {
          g.pos = leg.at;
          g.site = stage.sites.find((x) => x.id === (leg as Extract<Leg, { kind: 'work' }>).siteId) ?? null;
        }
        g.legs.shift();
        if (g.legs.length === 0) assign(g);
        leg = g.legs[0];
      }
      show(g);
    }
    raf = requestAnimationFrame(tick);
  };
  for (const g of crew) show(g);
  raf = requestAnimationFrame(tick);
  const onVisibility = (): void => {
    if (document.visibilityState === 'hidden') {
      cancelAnimationFrame(raf);
    } else {
      last = 0;
      raf = requestAnimationFrame(tick);
    }
  };
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener('visibilitychange', onVisibility);
  };
}

