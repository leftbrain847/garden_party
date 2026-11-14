/**
 * Garden Party client. Two sides, switched only by the tab bar:
 *   Garden (review): the island of beds → water everything due, or one bed → bet seeds, flip, got it / missed.
 *   Shed (decks):    decks → cards → add or edit a card (type it, or snap a photo and transcribe it).
 * Everything stays on this device. No network calls, so the same code is the friends, Play and demo build.
 */
import config from '../../app.config.json';
import { BETS, health, newSrs, queue, tally, water, type Bet, type Card, type Face, type Health } from '../app';
import { cameraIcon, CREW, gnome, island, plant, PLANT_COLORS, seeds } from './art';
import { load, newId, save, today, type Garden, type SaveResult } from './store';

// ---------- tiny DOM helper (text only, never HTML) ----------

type Kid = Node | string | null | false | undefined;
interface Props {
  cls?: string;
  text?: string;
  on?: Partial<Record<'click' | 'input' | 'change' | 'keydown', (e: Event) => void>>;
  attrs?: Record<string, string>;
}

function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, kids: Kid[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.cls) node.className = props.cls;
  if (props.text !== undefined) node.textContent = props.text;
  for (const [k, v] of Object.entries(props.attrs ?? {})) node.setAttribute(k, v);
  for (const [ev, fn] of Object.entries(props.on ?? {})) if (fn) node.addEventListener(ev, fn);
  for (const k of kids) if (k) node.appendChild(typeof k === 'string' ? document.createTextNode(k) : k);
  return node;
}

const button = (text: string, cls: string, onClick: () => void, attrs: Record<string, string> = {}): HTMLButtonElement =>
  h('button', { cls, text, on: { click: onClick }, attrs: { type: 'button', ...attrs } });

// ---------- copy: everything the gnomes say ----------

export const LINES = {
  pipAllWatered: 'Everything is watered. Come back tomorrow and some beds will be thirsty again.',
  pipThirsty: (bed: string, n: number): string => `${bed} is drying out fastest: ${n} ${n === 1 ? 'plant needs' : 'plants need'} water.`,
  pipEmpty: 'No beds yet. Head to the Shed and plant one.',
  mossStart: 'How sure are you? Bet your seeds, then flip.',
  mossBet: (n: Bet): string => ['', 'A hunch. Small bet, small swing.', 'Pretty sure. Two seeds down.', 'Locked in. Three seeds: big bloom or a hard wilt.'][n] ?? '',
  mossRight: (n: Bet): string => ['', 'Got it! A little growth.', 'Nice. It perks right up.', 'Called it! That one is going to bloom.'][n] ?? '',
  mossWrong: (n: Bet): string => ['', 'Close one. A light wilt; it comes back today.', 'Ouch. It drooped; it comes back today.', 'Bold bet, hard wilt. It comes back today.'][n] ?? '',
  mossDone: (right: number, total: number, seeds: number): string => `All watered: ${right} of ${total} right, ${seeds >= 0 ? '+' : ''}${seeds} seeds.`,
  quillShed: 'Type a card, or snap a photo of one and I\'ll help copy out the words.',
  quillScan: 'Tap the text box, then use your keyboard\'s Scan Text to read the photo. Fix anything I got wrong.',
  quillAuto: 'I read the photo. Check my copy below.',
  saveFull: 'Your phone\'s storage for this page is full, so that change only lasts until you close it. Try smaller photos.',
  saveUnavailable: 'This browser won\'t let the page save, so your garden only lasts until you close it.',
};

// ---------- state ----------

type Screen =
  | { name: 'garden' }
  | { name: 'bed'; deckId: string }
  | { name: 'review'; deckId?: string; ids: string[]; at: number; bet: Bet | null; flipped: boolean; right: number; seeds: number; line: string }
  | { name: 'done'; right: number; total: number; seeds: number; deckId?: string }
  | { name: 'shed' }
  | { name: 'deck'; deckId: string; confirmDelete?: boolean }
  | { name: 'card'; deckId: string; cardId?: string; draft: Draft; note: string; confirmDelete?: boolean };

