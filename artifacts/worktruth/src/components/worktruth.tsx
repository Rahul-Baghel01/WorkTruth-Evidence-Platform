import { type ComponentType, type ReactNode, useEffect, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { getGetDashboardStatsQueryKey, getGetSessionQueryKey, useGetDashboardStats, useGetSession, useLogout } from '@workspace/api-client-react';
import {
  Activity,
  AlertTriangle,
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  Bell,
  BookOpenCheck,
  Building2,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ClipboardCheck,
  Database,
  FileCheck2,
  FileUp,
  Filter,
  Gauge,
  GitCompareArrows,
  Globe2,
  House,
  Layers3,
  LineChart,
  ListFilter,
  LogOut,
  MapPinned,
  Menu,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  UploadCloud,
  UserCog,
  UserRound,
  X,
} from 'lucide-react';
import type {
  ActivityItem,
  CrossModalAnalysis,
  DashboardStats,
  EvidenceFusion,
  Project,
  ProjectPriority,
  RiskAssessment,
  WhyTrailEntry,
} from '@workspace/api-client-react';

export const cn = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export const money = (value = 0) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);

export const compactMoney = (value = 0) => {
  if (value >= 10000000) return `₹${(value / 10000000).toFixed(1)} cr`;
  if (value >= 100000) return `₹${(value / 100000).toFixed(1)} L`;
  return money(value);
};

export const dateLabel = (value?: string | null) =>
  value ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value)) : 'Not recorded';

export const priorityTone = (priority?: string) => {
  if (priority === 'CRITICAL') return 'critical';
  if (priority === 'HIGH') return 'high';
  if (priority === 'MODERATE') return 'moderate';
  return 'low';
};

export const firstName = (name?: string) => name?.trim().split(/\s+/)[0];

// Pure so it's trivially testable — based on the browser's local hour, never
// a server value, per the requirement that the greeting follow the viewer's
// own timezone with no backend involvement.
export function getTimeGreeting(date: Date = new Date()): string {
  const hour = date.getHours();
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 17) return 'Good afternoon';
  if (hour >= 17 && hour < 21) return 'Good evening';
  return 'Good night';
}

// Re-evaluates once a minute so a page left open across a boundary (e.g.
// 11:59am -> 12:00pm) updates without requiring a refresh, without the cost
// of a high-frequency timer.
export function useTimeGreeting(): string {
  const [greeting, setGreeting] = useState(() => getTimeGreeting());
  useEffect(() => {
    const id = setInterval(() => setGreeting(getTimeGreeting()), 60_000);
    return () => clearInterval(id);
  }, []);
  return greeting;
}

export const initials = (name?: string) => {
  const parts = name?.trim().split(/\s+/).filter(Boolean) ?? [];
  if (!parts.length) return '—';
  return (parts[0][0] + (parts[1]?.[0] ?? '')).toUpperCase();
};

export function PriorityBadge({ priority, small = false }: { priority?: string; small?: boolean }) {
  const tone = priorityTone(priority);
  return (
    <span data-testid={`status-priority-${priority ?? 'unknown'}`} className={cn('priority-badge', `priority-${tone}`, small && 'priority-small')}>
      <span className="priority-dot" /> {priority ?? 'Unrated'}
    </span>
  );
}

export function ScoreBar({ value, tone = 'primary', label }: { value: number; tone?: string; label?: string }) {
  const percentage = value <= 1 ? value * 100 : value;
  return (
    <div className="space-y-1.5">
      {label && <div className="flex items-center justify-between text-[11px] text-muted-foreground"><span>{label}</span><span className="font-mono-ui">{Math.round(percentage)}%</span></div>}
      <div className="score-track"><div className={cn('score-fill', `score-${tone}`)} style={{ width: `${Math.max(2, Math.min(100, percentage))}%` }} /></div>
    </div>
  );
}

export function SectionHeading({ eyebrow, title, detail, action }: { eyebrow?: string; title: string; detail?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex items-end justify-between gap-4">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h2 className="mt-1 font-display text-[22px] font-semibold tracking-[-.03em] text-foreground">{title}</h2>
        {detail && <p className="mt-1 text-sm text-muted-foreground">{detail}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className, ...props }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('surface-card', className)} {...props}>{children}</div>;
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={cn('skeleton', className)} aria-label="Loading" />;
}

