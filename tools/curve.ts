// 난이도 곡선(D29): 스테이지 S1~S5 시각별 적 체력 유입(초당)과 플레이어 기대 DPS(소총수 기준) 비교. `npm run sim:curve`
// 유입 = Σ 스폰(초당) × 적 체력 × 스케일(체력·밀도, PRD §7.3), 대군집 구간은 pacing 배율. 기대 DPS = 공격력 × 공격 속도 × (1 + 치명 기대) × 레벨 성장.
// 레벨 성장은 레벨업마다 공격·공속 약 +8%(업그레이드 평균, 중간 플레이 테스트 Lv 3·6·9를 3·8·12분에 대응). 카드·스킬·범위 무기는 뺀 보수적 비교.
import stagesData from '../src/data/stages.json';
import enemiesData from '../src/data/enemies.json';
import charactersData from '../src/data/characters.json';
import { enemyScale } from '../src/core/scaling';
import { pacingAt, phaseAt, type StageDef } from '../src/core/stage';

const STAGES = stagesData.stages as unknown as Record<string, StageDef>;
const EN = enemiesData.enemies as Record<string, { hp: number }>;
const A01 = charactersData.characters.A01.stats;
const POINTS = [
  { t: 180, lv: 3 },
  { t: 480, lv: 6 },
  { t: 720, lv: 9 },
];
const GROWTH = 1.08;
const dps = (lv: number) => A01.attack * A01.attackSpeed * (1 + A01.critChance * (A01.critMult - 1)) * GROWTH ** (lv - 1);

const rows: string[] = ['| 스테이지 | 3분 유입/DPS | 8분 유입/DPS | 12분 유입/DPS | 보스 체력 |', '| --- | --- | --- | --- | --- |'];
for (const [id, st] of Object.entries(STAGES)) {
  const n = Number(id.slice(1));
  const cells = POINTS.map(({ t, lv }) => {
    const sc = enemyScale(n, lv);
    const mult = pacingAt(st, t)?.mult ?? 1;
    const inflow = phaseAt(st, t).spawns.reduce((sum, s) => sum + s.perSec * (EN[s.enemy]?.hp ?? 0) * sc.hp, 0) * sc.density * mult;
    const d = dps(lv);
    return `${Math.round(inflow)} / ${Math.round(d)} (${(inflow / d).toFixed(2)})`;
  });
  const boss = Math.round((EN[st.boss.enemy]?.hp ?? 0) * enemyScale(n, 10).hp);
  rows.push(`| ${id} ${st.name} | ${cells.join(' | ')} | ${boss} |`);
}
console.log(rows.join('\n'));
