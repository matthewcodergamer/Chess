import type { ButtonHTMLAttributes, ReactNode } from 'react';

type ButtonSize = 'sm' | 'md' | 'lg';
type ButtonVariant = 'primary' | 'secondary' | 'destructive';

type SharedButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
};

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  children: ReactNode;
  size?: ButtonSize;
  loading?: boolean;
  loadingLabel?: string;
  'aria-label': string;
};

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
};

type SegmentedControlProps<T extends string> = {
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
  size?: ButtonSize;
  className?: string;
};

function cx(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function ActionButton({
  variant,
  size = 'md',
  loading = false,
  loadingLabel = 'Loading',
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  className,
  children,
  disabled,
  type,
  ...props
}: SharedButtonProps & { variant: ButtonVariant }) {
  return (
    <button
      {...props}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'qqurz-button',
        `qqurz-button--${variant}`,
        `qqurz-button--${size}`,
        fullWidth && 'qqurz-button--full',
        loading && 'is-loading',
        className,
      )}
    >
      <span className="qqurz-button-content">
        {leadingIcon !== undefined && <span className="qqurz-button-icon" aria-hidden="true">{leadingIcon}</span>}
        <span className="qqurz-button-label">{children}</span>
        {trailingIcon !== undefined && <span className="qqurz-button-icon" aria-hidden="true">{trailingIcon}</span>}
      </span>
      {loading && <span className="qqurz-button-spinner" aria-hidden="true" />}
      {loading && <span className="qqurz-button-sr">{loadingLabel}</span>}
    </button>
  );
}

export function PrimaryButton(props: SharedButtonProps) {
  return <ActionButton {...props} variant="primary" />;
}

export function SecondaryButton(props: SharedButtonProps) {
  return <ActionButton {...props} variant="secondary" />;
}

export function DestructiveButton(props: SharedButtonProps) {
  return <ActionButton {...props} variant="destructive" />;
}

export function IconButton({
  size = 'sm',
  loading = false,
  loadingLabel = 'Loading',
  className,
  children,
  disabled,
  type,
  ...props
}: IconButtonProps) {
  return (
    <button
      {...props}
      type={type ?? 'button'}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx('qqurz-button', 'qqurz-button--secondary', `qqurz-button--${size}`, 'qqurz-icon-button', loading && 'is-loading', className)}
    >
      <span className="qqurz-button-content" aria-hidden="true">{children}</span>
      {loading && <span className="qqurz-button-spinner" aria-hidden="true" />}
      {loading && <span className="qqurz-button-sr">{loadingLabel}</span>}
    </button>
  );
}

export function SegmentedControl<T extends string>({ value, options, onChange, ariaLabel, size = 'sm', className }: SegmentedControlProps<T>) {
  return (
    <div className={cx('qqurz-segmented', `qqurz-segmented--${size}`, className)} role="radiogroup" aria-label={ariaLabel}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.ariaLabel}
            disabled={option.disabled}
            className={cx('qqurz-segmented-option', selected && 'selected')}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
