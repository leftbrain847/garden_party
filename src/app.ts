/**
 * Garden Party: spaced-repetition cards as a garden.
 *
 * Each deck is a garden bed and each card is a plant. Reviewing is watering: before a card flips you bet
 * 1 to 3 seeds on how sure you are, then say whether you got it. Confident and right grows the plant a lot;
 * confident and wrong wilts it hard. The bet tunes the schedule, so there are no Again/Hard/Good/Easy buttons.
 *
 * Everything here is pure and deterministic: no clock, no Math.random, no I/O. "Today" is passed in as a
 * day number (whole days since 1970-01-01 in the player's time zone).
 */
import type { GameModule } from '@app-builder/host';
import config from '../app.config.json';

// ---------- config: every tunable lives here ----------

export type Bet = 1 | 2 | 3;
export const BETS: readonly Bet[] = [1, 2, 3];

export interface Rules {
  /** First interval (days) after a correct answer on a new card, by bet. */
  firstInterval: Record<Bet, number>;
  /** Interval multiplier on a correct answer, by bet (applied on top of ease). */
  rightGrowth: Record<Bet, number>;
  /** Interval multiplier on a wrong answer, by bet. A confident miss shrinks the interval the most. */
  wrongShrink: Record<Bet, number>;
  /** Ease change on a correct / wrong answer, by bet. */
  rightEase: Record<Bet, number>;
  wrongEase: Record<Bet, number>;
  startEase: number;
  minEase: number;
  maxEase: number;
  maxIntervalDays: number;
  /** Seeds won on a correct answer and lost on a wrong one: the bet itself. */
  seedsPerBet: number;
}

export const DEFAULT_RULES: Rules = {
  firstInterval: { 1: 1, 2: 2, 3: 4 },
  rightGrowth: { 1: 0.8, 2: 1, 3: 1.25 },
  wrongShrink: { 1: 0.5, 2: 0.3, 3: 0 },
  rightEase: { 1: 0, 2: 0.05, 3: 0.1 },
  wrongEase: { 1: -0.1, 2: -0.2, 3: -0.3 },
  startEase: 2.3,
  minEase: 1.3,
  maxEase: 3,
  maxIntervalDays: 365,
  seedsPerBet: 1,
};

export type Health = 'bloom' | 'ok' | 'thirsty' | 'wilted';
export const HEALTHS: readonly Health[] = ['bloom', 'ok', 'thirsty', 'wilted'];

export interface GardenRules {
  /** A plant with an interval this long or longer, not yet due, is in bloom. */
  bloomIntervalDays: number;
  /** A plant this many days past due has wilted. */
  wiltAfterDays: number;
}
export const GARDEN_RULES: GardenRules = { bloomIntervalDays: 14, wiltAfterDays: 3 };

// ---------- data ----------

export interface Face {
  text: string;
  /** A downscaled photo as a data: URL, kept on the device. */
  photo?: string;
}

export interface Srs {
  /** Day number the card is next due. */
  due: number;
  /** Current interval in days; 0 = never answered right. */
  interval: number;
  ease: number;
  reps: number;
  lapses: number;
}

export interface Card {
  id: string;
  deckId: string;
  front: Face;
  back: Face;
  /** What the front shows during review when it has a photo. */
  show: 'photo' | 'text';
  srs: Srs;
}

export interface Deck {
  id: string;
  name: string;
}

export const newSrs = (today: number, rules: Rules = DEFAULT_RULES): Srs => ({ due: today, interval: 0, ease: rules.startEase, reps: 0, lapses: 0 });

// ---------- garden ----------

export function health(srs: Srs, today: number, g: GardenRules = GARDEN_RULES): Health {
  const overdue = today - srs.due;
  if (overdue >= g.wiltAfterDays) return 'wilted';
  if (overdue >= 0) return 'thirsty';
  return srs.interval >= g.bloomIntervalDays ? 'bloom' : 'ok';
}

export const needsWater = (srs: Srs, today: number): boolean => srs.due <= today;

export function tally(cards: readonly Card[], today: number): Record<Health, number> {
  const t: Record<Health, number> = { bloom: 0, ok: 0, thirsty: 0, wilted: 0 };
  for (const c of cards) t[health(c.srs, today)] += 1;
  return t;
}