interface Draft {
  front: Face;
  back: Face;
  frontMode: 'type' | 'snap';
  backMode: 'type' | 'snap';
  show: 'photo' | 'text';
}

const garden: Garden = load();
let screen: Screen = { name: 'garden' };
let lastSave: SaveResult = 'saved';

function commit(): void {
  lastSave = save(garden);
}

function go(next: Screen): void {
  screen = next;
  draw();
  window.scrollTo(0, 0);
}

const deckName = (id: string): string => garden.decks.find((d) => d.id === id)?.name ?? 'Bed';
const cardsIn = (deckId: string): Card[] => garden.cards.filter((c) => c.deckId === deckId);
const firstLine = (t: string): string => t.split('\n')[0] ?? t;

// ---------- shared pieces ----------

function speech(who: keyof typeof CREW, line: string): HTMLElement {
  const g = CREW[who];
  return h('div', { cls: 'speech' }, [gnome(g, 56, `${g.name} the ${g.role}`), h('p', { cls: 'bubble' }, [h('b', { text: g.name }), ` · ${g.role}`, h('br'), line])]);
}

function top(kicker: string, title: string, sub?: string, back?: { label: string; to: Screen }): HTMLElement {
  return h('header', { cls: 'top' }, [
    back ? button(`‹ ${back.label}`, 'back', () => go(back.to)) : h('p', { cls: 'kicker', text: kicker }),
    h('h1', { text: title }),
    sub ? h('p', { cls: 'sub', text: sub }) : null,
  ]);
}

function saveNote(): HTMLElement | null {
  if (lastSave === 'saved') return null;
  return h('p', { cls: 'warn', text: lastSave === 'full' ? LINES.saveFull : LINES.saveUnavailable, attrs: { role: 'status' } });
}

function tabs(): HTMLElement {
  const onGarden = ['garden', 'bed', 'review', 'done'].includes(screen.name);
  const tab = (label: string, active: boolean, to: Screen): HTMLButtonElement =>
    button(label, active ? 'tab on' : 'tab', () => go(to), active ? { 'aria-current': 'page' } : {});
  return h('nav', { cls: 'tabs', attrs: { 'aria-label': 'Sides' } }, [tab('Garden', onGarden, { name: 'garden' }), tab('Shed', !onGarden, { name: 'shed' })]);
}

function healthLine(cards: readonly Card[]): string {
  const t = tally(cards, today());
  return (['bloom', 'ok', 'thirsty', 'wilted'] as Health[]).filter((k) => t[k] > 0).map((k) => `${t[k]} ${PLANT_COLORS[k].label}`).join(' · ');
}

// ---------- Garden side ----------

function gardenScreen(): Kid[] {
  const day = today();
  const due = queue(garden.cards, day);
  const byBed = garden.decks.map((d) => ({ d, n: due.filter((c) => c.deckId === d.id).length })).sort((a, b) => b.n - a.n);
  const worst = byBed[0];
  const pipLine = garden.decks.length === 0 ? LINES.pipEmpty : !worst || worst.n === 0 ? LINES.pipAllWatered : LINES.pipThirsty(worst.d.name, worst.n);
  return [
    top('Garden · review', 'Your garden', `${healthLine(garden.cards) || 'No plants yet'} · ${garden.seeds} seeds`),
    h('div', { cls: 'island-wrap' }, [island(garden.decks, garden.cards, day, (id) => go({ name: 'bed', deckId: id }))]),
    speech('pip', pipLine),
    due.length > 0 ? button(`Water all ${due.length} →`, 'cta', () => startReview()) : null,
    garden.decks.length > 0 ? h('p', { cls: 'hint', text: 'Or tap a bed to water just that one' }) : null,
    h(
      'div',
      { cls: 'list' },
      byBed
        .slice()
        .sort((a, b) => garden.decks.indexOf(a.d) - garden.decks.indexOf(b.d))
        .map(({ d, n }) =>
          h('button', { cls: 'row', attrs: { type: 'button' }, on: { click: () => go({ name: 'bed', deckId: d.id }) } }, [
            h('span', { cls: 'row-main' }, [h('b', { text: d.name }), h('span', { cls: n > 0 ? 'due' : 'muted', text: n > 0 ? `${n} to water` : 'all watered' })]),
            h('span', { cls: 'chev', text: '›', attrs: { 'aria-hidden': 'true' } }),
          ]),
        ),
    ),
  ];
}

