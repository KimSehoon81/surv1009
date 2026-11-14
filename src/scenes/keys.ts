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
  Ending: 'Ending',
  Codex: 'Codex',
  Web: 'Web',
} as const;

export type SceneKey = (typeof SceneKey)[keyof typeof SceneKey];