export function EmptyState({ icon: Icon = Database, title, description, action }: { icon?: ComponentType<{ size?: number }>; title: string; description: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Icon size={20} /></div><h3>{title}</h3><p>{description}</p>{action}</div>;
}

export function ErrorState({ message = 'We could not load this evidence set.', onRetry }: { message?: string; onRetry?: () => void }) {
  return <div className="empty-state error-state"><div className="empty-icon"><AlertTriangle size={20} /></div><h3>Signal unavailable</h3><p>{message}</p>{onRetry && <button data-testid="button-retry" onClick={onRetry} className="button button-secondary">Retry request</button>}</div>;
}

const navItems = [
  { href: '/dashboard', label: 'Overview', icon: House },
  { href: '/projects', label: 'Verification queue', icon: ClipboardCheck },
  { href: '/map', label: 'Project atlas', icon: MapPinned },
  { href: '/analytics', label: 'Evidence analytics', icon: BarChart3 },
  { href: '/upload', label: 'Import register', icon: FileUp },
];

export function WorkTruthMark({ inverse = false }: { inverse?: boolean }) {
  return <span className={cn('brand-mark', inverse && 'brand-mark-inverse')}><span className="brand-cross"><i /><i /></span><span>WORKTRUTH</span></span>;
}

export function Shell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const sessionQuery = useGetSession({ query: { queryKey: getGetSessionQueryKey() } });
  const statsQuery = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const stats = statsQuery.data;
  const logout = useLogout();
  const user = sessionQuery.data?.user;
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const active = (href: string) => location === href || (href !== '/dashboard' && location.startsWith(href));
  const handleSignOut = () => { logout.mutate(undefined, { onSettled: () => { queryClient.clear(); setLocation('/'); } }); };
  const criticalCount = stats?.criticalRisk ?? 0;
  const highPriorityCount = stats?.verificationRequired ?? 0;
  const hasAlerts = highPriorityCount > 0;
  return (
    <div className="app-shell">
      <aside className={cn('sidebar', collapsed && 'sidebar-collapsed', open && 'sidebar-open')}>
        <div className="sidebar-top">
          <Link href="/dashboard" className="brand-link" data-testid="link-brand"><WorkTruthMark inverse /></Link>
          <button className="icon-button sidebar-collapse" data-testid="button-toggle-sidebar" onClick={() => setCollapsed((v) => !v)} aria-label="Toggle sidebar">
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>
        <div className="sidebar-context"><span className="context-kicker">FIELD DESK</span><span className="context-value">MPLADS · 2024–25</span></div>
        <nav className="sidebar-nav" aria-label="Primary">
          <div className="nav-label">Monitor</div>
          {navItems.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className={cn('nav-item', active(href) && 'nav-item-active')} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
              <Icon size={17} strokeWidth={active(href) ? 2.4 : 1.8} /><span>{label}</span>{href === '/projects' && <span className="nav-count">{stats?.totalProjects ?? '—'}</span>}
            </Link>
          ))}
          <div className="nav-label nav-label-spaced">Governance</div>
          <Link href="/settings" className={cn('nav-item', active('/settings') && 'nav-item-active')} data-testid="link-nav-methodology"><ShieldCheck size={17} /><span>Method & access</span></Link>
          <Link href="/settings" className="nav-item" data-testid="link-nav-settings"><Settings2 size={17} /><span>Workspace settings</span></Link>
          {user?.role === 'ADMIN' && <>
            <div className="nav-label nav-label-spaced">Administration</div>
            <Link href="/admin/users" className={cn('nav-item', active('/admin/users') && 'nav-item-active')} data-testid="link-nav-user-management"><UserCog size={17} /><span>User Management</span></Link>
          </>}
        </nav>
        <div className="sidebar-footer">
          <div className="desk-status"><span className="status-pulse" /><span>Evidence service operational</span></div>
          <button className="nav-item nav-signout" data-testid="button-signout" onClick={handleSignOut} disabled={logout.isPending}><LogOut size={17} /><span>Sign out</span></button>
          <div className="officer-mini"><div className="avatar avatar-gold">{initials(user?.name)}</div><div><strong>{user?.name ?? '…'}</strong><span>{user?.role ?? ''}</span></div><ChevronDown size={14} /></div>
        </div>
      </aside>
      {open && <button className="mobile-scrim" onClick={() => setOpen(false)} aria-label="Close menu" data-testid="button-close-menu" />}
      <main className={cn('main-shell', collapsed && 'main-shell-wide')}>
        <header className="topbar">
          <button className="mobile-menu icon-button" data-testid="button-open-menu" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
          <div className="topbar-crumb"><span className="crumb-mobile">Field desk</span><span className="crumb-sep">/</span><span>{navItems.find((item) => active(item.href))?.label ?? (active('/settings') ? 'Method & access' : active('/admin') ? 'User Management' : 'Workspace')}</span></div>
          <div className="topbar-actions">
            <button className="icon-button" data-testid="button-help" aria-label="Help"><CircleHelp size={18} /></button>
            <div className="alerts-anchor">
              <button className={cn('icon-button', hasAlerts && 'has-dot')} data-testid="button-notifications" aria-label="Verification alerts" onClick={() => setAlertsOpen((v) => !v)}><Bell size={18} /></button>
              {alertsOpen && (
                <div className="alerts-popover" data-testid="panel-verification-alerts">
                  <div className="alerts-popover-head"><span>VERIFICATION ALERTS</span><button className="icon-button" aria-label="Close" onClick={() => setAlertsOpen(false)}><X size={14} /></button></div>
                  {hasAlerts ? (
                    <p>{highPriorityCount} project{highPriorityCount === 1 ? '' : 's'} at high or critical priority — officer review recommended{criticalCount > 0 ? ` (${criticalCount} critical).` : '.'}</p>
                  ) : (
                    <p>No high-priority evidence inconsistencies right now.</p>
                  )}
                  <p className="alerts-popover-note">In-app only today. External SMS/notification integration — Phase 2.</p>
                </div>
              )}
            </div>
            <div className="topbar-divider" />
            <div className="avatar avatar-navy">{initials(user?.name)}</div><span className="topbar-user">{user?.name ?? ''}</span>
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  );
}

