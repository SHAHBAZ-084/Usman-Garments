import { LucideIcon } from 'lucide-react';

export type IconButtonVariant = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const VARIANT_CLASS: Record<IconButtonVariant, string> = {
  neutral: 'text-textSecondary hover:bg-surface1 hover:text-textPrimary',
  accent: 'text-accent hover:bg-bgAccent',
  success: 'text-success hover:bg-bgSuccess',
  warning: 'text-warning hover:bg-bgWarning',
  danger: 'text-danger hover:bg-bgDanger',
};

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  icon: LucideIcon;
  label: string;
  variant?: IconButtonVariant;
  size?: 'sm' | 'md';
};

/** Consistent icon-only or icon+label action button. */
export function IconButton({
  icon: Icon,
  label,
  variant = 'neutral',
  size = 'sm',
  className = '',
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const iconSize = size === 'md' ? 'h-5 w-5' : 'h-4 w-4';
  const pad = size === 'md' ? 'px-3 py-2' : 'px-2 py-1.5';
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex items-center gap-1.5 rounded-lg text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${pad} ${VARIANT_CLASS[variant]} ${className}`}
    >
      <Icon className={iconSize} aria-hidden />
      {children ? <span>{children}</span> : null}
    </button>
  );
}
