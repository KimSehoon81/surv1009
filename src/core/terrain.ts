// 바닥 지형 무늬(2026-11-14, 사용자 요청 '개울·풀밭·계절 눈밭'): 개울은 월드 좌표 곡선이라 청크 경계에서 끊기지 않고,
// 풀숲·눈 더미·낙엽은 청크마다 시드로 정해진 자리. 그림 타일 위에 코드로 그린다(systems/floor). Phaser 없음
import { createRng, hashString } from './rng';

export type Season = 'summer' | 'autumn' | 'late' | 'winter';

export interface StreamCfg {
  /** 개울 사이 간격(px). 원점(출정 자리)은 두 개울 한가운데 */
  spacing: number;
  /** 굽이 크기(px)와 한 굽이 길이(px) */
  amp: number;
  wavelength: number;
  /** 폭 [최소, 최대] px */
  width: number[];
  /** h = 동서로 흐름, v = 남북으로 */
  dir?: 'h' | 'v';
  /** 얼어붙음(겨울): 느려지지 않음 */
  frozen?: boolean;
}

export interface TerrainCfg {
  season: Season;
  streams?: StreamCfg;
  /** 청크(512px)당 [최소, 최대] 개수 */
  grass?: number[];
  snow?: number[];
  leaves?: number[];
  /** 잔해(돌·웅덩이·구덩이·탄피 등, 그림이 있을 때만) [최소, 최대] */
  debris?: number[];
  /** 잔해 목록 이름(terrain.json decals.debris, 없으면 계절) */
  debrisSet?: string;
  /** 개울을 건널 때 이동 속도 배율 감소(0.25 = −25%) */
  wade?: number;
}

const TAU = Math.PI * 2;
const unit = (seed: number, k: number, salt: number): number => hashString(`${seed}:${k}:${salt}`) / 0x1_0000_0000;

/** k번째 개울의 중심선(가로 좌표 along에서의 세로 위치)과 반폭 */
export function streamAt(s: StreamCfg, seed: number, k: number, along: number): { center: number; half: number } {
  const p1 = unit(seed, k, 1) * TAU;
  const p2 = unit(seed, k, 2) * TAU;
  const p3 = unit(seed, k, 3) * TAU;
  const center = (k + 0.5) * s.spacing + s.amp * (Math.sin((along / s.wavelength) * TAU + p1) * 0.75 + Math.sin((along / (s.wavelength * 0.43)) * TAU + p2) * 0.25);
  const [lo = 12, hi = lo] = s.width;
  const half = (lo + (hi - lo) * (0.5 + 0.5 * Math.sin(along / 170 + p3))) / 2;
  return { center, half };
}

/** 가로지르는 좌표 구간 [a0, a1]에 걸칠 수 있는 개울 번호들 */
export function streamsNear(s: StreamCfg, a0: number, a1: number): number[] {
  const pad = s.amp + (s.width[1] ?? s.width[0] ?? 0);
  const k0 = Math.floor((a0 - pad) / s.spacing - 0.5);
  const k1 = Math.ceil((a1 + pad) / s.spacing - 0.5);
  const out: number[] = [];
  for (let k = k0; k <= k1; k++) out.push(k);
  return out;
}

/** 월드 좌표가 개울 물 위인지(둑 제외) */
export function inStream(s: StreamCfg, seed: number, x: number, y: number): boolean {
  const along = s.dir === 'v' ? y : x;
  const across = s.dir === 'v' ? x : y;
  for (const k of streamsNear(s, across, across)) {
    const { center, half } = streamAt(s, seed, k, along);
    if (Math.abs(across - center) <= half) return true;
  }
  return false;
}

export interface Spot {
  x: number;
  y: number;
  /** 크기 0~1 */
  size: number;
  /** 무늬 고르기용 0~1 */
  v: number;
}

/** 청크 안 풀숲·눈 더미·낙엽 자리(청크 왼쪽 위 기준 px), 개울 물 위는 뺌 */
export function chunkSpots(t: TerrainCfg, seed: number, cx: number, cy: number, size: number): { grass: Spot[]; snow: Spot[]; leaves: Spot[]; debris: Spot[] } {
  const rng = createRng(`${seed}:terrain:${cx}:${cy}`);
  const pick = (r: number[] | undefined): Spot[] => {
    if (!r) return [];
    const [lo = 0, hi = lo] = r;
    const n = lo + Math.floor(rng.next() * (hi - lo + 1));
    const out: Spot[] = [];
    for (let i = 0; i < n; i++) {
      const x = 16 + rng.next() * (size - 32);
      const y = 16 + rng.next() * (size - 32);
      const spot = { x, y, size: rng.next(), v: rng.next() };
      if (t.streams && inStream(t.streams, seed, cx * size + x, cy * size + y)) continue;
      out.push(spot);
    }
    return out;
  };
  // 순서를 지켜야 이미 있던 자리(풀숲·눈·낙엽)가 바뀌지 않음: 잔해는 맨 뒤
  const grass = pick(t.grass);
  const snow = pick(t.snow);
  const leaves = pick(t.leaves);
  return { grass, snow, leaves, debris: pick(t.debris) };
}
