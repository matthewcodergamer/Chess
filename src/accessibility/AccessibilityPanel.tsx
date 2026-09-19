import { useEffect, useRef, useState } from 'react';
import { SegmentedControl, Switch } from '../ui/controls';
import {
  feedbackEnabled,
  hapticsEnabled,
  hapticsSupported,
  setFeedbackEnabled,
  setHapticsEnabled,
  setSoundEnabled,
  soundEnabled,
} from '../ui/sound';
import { useAccessibilityPreferences, type BoardCoordinates, type FontScale } from './preferences';

type Props = {
  open: boolean;
  onClose: () => void;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  boardAppearance: string;
  onCycleBoardAppearance: () => void;
  onSoundChange?: (enabled: boolean) => void;
};

const FONT_STEPS: FontScale[] = ['default', 'large', 'extra'];

function fontScaleLabel(value: FontScale): string {
  if (value === 'large') return 'Large';
  if (value === 'extra') return 'Extra large';
  return 'Default';
}

export default function AccessibilityPanel({
  open,
  onClose,
  theme,
  onToggleTheme,
  boardAppearance,
  onCycleBoardAppearance,
  onSoundChange,
}: Props) {
  const [preferences, updatePreferences] = useAccessibilityPreferences();
  const [feedbackOn, setFeedbackOn] = useState(feedbackEnabled);
  const [soundOn, setSoundOn] = useState(soundEnabled);
  const [hapticsOn, setHapticsOn] = useState(hapticsEnabled);
  const panelRef = useRef<HTMLElement | null>(null);
  const vibrationAvailable = hapticsSupported();

  useEffect(() => {
    if (!open) return;
    setFeedbackOn(feedbackEnabled());
    setSoundOn(soundEnabled());
    setHapticsOn(hapticsEnabled());
    const panel = panelRef.current;
    requestAnimationFrame(() => panel?.querySelector<HTMLButtonElement>('.display-popover-heading button')?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [onClose, open]);

  if (!open) return null;

  const setAllFeedback = (enabled: boolean) => {
    setFeedbackEnabled(enabled);
    setFeedbackOn(enabled);
  };

  const setSound = (enabled: boolean) => {
    setSoundEnabled(enabled);
    setSoundOn(enabled);
    onSoundChange?.(enabled);
  };

  const setHaptics = (enabled: boolean) => {
    setHapticsEnabled(enabled);
    setHapticsOn(enabled);
  };

  const fontIndex = Math.max(0, FONT_STEPS.indexOf(preferences.fontScale));

  return (
    <section
      ref={panelRef}
      className="display-popover app-display-popover accessibility-panel"
      id="qqurz-display-menu"
      role="dialog"
      aria-modal="false"
      aria-labelledby="qqurz-accessibility-title"
    >
      <div className="display-popover-heading">
        <strong id="qqurz-accessibility-title">Display & accessibility</strong>
        <button type="button" onClick={onClose} aria-label="Close display and accessibility settings">×</button>
      </div>

      <div className="display-setting-block">
        <span>Text size</span>
        <div className="display-slider-row">
          <input
            type="range"
            min={0}
            max={2}
            step={1}
            value={fontIndex}
            aria-valuetext={fontScaleLabel(preferences.fontScale)}
            aria-label="Text size"
            onChange={event => updatePreferences({ fontScale: FONT_STEPS[Number(event.target.value)] ?? 'default' })}
          />
          <small>{fontScaleLabel(preferences.fontScale)}</small>
        </div>
      </div>

      <div className="display-setting-row">
        <span>Dark mode</span>
        <Switch checked={theme === 'dark'} onChange={() => onToggleTheme()} label={`Switch to ${theme === 'light' ? 'dark' : 'light'} theme`} />
      </div>

      <div className="display-setting-row">
        <span>High contrast</span>
        <Switch checked={preferences.highContrast} onChange={highContrast => updatePreferences({ highContrast })} label="High contrast" />
      </div>

      <div className="display-setting-row">
        <span>Reduced motion</span>
        <Switch checked={preferences.reducedMotion} onChange={reducedMotion => updatePreferences({ reducedMotion })} label="Reduced motion" />
      </div>

      <div className="display-setting-row">
        <span>Board appearance</span>
        <button type="button" onClick={onCycleBoardAppearance}>{boardAppearance}</button>
      </div>

      <div className="display-setting-block display-coordinate-setting">
        <span>Board coordinates</span>
        <SegmentedControl<BoardCoordinates>
          value={preferences.boardCoordinates}
          options={[
            { value: 'inside', label: 'Squares', ariaLabel: 'Coordinates inside board squares' },
            { value: 'edges', label: 'Edges', ariaLabel: 'Coordinates along board edges' },
            { value: 'off', label: 'Off', ariaLabel: 'Hide board coordinates' },
          ]}
          onChange={boardCoordinates => updatePreferences({ boardCoordinates })}
          ariaLabel="Board coordinates"
          className="display-accessibility-segmented"
        />
      </div>

      <div className="display-setting-row">
        <span>Sound & haptics</span>
        <Switch checked={feedbackOn} onChange={setAllFeedback} label="Sound and haptics master" />
        <small className="display-setting-help">Master control. Muting this stops every chess sound and vibration while preserving the individual choices below.</small>
      </div>

      <div className="display-setting-row">
        <span>Game sounds</span>
        <Switch checked={soundOn} onChange={setSound} disabled={!feedbackOn} label="Game sounds" />
      </div>

      <div className="display-setting-row">
        <span>Haptics</span>
        <Switch checked={vibrationAvailable && hapticsOn} onChange={setHaptics} disabled={!feedbackOn || !vibrationAvailable} label="Haptics" />
        {!vibrationAvailable && <small className="display-setting-help">This browser does not expose vibration feedback.</small>}
      </div>

      <p className="display-accessibility-note">Keyboard board controls, screen-reader turn announcements, visible focus rings and large touch targets stay enabled at every setting.</p>
    </section>
  );
}
