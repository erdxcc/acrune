import type { z } from 'zod';
import type { battleSchema } from './schema';

type Waves = z.input<typeof battleSchema>['waves'];

/** Enemies that come out one at a time: each is a wave of its own, the next walks in after it falls. */
function inTurn(...enemies: string[]): Waves {
  return enemies.map((enemy) => ({ spawns: [{ enemy, delay: 0 }] }));
}

/**
 * Battle ids match BATTLES in @grimoire/glyphs (order, unlocks, page limits). A location whose
 * painting has not arrived yet (bg_location<n>) shows the chapter background instead.
 */
export const battles: z.input<typeof battleSchema>[] = [
  {
    id: 'c1-b1',
    name: 'The Ember Road',
    brief: 'Three slime mages block the road, one after another. Fire dries them out, and fire answers their water.',
    background: 'bg_location1',
    waves: inTurn('slime_mage', 'slime_mage', 'slime_mage'),
  },
  {
    id: 'c1-b2',
    name: 'The Flooded Mill',
    brief: 'Two slimes come first, then the skeleton mage they guard. Answer his flames with water.',
    background: 'bg_location2',
    waves: inTurn('slime_mage', 'slime_mage', 'skeleton_mage'),
  },
  {
    id: 'c1-b3',
    name: 'Windbreak Pass',
    brief: 'Three skeletons hold the pass, one by one. Earth answers their wind; the mage among them throws fire.',
    background: 'bg_location3',
    waves: inTurn('skeleton', 'skeleton_mage', 'skeleton'),
  },
  {
    id: 'c1-boss',
    name: 'The Sundered Gate',
    brief: 'The Warden changes its nature when wounded. Read it, and answer.',
    background: 'bg_location4',
    waves: inTurn('gate_warden'),
  },
];
