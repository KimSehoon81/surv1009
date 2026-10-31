// 카드 루프 시뮬레이터(core만 사용, PRD §13 "카드 사용 판당 10회 이상" 점검). `npm run sim`
// 15분 런을 정책별로 N번 돌려 판당 제출·성공·인장 획득·인장 사용·조합 성공의 평균과 분포를 낸다.
// 정책: eager = 쿨다운이 풀리고 추천이 있으면 바로 제출(인장은 조합에 씀), casual = 20초마다 한 번 추천 제출.
import cardsData from '../src/data/cards.json';
import combosData from '../src/data/combos.json';
import rulesData from '../src/data/cardRules.json';
import { cardStep, createCardState, minusChanceFor, type CardData, type CardEnv, type CardRules, type CardState } from '../src/core/cards';
import { recommend } from '../src/core/cardAdvisor';
import type { ComboDef } from '../src/core/combos';
import { createRng } from '../src/core/rng';

const DATA: CardData = { cards: cardsData.cards as unknown as CardData['cards'], combos: combosData.combos as ComboDef[], rules: rulesData as unknown as CardRules };
const RUN_MS = 15 * 60_000;
const STEP_MS = 100;
const RUNS = Number(process.argv[2] ?? 1000);

interface Result {
  submits: number;
  successes: number;
  sealsGained: number;
  sealsUsed: number;
  combos: number;
  longest: number;
}

function env(now: number): CardEnv {
  return { nowMs: now, handSize: 5, drawSpeed: 1, luck: 0, extraChance: 0, opForSeal: DATA.rules.opForSeal, minusChance: minusChanceFor(1, DATA.rules) };
}

function run(seed: string, policy: 'eager' | 'casual'): Result {
  const rng = createRng(seed);
  let s: CardState = createCardState(cardsData.starterDeck, DATA, env(0), rng).state;
  const r: Result = { submits: 0, successes: 0, sealsGained: 0, sealsUsed: 0, combos: 0, longest: 0 };
  let nextCasual = 20_000;
  for (let t = 0; t < RUN_MS; t += STEP_MS) {
    s = cardStep(s, { type: 'tick', dtMs: STEP_MS }, env(t), rng, DATA).state;
    if (t < s.cooldownUntilMs) continue;
    if (policy === 'casual' && t < nextCasual) continue;
    const a = recommend(s, env(t), DATA);
    if (!a) continue;
    nextCasual = t + 20_000;
    const useSeal = s.seals > 0 && a.combo !== null;
    const step = cardStep(s, { type: 'submit', uids: a.uids, useSeal }, env(t), rng, DATA);
    s = step.state;
    for (const e of step.events) {
      if (e.type === 'judged') {
        r.submits++;
        if (e.success) r.successes++;
      }
      if (e.type === 'sealGained') r.sealsGained++;
      if (e.type === 'sealUsed') r.sealsUsed++;
      if (e.type === 'comboSkill') r.combos++;
    }
  }
  r.longest = s.stats.longestFailStreak;
  return r;
}

const pct = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))] ?? 0;
for (const policy of ['eager', 'casual'] as const) {
  const rs = Array.from({ length: RUNS }, (_, i) => run(`sim${i}`, policy));
  const col = (k: keyof Result) => rs.map((x) => x[k]).sort((a, b) => a - b);
  const mean = (k: keyof Result) => rs.reduce((m, x) => m + x[k], 0) / rs.length;
  const subs = col('submits');
  console.log(`\n[${policy}] ${RUNS}판 × 15분`);
  for (const k of ['submits', 'successes', 'sealsGained', 'sealsUsed', 'combos', 'longest'] as const) {
    const c = col(k);
    console.log(`  ${k.padEnd(12)} 평균 ${mean(k).toFixed(1).padStart(6)}  10% ${String(pct(c, 0.1)).padStart(4)}  중앙 ${String(pct(c, 0.5)).padStart(4)}  90% ${String(pct(c, 0.9)).padStart(4)}`);
  }
  const rate = rs.reduce((m, x) => m + x.successes, 0) / Math.max(1, rs.reduce((m, x) => m + x.submits, 0));
  console.log(`  실제 성공률 ${(rate * 100).toFixed(1)}% · 판당 제출 10회 이상 ${((subs.filter((n) => n >= 10).length / RUNS) * 100).toFixed(0)}%`);
}
