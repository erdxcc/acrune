import { counterSpell, seededRandom, SPELLS, type AccuracyLevel, type Element, type SpellKey } from '@grimoire/glyphs';
import type { Balance, BattleDef, CastDef, EnemyDef, SpellDef } from '../content/schema';

/**
 * Battle rules as a plain deterministic simulation: fixed 60 Hz steps, seeded
 * randomness, no Phaser. The scene feeds it casts and draws its state and
 * events. The hero stands at x = 0, enemies enter at the far end of the field;
 * enemies with speed 0 stand at their post and act once the entrance time has passed
 * (the scene shows them coming out).
 */

export const STEP_SECONDS = 1 / 60;
const HERO_REACH = 3;

export interface SimContent {
  balance: Balance;
  spells: Readonly<Record<SpellKey, SpellDef>>;
  enemy(key: string): EnemyDef;
}

export type EnemyState = 'walk' | 'ready' | 'windup' | 'transition';

export interface Enemy {
  id: number;
  def: EnemyDef;
  x: number;
  hp: number;
  maxHp: number;
  state: EnemyState;
  /** Seconds left in the current state: attack interval, cooldown, windup or transition. */
  timer: number;
  /** Spell being wound up. */
  casting: SpellKey | null;
  castCount: number;
  /** Boss phase index. */
  phase: number;
  stunLeft: number;
  slowFactor: number;
  slowLeft: number;
  burns: { dps: number; left: number }[];
  summonTimer: number;
  summonerId: number | null;
}

export interface Projectile {
  id: number;
  from: 'hero' | 'enemy';
  spell: SpellKey;
  /** Accuracy of a hero spell; null for enemy spells. */
  level: AccuracyLevel | null;
  x: number;
  speed: number;
  /** Enemy the hero spell homes on. */
  targetId: number | null;
  ownerId: number | null;
  damage: number;
}

export type Affinity = 'weak' | 'normal' | 'resist' | 'immune';

export type SimEvent =
  | { type: 'wave'; index: number; total: number }
  | { type: 'spawn'; enemyId: number }
  | { type: 'cast'; spell: SpellKey; level: AccuracyLevel; projectileId: number }
  | { type: 'noMana'; spell: SpellKey }
  | { type: 'fizzle' }
  | { type: 'backfire'; spell: SpellKey; damage: number }
  | { type: 'hit'; enemyId: number; spell: SpellKey; damage: number; affinity: Affinity; level: AccuracyLevel }
  | { type: 'enemyParry'; enemyId: number; spell: SpellKey; projectileId: number }
  | { type: 'parry'; spell: SpellKey; enemyId: number; x: number; level: AccuracyLevel }
  | { type: 'windup'; enemyId: number; spell: SpellKey; duration: number }
  | { type: 'release'; enemyId: number; spell: SpellKey; projectileId: number }
  | { type: 'melee'; enemyId: number; damage: number }
  | { type: 'heroHit'; damage: number; spell: SpellKey | null }
  | { type: 'death'; enemyId: number }
  | { type: 'phase'; enemyId: number; phase: number; duration: number }
  | { type: 'victory' }
  | { type: 'defeat' };

export interface BattleStats {
  /** Spells released, parries included. */
  casts: number;
  precise: number;
  parries: number;
  fizzles: number;
  backfires: number;
  damageTaken: number;
}

export type CastResult =
  | { kind: 'attack'; projectileId: number }
  | { kind: 'parry'; enemyId: number }
  | { kind: 'noMana' }
  | { kind: 'idle' };

interface Incoming {
  spell: SpellKey;
  timeToHit: number;
  enemyId: number;
  x: number;
  cancel: () => void;
}

export class BattleSim {
  time = 0;
  status: 'running' | 'won' | 'lost' = 'running';
  readonly hero: { hp: number; maxHp: number; mana: number; maxMana: number };
  enemies: Enemy[] = [];
  projectiles: Projectile[] = [];
  readonly stats: BattleStats = { casts: 0, precise: 0, parries: 0, fizzles: 0, backfires: 0, damageTaken: 0 };
  waveIndex = -1;

  private readonly random: () => number;
  private events: SimEvent[] = [];
  private nextId = 1;
  private waveClock = 0;
  private pending: { enemy: string; delay: number; wait?: number }[] = [];
  private betweenWaves: number | null = null;

