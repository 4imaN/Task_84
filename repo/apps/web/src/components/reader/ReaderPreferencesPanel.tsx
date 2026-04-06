import type { ReadingProfileRecord } from '@ledgerread/contracts';

type ReaderPreferencesPanelProps = {
  activePreferences: ReadingProfileRecord['preferences'];
  isSaving: boolean;
  onToggleNightMode: () => void;
  onSave: () => void;
  onUpdatePreferences: (patch: Partial<ReadingProfileRecord['preferences']>) => void;
};

export function ReaderPreferencesPanel({
  activePreferences,
  isSaving,
  onToggleNightMode,
  onSave,
  onUpdatePreferences,
}: ReaderPreferencesPanelProps) {
  return (
    <div className="shell-panel grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-4">
      <label className="space-y-2 font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">
        Font Size (pt): {activePreferences.fontSize}
        <input
          className="w-full"
          type="range"
          min={10}
          max={28}
          value={activePreferences.fontSize}
          onChange={(event) => onUpdatePreferences({ fontSize: Number(event.target.value) })}
        />
      </label>
      <label className="space-y-2 font-ui text-xs uppercase tracking-[0.2em] text-black/45 dark:text-white/45">
        Line Spacing
        <input
          className="w-full"
          type="range"
          min={1}
          max={2}
          step={0.1}
          value={activePreferences.lineSpacing}
          onChange={(event) => onUpdatePreferences({ lineSpacing: Number(event.target.value) })}
        />
      </label>
      <select
        className="field"
        value={activePreferences.fontFamily}
        onChange={(event) =>
          onUpdatePreferences({
            fontFamily: event.target.value as ReadingProfileRecord['preferences']['fontFamily'],
          })
        }
      >
        <option value="Merriweather">Merriweather</option>
        <option value="Noto Sans">Noto Sans</option>
        <option value="Source Serif">Source Serif</option>
      </select>
      <select
        className="field"
        value={activePreferences.theme}
        onChange={(event) =>
          onUpdatePreferences({
            theme: event.target.value as ReadingProfileRecord['preferences']['theme'],
          })
        }
      >
        <option value="paper">Paper</option>
        <option value="linen">Linen</option>
        <option value="mist">Mist</option>
        <option value="sepia">Sepia</option>
      </select>
      <select
        className="field"
        value={activePreferences.readerMode}
        onChange={(event) =>
          onUpdatePreferences({
            readerMode: event.target.value as ReadingProfileRecord['preferences']['readerMode'],
          })
        }
      >
        <option value="PAGINATION">Pagination</option>
        <option value="SCROLL">Continuous Scroll</option>
      </select>
      <select
        className="field"
        value={activePreferences.chineseMode}
        onChange={(event) =>
          onUpdatePreferences({
            chineseMode: event.target.value as ReadingProfileRecord['preferences']['chineseMode'],
          })
        }
      >
        <option value="SIMPLIFIED">Simplified Chinese</option>
        <option value="TRADITIONAL">Traditional Chinese</option>
      </select>
      <button className="button-secondary" onClick={onToggleNightMode}>
        {activePreferences.nightMode ? 'Disable Global Night Mode' : 'Enable Global Night Mode'}
      </button>
      <button className="button-primary" disabled={isSaving} onClick={onSave}>
        {isSaving ? 'Saving...' : 'Save Preferences'}
      </button>
    </div>
  );
}
