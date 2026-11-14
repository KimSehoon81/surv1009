import * as Phaser from 'phaser';
import sfxData from '../data/sfx.json';
import { createRng } from '../core/rng';
import { AudioSystem, fromFile, type VolumeSettings } from '../systems/audio';
import { LOGICAL_WIDTH } from '../config/display';
import { SceneKey } from './keys';
import { t } from '../i18n';
import { uiText } from '../ui/text';

const style = (size: number, color = '#e8dcc0'): Phaser.Types.GameObjects.Text.TextStyle => uiText(size, color);

/**
 * 소리 검수 화면(?gallery=audio): 소리마다 버튼(클릭 = 재생, Shift+클릭 = 10번 연타로 보이스 상한·쿨다운 시험),
 * BGM 곡 전환, 볼륨(BGM·효과음·UI, 저장됨). 파일에서 온 소리는 [파일] 표시.
 */
export class AudioGalleryScene extends Phaser.Scene {
  private audio!: AudioSystem;
  private stats!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.AudioGallery);
  }

  create(): void {
    this.audio = new AudioSystem(this, createRng('audio-gallery'));
    this.add.text(12, 8, t('audioGallery.title'), style(13, '#ffe14d'));
    const cues = Object.keys(sfxData.cues);
    const cols = 4;
    const w = (LOGICAL_WIDTH - 24) / cols;
    cues.forEach((cue, i) => {
      const src = (sfxData.cues as Record<string, { src: string }>)[cue]?.src ?? '';
      const label = this.add
        .text(12 + (i % cols) * w, 32 + Math.floor(i / cols) * 18, `${cue}${fromFile.has(src) ? ` ${t('audioGallery.file')}` : ''}`, style(12))
        .setInteractive({ useHandCursor: true });
      label.on('pointerdown', (p: Phaser.Input.Pointer) => {
        const burst = (p.event as MouseEvent).shiftKey ? 10 : 1;
        for (let k = 0; k < burst; k++) this.time.delayedCall(k * 30, () => this.audio.play(cue, undefined, undefined, { combo: k + 1 }));
      });
    });
    const y = 40 + Math.ceil(cues.length / cols) * 18;
    this.add.text(12, y, 'BGM:', style(12, '#7fd8ff'));
    const OFF = t('audioGallery.off');
    [...Object.keys(sfxData.bgm.tracks), OFF].forEach((name, i) => {
      this.add
        .text(60 + i * 120, y, name, style(12, '#7fd8ff'))
        .setInteractive({ useHandCursor: true })
        .on('pointerdown', () => this.audio.playBgm(name === OFF ? null : name));
    });
    (['master', 'bgm', 'sfx', 'ui'] as (keyof VolumeSettings)[]).forEach((bus, i) => {
      const yy = y + 24 + i * 18;
      const label = this.add.text(12, yy, '', style(12));
      const show = () => label.setText(`${bus} ${Math.round(this.audio.volumes[bus] * 100)}%`);
      show();
      const btn = (x: number, d: number, s: string) =>
        this.add
          .text(x, yy, s, style(12, '#ffe14d'))
          .setInteractive({ useHandCursor: true })
          .on('pointerdown', () => {
            this.audio.setVolume(bus, this.audio.volumes[bus] + d);
            show();
          });
      btn(130, -0.1, '[−]');
      btn(160, 0.1, '[+]');
    });
    this.stats = this.add.text(12, y + 110, '', style(12, '#b0a890'));
  }

  override update(): void {
    this.audio.update({ paused: false, slowmo: false, judge: false }, 0, 0);
    this.stats.setText(t('audioGallery.stats', { played: this.audio.played, dropped: this.audio.dropped, voices: this.audio.activeVoices, bgm: this.audio.bgmPlaying ?? t('audioGallery.noBgm') }));
  }
}
