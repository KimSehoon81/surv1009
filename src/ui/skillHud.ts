import type * as Phaser from 'phaser';
import skillsData from '../data/skills.json';
import hud from '../data/hud.json';
import { manifest } from '../assets/manifest';
import type { SkillSlots } from '../core/skills';
import { LOGICAL_WIDTH } from '../config/display';
import { PIXEL_FONT } from './pixelFont';
import { uiText } from './text';

const S = hud.skills;
const BOX = S.box;
const GAP = S.gap;

/**
 * 고급 스킬 슬롯 4칸(Q·E·R·F)과 TP 게이지(화면 오른쪽 위, PRD §11 HUD 배치).
 * 크게 보되 전장을 가리지 않게 판은 옅게(hud.json skills.panelAlpha): 쓸 수 있으면 밝은 테두리가 맥박치고,
 * 쿨다운은 위에서부터 덮이며 남은 초를 가운데에, TP가 모자라면 비용이 붉게
 */
export class SkillHud {
  private readonly gfx: Phaser.GameObjects.Graphics;
  private readonly icons: (Phaser.GameObjects.Image | null)[] = [];
  private readonly costs: Phaser.GameObjects.BitmapText[] = [];
  private readonly cds: Phaser.GameObjects.BitmapText[] = [];
  private readonly tpText: Phaser.GameObjects.BitmapText;
  private readonly w = 4 * BOX + 3 * GAP;
  private readonly x0 = LOGICAL_WIDTH - S.right - (4 * BOX + 3 * GAP);
  private readonly y0 = S.top;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly skills: SkillSlots,
    private readonly now: () => number,
  ) {
    this.gfx = scene.add.graphics();
    skills.slots.forEach((slot, i) => {
      const x = this.x0 + i * (BOX + GAP);
      const def = slot.skillId ? skillsData.skills[slot.skillId as keyof typeof skillsData.skills] : undefined;
      this.icons.push(def ? scene.add.image(x + BOX / 2, this.y0 + BOX / 2 + 2, manifest.image('skills', def.icon, 32, 32).key).setScale(S.iconScale) : null);
      // 키 글자: 왼쪽 위 작은 판 위에 또렷한 글꼴로
      scene.add.text(x + 9, this.y0 + 9, slot.key, { ...uiText(14, '#ffffff'), stroke: '#0a0604', strokeThickness: 3 }).setOrigin(0.5).setDepth(1);
      this.costs.push(
        scene.add
          .bitmapText(x + BOX - 3, this.y0 + BOX - 2, PIXEL_FONT, def ? String(def.tpCost) : '', 7)
          .setOrigin(1, 1)
          .setLetterSpacing(-1)
          .setScale(2)
          .setDepth(1),
      );
      this.cds.push(scene.add.bitmapText(x + BOX / 2, this.y0 + BOX / 2 + 4, PIXEL_FONT, '', 7).setOrigin(0.5).setLetterSpacing(-1).setScale(2).setDepth(2).setVisible(false));
    });
    this.tpText = scene.add.bitmapText(this.x0, this.y0 - 15, PIXEL_FONT, 'TP', 7).setLetterSpacing(-1).setScale(2);
  }

  update(): void {
    const now = this.now();
    const s = this.skills;
    const g = this.gfx.clear();
    // 옅은 판(전장이 비쳐 보임)
    g.fillStyle(0x000000, S.panelAlpha).fillRect(this.x0 - 6, this.y0 - 20, this.w + 12, BOX + 26);
    // TP 게이지
    const bx = this.x0 + 58;
    const bw = this.w - 58;
    const by = this.y0 - 14;
    this.tpText.setText(`TP ${Math.floor(s.tp)}`);
    g.fillStyle(0x1a1410, 0.9).fillRect(bx - 1, by - 1, bw + 2, 10);
    g.fillStyle(0x2a2a3a, 1).fillRect(bx, by, bw, 8);
    g.fillStyle(0x7fd8ff, 1).fillRect(bx, by, Math.round((bw * s.tp) / s.tpMax), 8);
    const pulse = 0.5 + 0.5 * Math.sin(this.scene.time.now / 220);

    s.slots.forEach((slot, i) => {
      const x = this.x0 + i * (BOX + GAP);
      const y = this.y0;
      const icon = this.icons[i];
      const reason = s.check(i, now);
      const ready = reason === null;
      g.fillStyle(0x0a0806, S.boxAlpha).fillRect(x, y, BOX, BOX);
      // 키 글자 판
      g.fillStyle(0x0a0806, 0.75).fillRect(x, y, 18, 18);
      const cdText = this.cds[i];
      if (slot.locked || !icon) {
        icon?.setVisible(false);
        // 자물쇠(코드로 그림)
        const cx = x + BOX / 2;
        const cy = y + BOX / 2 + 4;
        g.fillStyle(0x6a5e48, 1).fillRect(cx - 8, cy - 2, 16, 12);
        g.lineStyle(3, 0x6a5e48, 1).strokeRect(cx - 5, cy - 10, 10, 9);
        this.costs[i]?.setVisible(false);
        cdText?.setVisible(false);
      } else {
        icon.setVisible(true).setTint(ready ? 0xffffff : 0x7a7a7a);
        // 쿨다운: 위에서부터 어둡게 덮고 줄어듦 + 남은 초
        const cd = s.cooldownLeft(i, now);
        if (cd > 0) {
          g.fillStyle(0x000000, 0.62).fillRect(x, y, BOX, Math.round(BOX * cd));
          cdText?.setText(String(Math.max(1, Math.ceil((slot.readyAtMs - now) / 1000)))).setVisible(true);
        } else cdText?.setVisible(false);
        // 비용은 쿨다운이 끝난 뒤에만(남은 초와 겹치지 않게)
        this.costs[i]?.setVisible(cd <= 0).setTint(reason === 'tp' ? 0xff6050 : 0xffffff);
      }
      // 테두리: 쓸 수 있으면 밝은 하늘색이 맥박, 아니면 어두운 갈색
      if (ready) g.lineStyle(2, 0x7fd8ff, 0.65 + 0.35 * pulse).strokeRect(x + 1, y + 1, BOX - 2, BOX - 2);
      else g.lineStyle(1, 0x6a5a40, 1).strokeRect(x + 0.5, y + 0.5, BOX - 1, BOX - 1);
    });
  }
}