export function PublicHeader() {
  return <header className="public-header"><Link href="/" className="brand-link" data-testid="link-public-brand"><WorkTruthMark /></Link><nav className="public-nav"><a href="#how-it-works" data-testid="link-how-it-works">How it works</a><a href="#methodology" data-testid="link-methodology">Methodology</a><Link href="/login" className="button button-dark button-small" data-testid="link-public-login">Officer sign in <ChevronRight size={15} /></Link></nav></header>;
}

export function MetricCard({ label, value, detail, icon: Icon, tone = 'navy', trend, title }: { label: string; value: string | number; detail: string; icon: typeof Activity; tone?: string; trend?: 'up' | 'down'; title?: string }) {
  return <Card className={cn('metric-card', `metric-${tone}`)} title={title}><div className="metric-top"><span className="metric-label">{label}</span><span className="metric-icon"><Icon size={17} /></span></div><div className="metric-value">{value}</div><div className="metric-detail">{trend && (trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />)}{detail}</div></Card>;
}

export function MiniBars({ values, labels, accent = 'navy' }: { values: number[]; labels?: string[]; accent?: string }) {
  const max = Math.max(...values, 1);
  return <div className="mini-bars">{values.map((value, index) => <div className="mini-bar-col" key={`${value}-${index}`}><div className={cn('mini-bar', `bar-${accent}`)} style={{ height: `${Math.max(7, (value / max) * 100)}%` }} title={labels?.[index]} /><span>{labels?.[index]}</span></div>)}</div>;
}

export function RiskRing({ score, priority }: { score: number; priority?: string }) {
  const tone = priorityTone(priority);
  const percentage = score <= 1 ? score * 100 : score;
  return <div className={cn('risk-ring', `ring-${tone}`)} style={{ '--ring-progress': `${Math.min(100, Math.max(0, percentage)) * 3.6}deg` } as React.CSSProperties}><div><strong>{Math.round(percentage)}</strong><span>priority signal</span></div></div>;
}

// Evidence-sufficiency status (INSUFFICIENT/LIMITED/SUFFICIENT/STRONG evidence)
// is a distinct axis from anomaly severity — reuses the priority-badge tones
// only for visual consistency, not because it maps to Verification Priority.
const EVIDENCE_STATUS_TONE: Record<string, string> = {
  STRONG_EVIDENCE: 'low',
  SUFFICIENT_EVIDENCE: 'moderate',
  LIMITED_EVIDENCE: 'high',
  INSUFFICIENT_EVIDENCE: 'critical',
};

export function EvidenceSufficiencyBadge({ status }: { status?: string }) {
  const tone = (status && EVIDENCE_STATUS_TONE[status]) || 'moderate';
  const label = status ? status.replace(/_/g, ' ').toLowerCase() : 'unknown';
  return <span data-testid={`status-evidence-${status ?? 'unknown'}`} className={cn('priority-badge', `priority-${tone}`)}><span className="priority-dot" /> {label}</span>;
}