function bedScreen(deckId: string): Kid[] {
  const day = today();
  const cards = cardsIn(deckId);
  const due = queue(cards, day);
  return [
    top('', deckName(deckId), [`${cards.length} plants`, healthLine(cards)].filter(Boolean).join(' · '), { label: 'Garden', to: { name: 'garden' } }),
    h(
      'div',
      { cls: 'plants' },
      cards.map((c) => {
        const hl = health(c.srs, day);
        return h('div', { cls: 'plant-tile' }, [plant(hl), h('b', { text: firstLine(c.front.text) || 'Photo card' }), h('small', { cls: `state ${hl}`, text: PLANT_COLORS[hl].label })]);
      }),
    ),
    due.length > 0 ? button(`Water this bed (${due.length}) →`, 'cta', () => startReview(deckId)) : h('p', { cls: 'hint', text: 'Every plant here is watered.' }),
  ];
}

function startReview(deckId?: string): void {
  const ids = queue(garden.cards, today(), deckId).map((c) => c.id);
  if (ids.length === 0) return;
  go({ name: 'review', deckId, ids, at: 0, bet: null, flipped: false, right: 0, seeds: 0, line: LINES.mossStart });
}

function faceView(f: Face, show: 'photo' | 'text', cls: string): HTMLElement {
  const usePhoto = show === 'photo' && f.photo;
  return h('div', { cls }, [
    usePhoto ? h('img', { cls: 'photo', attrs: { src: f.photo ?? '', alt: f.text ? `Photo: ${f.text}` : 'Photo of the card' } }) : null,
    !usePhoto ? h('p', { cls: 'card-text', text: f.text || '(no text)' }) : null,
  ]);
}

function reviewScreen(r: Extract<Screen, { name: 'review' }>): Kid[] {
  const card = garden.cards.find((c) => c.id === r.ids[r.at]);
  if (!card) return doneOrBack(r);
  const answer = (right: boolean): void => {
    if (!r.bet) return;
    const day = today();
    const out = water(card.srs, { bet: r.bet, right }, day);
    card.srs = out.srs;
    const bank = garden.seeds;
    garden.seeds = Math.max(0, garden.seeds + out.seeds);
    commit();
    const line = right ? LINES.mossRight(r.bet) : LINES.mossWrong(r.bet);
    const next = { ...r, at: r.at + 1, bet: null, flipped: false, right: r.right + (right ? 1 : 0), seeds: r.seeds + (garden.seeds - bank), line };
    if (next.at >= next.ids.length) go({ name: 'done', right: next.right, total: next.ids.length, seeds: next.seeds, deckId: r.deckId });
    else go(next);
  };
  const progress = h('progress', { attrs: { max: String(r.ids.length), value: String(r.at), 'aria-label': `Card ${r.at + 1} of ${r.ids.length}` } });
  return [
    h('header', { cls: 'top review-top' }, [button('‹ Back to garden', 'back', () => go({ name: 'garden' })), h('span', { cls: 'muted', text: `${r.at + 1} of ${r.ids.length}` })]),
    progress,
    speech('moss', r.line),
    h('section', { cls: r.flipped ? 'card flipped' : 'card', attrs: { 'aria-live': 'polite' } }, [
      h('p', { cls: 'card-deck', text: deckName(card.deckId) }),
      faceView(card.front, card.show, 'face'),
      r.flipped ? h('div', { cls: 'answer' }, [h('p', { cls: 'card-deck', text: 'Back' }), faceView(card.back, card.back.photo ? 'photo' : 'text', 'face back')]) : null,
    ]),
    !r.flipped
      ? h('div', { cls: 'bets', attrs: { role: 'group', 'aria-label': 'How sure are you?' } }, BETS.map((b) =>
          h('button', { cls: r.bet === b ? 'bet on' : 'bet', attrs: { type: 'button', 'aria-pressed': String(r.bet === b) }, on: { click: () => go({ ...r, bet: b, line: LINES.mossBet(b) }) } }, [
            seeds(b),
            h('span', { text: `${b} · ${['', 'Hunch', 'Pretty sure', 'Lock'][b]}` }),
          ]),
        ))
      : null,
    !r.flipped
      ? button(r.bet ? 'Flip it' : 'Bet first, then flip', 'cta', () => r.bet && go({ ...r, flipped: true }), r.bet ? {} : { disabled: '' })
      : h('div', { cls: 'verdict' }, [button('Missed', 'miss', () => answer(false)), button('Got it', 'hit', () => answer(true))]),
  ];
}

