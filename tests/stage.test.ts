import { describe, expect, it } from 'vitest';
import stagesData from '../src/data/stages.json';
import enemiesData from '../src/data/enemies.json';
import floorData from '../src/data/floor.json';
import metaData from '../src/data/meta.json';
import { StageDirector, introductions, pacingAt, phaseAt, type StageDef } from '../src/core/stage';
import { Disruptions } from '../src/core/disruptions';
import { actualRate, defeatTip, meritPoints, type RunRecord } from '../src/core/results';
import { createAttackState, damageTakenMult, moveMode, stepAttack, type AttackSpec } from '../src/core/enemyAttack';

const STAGES = stagesData.stages as unknown as Record<string, StageDef>;
const S1 = STAGES.S1 as StageDef;
const ENEMIES = enemiesData.enemies as Record<string, { tier: string; attacks?: AttackSpec[] }>;
const RULES = stagesData.rules;

describe('스테이지 스키마', () => {
  it('모든 스테이지에 필수 필드가 있고 적 ID·바닥이 존재한다', () => {
    for (const [id, st] of Object.entries(STAGES)) {
      expect(st.name, id).toBeTruthy();
      expect(floorData, id).toHaveProperty(st.floor);
      expect(st.phases.length, id).toBeGreaterThan(0);
      expect(st.phases[0]?.from, id).toBe(0);
      // 구간이 빈틈없이 이어지고 마지막은 끝까지
      st.phases.forEach((p, i) => {
        const next = st.phases[i + 1];
        if (next) expect(p.to, `${id} phase ${i}`).toBe(next.from);
        else expect(p.to, `${id} last`).toBeNull();
        for (const s of p.spawns) expect(ENEMIES, `${id}:${s.enemy}`).toHaveProperty(s.enemy);
      });
      for (const e of st.elites) expect(ENEMIES[e.enemy]?.tier, `${id}:${e.enemy}`).toBe('elite');
      expect(ENEMIES[st.boss.enemy]?.tier, `${id} boss`).toBe('boss');
      expect(st.boss.warnSec).toBeGreaterThanOrEqual(15);
      for (const e of st.elites) expect(e.warnSec).toBeGreaterThanOrEqual(3);
      for (const d of st.disruptions) {
        expect(d.warnSec, `${id}:${d.type}`).toBeGreaterThanOrEqual(10);
        expect(d.source, `${id}:${d.type}`).toBeTruthy();
      }
    }
  });

  it('진행 원칙: 새 요소는 1분에 1개 이하', () => {
    for (const [id, st] of Object.entries(STAGES)) {
      const intro = introductions(st).filter((x) => x.at > 0);
      for (let i = 1; i < intro.length; i++) {
        const gap = (intro[i]?.at ?? 0) - (intro[i - 1]?.at ?? 0);
        expect(gap, `${id}: ${intro[i - 1]?.what} → ${intro[i]?.what}`).toBeGreaterThanOrEqual(RULES.newElementGapSec);
      }
    }
  });

  it('대군집 뒤에는 숨 고르기(스폰 −50%)가 바로 붙는다', () => {
    for (const st of Object.values(STAGES)) {
      st.pacing.forEach((p, i) => {
        if (p.mult <= 1) return;
        const next = st.pacing[i + 1];
        expect(next?.from).toBe(p.to);
        expect(next?.mult).toBeLessThanOrEqual(0.5);
      });
    }
  });
});

