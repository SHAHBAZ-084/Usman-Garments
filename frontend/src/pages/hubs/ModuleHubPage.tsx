import { Link } from 'react-router-dom';
import { PageShell, Panel } from '../../components/ui/PageShell';
import { navLinkIcon } from '../../config/navIcons';

export type HubAction = {
  label: string;
  to: string;
  description?: string;
  primary?: boolean;
};

export function ModuleHubPage({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions: HubAction[];
}) {
  return (
    <PageShell title={title} subtitle={subtitle ?? 'Choose an action'}>
      <Panel>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action) => {
            const Icon = navLinkIcon(action.label);
            return (
              <Link
                key={action.to + action.label}
                to={action.to}
                className={`flex flex-col items-start gap-2 rounded-lg border px-4 py-4 text-left transition hover:border-accent ${
                  action.primary
                    ? 'border-accent bg-accent/10 text-textPrimary'
                    : 'border-border bg-surface1 text-textPrimary hover:bg-surface2'
                }`}
              >
                <span className="flex items-center gap-2 text-sm font-semibold">
                  {Icon ? <Icon className="h-4 w-4 shrink-0 opacity-80" aria-hidden /> : null}
                  {action.label}
                </span>
                {action.description ? (
                  <span className="text-xs text-textMuted">{action.description}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </Panel>
    </PageShell>
  );
}