function doneOrBack(r: Extract<Screen, { name: 'review' }>): Kid[] {
  // The card vanished (deleted in another tab): skip it.
  const next = { ...r, at: r.at + 1 };
  if (next.at < next.ids.length) {
    screen = next;
    return reviewScreen(next);
  }
  screen = { name: 'done', right: r.right, total: r.at, seeds: r.seeds, deckId: r.deckId };
  return doneScreen(screen);
}

function doneScreen(d: Extract<Screen, { name: 'done' }>): Kid[] {
  return [
    top('Garden · review', 'All watered', undefined),
    speech('moss', LINES.mossDone(d.right, d.total, d.seeds)),
    button('Back to the garden', 'cta', () => go({ name: 'garden' })),
  ];
}

// ---------- Shed side ----------

function shedScreen(): Kid[] {
  const input = h('input', { cls: 'field', attrs: { type: 'text', placeholder: 'New deck name', maxlength: '40', 'aria-label': 'New deck name' } });
  const plantDeck = (): void => {
    const name = input.value.trim();
    if (!name) return;
    const id = newId('deck');
    garden.decks.push({ id, name });
    commit();
    go({ name: 'deck', deckId: id });
  };
  input.addEventListener('keydown', (e) => e.key === 'Enter' && plantDeck());
  return [
    top('Shed · decks', 'Potting shed', 'Make decks and cards here.'),
    speech('quill', LINES.quillShed),
    h('div', { cls: 'list' }, garden.decks.map((d) =>
      h('button', { cls: 'row', attrs: { type: 'button' }, on: { click: () => go({ name: 'deck', deckId: d.id }) } }, [
        h('span', { cls: 'row-main' }, [h('b', { text: d.name }), h('span', { cls: 'muted', text: `${cardsIn(d.id).length} cards` })]),
        h('span', { cls: 'chev', text: '›', attrs: { 'aria-hidden': 'true' } }),
      ]),
    )),
    h('div', { cls: 'new-deck' }, [input, button('Plant deck', 'build small', plantDeck)]),
  ];
}

function deckScreen(d: Extract<Screen, { name: 'deck' }>): Kid[] {
  const cards = cardsIn(d.deckId);
  const blank = (): Draft => ({ front: { text: '' }, back: { text: '' }, frontMode: 'type', backMode: 'type', show: 'text' });
  return [
    top('', deckName(d.deckId), `${cards.length} cards`, { label: 'Shed', to: { name: 'shed' } }),
    button('+ Add card', 'cta build', () => go({ name: 'card', deckId: d.deckId, draft: blank(), note: LINES.quillShed })),
    h('div', { cls: 'cards' }, cards.map((c) =>
      h('button', {
        cls: 'card-row',
        attrs: { type: 'button' },
        on: { click: () => go({ name: 'card', deckId: d.deckId, cardId: c.id, draft: { front: { ...c.front }, back: { ...c.back }, frontMode: c.front.photo ? 'snap' : 'type', backMode: c.back.photo ? 'snap' : 'type', show: c.show }, note: LINES.quillShed }) },
      }, [
        h('span', { cls: 'thumb', attrs: { 'aria-hidden': 'true' } }, [c.front.photo ? cameraIcon() : 'Aa']),
        h('span', { cls: 'f', text: firstLine(c.front.text) || 'Photo card' }),
        h('span', { cls: 'b', text: firstLine(c.back.text) }),
      ]),
    )),
    d.confirmDelete
      ? h('div', { cls: 'verdict' }, [button('Keep it', 'ghost', () => go({ ...d, confirmDelete: false })), button(`Delete ${cards.length} cards`, 'miss', () => deleteDeck(d.deckId))])
      : button('Delete this deck', 'ghost danger', () => go({ ...d, confirmDelete: true })),
  ];
}

