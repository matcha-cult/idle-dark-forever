import type { UnitLike, WorldLike } from './_shapes.js';
function getLevelBonus(level: number) {
  if (level <= 60) return level * 0.3 + 1;
  if (level <= 70) return level * 0.5 + 1 - 6;
}
export const h = {
  atk(this: UnitLike, world: WorldLike, value: number) {
    if (!this.summoner) { return 0; }
    const { player } = this.summoner;
    const level = player.getSkillLevel('summonFire');
    return (5 * getLevelBonus(player.level) * (this.summoner.int * 0.01 + 1) * (level * 0.3 + 1) * this.summoner.dmgAdd);
  },
};
