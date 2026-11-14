/**
 * The garden lives on this device only (localStorage). Storage can be missing or full, for example in a
 * private tab or an artifact preview: then the garden still works for the session and simply isn't saved.
 */
import { DEFAULT_RULES, type Card, type Deck } from '../app';
import { starterGarden } from '../decks';

export const STORE = { key: 'garden-party:v1', version: 1 };

export interface Garden {
  version: number;
  decks: Deck[];
  cards: Card[];
  seeds: number;
}

/** Day number in the player's own time zone: whole days since 1970-01-01. */
export function today(now: Date = new Date()): number {
  return Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86_400_000);
}

function fresh(): Garden {
  const g = starterGarden(today(), DEFAULT_RULES.startEase);
  return { version: STORE.version, decks: g.decks, cards: g.cards, seeds: 0 };
}

function isGarden(x: unknown): x is Garden {
  const g = x as Garden;
  return typeof g === 'object' && g !== null && g.version === STORE.version && Array.isArray(g.decks) && Array.isArray(g.cards) && typeof g.seeds === 'number';
}

export function load(): Garden {
  try {
    const raw = localStorage.getItem(STORE.key);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isGarden(parsed)) return parsed;
    }
  } catch {
    /* no storage here: start fresh for this session */
  }
  return fresh();
}

export type SaveResult = 'saved' | 'full' | 'unavailable';

export function save(g: Garden): SaveResult {
  try {
    localStorage.setItem(STORE.key, JSON.stringify(g));
    return 'saved';
  } catch (e) {
    return e instanceof DOMException && /quota/i.test(e.name) ? 'full' : 'unavailable';
  }
}

let counter = 0;
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;
