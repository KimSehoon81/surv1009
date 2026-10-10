export const SceneKey = {
  Boot: 'Boot',
  Preload: 'Preload',
  Battle: 'Battle',
  Gallery: 'Gallery',
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
