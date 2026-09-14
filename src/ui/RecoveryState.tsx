import type { ReactNode } from 'react';

export type RecoveryTone = 'empty' | 'offline' | 'warning' | 'error' | 'success';
export type RecoveryAction = {
  label: string;
  onClick: () => void;
  disabled?: boolean;
};

type Props = {
  tone?: RecoveryTone;
  eyebrow?: string;
  title: string;
  body: ReactNode;
  detail?: ReactNode;
  primaryAction?: RecoveryAction;
  secondaryAction?: RecoveryAction;
  countdown?: { label: string; seconds: number } | null;
  compact?: boolean;
  className?: string;
  live?: 'polite' | 'assertive' | 'off';
};

const ICONS: Record<RecoveryTone, string> = {
  empty: '◇',
  offline: '↻',
  warning: '!',
  error: '×',
  success: '✓',
};

export default function RecoveryState({
  tone = 'empty',
  eyebrow,
  title,
  body,
  detail,
  primaryAction,
  secondaryAction,
  countdown,
  compact = false,
  className = '',
  live = 'polite',
}: Props) {
  return (
    <section
      className={`qqurz-recovery-state ${compact ? 'compact' : ''} ${className}`.trim()}
      data-tone={tone}
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={live === 'off' ? undefined : live}
    >
      <span className="qqurz-recovery-icon" aria-hidden="true">{ICONS[tone]}</span>
      <div className="qqurz-recovery-copy">
        {eyebrow && <span className="qqurz-kicker">{eyebrow}</span>}
        <h3>{title}</h3>
        <div className="qqurz-recovery-body">{body}</div>
        {detail && <div className="qqurz-recovery-detail">{detail}</div>}
        {countdown && (
          <div className="qqurz-recovery-countdown" aria-label={`${countdown.label}: ${Math.max(0, countdown.seconds)} seconds`}>
            <span>{countdown.label}</span>
            <b>{Math.max(0, countdown.seconds)}s</b>
          </div>
        )}
        {(primaryAction || secondaryAction) && (
          <div className="qqurz-recovery-actions">
            {primaryAction && <button className="primary-black" type="button" onClick={primaryAction.onClick} disabled={primaryAction.disabled}>{primaryAction.label}</button>}
            {secondaryAction && <button type="button" onClick={secondaryAction.onClick} disabled={secondaryAction.disabled}>{secondaryAction.label}</button>}
          </div>
        )}
      </div>
    </section>
  );
}