// Central Evidence Fusion section: combines the five lenses into one
// transparent, explainable signal. Explicitly labelled a "verification
// signal" throughout — never presented as a probability of fraud. Coverage,
// confidence, and agreement/mixed-evidence are shown as separate axes from
// the score itself, per the evidence-fusion methodology.
export function FusionPanel({ fusion }: { fusion?: EvidenceFusion }) {
  if (!fusion) return null;
  const scorePercent = fusion.overallEvidenceScore != null ? Math.round(fusion.overallEvidenceScore * 100) : null;
  const confidencePercent = Math.round(fusion.overallConfidence * 100);
  return (
    <Card className="fusion-card">
      <div className="card-overline"><span>EVIDENCE FUSION</span><Layers3 size={14} /></div>
      <div className="fusion-summary">
        <div className="fusion-metric"><strong>{scorePercent != null ? `${scorePercent}%` : '—'}</strong><span>Evidence verification signal</span></div>
        <div className="fusion-metric"><strong>{confidencePercent}%</strong><span>Overall Evidence Confidence</span></div>
        <EvidenceSufficiencyBadge status={fusion.status} />
      </div>
      <p className="fusion-note">This is an evidence-based verification signal derived from the five lenses below — not a probability of fraud. A human officer makes the final determination.</p>
      <div className="fusion-coverage">
        <div className="fusion-coverage-label"><span>Evidence coverage</span><b>{fusion.coverage.availableLensCount} of {fusion.coverage.totalLensCount} dimensions have usable evidence</b></div>
        <ScoreBar value={fusion.coverage.coveragePercent} />
        <div className="fusion-dimensions">
          {fusion.lenses.map((lens) => (
            <span key={lens.lens} className={cn('fusion-dim-chip', lens.isInsufficientEvidence ? 'fusion-dim-unavailable' : lens.isAnomalous ? 'fusion-dim-anomalous' : 'fusion-dim-available')}>
              {lens.lens}
            </span>
          ))}
        </div>
      </div>
      {fusion.agreement.signals.length > 0 && (
        <div className="fusion-signals">
          <span className="fusion-section-label">Strongest contributing signals</span>
          {fusion.agreement.signals.map((signal, index) => <div key={`${signal.lenses.join('-')}-${index}`} className="reason-row"><span className="reason-index">0{index + 1}</span><span>{signal.description}</span></div>)}
        </div>
      )}
      {fusion.mixedEvidence.isMixed && (
        <div className="fusion-mixed-banner"><AlertTriangle size={14} /><span>Evidence is mixed across dimensions ({fusion.mixedEvidence.anomalousLenses.join(', ')} vs. {fusion.mixedEvidence.consistentLenses.join(', ')}) — this requires human verification rather than an automatic conclusion.</span></div>
      )}
      {fusion.reasons.length > 0 && (
        <div className="fusion-signals">
          <span className="fusion-section-label">Fusion explanation</span>
          <div className="reason-list">{fusion.reasons.map((reason, index) => <div key={`${reason}-${index}`} className="reason-row"><span className="reason-index">0{index + 1}</span><span>{reason}</span></div>)}</div>
        </div>
      )}
    </Card>
  );
}

