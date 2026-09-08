import { type ComponentType, type ReactNode, useState } from 'react';
import { Link, useLocation } from 'wouter';
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
  UserRound,
  X,
} from 'lucide-react';
import type {
  ActivityItem,
  DashboardStats,
  Project,
  ProjectPriority,
  RiskAssessment,
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
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const active = (href: string) => location === href || (href !== '/dashboard' && location.startsWith(href));
  const handleSignOut = () => { sessionStorage.removeItem('worktruth-session'); setLocation('/'); };
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
              <Icon size={17} strokeWidth={active(href) ? 2.4 : 1.8} /><span>{label}</span>{href === '/projects' && <span className="nav-count">24</span>}
            </Link>
          ))}
          <div className="nav-label nav-label-spaced">Governance</div>
          <Link href="/settings" className={cn('nav-item', active('/settings') && 'nav-item-active')} data-testid="link-nav-methodology"><ShieldCheck size={17} /><span>Method & access</span></Link>
          <Link href="/settings" className="nav-item" data-testid="link-nav-settings"><Settings2 size={17} /><span>Workspace settings</span></Link>
        </nav>
        <div className="sidebar-footer">
          <div className="desk-status"><span className="status-pulse" /><span>Evidence service operational</span></div>
          <button className="nav-item nav-signout" data-testid="button-signout" onClick={handleSignOut}><LogOut size={17} /><span>Sign out</span></button>
          <div className="officer-mini"><div className="avatar avatar-gold">AR</div><div><strong>Ananya Rao</strong><span>District Officer</span></div><ChevronDown size={14} /></div>
        </div>
      </aside>
      {open && <button className="mobile-scrim" onClick={() => setOpen(false)} aria-label="Close menu" data-testid="button-close-menu" />}
      <main className={cn('main-shell', collapsed && 'main-shell-wide')}>
        <header className="topbar">
          <button className="mobile-menu icon-button" data-testid="button-open-menu" onClick={() => setOpen(true)} aria-label="Open menu"><Menu size={19} /></button>
          <div className="topbar-crumb"><span className="crumb-mobile">Field desk</span><span className="crumb-sep">/</span><span>{navItems.find((item) => active(item.href))?.label ?? (active('/settings') ? 'Method & access' : 'Workspace')}</span></div>
          <div className="topbar-actions">
            <button className="icon-button" data-testid="button-help" aria-label="Help"><CircleHelp size={18} /></button>
            <button className="icon-button has-dot" data-testid="button-notifications" aria-label="Notifications"><Bell size={18} /></button>
            <div className="topbar-divider" />
            <div className="avatar avatar-navy">AR</div><span className="topbar-user">Ananya Rao</span>
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

export function MetricCard({ label, value, detail, icon: Icon, tone = 'navy', trend }: { label: string; value: string | number; detail: string; icon: typeof Activity; tone?: string; trend?: 'up' | 'down' }) {
  return <Card className={cn('metric-card', `metric-${tone}`)}><div className="metric-top"><span className="metric-label">{label}</span><span className="metric-icon"><Icon size={17} /></span></div><div className="metric-value">{value}</div><div className="metric-detail">{trend && (trend === 'up' ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />)}{detail}</div></Card>;
}

export function MiniBars({ values, labels, accent = 'navy' }: { values: number[]; labels?: string[]; accent?: string }) {
  const max = Math.max(...values, 1);
  return <div className="mini-bars">{values.map((value, index) => <div className="mini-bar-col" key={`${value}-${index}`}><div className={cn('mini-bar', `bar-${accent}`)} style={{ height: `${Math.max(7, (value / max) * 100)}%` }} title={labels?.[index]} /><span>{labels?.[index]}</span></div>)}</div>;
}

export function RiskRing({ score, priority }: { score: number; priority?: string }) {
  const tone = priorityTone(priority);
  const percentage = score <= 1 ? score * 100 : score;
  return <div className={cn('risk-ring', `ring-${tone}`)} style={{ '--ring-progress': `${Math.min(100, Math.max(0, percentage)) * 3.6}deg` } as React.CSSProperties}><div><strong>{Math.round(percentage)}</strong><span>risk score</span></div></div>;
}

export function ActivityList({ items, compact = false }: { items?: ActivityItem[]; compact?: boolean }) {
  if (!items?.length) return <EmptyState icon={Activity} title="No activity yet" description="Evidence review events will appear here." />;
  return <div className={cn('activity-list', compact && 'activity-compact')}>{items.map((item) => <div className="activity-row" key={item.id} data-testid={`activity-${item.id}`}><div className={cn('activity-icon', item.type === 'risk' ? 'activity-danger' : item.type === 'upload' ? 'activity-gold' : 'activity-blue')}><Activity size={14} /></div><div className="activity-copy"><div className="activity-title">{item.title}</div><div className="activity-detail">{item.detail}</div></div><time>{item.time}</time></div>)}</div>;
}

export function ProjectRow({ project, onSelect }: { project: Project; onSelect?: () => void }) {
  return <button className="project-row" onClick={onSelect} data-testid={`row-project-${project.id}`}><div className="project-main"><span className="project-code">{project.id}</span><strong>{project.name}</strong><span className="project-location">{project.district}, {project.state}</span></div><div className="project-category">{project.category}</div><div className="project-evidence"><ScoreBar value={project.evidenceQuality} /><span>{Math.round(project.evidenceQuality)} / 100</span></div><PriorityBadge priority={project.priority} small /><div className="project-flag"><AlertTriangle size={13} /> {project.primaryFlag || 'Review evidence'}</div><ChevronRight className="row-chevron" size={16} /></button>;
}

export function StatusPill({ status }: { status?: string }) {
  const safe = (status ?? 'Pending Review').toLowerCase().replaceAll(' ', '-');
  return <span className={cn('status-pill', `status-${safe}`)} data-testid={`status-investigation-${safe}`}>{status ?? 'Pending Review'}</span>;
}

export function RiskReasons({ risk }: { risk?: RiskAssessment }) {
  if (!risk) return null;
  return <div className="reason-list">{risk.reasons?.map((reason, index) => <div key={`${reason}-${index}`} className="reason-row"><span className="reason-index">0{index + 1}</span><span>{reason}</span></div>)}</div>;
}

export function DataStamp({ children }: { children: ReactNode }) {
  return <span className="data-stamp"><span className="stamp-dot" />{children}</span>;
}