function deleteDeck(id: string): void {
  garden.decks = garden.decks.filter((d) => d.id !== id);
  garden.cards = garden.cards.filter((c) => c.deckId !== id);
  commit();
  go({ name: 'shed' });
}

// ----- photos and transcription -----

export const PHOTO = { maxSide: 720, quality: 0.72 };

function readPhoto(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('not an image'));
      img.onload = () => {
        const k = Math.min(1, PHOTO.maxSide / Math.max(img.width, img.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * k);
        canvas.height = Math.round(img.height * k);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', PHOTO.quality));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

interface DetectedText {
  rawValue: string;
}
interface TextDetectorLike {
  detect(image: ImageBitmapSource): Promise<DetectedText[]>;
}

/** Chrome's experimental built-in text detector, when the browser has one. Everywhere else: null. */
async function autoRead(dataUrl: string): Promise<string | null> {
  const Ctor = (globalThis as unknown as { TextDetector?: new () => TextDetectorLike }).TextDetector;
  if (!Ctor) return null;
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const found = await new Ctor().detect(img);
    const text = found.map((t) => t.rawValue).join('\n').trim();
    return text || null;
  } catch {
    return null;
  }
}

function sideEditor(c: Extract<Screen, { name: 'card' }>, side: 'front' | 'back'): HTMLElement {
  const face = c.draft[side];
  const mode = side === 'front' ? c.draft.frontMode : c.draft.backMode;
  const setMode = (m: 'type' | 'snap'): void => go({ ...c, draft: side === 'front' ? { ...c.draft, frontMode: m } : { ...c.draft, backMode: m } });
  const id = `text-${side}`;
  const area = h('textarea', { cls: 'field', attrs: { id, rows: '3', maxlength: '500', placeholder: mode === 'snap' ? 'Tap here, then Scan Text' : side === 'front' ? 'Question or prompt' : 'Answer' } });
  area.value = face.text;
  area.addEventListener('input', () => {
    face.text = area.value;
  });
  const file = h('input', { cls: 'hidden-file', attrs: { type: 'file', accept: 'image/*', 'aria-label': `Photo for the ${side}` } });
  file.addEventListener('change', () => {
    const f = file.files?.[0];
    if (!f) return;
    void readPhoto(f)
      .then(async (url) => {
        face.photo = url;
        const auto = await autoRead(url);
        if (auto && !face.text) face.text = auto;
        // Only redraw if the player is still editing this card; faces are shared between draft copies, so their other edits stay.
        if (screen.name === 'card' && screen.draft[side] === face) {
          if (side === 'front') screen.draft.show = 'photo';
          go({ ...screen, note: auto ? LINES.quillAuto : LINES.quillScan });
        }
      })
      .catch(() => {
        if (screen.name === 'card' && screen.draft[side] === face) go({ ...screen, note: 'Quill couldn\'t open that photo. Try another one.' });
      });
  });
  return h('section', { cls: 'side' }, [
    h('div', { cls: 'side-head' }, [
      h('label', { cls: 'lbl', text: side === 'front' ? 'Front' : 'Back', attrs: { for: id } }),
      h('div', { cls: 'seg', attrs: { role: 'group', 'aria-label': `${side} input` } }, [
        button('Type', mode === 'type' ? 'on' : '', () => setMode('type'), { 'aria-pressed': String(mode === 'type') }),
        button('Snap', mode === 'snap' ? 'on' : '', () => setMode('snap'), { 'aria-pressed': String(mode === 'snap') }),
      ]),
    ]),
    mode === 'snap'
      ? h('div', { cls: 'snap' }, [
          face.photo ? h('img', { cls: 'photo', attrs: { src: face.photo, alt: `Photo for the ${side}` } }) : h('div', { cls: 'photo-empty', text: 'No photo yet' }),
          face.photo ? button('Remove photo', 'ghost small-ghost', () => { delete face.photo; if (side === 'front') c.draft.show = 'text'; go({ ...c }); }) : null,
          h('label', { cls: 'snap-btn', attrs: { role: 'button', tabindex: '0' }, on: { keydown: (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); file.click(); } } } }, [cameraIcon(), face.photo ? 'Retake photo' : 'Take photo', file]),
        ])
      : null,
    area,
    side === 'front' && face.photo
      ? h('div', { cls: 'show-row' }, [
          h('span', { cls: 'muted', text: 'When watering, show' }),
          h('div', { cls: 'seg' }, [
            button('Photo', c.draft.show === 'photo' ? 'on' : '', () => go({ ...c, draft: { ...c.draft, show: 'photo' } })),
            button('Text', c.draft.show === 'text' ? 'on' : '', () => go({ ...c, draft: { ...c.draft, show: 'text' } })),
          ]),
        ])
      : null,
  ]);
}

