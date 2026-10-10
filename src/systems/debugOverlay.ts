import type * as Phaser from 'phaser';
import type { GameClock } from './clock';
import { Depth } from '../config/depth';

/** F1로 켜고 끄는 디버그 표시: FPS, 개체 수, 전투 시계 + 씬이 넘겨주는 추가 정보 */
export class DebugOverlay {
  private readonly text: Phaser.GameObjects.Text;
  private elapsed = 0;
  private readonly fpsSamples: number[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly clock: GameClock,
    visible: boolean,
    private readonly extra: () => string[] = () => [],
  ) {
    this.text = scene.add
      .text(4, 4, '', { fontFamily: 'monospace', fontSize: '10px', color: '#e8ffe8', backgroundColor: '#000000a0' })
      .setScrollFactor(0)
      .setDepth(Depth.Debug)
      .setVisible(visible);
    scene.input.keyboard?.on('keydown-F1', (e: KeyboardEvent) => {
      e.preventDefault();
      this.text.setVisible(!this.text.visible);
    });
  }

  get avgFps(): number {
    return this.fpsSamples.length ? this.fpsSamples.reduce((a, b) => a + b, 0) / this.fpsSamples.length : 0;
  }

  /** 실시간 delta로 4회/초 갱신(매 프레임 텍스트 갱신은 비용이 크다) */
  update(realDeltaMs: number): void {
    if (!this.text.visible) return;
    this.elapsed += realDeltaMs;
    if (this.elapsed < 250) return;
    this.elapsed = 0;
    // 최근 10초(250ms × 40) 평균 FPS
    this.fpsSamples.push(this.scene.game.loop.actualFps);
    if (this.fpsSamples.length > 40) this.fpsSamples.shift();
    const snap = this.clock.snapshot();
    const mods = Object.entries(snap.modifiers)
      .map(([k, v]) => `${k}:${v}`)
      .join(' ');
    this.text.setText([
      `FPS ${this.scene.game.loop.actualFps.toFixed(0)} (10s avg ${this.avgFps.toFixed(1)})  objects ${this.scene.children.length}`,
      `clock x${snap.scale.toFixed(2)} t=${(snap.timeMs / 1000).toFixed(1)}s${mods ? ' ' + mods : ''}`,
      ...this.extra(),
    ]);
  }
}
