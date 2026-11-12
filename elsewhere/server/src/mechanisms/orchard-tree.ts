import {
  DAY,
  act,
  control,
  hash,
  listOf,
  numberOf,
  plural,
  type Mechanism,
  type MechanismState,
} from './common.js';

/** Fruit set on a day stays on the low branch for this many days, then is gone. */
const LIFE_DAYS = 12;
const MAX_ON_GROUND = 999;

interface Fruit {
  day: number;
  index: number;
  /** 0 (just set) to 1 (fully ripe). */
  ripeness: number;
  age: number;
}

/** The apples on the low branch at a time, minus those already shaken down. */
function branchAt(id: string, state: MechanismState, now: number): Fruit[] {
  const today = Math.floor(now / DAY);
  const gone = listOf(state, 'gone');
  const fruit: Fruit[] = [];
  for (let day = today - LIFE_DAYS + 1; day <= today; day++) {
    const set = 1 + Math.floor(hash(`${id}:set:${day}`) * 3);
    let removed = 0;
    for (let i = 0; i < gone.length; i += 2) if (gone[i] === day) removed = gone[i + 1];
    const age = Math.max(0, now - day * DAY) / DAY;
    for (let index = removed; index < set; index++)
      fruit.push({ day, index, age, ripeness: Math.min(1, age / LIFE_DAYS) });
  }
  return fruit;
}

/** Natural history: a low branch of fruit that sets, ripens and can be shaken down. */
export const orchardTree: Mechanism = {
  controls: [
    act('count', 'count the apples on the low branch and on the ground'),
    control('shake', 'shake the low branch', 1, 5, 'strength of the shake'),
  ],
  run: ({ control: id, value, state, object, now }) => {
    const fruit = branchAt(object.id, state, now);
    const ground = numberOf(state, 'ground', 0);
    if (id === 'count') {
      const small = fruit.filter((item) => item.age < 4).length;
      const large = fruit.filter((item) => item.age >= 8).length;
      const middling = fruit.length - small - large;
      return {
        reading: `On the low branch there are ${small} small, ${middling} middling and ${large} large apples; ${ground} ${plural(ground, 'apple lies', 'apples lie')} on the ground.`,
      };
    }
    const strength = value as number;
    const uses = numberOf(state, 'uses', 0);
    const gone = new Map<number, number>();
    const stored = listOf(state, 'gone');
    for (let i = 0; i < stored.length; i += 2) gone.set(stored[i], stored[i + 1]);
    let fell = 0;
    for (const item of fruit) {
      const chance = Math.min(0.95, strength * 0.13 * (0.1 + 1.4 * item.ripeness));
      if (hash(`${object.id}:shake:${uses}:${item.day}:${item.index}`) < chance) {
        gone.set(item.day, (gone.get(item.day) ?? 0) + 1);
        fell++;
      }
    }
    const today = Math.floor(now / DAY);
    const kept = [...gone.entries()]
      .filter(([day]) => day > today - LIFE_DAYS)
      .sort((a, b) => a[0] - b[0])
      .flat();
    const onGround = Math.min(MAX_ON_GROUND, ground + fell);
    return {
      reading: `A shake of strength ${strength} brought down ${fell} ${plural(fell, 'apple')}; ${onGround} ${plural(onGround, 'apple lies', 'apples lie')} on the ground now.`,
      state: { ...state, gone: kept, ground: onGround },
    };
  },
};
