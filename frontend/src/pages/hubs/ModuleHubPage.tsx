import { Link } from 'react-router-dom';
import { PageShell, Panel } from '../../components/ui/PageShell';
import { navLinkIcon } from '../../config/navIcons';

export type HubAction = {
  label: string;
  to: string;
  description?: string;
  primary?: boolean;
  /** Theme accent for the card */
  tone?: 'gold' | 'green' | 'teal' | 'amber' | 'slate' | 'rose' | 'indigo';
};

const TONE_CLASS: Record<NonNullable<HubAction['tone']>, string> = {
  gold: 'hub-action hub-action--gold',
  green: 'hub-action hub-action--green',
  teal: 'hub-action hub-action--teal',
  amber: 'hub-action hub-action--amber',
  slate: 'hub-action hub-action--slate',
  rose: 'hub-action hub-action--rose',
  indigo: 'hub-action hub-action--indigo',
};

const DEFAULT_TONES: HubAction['tone'][] = ['gold', 'green', 'teal', 'amber', 'indigo', 'rose', 'slate'];

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
    <PageShell title={title} subtitle={subtitle ?? 'Choose an action'} wide>
      <Panel className="border-0 bg-transparent p-0 shadow-none">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {actions.map((action, index) => {
            const Icon = navLinkIcon(action.label);
            const tone = action.tone ?? DEFAULT_TONES[index % DEFAULT_TONES.length]!;
            return (
              <Link
                key={action.to + action.label}
                to={action.to}
                className={`${TONE_CLASS[tone]} ${action.primary ? 'hub-action--primary' : ''}`}
              >
                <span className="hub-action-icon" aria-hidden>
                  {Icon ? <Icon className="h-5 w-5" /> : null}
                </span>
                <span className="hub-action-label">{action.label}</span>
                {action.description ? (
                  <span className="hub-action-desc">{action.description}</span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </Panel>
    </PageShell>
  );
}
