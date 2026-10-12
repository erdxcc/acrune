import type { z } from 'zod';
import type { balanceSchema } from './schema';

export const balance: z.input<typeof balanceSchema> = {
  hero: { hp: 100, mana: 100, manaRegen: 10 },
  accuracy: {
    precise: { power: 1.5 },
    normal: { power: 1 },
    sloppy: { power: 0.7, backfireChance: 0.4, backfireShare: 0.5 },
  },
  element: { weak: 2, resist: 0.5, immune: 0 },
  field: { length: 100 },
  wavePause: 1.5,
  entrance: 0.9,
  // Time to start the second glyph of a combination after lifting the finger.
  comboWindowMs: 650,
};