describe('스테이지 진행', () => {
  it('시간 구간별 스폰 표와 밀도 배율', () => {
    expect(phaseAt(S1, 10).spawns.map((s) => s.enemy)).toEqual(['E01']);
    expect(phaseAt(S1, 9999).to).toBeNull();
    expect(pacingAt(S1, 500)?.mult).toBe(1.8);
    expect(pacingAt(S1, 100)).toBeNull();
  });

  it('엘리트는 3초 전 예고 후 등장, 보스는 13:00 15초 전 경고', () => {
    const d = new StageDirector(S1);
    const all: [number, string][] = [];
    for (let t = 0; t <= 800; t += 0.5) for (const ev of d.update(t, 1, { enemiesOnScreen: 50 })) all.push([t, ev.type]);
    const first = (type: string) => all.find((x) => x[1] === type)?.[0];
    expect(first('eliteWarn')).toBe(237);
    expect(first('elite')).toBe(240);
    expect(first('disruptionWarn')).toBe(290);
    expect(first('disruption')).toBe(300);
    expect(first('bossWarn')).toBe(765);
    expect(first('boss')).toBe(780);
    expect(all.filter((x) => x[1] === 'boss')).toHaveLength(1);
    expect(d.spawnsAt(790).mult).toBeCloseTo(S1.boss.spawnMult);
  });

  it('Lv10에 먼저 닿으면 그때부터 15초 경고 뒤 보스', () => {
    const d = new StageDirector(S1);
    d.update(400, 9, { enemiesOnScreen: 0 });
    const warn = d.update(401, 10, { enemiesOnScreen: 0 }).find((e) => e.type === 'bossWarn');
    expect(warn).toMatchObject({ inSec: 15 });
    expect(d.update(415, 10, { enemiesOnScreen: 0 }).some((e) => e.type === 'boss')).toBe(false);
    expect(d.update(416, 10, { enemiesOnScreen: 0 }).some((e) => e.type === 'boss')).toBe(true);
  });

  it('방해는 화면 적이 적으면 미뤄진다', () => {
    const d = new StageDirector(S1);
    for (let t = 0; t <= 320; t += 1) expect(d.update(t, 1, { enemiesOnScreen: 0 }).some((e) => e.type === 'disruptionWarn')).toBe(false);
    // 5초마다 다시 보므로 적이 많아지면 5초 안에 예고
    let warned = false;
    for (let t = 321; t <= 326; t += 1) warned ||= d.update(t, 1, { enemiesOnScreen: 99 }).some((e) => e.type === 'disruptionWarn');
    expect(warned).toBe(true);
  });
});

describe('방해 관리자', () => {
  const def = (type: string, category: string, priority = 1) => ({ type, category, source: 'stage', priority, durationSec: 10 });
  it('동시 최대 2개, 카드를 가리는 방해는 1개, 우선순위가 높으면 밀어냄', () => {
    const m = new Disruptions(RULES.maxDisruptions, RULES.maxCardObscuring);
    expect(m.add(def('smoke', 'a'), 0)).toBe(true);
    expect(m.add(def('noise', 'a'), 0)).toBe(false);
    expect(m.add(def('noise', 'a', 5), 0)).toBe(true);
    expect(m.has('smoke')).toBe(false);
    expect(m.add(def('jam', 'b'), 0)).toBe(true);
    expect(m.add(def('fog', 'b'), 0)).toBe(false);
    expect(m.active).toHaveLength(2);
  });

  it('시간이 다 되면 풀리고, 통신 복구는 하나, 출처가 사라지면 그 출처 것', () => {
    const m = new Disruptions(2, 1);
    m.add(def('smoke', 'a'), 0);
    m.add({ ...def('jam', 'b'), source: 'E99' }, 0);
    expect(m.remaining('smoke', 4)).toBe(6);
    expect(m.clearSource('E99')).toBe(1);
    expect(m.update(10).map((a) => a.type)).toEqual(['smoke']);
    m.add(def('smoke', 'a'), 20);
    expect(m.clearOne()?.type).toBe('smoke');
    expect(m.clearOne()).toBeNull();
  });
});

