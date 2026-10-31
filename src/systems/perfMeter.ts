/** 프레임 안 구간별 시간(ms, 지수 이동 평균). 디버그 표시·성능 측정용 */
export class PerfMeter {
  readonly avg = new Map<string, number>();
  /** 구간별 최근 1초 최댓값 */
  readonly peak = new Map<string, number>();
  private last = 0;
  private peakReset = 0;

  start(): void {
    this.last = performance.now();
    if (this.last - this.peakReset > 1000) {
      this.peak.clear();
      this.peakReset = this.last;
    }
  }

  lap(name: string): void {
    const t = performance.now();
    const d = t - this.last;
    this.last = t;
    this.avg.set(name, (this.avg.get(name) ?? d) * 0.9 + d * 0.1);
    this.peak.set(name, Math.max(this.peak.get(name) ?? 0, d));
  }

  /** "이름 평균" 한 줄(큰 것부터) */
  summary(n = 6): string {
    return [...this.avg.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([k, v]) => `${k} ${v.toFixed(2)}`)
      .join(' · ');
  }
}
