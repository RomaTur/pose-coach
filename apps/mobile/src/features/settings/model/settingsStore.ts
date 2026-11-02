import { create } from 'zustand';
import { createMMKV } from 'react-native-mmkv';

import { DEFAULT_SETTINGS, readSettings, writeSettings, type CoachSettings } from './settings';

let storage: ReturnType<typeof createMMKV> | undefined;
function getStorage() { return storage ??= createMMKV({ id: 'pose-coach-settings' }); }

type SettingsState = {
  settings: CoachSettings;
  error: string | null;
  ready: boolean;
  load: () => void;
  change: (change: Partial<CoachSettings>) => void;
};

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS }, error: null, ready: false,
  load: () => {
    try { set({ settings: readSettings(getStorage()), error: null, ready: true }); }
    catch { set({ error: 'Настройки не прочитаны. Текущие значения оставлены без изменений; сохранённые данные не изменены.', ready: false }); }
  },
  change: change => {
    if (!get().ready) return;
    const settings = { ...get().settings, ...change };
    try {
      // Сначала постоянная запись; переключатель не обещает несохранённое значение.
      writeSettings(getStorage(), settings);
      set({ settings, error: null });
    } catch { set({ error: 'Не удалось сохранить настройки. Попробуйте ещё раз.' }); }
  },
}));