function cardScreen(c: Extract<Screen, { name: 'card' }>): Kid[] {
  const saveCard = (): void => {
    const { front, back, show } = c.draft;
    if (!front.text.trim() && !front.photo) return go({ ...c, note: 'Give the front some words or a photo first.' });
    const existing = garden.cards.find((x) => x.id === c.cardId);
    const clean = (f: Face): Face => (f.photo ? { text: f.text.trim(), photo: f.photo } : { text: f.text.trim() });
    if (existing) {
      existing.front = clean(front);
      existing.back = clean(back);
      existing.show = front.photo ? show : 'text';
    } else {
      garden.cards.push({ id: newId('card'), deckId: c.deckId, front: clean(front), back: clean(back), show: front.photo ? show : 'text', srs: newSrs(today()) });
    }
    commit();
    go({ name: 'deck', deckId: c.deckId });
  };
  const remove = (): void => {
    garden.cards = garden.cards.filter((x) => x.id !== c.cardId);
    commit();
    go({ name: 'deck', deckId: c.deckId });
  };
  return [
    top('', c.cardId ? 'Edit card' : 'New card', undefined, { label: deckName(c.deckId), to: { name: 'deck', deckId: c.deckId } }),
    speech('quill', c.note),
    sideEditor(c, 'front'),
    sideEditor(c, 'back'),
    h('div', { cls: 'verdict' }, [button('Cancel', 'ghost', () => go({ name: 'deck', deckId: c.deckId })), button('Save card', 'build', saveCard)]),
    c.cardId
      ? c.confirmDelete
        ? h('div', { cls: 'verdict' }, [button('Keep it', 'ghost', () => go({ ...c, confirmDelete: false })), button('Delete card', 'miss', remove)])
        : button('Delete card', 'ghost danger', () => go({ ...c, confirmDelete: true }))
      : null,
  ];
}

// ---------- draw ----------

function draw(): void {
  const s = screen;
  const body =
    s.name === 'garden' ? gardenScreen()
    : s.name === 'bed' ? bedScreen(s.deckId)
    : s.name === 'review' ? reviewScreen(s)
    : s.name === 'done' ? doneScreen(s)
    : s.name === 'shed' ? shedScreen()
    : s.name === 'deck' ? deckScreen(s)
    : cardScreen(s);
  const side = ['shed', 'deck', 'card'].includes(screen.name) ? 'side-shed' : 'side-garden';
  const app = document.getElementById('app');
  if (!app) return;
  app.className = side;
  app.replaceChildren(h('main', { cls: 'screen', attrs: { 'aria-label': config.title } }, [saveNote(), ...body]), tabs());
}

// Keep "today" honest if the page stays open past midnight.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (screen.name === 'garden' || screen.name === 'bed')) draw();
});

commit();
draw();

