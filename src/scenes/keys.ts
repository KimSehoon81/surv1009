export const SceneKey = {
  Boot: 'Boot',
  Preload: 'Preload',
  Battle: 'Battle',
  Gallery: 'Gallery',
  Hud: 'Hud',
  AudioGallery: 'AudioGallery',
  Menu: 'Menu',
  Map: 'Map',
  Prep: 'Prep',
  Settings: 'Settings',
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
