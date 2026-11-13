// 밸런스 해석 모델(D39): 스테이지별 시간 축 '기대 DPS ÷ 필요 DPS'와 예상 클리어 시간·생존 근사. `npm run sim:balance`(-- --write면 docs/BALANCE.md 표 갱신)
// 필요 DPS = 그 시각 스폰 표의 적 체력 유입(초당, 스케일링·대군집 배율 포함). 기대 DPS = 무기 × 레벨 성장 × 메타 성장 × 범위 배수 + 고급 스킬 + 카드.
// 가정은 src/data/balance.json. 절대값보다 S1 대비 상대값(정규화 비율)을 본다: S1 = 클리어율 40~60% 기준.
import { readFileSync, writeFileSync } from 'node:fs';
import stagesData from '../src/data/stages.json';
import enemiesData from '../src/data/enemies.json';
import charactersData from '../src/data/characters.json';
import skillsData from '../src/data/skills.json';
import timelinesData from '../src/data/timelines.json';
import B from '../src/data/balance.json';
import { enemyScale } from '../src/core/scaling';
import { earlySpawns, pacingAt, phaseAt, type StageDef } from '../src/core/stage';

const STAGES = stagesData.stages as unknown as Record<string, StageDef>;
const EN = enemiesData.enemies as Record<string, { hp: number }>;
const CH = Object.values(charactersData.characters).map((c) => c.stats);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
// 캐릭터 30명 평균(기대값): 공격 × 공속 × 치명 기대
const BASE = avg(CH.map((s) => s.attack * s.attackSpeed * (1 + s.critChance * (s.critMult - 1))));
const ATK = avg(CH.map((s) => s.attack));
const TL = timelinesData.timelines as Record<string, { events: { damage?: number; repeat?: { count: number } }[]; with?: string[] }>;
const SK = skillsData.skills as Record<string, { slot: string; cooldownMs: number; timeline?: string; unlock: string }>;

/** 스킬 한 번의 피해 배수 합(이벤트 damage × 반복 수, with 포함) */
function castMult(id: string, depth = 0): number {
  const t = TL[id];
  if (!t || depth > 2) return 0;
  return t.events.reduce((s, e) => s + (e.damage ?? 0) * (e.repeat?.count ?? 1), 0) + (t.with ?? []).reduce((s, w) => s + castMult(w, depth + 1), 0);
}

const levelAt = (t: number) => {
  let lv = 1;
  for (const [sec, l] of B.levelAt as number[][]) if (t >= (sec ?? 0)) lv = l ?? lv;
  return lv;
};

/** 스테이지 n에서 열린 슬롯마다 해금된 가장 센 스킬의 초당 피해(플레이어 공격 기준) */
function skillDps(n: number, lv: number): number {
  const open = Object.entries(B.slotOpenStage).filter(([, s]) => n >= s).map(([k]) => k);
  let sum = 0;
  for (const slot of open) {
    const unlocked = Object.entries(SK).filter(([, s]) => s.slot === slot && (s.unlock === '시작' || Number(s.unlock.replace(/[^0-9]/g, '')) < n));
    const best = Math.max(0, ...unlocked.map(([, s]) => (castMult(s.timeline ?? '') * B.skillTargets) / (s.cooldownMs / 1000)));
    sum += best;
  }
  return sum * ATK * (1 + B.levelGrowth) ** (lv - 1) * B.skillUptime;
}

function expected(n: number, t: number): number {
  const lv = levelAt(t);
  const grow = (1 + B.levelGrowth) ** (lv - 1) * (1 + B.metaPerStage * (n - 1));
  const weapon = BASE * grow * B.aoeMul;
  return weapon * (1 + B.cardShare) + skillDps(n, lv);
}

function required(st: StageDef, n: number, t: number): number {
  const sc = enemyScale(n, levelAt(t));
  const mult = pacingAt(st, t)?.mult ?? 1;
  return earlySpawns(st, phaseAt(st, t).spawns, t).reduce((s, sp) => s + sp.perSec * (EN[sp.enemy]?.hp ?? 0) * sc.hp, 0) * sc.density * mult * (st.spawnScale ?? 1);
}

const rows: { id: string; name: string; r: number[]; norm: number[]; clear: number; surv: number }[] = [];
let s1: number[] = [];
for (const [id, st] of Object.entries(STAGES)) {
  const n = Number(id.slice(1));
  const r = (B.levelAt as number[][]).map(([t = 0]) => expected(n, t) / required(st, n, t));
  if (n === 1) s1 = r;
  const norm = r.map((v, i) => v / (s1[i] ?? v));
  const boss = (EN[st.boss.enemy]?.hp ?? 0) * enemyScale(n, 10).hp;
  const clear = B.bossAt + boss / (expected(n, B.bossAt) * B.bossFocus);
  // 생존 근사: S1 정규화 비율 1 → 50%, 비율이 두 배면 약 80%, 절반이면 약 20%
  const g = Math.exp(avg(norm.slice(1).map((v) => Math.log(v))));
  const surv = 1 / (1 + Math.exp(-2 * Math.log(g) / Math.log(2) * 0.7));
  rows.push({ id, name: st.name, r, norm, clear, surv });
}
const fmt = (v: number) => v.toFixed(2);
const out = [
  '| 스테이지 | 3분 기대/필요 | 8분(대군집) | 12분 | S1 대비(3·8·12분) | 예상 점령 | 생존 근사 |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...rows.map((x) => {
    // 3분은 도입부(S1~S3 초반 밀도 가산이 있어 S1 대비는 의미가 약함): 절대 비율 ≥ 1만 보고, 띠는 8·12분
    const inBand = (x.r[0] ?? 0) >= 1 && x.norm.slice(1).every((v) => v >= B.band[0]! && v <= B.band[1]!);
    return `| ${x.id} ${x.name} | ${fmt(x.r[0]!)} | ${fmt(x.r[1]!)} | ${fmt(x.r[2]!)} | ${x.norm.map(fmt).join(' · ')}${inBand ? '' : ' ⚠'} | ${Math.floor(x.clear / 60)}:${String(Math.round(x.clear % 60)).padStart(2, '0')} | ${Math.round(x.surv * 100)}% |`;
  }),
].join('\n');
console.log(out);
if (process.argv.includes('--write')) {
  const path = 'docs/BALANCE.md';
  const doc = readFileSync(path, 'utf8');
  const a = '<!-- sim:balance -->';
  const b = '<!-- /sim:balance -->';
  const next = doc.replace(new RegExp(`${a}[\\s\\S]*?${b}`), `${a}\n${out}\n${b}`);
  writeFileSync(path, next);
  console.log(`\n${path} 갱신`);
}
