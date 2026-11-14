import { describe, expect, it } from 'vitest';
import { app, applySegment, DEFAULT_RULES, GARDEN_RULES, health, newSrs, queue, startRun, tally, water, type Card, type Srs } from '../src/app';
import { STARTER_DECKS, starterGarden } from '../src/decks';

const T = 20_000; // a fixed "today"
const srs = (p: Partial<Srs>): Srs => ({ ...newSrs(T), ...p });

describe('garden health', () => {
  it('is thirsty when due, wilted when long overdue, blooming on a long interval', () => {
    expect(health(srs({ due: T }), T)).toBe('thirsty');
    expect(health(srs({ due: T - GARDEN_RULES.wiltAfterDays }), T)).toBe('wilted');
    expect(health(srs({ due: T + 3, interval: 5 }), T)).toBe('ok');
    expect(health(srs({ due: T + 3, interval: GARDEN_RULES.bloomIntervalDays }), T)).toBe('bloom');
  });

  it('queues only due cards, most overdue first, stable on ties', () => {
    const mk = (id: string, due: number, deckId = 'a'): Card => ({ id, deckId, front: { text: id }, back: { text: '' }, show: 'text', srs: srs({ due }) });
    const cards = [mk('later', T + 2), mk('today1', T), mk('old', T - 5), mk('today2', T), mk('other', T - 9, 'b')];
    expect(queue(cards, T).map((c) => c.id)).toEqual(['other', 'old', 'today1', 'today2']);
    expect(queue(cards, T, 'a').map((c) => c.id)).toEqual(['old', 'today1', 'today2']);
  });
});

describe('watering with a bet', () => {
  it('a new card right: the first interval grows with the bet', () => {
    expect(water(newSrs(T), { bet: 1, right: true }, T).srs.interval).toBe(DEFAULT_RULES.firstInterval[1]);
    expect(water(newSrs(T), { bet: 3, right: true }, T).srs.interval).toBe(DEFAULT_RULES.firstInterval[3]);
  });

  it('a bigger bet grows a known card more when right', () => {
    const base = srs({ interval: 10, ease: 2.3 });
    const i1 = water(base, { bet: 1, right: true }, T).srs.interval;
    const i3 = water(base, { bet: 3, right: true }, T).srs.interval;
    expect(i3).toBeGreaterThan(i1);
    expect(i1).toBeGreaterThan(10);
  });

  it('every miss comes back today; a hunch miss keeps more of its interval than a confident one', () => {
    const base = srs({ interval: 10, ease: 2.3 });
    const lock = water(base, { bet: 3, right: false }, T).srs;
    const hunch = water(base, { bet: 1, right: false }, T).srs;
    expect(lock.interval).toBe(0);
    expect(lock.due).toBe(T);
    expect(hunch.interval).toBe(5);
    expect(hunch.due).toBe(T);
    expect(lock.ease).toBeLessThan(hunch.ease);
    expect(lock.lapses).toBe(1);
  });

  it('seeds are won or lost by the size of the bet', () => {
    expect(water(newSrs(T), { bet: 2, right: true }, T).seeds).toBe(2);
    expect(water(newSrs(T), { bet: 3, right: false }, T).seeds).toBe(-3);
  });

  it('ease and interval stay inside their limits', () => {
    let s = srs({ interval: 300, ease: DEFAULT_RULES.maxEase });
    for (let i = 0; i < 5; i++) s = water(s, { bet: 3, right: true }, T).srs;
    expect(s.interval).toBeLessThanOrEqual(DEFAULT_RULES.maxIntervalDays);
    expect(s.ease).toBeLessThanOrEqual(DEFAULT_RULES.maxEase);
    let w = srs({ interval: 4, ease: DEFAULT_RULES.minEase });
    for (let i = 0; i < 5; i++) w = water(w, { bet: 3, right: false }, T).srs;
    expect(w.ease).toBeGreaterThanOrEqual(DEFAULT_RULES.minEase);
  });
});

describe('starter garden', () => {
  it('seeds three decks with every card in a deck and plants in every health state', () => {
    const g = starterGarden(T, DEFAULT_RULES.startEase);
    expect(g.decks.map((d) => d.name)).toEqual(STARTER_DECKS.map((d) => d.name));
    expect(g.cards.length).toBe(STARTER_DECKS.reduce((n, d) => n + d.cards.length, 0));
    const t = tally(g.cards, T);
    for (const k of ['bloom', 'ok', 'thirsty', 'wilted'] as const) expect(t[k]).toBeGreaterThan(0);
    expect(new Set(g.cards.map((c) => c.id)).size).toBe(g.cards.length);
  });
});

describe('the solo run (one watering session)', () => {
  it('the server replays a session to the same seed total the client shows', () => {
    const solo = app.solo!;
    let server = solo.start(app.defaultConfig, 9);
    let client = startRun(9);
    const answers = [{ bet: 3, right: true }, { bet: 1, right: false }, { bet: 2, right: true }] as const;
    answers.forEach((a, i) => {
      const seg = solo.parseSegment(JSON.parse(JSON.stringify({ n: i + 1, bet: a.bet, right: a.right })));
      expect(seg).not.toBeNull();
      const out = solo.apply(app.defaultConfig, server, seg!);
      if ('error' in out) throw new Error(out.error);
      server = out.run;
      client = applySegment(DEFAULT_RULES, client, { n: i + 1, bet: a.bet, right: a.right })!;
    });
    expect(solo.score(server)).toBe(client.seeds);
    expect(client.seeds).toBe(3 - 1 + 2);
  });

  it('rejects out-of-order and malformed segments', () => {
    const solo = app.solo!;
    expect(applySegment(DEFAULT_RULES, startRun(1), { n: 2, bet: 1, right: true })).toBeNull();
    for (const bad of [null, [], { n: 1, bet: 4, right: true }, { n: 1, bet: 2 }, { n: '1', bet: 2, right: true }, { n: 1, bet: 2, right: 'yes' }, { n: 1, bet: 2, right: true, x: 1 }]) {
      expect(solo.parseSegment(bad)).toBeNull();
    }
  });
});