/** Cards to water, most overdue first; ties keep their stored order so the queue is stable. */
export function queue(cards: readonly Card[], today: number, deckId?: string): Card[] {
  return cards
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => needsWater(c.srs, today) && (deckId === undefined || c.deckId === deckId))
    .sort((a, b) => a.c.srs.due - b.c.srs.due || a.i - b.i)
    .map(({ c }) => c);
}

// ---------- watering: the bet ----------

export interface Answer {
  bet: Bet;
  right: boolean;
}

export interface Outcome {
  srs: Srs;
  seeds: number;
  before: Health;
  after: Health;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

export function water(srs: Srs, ans: Answer, today: number, rules: Rules = DEFAULT_RULES): Outcome {
  const before = health(srs, today);
  let interval: number;
  let ease: number;
  if (ans.right) {
    ease = clamp(srs.ease + rules.rightEase[ans.bet], rules.minEase, rules.maxEase);
    interval = srs.interval === 0 ? rules.firstInterval[ans.bet] : Math.max(srs.interval + 1, Math.round(srs.interval * ease * rules.rightGrowth[ans.bet]));
  } else {
    ease = clamp(srs.ease + rules.wrongEase[ans.bet], rules.minEase, rules.maxEase);
    interval = Math.floor(srs.interval * rules.wrongShrink[ans.bet]);
  }
  interval = clamp(interval, 0, rules.maxIntervalDays);
  // A miss comes back today (interval 0); anything else waits its interval.
  const next: Srs = {
    due: today + interval,
    interval,
    ease: Math.round(ease * 100) / 100,
    reps: srs.reps + 1,
    lapses: srs.lapses + (ans.right ? 0 : 1),
  };
  const seeds = (ans.right ? 1 : -1) * ans.bet * rules.seedsPerBet;
  // Watered today: a fresh miss is still thirsty, a hit is healthy or blooming.
  return { srs: next, seeds, before, after: health(next, today + (interval === 0 ? 0 : 1)) };
}

// ---------- the solo run: one watering session ----------

export interface Run {
  seed: number;
  answered: number;
  right: number;
  seeds: number;
}

export interface Segment {
  n: number;
  bet: Bet;
  right: boolean;
}

export const SESSION = { maxCards: 200 };

export const startRun = (seed: number): Run => ({ seed, answered: 0, right: 0, seeds: 0 });

export function applySegment(rules: Rules, run: Run, seg: Segment): Run | null {
  if (seg.n !== run.answered + 1 || seg.n > SESSION.maxCards) return null;
  const seeds = (seg.right ? 1 : -1) * seg.bet * rules.seedsPerBet;
  return { ...run, answered: seg.n, right: run.right + (seg.right ? 1 : 0), seeds: run.seeds + seeds };
}

function parseSegment(raw: unknown): Segment | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).length !== 3) return null;
  const { n, bet, right } = r;
  if (!Number.isInteger(n) || typeof right !== 'boolean') return null;
  if (bet !== 1 && bet !== 2 && bet !== 3) return null;
  return { n: n as number, bet, right };
}

export const app: GameModule<Rules, null, never, null> = {
  id: config.id,
  defaultConfig: DEFAULT_RULES,
  // Solo apps have no room; these limits are unused but required by the contract.
  limits: { tickHz: 0, snapshotHz: 0, minPlayers: 1, maxPlayers: 1, maxMsgBytes: 256, maxInputsPerSec: 5 },
  parseInput: () => null,
  init: () => null,
  onInput: () => undefined,
  viewFor: () => null,
  isOver: () => true,
  solo: {
    start: (_rules, seed) => startRun(seed),
    parseSegment,
    apply: (rules, run, seg) => {
      const next = applySegment(rules, run as Run, seg as Segment);
      return next ? { run: next } : { error: 'segment does not fit the rules' };
    },
    isOver: (run) => (run as Run).answered >= SESSION.maxCards,
    score: (run) => (run as Run).seeds,
    maxSegmentBytes: 256,
    maxSegments: SESSION.maxCards,
  },
};
