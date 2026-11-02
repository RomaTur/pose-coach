export type CoachSettings = {
  voice: boolean;
  haptics: boolean;
  diagnostics: boolean;
  target: number;
};

export const DEFAULT_SETTINGS: Readonly<CoachSettings> = {
  voice: true, haptics: true, diagnostics: false, target: 10,
};

export interface SettingsStorage {
  getString(key: string): string | undefined;
  set(key: string, value: string): void;
}

function isSettings(value: unknown): value is CoachSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return typeof item.voice === 'boolean' && typeof item.haptics === 'boolean' &&
    typeof item.diagnostics === 'boolean' && Number.isInteger(item.target) &&
    (item.target as number) >= 1 && (item.target as number) <= 100;
}

export function readSettings(storage: SettingsStorage): CoachSettings {
  const raw = storage.getString('coach.settings');
  if (raw === undefined) return { ...DEFAULT_SETTINGS };
  const parsed: unknown = JSON.parse(raw);
  if (!isSettings(parsed) || (parsed as CoachSettings & { version?: number }).version !== 1) {
    throw new Error('Unsupported or invalid settings');
  }
  const { voice, haptics, diagnostics, target } = parsed;
  return { voice, haptics, diagnostics, target };
}

export function writeSettings(storage: SettingsStorage, settings: CoachSettings): void {
  if (!isSettings(settings)) throw new Error('Invalid settings');
  const { voice, haptics, diagnostics, target } = settings;
  storage.set('coach.settings', JSON.stringify({ version: 1, voice, haptics, diagnostics, target }));
}
