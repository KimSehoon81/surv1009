// 씬 사이 데이터(scene.start(key, payload)로만 전달, 전역 변수 없음)

import type { CharacterId } from '../entities/Player';

/** 작전지도로 돌아올 때: 방금 끝난 판 */
export interface MapPayload {
  lastResult?: { stage: string; victory: boolean; merit: number };
  /** 처음 고를 지역 */
  focus?: string;
}

/** 성장 지도(출정 준비에서 열고, 닫으면 같은 지역 준비로) */
export interface WebPayload {
  char: string;
  stage: string;
}

/** 출정 준비 */
export interface PrepPayload {
  stage: string;
}

/** 전투(다시 출정은 같은 payload) */
export interface BattlePayload {
  stage: string;
  char: CharacterId;
  /** 덱 20장(없으면 기본 덱) */
  deck?: string[];
  /** 슬롯 키 → 장착 스킬(없으면 skills.json equip) */
  skills?: Record<string, string | null>;
}
