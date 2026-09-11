import { createCustomTimeControl, TIME_CONTROL_PRESETS, type TimeControl, type TimeControlPresetId } from '../../shared/timeControl';

type Props = {
  value: TimeControl;
  onChange: (value: TimeControl) => void;
  allowedPresetIds?: readonly TimeControlPresetId[];
  allowCustom?: boolean;
  label?: string;
};

export default function TimeControlPicker({
  value,
  onChange,
  allowedPresetIds = ['3+2', '5+0', '10+5'],
  allowCustom = true,
  label = 'Time control',
}: Props) {
  const baseMinutes = Math.max(.25, value.baseMs / 60_000);
  const incrementSeconds = Math.max(0, value.incrementMs / 1_000);

  return (
    <div className="time-control-picker">
      <div className="time-control-heading"><span>{label}</span><b>{value.label}</b></div>
      <div className="time-control-pills" role="radiogroup" aria-label={label}>
        {allowedPresetIds.map(id => {
          const preset = TIME_CONTROL_PRESETS[id];
          const selected = !value.custom && value.baseMs === preset.baseMs && value.incrementMs === preset.incrementMs;
          return <button key={id} type="button" className={selected ? 'selected' : ''} aria-pressed={selected} onClick={() => onChange({ ...preset })}>{preset.label}</button>;
        })}
        {allowCustom && <button type="button" className={value.custom ? 'selected' : ''} aria-pressed={value.custom} onClick={() => onChange(createCustomTimeControl(baseMinutes, incrementSeconds))}>Custom</button>}
      </div>
      {allowCustom && value.custom && (
        <div className="time-control-custom">
          <label><span>Minutes</span><input type="number" min="0.25" max="180" step="0.25" inputMode="decimal" value={baseMinutes} onChange={event => onChange(createCustomTimeControl(Number(event.target.value), incrementSeconds))} /></label>
          <span className="time-control-plus">+</span>
          <label><span>Increment</span><input type="number" min="0" max="60" step="1" inputMode="numeric" value={incrementSeconds} onChange={event => onChange(createCustomTimeControl(baseMinutes, Number(event.target.value)))} /></label>
        </div>
      )}
    </div>
  );
}
