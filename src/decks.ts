/**
 * The three starter beds. Pure data plus one builder: given "today", it spreads the plants across every
 * health state so a new garden has something to water and something already blooming.
 */
import type { Card, Deck } from './app';

interface SeedDeck {
  id: string;
  name: string;
  cards: [front: string, back: string][];
}

export const STARTER_DECKS: SeedDeck[] = [
  {
    id: 'harry-potter',
    name: 'Harry Potter',
    cards: [
      ["Harry's owl", 'Hedwig'],
      ["Ron's rat (and who it really is)", 'Scabbers, who is really Peter Pettigrew.'],
      ['Platform for the Hogwarts Express', 'Platform Nine and Three-Quarters'],
      ['The four Hogwarts houses', 'Gryffindor, Hufflepuff, Ravenclaw, Slytherin'],
      ['The Disarming Charm', 'Expelliarmus'],
      ['The spell that casts a Patronus', 'Expecto Patronum'],
      ["Harry's Patronus", 'A stag'],
      ["Harry's Quidditch position", 'Seeker'],
      ["Hermione's cat", 'Crookshanks'],
      ['The Half-Blood Prince', 'Severus Snape'],
      ['What Dobby is', 'A house-elf'],
      ["Voldemort's birth name", 'Tom Marvolo Riddle'],
    ],
  },
  {
    id: 'clean-energy',
    name: 'Clean energy',
    cards: [
      ['What a solar PV cell does', 'Turns sunlight straight into electricity (the photovoltaic effect).'],
      ['Power vs energy units', 'Power is watts (kW, MW); energy is watt-hours (kWh, MWh).'],
      ['Capacity factor', 'Actual output over a period ÷ what it would make at full nameplate capacity.'],
      ['How a heat pump beats a heater', 'It moves heat instead of making it, so it delivers more heat than the electricity it uses.'],
      ['Green hydrogen', 'Hydrogen made by electrolysis powered by renewable electricity.'],
      ['Curtailment', 'Deliberately cutting renewable output because the grid can\'t use or move it.'],
      ['Pumped hydro storage', 'Pump water uphill when power is cheap; run it back through turbines when it\'s needed.'],
      ['LCOE', 'Levelized cost of energy: lifetime cost ÷ lifetime energy produced.'],
      ['Wind power vs wind speed', 'Power rises with the cube of wind speed (up to the turbine\'s rated speed).'],
      ['Geothermal power', 'Heat from inside the Earth makes steam that drives turbines.'],
      ['Net metering', 'Crediting rooftop-solar owners for power they send back to the grid.'],
      ['The duck curve', 'Net demand dips at midday as solar floods in, then ramps steeply in the evening.'],
    ],
  },
  {
    id: 'us-civics',
    name: 'US civics',
    cards: [
      ['The supreme law of the land', 'The Constitution'],
      ['The first ten amendments', 'The Bill of Rights'],
      ['How many amendments the Constitution has', '27'],
      ['The three branches of government', 'Legislative, executive and judicial'],
      ['How many US senators', '100 (two per state)'],
      ["A senator's term", '6 years'],
      ["A representative's term", '2 years'],
      ['Voting members of the House', '435'],
      ["The president's term", '4 years'],
      ['Who can declare war', 'Congress'],
      ['Electoral votes needed to win the presidency', '270'],
      ['Overriding a presidential veto', 'Two-thirds of both the House and the Senate'],
      ['Judicial review', 'Courts can strike down laws that conflict with the Constitution.'],
    ],
  },
];

/** [days until due, interval]: a repeating spread across wilted, thirsty, healthy and blooming plants. */
export const STARTER_SPREAD: [number, number][] = [
  [0, 2], [6, 20], [3, 6], [-4, 3], [9, 30], [2, 5], [-1, 4], [1, 3], [12, 15], [0, 1], [4, 8], [-5, 2], [7, 18], [5, 9],
];

export function starterGarden(today: number, startEase: number): { decks: Deck[]; cards: Card[] } {
  const decks: Deck[] = STARTER_DECKS.map((d) => ({ id: d.id, name: d.name }));
  const cards: Card[] = [];
  STARTER_DECKS.forEach((d, di) => {
    d.cards.forEach(([front, back], i) => {
      const [dueIn, interval] = STARTER_SPREAD[(i + di * 3) % STARTER_SPREAD.length] ?? [0, 0];
      cards.push({
        id: `${d.id}-${i + 1}`,
        deckId: d.id,
        front: { text: front },
        back: { text: back },
        show: 'text',
        srs: { due: today + dueIn, interval, ease: startEase, reps: interval > 0 ? 2 : 0, lapses: 0 },
      });
    });
  });
  return { decks, cards };
}