  constructor(
    readonly battle: BattleDef,
    private readonly content: SimContent,
    seed: number,
  ) {
    const { hero } = content.balance;
    this.hero = { hp: hero.hp, maxHp: hero.hp, mana: hero.mana, maxMana: hero.mana };
    this.random = seededRandom(seed);
  }

  get fieldLength(): number {
    return this.content.balance.field.length;
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  /** Advances the battle by `seconds`, in whole fixed steps. */
  advance(seconds: number): void {
    const steps = Math.round(seconds / STEP_SECONDS);
    for (let i = 0; i < steps && this.status === 'running'; i++) this.step();
  }

  step(): void {
    if (this.status !== 'running') return;
    const dt = STEP_SECONDS;
    this.time += dt;
    const { hero } = this.content.balance;
    this.hero.mana = Math.min(this.hero.maxMana, this.hero.mana + hero.manaRegen * dt);

    this.updateWaves(dt);
    for (const enemy of [...this.enemies]) this.updateEnemy(enemy, dt);
    this.updateProjectiles(dt);

    if (this.hero.hp <= 0 && this.status === 'running') {
      this.hero.hp = 0;
      this.status = 'lost';
      this.events.push({ type: 'defeat' });
    }
  }

  /** A drawing that was not recognised: no mana is spent. */
  fizzle(): void {
    if (this.status !== 'running') return;
    this.stats.fizzles++;
    this.events.push({ type: 'fizzle' });
  }

  /** Releases a recognised spell: a parry if it answers an incoming attack, otherwise an attack. */
  cast(spell: SpellKey, level: AccuracyLevel): CastResult {
    if (this.status !== 'running') return { kind: 'idle' };
    if (level === 'failed') {
      this.fizzle();
      return { kind: 'idle' };
    }
    const def = this.content.spells[spell];
    if (this.hero.mana < def.mana) {
      this.events.push({ type: 'noMana', spell });
      return { kind: 'noMana' };
    }
    this.hero.mana -= def.mana;
    this.stats.casts++;
    if (level === 'precise') this.stats.precise++;

    if (level === 'sloppy') {
      const { backfireChance, backfireShare } = this.content.balance.accuracy.sloppy;
      if (this.random() < backfireChance) {
        const damage = def.damage * backfireShare;
        this.stats.backfires++;
        this.hurtHero(damage);
        this.events.push({ type: 'backfire', spell, damage });
      }
    }

    const parried = this.incomingAttacks()
      .filter((a) => counterSpell(a.spell) === spell)
      .sort((a, b) => a.timeToHit - b.timeToHit)[0];
    if (parried) {
      parried.cancel();
      this.stats.parries++;
      this.events.push({ type: 'parry', spell, enemyId: parried.enemyId, x: parried.x, level });
      return { kind: 'parry', enemyId: parried.enemyId };
    }

    const projectile: Projectile = {
      id: this.nextId++,
      from: 'hero',
      spell,
      level,
      x: HERO_REACH,
      speed: def.speed,
      targetId: this.nearestEnemy()?.id ?? null,
      ownerId: null,
      damage: def.damage * this.power(level),
    };
    this.projectiles.push(projectile);
    this.events.push({ type: 'cast', spell, level, projectileId: projectile.id });
    return { kind: 'attack', projectileId: projectile.id };
  }

  /** Attacks on their way to the hero: wind-ups in progress and spells in flight. */
  incomingAttacks(): Incoming[] {
    const out: Incoming[] = [];
    for (const e of this.enemies) {
      const cast = this.castOf(e);
      if (e.state === 'windup' && e.casting && cast) {
        out.push({
          spell: e.casting,
          timeToHit: e.timer + Math.max(0, e.x - e.def.size) / cast.speed,
          enemyId: e.id,
          x: e.x,
          cancel: () => this.interruptCast(e),
        });
      }
    }
    for (const p of this.projectiles) {
      if (p.from !== 'enemy' || p.ownerId === null) continue;
      out.push({
        spell: p.spell,
        timeToHit: p.x / p.speed,
        enemyId: p.ownerId,
        x: p.x,
        cancel: () => this.removeProjectile(p.id),
      });
    }
    return out;
  }

  nearestEnemy(): Enemy | undefined {
    let best: Enemy | undefined;
    for (const e of this.enemies) if (!best || e.x < best.x) best = e;
    return best;
  }

  /** Weak/resist/immune of `enemy` against `spell`, using the boss's current phase. */
  affinity(enemy: Enemy, spell: SpellKey): Affinity {
    if (enemy.state === 'transition') return 'immune';
    const defence = this.defenceOf(enemy);
    const elements = SPELLS[spell].elements;
    if (elements.every((el) => defence.immune.includes(el))) return 'immune';
    if (elements.some((el) => defence.weak.includes(el))) return 'weak';
    if (elements.every((el) => defence.resist.includes(el))) return 'resist';
    return 'normal';
  }

  castOf(enemy: Enemy): CastDef | undefined {
    if (enemy.def.kind === 'boss') return enemy.def.phases[enemy.phase]?.cast;
    return enemy.def.cast;
  }

  private defenceOf(enemy: Enemy): { weak: readonly Element[]; resist: readonly Element[]; immune: readonly Element[] } {
    if (enemy.def.kind === 'boss') return enemy.def.phases[enemy.phase] ?? enemy.def;
    return enemy.def;
  }

  private power(level: AccuracyLevel): number {
    const { accuracy } = this.content.balance;
    if (level === 'precise') return accuracy.precise.power;
    if (level === 'sloppy') return accuracy.sloppy.power;
    return accuracy.normal.power;
  }

  private multiplier(affinity: Affinity): number {
    const m = this.content.balance.element;
    return affinity === 'weak' ? m.weak : affinity === 'resist' ? m.resist : affinity === 'immune' ? m.immune : 1;
  }

  private updateWaves(dt: number): void {
    const waves = this.battle.waves;
    if (this.waveIndex < 0) {
      this.startWave(0);
      return;
    }
    this.waveClock += dt;
    while (this.pending[0] && this.pending[0].delay <= this.waveClock) this.spawnPending(this.pending.shift()!);
    if (this.pending.length > 0 || this.enemies.length > 0) return;
    if (this.waveIndex >= waves.length - 1) {
      this.status = 'won';
      this.events.push({ type: 'victory' });
      return;
    }
    this.betweenWaves ??= this.content.balance.wavePause;
    this.betweenWaves -= dt;
    if (this.betweenWaves <= 0) {
      this.betweenWaves = null;
      this.startWave(this.waveIndex + 1);
    }
  }

  private startWave(index: number): void {
    this.waveIndex = index;
    this.waveClock = 0;
    this.pending = [...this.battle.waves[index]!.spawns].sort((a, b) => a.delay - b.delay);
    this.events.push({ type: 'wave', index, total: this.battle.waves.length });
    while (this.pending[0] && this.pending[0].delay <= 0) this.spawnPending(this.pending.shift()!);
  }

  private spawnPending(entry: { enemy: string; wait?: number }): void {
    const enemy = this.spawn(entry.enemy, this.fieldLength, null);
    if (enemy.state === 'ready') enemy.timer += this.content.balance.entrance + (entry.wait ?? 0);
  }

  private spawn(key: string, x: number, summonerId: number | null): Enemy {
    const def = this.content.enemy(key);
    const standing = def.speed === 0;
    let spawnX = standing ? def.stopAt : x + def.size;
    if (summonerId === null && !standing) {
      // Queue up behind whoever is still standing at the entrance.
      for (const o of this.enemies) spawnX = Math.max(spawnX, o.x + o.def.size + def.size);
    }
    const enemy: Enemy = {
      id: this.nextId++,
      def,
      x: spawnX,
      hp: def.hp,
      maxHp: def.hp,
      state: 'walk',
      timer: 0,
      casting: null,
      castCount: 0,
      phase: 0,
      stunLeft: 0,
      slowFactor: 1,
      slowLeft: 0,
      burns: [],
      summonTimer: def.phases[0]?.summon?.every ?? 0,
      summonerId,
    };
    this.enemies.push(enemy);
    if (standing) this.becomeReady(enemy);
    this.events.push({ type: 'spawn', enemyId: enemy.id });
    return enemy;
  }

  private updateEnemy(e: Enemy, dt: number): void {
    if (!this.enemies.includes(e)) return;
    for (const burn of e.burns) {
      this.damageEnemy(e, burn.dps * Math.min(dt, burn.left));
      burn.left -= dt;
    }
    e.burns = e.burns.filter((b) => b.left > 0);
    if (!this.enemies.includes(e)) return;

    if (e.stunLeft > 0) {
      e.stunLeft -= dt;
      return;
    }
    if (e.slowLeft > 0) {
      e.slowLeft -= dt;
      if (e.slowLeft <= 0) e.slowFactor = 1;
    }
    const t = dt * e.slowFactor;

    if (e.state === 'transition') {
      e.timer -= dt;
      if (e.timer <= 0) this.becomeReady(e);
      return;
    }

    this.updateSummons(e, t);

    if (e.state === 'walk') {
      const limit = this.advanceLimit(e);
      e.x = Math.max(limit, e.x - e.def.speed * t);
      // Casters work from wherever the queue stops them; melee waits for its turn.
      if (e.x <= e.def.stopAt || (e.x <= limit && this.castOf(e))) this.becomeReady(e);
      return;
    }

    // Knocked back, or the enemy in front is gone: walk in again (a wind-up keeps going).
    if (e.state === 'ready' && e.x > this.advanceLimit(e) + 0.5) {
      e.state = 'walk';
      return;
    }

    e.timer -= t;
    if (e.timer > 0) return;
    const cast = this.castOf(e);
    if (e.state === 'windup' && e.casting && cast) {
      this.release(e, e.casting, cast);
      e.state = 'ready';
      e.casting = null;
      e.timer = cast.cooldown;
    } else if (cast) {
      e.casting = cast.spells[e.castCount++ % cast.spells.length]!;
      e.state = 'windup';
      e.timer = cast.windup;
      this.events.push({ type: 'windup', enemyId: e.id, spell: e.casting, duration: cast.windup });
    } else if (e.def.melee) {
      this.hurtHero(e.def.melee.damage);
      this.events.push({ type: 'melee', enemyId: e.id, damage: e.def.melee.damage });
      e.timer = e.def.melee.interval;
    }
  }

  /** Closest the enemy may come: its stop, or just behind an enemy ahead that stops nearer the hero. */
  private advanceLimit(e: Enemy): number {
    let limit = e.def.stopAt;
    for (const o of this.enemies) {
      if (o !== e && o.x < e.x && o.def.stopAt <= e.def.stopAt) limit = Math.max(limit, o.x + o.def.size + e.def.size);
    }
    return limit;
  }

  private becomeReady(e: Enemy): void {
    e.state = 'ready';
    e.casting = null;
    e.timer = this.castOf(e) ? 0.6 : (e.def.melee?.interval ?? 1) * 0.5;
  }

  private updateSummons(e: Enemy, dt: number): void {
    const summon = e.def.kind === 'boss' ? e.def.phases[e.phase]?.summon : undefined;
    if (!summon) return;
    e.summonTimer -= dt;
    if (e.summonTimer > 0) return;
    e.summonTimer = summon.every;
    const alive = this.enemies.filter((o) => o.summonerId === e.id).length;
    if (alive < summon.max) this.spawn(summon.enemy, e.x - e.def.size - 4, e.id);
  }

  private release(e: Enemy, spell: SpellKey, cast: CastDef): void {
    const projectile: Projectile = {
      id: this.nextId++,
      from: 'enemy',
      spell,
      level: null,
      x: Math.max(HERO_REACH, e.x - e.def.size),
      speed: cast.speed,
      targetId: null,
      ownerId: e.id,
      damage: cast.damage,
    };
    this.projectiles.push(projectile);
    this.events.push({ type: 'release', enemyId: e.id, spell, projectileId: projectile.id });
  }

  private interruptCast(e: Enemy): void {
    const cast = this.castOf(e);
    e.state = 'ready';
    e.casting = null;
    e.timer = cast?.cooldown ?? 1;
  }

  private updateProjectiles(dt: number): void {
    for (const p of [...this.projectiles]) {
      if (p.from === 'enemy') {
        p.x -= p.speed * dt;
        if (p.x <= HERO_REACH) {
          this.removeProjectile(p.id);
          this.hurtHero(p.damage);
          this.events.push({ type: 'heroHit', damage: p.damage, spell: p.spell });
        }
        continue;
      }
      let target = this.enemies.find((e) => e.id === p.targetId);
      if (!target) {
        target = this.nearestEnemy();
        p.targetId = target?.id ?? null;
      }
      p.x += p.speed * dt;
      if (target && p.x >= target.x - target.def.size) {
        this.removeProjectile(p.id);
        this.hitEnemy(target, p);
      } else if (p.x > this.fieldLength + 20) {
        this.removeProjectile(p.id);
      }
    }
  }

  private hitEnemy(target: Enemy, p: Projectile): void {
    const level = p.level ?? 'normal';
    const counter = counterSpell(p.spell);
    const cast = this.castOf(target);
    const canParry =
      target.def.parryChance > 0 &&
      counter !== undefined &&
      cast?.spells.includes(counter) &&
      (target.state === 'walk' || target.state === 'ready') &&
      target.stunLeft <= 0;
    if (canParry && this.random() < target.def.parryChance) {
      this.events.push({ type: 'enemyParry', enemyId: target.id, spell: p.spell, projectileId: p.id });
      return;
    }

    const affinity = this.affinity(target, p.spell);
    const mult = this.multiplier(affinity);
    const damage = p.damage * mult;
    this.events.push({ type: 'hit', enemyId: target.id, spell: p.spell, damage, affinity, level });
    if (mult > 0) this.applyEffects(target, p, mult);
    this.damageEnemy(target, damage);
  }

  private applyEffects(target: Enemy, p: Projectile, mult: number): void {
    const def = this.content.spells[p.spell];
    const power = this.power(p.level ?? 'normal');
    for (const effect of def.effects) {
      switch (effect.kind) {
        case 'burn':
          target.burns.push({ dps: effect.dps * power * mult, left: effect.duration });
          break;
        case 'slow':
          target.slowFactor = Math.min(target.slowFactor, effect.factor);
          target.slowLeft = Math.max(target.slowLeft, effect.duration);
          break;
        case 'stun':
          target.stunLeft = Math.max(target.stunLeft, effect.duration);
          break;
        case 'knockback':
          // A standing enemy keeps its post but loses time; a walking one is pushed back.
          if (target.def.speed === 0) target.timer += effect.distance / 25;
          else if (target.def.kind !== 'boss') target.x = Math.min(this.fieldLength, target.x + effect.distance);
          break;
        case 'area':
          for (const other of [...this.enemies]) {
            if (other === target || Math.abs(other.x - target.x) > effect.radius) continue;
            const affinity = this.affinity(other, p.spell);
            const splash = p.damage * effect.share * this.multiplier(affinity);
            this.events.push({ type: 'hit', enemyId: other.id, spell: p.spell, damage: splash, affinity, level: p.level ?? 'normal' });
            this.damageEnemy(other, splash);
          }
          break;
      }
    }
  }

  private damageEnemy(e: Enemy, damage: number): void {
    if (damage <= 0 || !this.enemies.includes(e)) return;
    e.hp -= damage;
    if (e.hp <= 0) {
      this.kill(e);
      return;
    }
    const next = e.def.phases[e.phase + 1];
    if (e.def.kind === 'boss' && next && e.hp / e.maxHp < next.below) {
      e.phase++;
      e.state = 'transition';
      e.casting = null;
      e.timer = next.transition;
      e.summonTimer = next.summon?.every ?? 0;
      e.burns = [];
      this.events.push({ type: 'phase', enemyId: e.id, phase: e.phase, duration: next.transition });
    }
  }

  private kill(e: Enemy): void {
    e.hp = 0;
    this.enemies = this.enemies.filter((o) => o !== e);
    this.events.push({ type: 'death', enemyId: e.id });
    if (e.def.kind === 'boss') for (const minion of this.enemies.filter((o) => o.summonerId === e.id)) this.kill(minion);
  }

  private hurtHero(damage: number): void {
    this.hero.hp -= damage;
    this.stats.damageTaken += damage;
  }

  private removeProjectile(id: number): void {
    this.projectiles = this.projectiles.filter((p) => p.id !== id);
  }
}
