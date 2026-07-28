import { forwardRef, ReactNode, RefObject } from 'react';
import { Link } from 'react-router-dom';

type PageShellProps = {
  title: ReactNode;
  subtitle?: string;
  children?: ReactNode;
  actions?: ReactNode;
  centerTitle?: boolean;
  titleRef?: RefObject<HTMLHeadingElement | null>;
};

export function PageShell({
  title,
  subtitle,
  children,
  actions,
  centerTitle = false,
  titleRef,
}: PageShellProps) {
  if (centerTitle) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="mb-6 flex flex-col items-center gap-4">
          <h1
            ref={titleRef}
            tabIndex={-1}
            className="rounded-sm text-center text-2xl font-semibold text-textPrimary outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-surface3"
          >
            {title}
          </h1>
          {actions ? <div className="flex flex-wrap justify-center gap-2">{actions}</div> : null}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-textPrimary">{title}</h1>
          {subtitle ? <p className="mt-1 text-sm text-textSecondary">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
      {children}
    </div>
  );
}

/** Metric / grouped summary tile (dashboard style). */
export function Tile({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-lg border border-border bg-surface2 p-3 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

type MetricComparison = {
  current: number;
  previous: number;
  changePercent: number | null;
};

export function GrowthIndicator({ comparison }: { comparison?: MetricComparison | null }) {
  if (!comparison) return null;
  const { changePercent, current, previous } = comparison;
  if (changePercent === null) {
    if (current > 0 && previous === 0) {
      return <span className="text-xs font-medium text-success">↑ New</span>;
    }
    return null;
  }
  if (changePercent === 0) {
    return <span className="text-xs font-medium text-textMuted">— 0%</span>;
  }
  const up = changePercent > 0;
  return (
    <span className={`text-xs font-medium ${up ? 'text-success' : 'text-danger'}`}>
      {up ? '↑' : '↓'} {Math.abs(changePercent).toFixed(1)}%
    </span>
  );
}

type ClickableMetricTileProps = {
  label: string;
  value: string;
  sub?: string;
  to: string;
  accent?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  comparison?: MetricComparison | null;
};

const KPI_ACCENT: Record<NonNullable<ClickableMetricTileProps['accent']>, string> = {
  default: 'border-l-accent',
  success: 'border-l-success',
  warning: 'border-l-warning',
  danger: 'border-l-danger',
  info: 'border-l-info',
};

/** Dashboard KPI card — navigates to a related report on click. */
export function ClickableMetricTile({ label, value, sub, to, accent = 'default', comparison }: ClickableMetricTileProps) {
  return (
    <Link to={to} className={`kpi-card block border-l-4 ${KPI_ACCENT[accent]}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-textSecondary">{label}</p>
        <GrowthIndicator comparison={comparison} />
      </div>
      <p className="mt-1 text-lg font-semibold text-textPrimary">{value}</p>
      {sub ? <p className="mt-0.5 text-[10px] text-textMuted">{sub}</p> : null}
      <p className="mt-1 text-[10px] text-accent">View details →</p>
    </Link>
  );
}

/** Raised form card. */
export function Panel({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-surface2 p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return <label className="mb-1 block text-sm font-medium text-textSecondary">{children}</label>;
}

export const TextInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function TextInput(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full rounded-lg border border-border bg-surface2 px-3 py-2 text-sm text-textPrimary outline-none ring-accent focus:ring-2 ${props.className ?? ''}`}
      />
    );
  },
);

export const FinancialButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function FinancialButton(props, ref) {
    const { className = '', ...rest } = props;
    return (
      <button
        ref={ref}
        {...rest}
        className={`btn-financial disabled:cursor-not-allowed ${className}`}
      />
    );
  },
);

export const PrimaryButton = forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement>>(
  function PrimaryButton(props, ref) {
    const { className = '', ...rest } = props;
    return (
      <button
        ref={ref}
        {...rest}
        className={`btn-primary disabled:cursor-not-allowed ${className}`}
      />
    );
  },
);

export function SecondaryButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className = '', ...rest } = props;
  return (
    <button
      type="button"
      {...rest}
      className={`btn-secondary ${className}`}
    />
  );
}

export function GhostButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg px-3 py-2 text-sm font-medium text-textSecondary transition hover:bg-surface1 hover:text-textPrimary disabled:cursor-not-allowed disabled:opacity-60 ${props.className ?? ''}`}
    />
  );
}

export function DangerButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...props}
      className={`rounded-lg border border-danger/30 bg-bgDanger px-4 py-2 text-sm font-medium text-danger transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 ${props.className ?? ''}`}
    />
  );
}

export { Feedback } from './Feedback';
export { IconButton } from './IconButton';
export { LoadingState, MetricSkeletonGrid } from './LoadingState';
