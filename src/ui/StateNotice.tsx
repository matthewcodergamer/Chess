import type { ReactNode } from 'react';

type StateNoticeTone = 'neutral' | 'warning' | 'error' | 'success';

type StateNoticeAction = {
  label: string;
  onClick: () => void;
  primary?: boolean;
  disabled?: boolean;
};

type Props = {
  eyebrow?: string;
  title: string;
  body: ReactNode;
  tone?: StateNoticeTone;
  icon?: string;
  actions?: StateNoticeAction[];
  detail?: ReactNode;
  className?: string;
  live?: 'polite' | 'assertive' | 'off';
};

export default function StateNotice({
  eyebrow,
  title,
  body,
  tone = 'neutral',
  icon = '○',
  actions = [],
  detail,
  className = '',
  live = 'polite',
}: Props) {
  const role = tone === 'error' ? 'alert' : 'status';
  return (
    <section
      className={`state-notice ${tone} ${className}`.trim()}
      role={live === 'off' ? undefined : role}
      aria-live={live === 'off' ? undefined : live}
    >
      <div className="state-notice-icon" aria-hidden="true">{icon}</div>
      <div className="state-notice-copy">
        {eyebrow && <span className="qqurz-kicker">{eyebrow}</span>}
        <h3>{title}</h3>
        <div className="state-notice-body">{body}</div>
        {detail && <div className="state-notice-detail">{detail}</div>}
        {actions.length > 0 && (
          <div className="state-notice-actions">
            {actions.map(action => (
              <button
                key={action.label}
                type="button"
                className={action.primary ? 'primary-black' : undefined}
                onClick={action.onClick}
                disabled={action.disabled}
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