describe('정산', () => {
  const rec = (over: Partial<RunRecord> = {}): RunRecord => ({
    victory: true, timeSec: 780, level: 10, kills: 500, eliteKills: 3, bossKill: true, submits: 40, successes: 13,
    longestFailStreak: 6, sealsUsed: 3, sealsHeld: 0, residueDamage: 120, comboSuccesses: 7, lastHitBy: 'contact', ...over,
  });
  it('전공 포인트: 식은 data, 패배는 50%', () => {
    const f = metaData.merit;
    const win = meritPoints(rec(), f);
    expect(win).toBe(Math.round(500 * f.perKill + 3 * f.perEliteKill + 10 * f.perLevel + 13 * f.perMinute + f.captureBonus + f.bossKill));
    const lose = rec({ victory: false, bossKill: false });
    expect(meritPoints(lose, f)).toBe(Math.round((500 * f.perKill + 3 * f.perEliteKill + 10 * f.perLevel + 13 * f.perMinute) * f.defeatRatio));
    expect(actualRate(rec())).toBe(33);
  });

  it('패배 원인 팁은 마지막 피격과 기록을 보고 한 줄', () => {
    const t = metaData.tips;
    expect(defeatTip(rec({ lastHitBy: 'boss:card' }), t)).toBe(t.boss);
    expect(defeatTip(rec({ lastHitBy: 'lob' }), t)).toBe(t.lob);
    expect(defeatTip(rec({ level: 2 }), t)).toBe(t.early);
    expect(defeatTip(rec({ sealsHeld: 2 }), t)).toBe(t.seals);
    expect(defeatTip(rec(), t)).toBe(t.default);
  });
});

describe('보스 작전 카드·패턴 시퀀서', () => {
  const boss = ENEMIES.E05?.attacks ?? [];
  const card = boss.find((a) => a.type === 'opCard') as AttackSpec;
  const ctx = (rand: () => number) => ({ x: 0, y: 0, targetX: 100, targetY: 0, sinceHurtMs: Infinity, rand });
  const fresh = () => {
    const s = createAttackState([card], () => 0);
    s.cooldowns = [0];
    return s;
  };

  it('3초 충전 → 판정 성공이면 예고 후 대형 착탄', () => {
    const s = fresh();
    const evs = [...stepAttack(s, [card], 16, ctx(() => 0), 600), ...stepAttack(s, [card], 3000, ctx(() => 0), 600)];
    expect(evs.map((e) => e.type)).toEqual(['windup', 'judged', 'telegraph']);
    expect(moveMode(s, [card])).toBe('hold');
  });

  it('판정 실패면 예고 없이 2초 경직 + 약점, 끝나면 원래대로', () => {
    const s = fresh();
    stepAttack(s, [card], 16, ctx(() => 0.99), 600);
    const evs = stepAttack(s, [card], 3000, ctx(() => 0.99), 600);
    expect(evs.find((e) => e.type === 'judged')).toMatchObject({ result: 'fail' });
    expect(s.phase).toBe('recover');
    expect(damageTakenMult(s, [card])).toBeCloseTo(card.weakMult ?? 1);
    stepAttack(s, [card], card.failRecoverMs ?? 0, ctx(() => 0.99), 600);
    expect(s.phase).toBe('idle');
    expect(damageTakenMult(s, [card])).toBe(1);
  });

  it('충전 중 최대 체력의 일정 비율 이상 맞으면 취소', () => {
    const s = fresh();
    stepAttack(s, [card], 16, ctx(() => 0), 600);
    s.chargeDamage = card.cancelFrac ?? 0;
    const evs = stepAttack(s, [card], 16, ctx(() => 0), 600);
    expect(evs.find((e) => e.type === 'judged')).toMatchObject({ result: 'cancel' });
    expect(s.phase).toBe('recover');
  });

  it('가중치로 패턴을 고른다(같은 난수면 같은 선택, 모두 나옴)', () => {
    const picked = new Set<string>();
    for (let k = 0; k < 20; k++) {
      const s = createAttackState(boss, () => 0);
      s.cooldowns = boss.map(() => 0);
      stepAttack(s, boss, 16, ctx(() => k / 20), 600);
      picked.add(boss[s.index]?.type ?? '');
    }
    expect([...picked].sort()).toEqual(['fanShot', 'lob', 'opCard']);
  });
});
