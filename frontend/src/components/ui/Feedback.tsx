import { ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info, AlertTriangle } from 'lucide-react';

export type FeedbackVariant = 'success' | 'error' | 'warning' | 'info';

const CONFIG: Record<
  FeedbackVariant,
  { icon: typeof CheckCircle2; className: string }
> = {
  success: {
    icon: CheckCircle2,
    className: 'border-success/30 bg-bgSuccess text-success',
  },
  error: {
    icon: AlertCircle,
    className: 'border-danger/30 bg-bgDanger text-danger',
  },
  warning: {
    icon: AlertTriangle,
    className: 'border-warning/30 bg-bgWarning text-warning',
  },
  info: {
    icon: Info,
    className: 'border-info/30 bg-bgInfo text-info',
  },
};

type FeedbackProps = {
  variant: FeedbackVariant;
  children: ReactNode;
  className?: string;
};

/** Unified inline feedback for save/delete/payment actions app-wide. */
export function Feedback({ variant, children, className = '' }: FeedbackProps) {
  const { icon: Icon, className: tone } = CONFIG[variant];
  return (
    <p
      role="status"
      className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${tone} ${className}`}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <span className="flex-1">{children}</span>
    </p>
  );
}
