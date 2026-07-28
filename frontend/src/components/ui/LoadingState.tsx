import { Loader2 } from 'lucide-react';

type LoadingStateProps = {
  label?: string;
  className?: string;
};

/** Consistent spinner for data-fetching views. */
export function LoadingState({ label = 'Loading…', className = '' }: LoadingStateProps) {
  return (
    <div className={`flex items-center gap-2 text-textMuted ${className}`}>
      <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/** Skeleton grid for dashboard-style metric cards. */
export function MetricSkeletonGrid({ count = 10 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="animate-pulse rounded-lg border border-border bg-surface2 p-3"
        >
          <div className="mb-2 h-3 w-16 rounded bg-surface1" />
          <div className="h-5 w-24 rounded bg-surface1" />
        </div>
      ))}
    </div>
  );
}
