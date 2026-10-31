// 효과음 굽기(tools/audio/bake)용 순수 함수: 앞 무음 자르기, 피크 정규화, 16비트 모노 WAV 인코딩. Phaser 없음.

/** 앞 무음을 keepMs만 남기고 자른다(PRD §11: 앞 무음 5ms 이하). threshold = 진폭 */
export function trimLeading(data: Float32Array, sampleRate: number, keepMs = 5, threshold = 0.002): Float32Array {
  let first = 0;
  while (first < data.length && Math.abs(data[first] ?? 0) < threshold) first++;
  const keep = Math.floor((keepMs / 1000) * sampleRate);
  return data.slice(Math.max(0, first - keep));
}

/** 앞 무음 길이(ms) */
export function leadingSilenceMs(data: Float32Array, sampleRate: number, threshold = 0.002): number {
  let first = 0;
  while (first < data.length && Math.abs(data[first] ?? 0) < threshold) first++;
  return (first / sampleRate) * 1000;
}

export function peak(data: Float32Array): number {
  let p = 0;
  for (const v of data) p = Math.max(p, Math.abs(v));
  return p;
}

/** 피크를 peakDb(dBFS)에 맞춘다 */
export function normalize(data: Float32Array, peakDb = -1): Float32Array {
  const p = peak(data);
  if (p <= 0) return data.slice();
  const k = 10 ** (peakDb / 20) / p;
  return data.map((v) => v * k);
}

/** 16비트 PCM 모노 WAV */
export function encodeWav(data: Float32Array, sampleRate: number): Uint8Array {
  const bytes = 44 + data.length * 2;
  const buf = new ArrayBuffer(bytes);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, bytes - 8, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) {
    const s = Math.max(-1, Math.min(1, data[i] ?? 0));
    v.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return new Uint8Array(buf);
}