function capitalizeWord(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

// Cross-Evidence Inconsistencies (P0-K): structured objects produced only
// when at least two independent evidence dimensions tell a materially
// inconsistent story — never a re-listing of a single lens's own anomalies.
// Severity uses the same LOW/MODERATE/HIGH/CRITICAL vocabulary and visual
// tones as Verification Priority (via priorityTone) purely for consistency;
// it is a distinct axis (materiality of the contradiction, not a routing
// decision) and confidence is tracked separately alongside it.
export function InconsistencyPanel({ inconsistencies }: { inconsistencies?: CrossModalAnalysis }) {
  if (!inconsistencies) return null;
  const items = inconsistencies.items;
  return (
    <Card className="inconsistency-card">
      <div className="card-overline"><span>CROSS-EVIDENCE INCONSISTENCIES</span><GitCompareArrows size={14} /></div>
      <p className="fusion-note">Independent evidence dimensions that tell a materially inconsistent story about this project — not a fraud finding, a prompt for human verification.</p>
      {items.length === 0 ? (
        <EmptyState icon={ShieldCheck} title="No cross-evidence inconsistencies" description="The independently computed evidence dimensions do not contradict each other." />
      ) : (
        <div className="inconsistency-list">
          {items.map((item) => (
            <div key={item.id} className="inconsistency-item" data-testid={`inconsistency-${item.id}`}>
              <div className="inconsistency-head">
                <span className={cn('priority-badge', `priority-${priorityTone(item.severity)}`)}><span className="priority-dot" /> {item.severity}</span>
                <span className="inconsistency-dimensions">{item.dimensions.map(capitalizeWord).join(' ↔ ')}</span>
                <span className="inconsistency-confidence">{Math.round(item.confidence * 100)}% confidence</span>
              </div>
              <p className="inconsistency-description">{item.description}</p>
              {item.evidenceReferences.length > 0 && (
                <div className="inconsistency-evidence">
                  {item.evidenceReferences.map((ref, index) => (
                    <span key={`${ref.type}-${ref.id ?? index}`} className="inconsistency-evidence-chip">{ref.label}: {ref.value}</span>
                  ))}
                </div>
              )}
              <div className="inconsistency-footer">
                <span>{item.expectedRelationship}</span>
                <span className="inconsistency-verify">Requires verification</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

export function ActivityList({ items, compact = false }: { items?: ActivityItem[]; compact?: boolean }) {
  if (!items?.length) return <EmptyState icon={Activity} title="No activity yet" description="Evidence review events will appear here." />;
  return <div className={cn('activity-list', compact && 'activity-compact')}>{items.map((item) => <div className="activity-row" key={item.id} data-testid={`activity-${item.id}`}><div className={cn('activity-icon', item.type === 'risk' ? 'activity-danger' : item.type === 'upload' ? 'activity-gold' : 'activity-blue')}><Activity size={14} /></div><div className="activity-copy"><div className="activity-title">{item.title}</div><div className="activity-detail">{item.detail}</div></div><time>{item.time}</time></div>)}</div>;
}

export function ProjectRow({ project, onSelect }: { project: Project; onSelect?: () => void }) {
  return <button className="project-row" onClick={onSelect} data-testid={`row-project-${project.id}`}><div className="project-main"><span className="project-code">{project.id}</span><strong>{project.name}</strong><span className="project-location">{project.district}, {project.state}</span></div><div className="project-category">{project.category}</div><div className="project-evidence"><ScoreBar value={project.evidenceQuality} /><span>{Math.round(project.evidenceQuality)} / 100</span></div><PriorityBadge priority={project.priority} small /><div className="project-flag"><AlertTriangle size={13} /> {project.primaryFinding || 'Review evidence'}</div><ChevronRight className="row-chevron" size={16} /></button>;
}

export function StatusPill({ status }: { status?: string }) {
  const safe = (status ?? 'Pending Review').toLowerCase().replaceAll(' ', '-');
  return <span className={cn('status-pill', `status-${safe}`)} data-testid={`status-investigation-${safe}`}>{status ?? 'Pending Review'}</span>;
}

export function RiskReasons({ risk }: { risk?: RiskAssessment }) {
  if (!risk) return null;
  return <div className="reason-list">{risk.reasons?.map((reason, index) => <div key={`${reason}-${index}`} className="reason-row"><span className="reason-index">0{index + 1}</span><span>{reason}</span></div>)}</div>;
}

const WHY_TYPE_LABEL: Record<string, string> = {
  CROSS_MODAL: 'Cross-evidence',
  FUSION: 'Fusion signal',
  EVIDENCE_COVERAGE: 'Evidence coverage',
  INSUFFICIENT_EVIDENCE: 'Insufficient evidence',
};

// The structured "why this priority?" trail (P0-M) — each entry traces to a
// specific cross-modal inconsistency, a specific anomalous lens's own
// triggered check, or the fusion engine's evidence-coverage accounting.
// risk.reasons is exactly entries.map(e => e.explanation), so this is a
// strict superset of the plain reason list, never a different narrative.
export function WhyTrail({ entries }: { entries?: WhyTrailEntry[] }) {
  if (!entries?.length) return null;
  return (
    <div className="why-trail">
      {entries.map((entry, index) => (
        <div className="why-entry" key={`${entry.type}-${index}`}>
          <div className="why-entry-head">
            <span className="why-entry-type">{WHY_TYPE_LABEL[entry.type] ?? entry.type}</span>
            {entry.severity && <span className={cn('priority-badge', `priority-${priorityTone(entry.severity)}`)}><span className="priority-dot" /> {entry.severity}</span>}
            {entry.confidence != null && <span className="why-entry-confidence">{Math.round(entry.confidence * 100)}% confidence</span>}
          </div>
          <strong className="why-entry-title">{entry.title}</strong>
          <p className="why-entry-explanation">{entry.explanation}</p>
          {!!entry.evidenceReferences?.length && (
            <div className="inconsistency-evidence">
              {entry.evidenceReferences.map((ref, refIndex) => <span key={`${ref.type}-${ref.id ?? refIndex}`} className="inconsistency-evidence-chip">{ref.label}: {ref.value}</span>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function DataStamp({ children }: { children: ReactNode }) {
  return <span className="data-stamp"><span className="stamp-dot" />{children}</span>;
}