export const SceneKey = {
  Boot: 'Boot',
  Preload: 'Preload',
  Battle: 'Battle',
  Gallery: 'Gallery',
  Hud: 'Hud',
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
