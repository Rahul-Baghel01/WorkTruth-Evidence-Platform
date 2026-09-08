import { useMemo, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BarChart2,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  CloudUpload,
  Download,
  FileSpreadsheet,
  FileText,
  Filter,
  Fingerprint,
  Gauge,
  Image as ImageIcon,
  Info,
  Layers,
  LockKeyhole,
  MapPin,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  Send,
  Shield,
  ShieldAlert,
  SlidersHorizontal,
  Sparkles,
  Target,
  Upload,
  Waypoints,
  X,
} from 'lucide-react';
import {
  getGetDashboardActivityQueryKey,
  getGetDashboardStatsQueryKey,
  getGetFinancialAnalysisQueryKey,
  getGetGeoAnalysisQueryKey,
  getGetInvestigationQueryKey,
  getGetProjectAnalysisQueryKey,
  getGetProjectQueryKey,
  getGetProjectRiskQueryKey,
  getGetTemporalAnalysisQueryKey,
  getGetTextAnalysisQueryKey,
  getGetVisualAnalysisQueryKey,
  getListProjectsQueryKey,
  useAnalyzeProject,
  useCreateProject,
  useGetDashboardActivity,
  useGetDashboardStats,
  useGetFinancialAnalysis,
  useGetGeoAnalysis,
  useGetInvestigation,
  useGetProject,
  useGetProjectAnalysis,
  useGetProjectRisk,
  useGetTemporalAnalysis,
  useGetTextAnalysis,
  useGetVisualAnalysis,
  useListProjects,
  useLogin,
  useUpdateInvestigation,
  useUpdateProject,
  useUploadProjects,
} from '@workspace/api-client-react';
import type { Project, ProjectPriority, UploadResult } from '@workspace/api-client-react';
import {
  ActivityList,
  Card,
  DataStamp,
  EmptyState,
  ErrorState,
  MetricCard,
  MiniBars,
  PriorityBadge,
  ProjectRow,
  RiskReasons,
  RiskRing,
  Shell,
  ScoreBar,
  SectionHeading,
  Skeleton,
  StatusPill,
  cn,
  compactMoney,
  dateLabel,
  money,
  priorityTone,
} from '@/components/worktruth';
import { parseRegisterFile, type RegisterParseResult } from '@/lib/register-import';

function LineChart({ points, height = 180 }: { points: Array<{ label: string; values: number[] }>; height?: number }) {
  const all = points.flatMap((point) => point.values);
  const max = Math.max(...all, 1);
  const min = Math.min(...all, 0);
  const width = 640;
  const x = (index: number) => (index / Math.max(points.length - 1, 1)) * width;
  const y = (value: number) => height - 24 - ((value - min) / Math.max(max - min, 1)) * (height - 42);
  const colors = ['#244f5c', '#e3ad45', '#bf4e43', '#5a8d7a'];
  return <div className="line-chart-wrap"><svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="line-chart" role="img" aria-label="Risk trend chart"><line x1="0" x2={width} y1={height - 24} y2={height - 24} className="chart-axis" /><line x1="0" x2={width} y1={y(max * .5)} y2={y(max * .5)} className="chart-gridline" />{[0, 1, 2, 3].map((series) => <polyline key={series} points={points.map((point, index) => `${x(index)},${y(point.values[series] ?? 0)}`).join(' ')} fill="none" stroke={colors[series]} strokeWidth={series === 0 ? 2.7 : 1.7} strokeLinecap="round" strokeLinejoin="round" />)}</svg><div className="chart-labels">{points.map((point) => <span key={point.label}>{point.label}</span>)}</div></div>;
}

function DonutChart({ points }: { points?: Array<{ label: string; value: number }> }) {
  const values = points?.length ? points : [{ label: 'No data', value: 1 }];
  const total = values.reduce((sum, point) => sum + point.value, 0);
  const colors = ['#244f5c', '#e3ad45', '#5a8d7a', '#bf4e43', '#8c6d52'];
  let offset = 0;
  return <div className="donut-wrap"><div className="donut" style={{ background: `conic-gradient(${values.map((point, index) => { const start = offset; offset += (point.value / total) * 360; return `${colors[index % colors.length]} ${start}deg ${offset}deg`; }).join(', ')})` }}><div className="donut-center"><strong>{total}</strong><span>projects</span></div></div><div className="donut-legend">{values.slice(0, 5).map((point, index) => <div key={point.label}><span style={{ background: colors[index % colors.length] }} />{point.label}<b>{point.value}</b></div>)}</div></div>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-intro fade-up"><div><div className="eyebrow">{eyebrow}</div><h1 className="display-title">{title}</h1><p className="intro-copy">{description}</p></div>{action}</div>;
}

export function LandingPage() {
  return <div className="landing-page">
    <div className="landing-grid" />
    <PublicLandingHeader />
    <main>
      <section className="landing-hero">
        <div className="hero-copy">
          <div className="eyebrow hero-eyebrow"><span className="eyebrow-line" />PUBLIC WORKS · EVIDENCE DESK</div>
          <h1>Verify what<br /><em>moves</em> public money.</h1>
          <p>WorkTruth helps district officers turn scattered project evidence into a clear, defensible order of action.</p>
          <div className="hero-actions"><Link href="/login" className="button button-dark button-large" data-testid="link-launch-worktruth">Open the field desk <ArrowRight size={17} /></Link><a href="#how-it-works" className="text-link" data-testid="link-explore-method">See how it works <ChevronDown size={15} /></a></div>
          <div className="hero-trust"><Shield size={15} /><span>Built for responsible review</span><span className="trust-sep">·</span><span>Every signal is explainable</span></div>
        </div>
        <div className="hero-console">
          <div className="console-rail"><span className="rail-dot active" /><span className="rail-dot" /><span className="rail-dot" /><span className="rail-line" /><span className="rail-mark">WT</span></div>
          <div className="console-body"><div className="console-head"><div><span className="console-kicker">TODAY'S EVIDENCE PULSE</span><strong>District portfolio</strong></div><DataStamp>Live</DataStamp></div><div className="console-score"><div><span>Projects monitored</span><strong>184</strong><small>Across 12 districts</small></div><div className="score-sweep"><div className="sweep-ring"><span>82</span><small>evidence<br />health</small></div></div></div><div className="console-lines"><div><span>Verification required</span><b className="text-danger">24</b><i style={{ width: '34%' }} /></div><div><span>Evidence within norm</span><b>137</b><i style={{ width: '74%' }} /></div><div><span>Recently resolved</span><b className="text-green">23</b><i style={{ width: '21%' }} /></div></div><div className="console-foot"><span><CircleDot size={12} /> Last sync 09:42 IST</span><span>Evidence ledger v2.4</span></div></div>
          <div className="console-ticker"><span className="ticker-label">PRIORITY QUEUE</span><div><span className="ticker-dot danger" /> Road widening · Palghar <b>High</b></div><div><span className="ticker-dot gold" /> PHC upgrade · Nandurbar <b>Moderate</b></div></div>
        </div>
      </section>
      <section className="landing-proof"><div className="proof-label">ONE CLEAR VIEW OF THE RECORD</div><div className="proof-statement">A project is more than a spend rate. It is a chain of claims — sanction, progress, place, image, and language — held to account together.</div><div className="proof-notes"><div><span>01</span><p>Find the break<br />in the story.</p></div><div><span>02</span><p>See why it<br />matters.</p></div><div><span>03</span><p>Choose the<br />next proof.</p></div></div></section>
      <section className="landing-section" id="how-it-works"><div className="section-kicker">THE VERIFICATION LOOP</div><div className="section-heading-row"><h2>From register<br />to <em>reasonable action.</em></h2><p>Not an opaque score. A sequence of checks that keeps the officer in control.</p></div><div className="loop-grid"><div className="loop-card loop-card-large"><div className="loop-num">01</div><Fingerprint size={29} /><h3>Assemble the record</h3><p>Sanction orders, expenditure, progress reports, photographs, coordinates, and descriptions become one project truth set.</p><span className="loop-caption">INPUT · MULTIMODAL EVIDENCE</span></div><div className="loop-card"><div className="loop-num">02</div><Target size={26} /><h3>Surface the tension</h3><p>Financial, visual, geographic, temporal, and text signals are compared without flattening the context.</p><span className="loop-caption">COMPARE · EXPLAIN</span></div><div className="loop-card loop-card-accent"><div className="loop-num">03</div><NotebookPen size={26} /><h3>Decide the next proof</h3><p>Prioritise a field visit, request, or verification step. Record the reasoning for the next officer.</p><span className="loop-caption">ACT · LEAVE A TRACE</span></div></div></section>
      <section className="landing-method" id="methodology"><div className="method-copy"><div className="section-kicker">A METHOD YOU CAN DEFEND</div><h2>Clarity before<br /><em>confidence.</em></h2><p>WorkTruth separates the signal from the verdict. Officers see the inputs, weights, and caveats behind every priority — then make the accountable call.</p><Link href="/login" className="text-link dark-link" data-testid="link-method-login">Enter the evidence desk <ArrowRight size={15} /></Link></div><div className="method-diagram"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="method-core"><ShieldCheckIcon /><span>OFFICER<br />JUDGEMENT</span></div><div className="method-node node-one"><span>01</span>Financial</div><div className="method-node node-two"><span>02</span>Visual</div><div className="method-node node-three"><span>03</span>Geo</div><div className="method-node node-four"><span>04</span>Temporal</div></div></section>
      <section className="landing-footer"><div><div className="footer-mark"><span className="brand-cross"><i /><i /></span>WORKTRUTH</div><p>Evidence integrity for public work.</p></div><div className="footer-right"><span>For district officers and accountable teams</span><Link href="/login" className="button button-gold" data-testid="link-footer-login">Launch workspace <ArrowRight size={15} /></Link></div></section>
    </main>
  </div>;
}

function ShieldCheckIcon() { return <Shield size={25} />; }
function PublicLandingHeader() { return <header className="landing-nav"><Link href="/" className="brand-link" data-testid="link-landing-brand"><span className="brand-mark"><span className="brand-cross"><i /><i /></span><span>WORKTRUTH</span></span></Link><div className="landing-nav-right"><span className="landing-version">MPLADS / FIELD DESK</span><Link href="/login" className="button button-dark button-small" data-testid="link-landing-login">Officer sign in <ArrowRight size={14} /></Link></div></header>; }

export function LoginPage() {
  const [, setLocation] = useLocation();
  const login = useLogin();
  const [email, setEmail] = useState('ananya.rao@district.gov.in');
  const [password, setPassword] = useState('demo-officer');
  const [error, setError] = useState('');
  const submit = (event: React.FormEvent) => { event.preventDefault(); setError(''); login.mutate({ data: { email, password } }, { onSuccess: (session) => { sessionStorage.setItem('worktruth-session', session.token); setLocation('/dashboard'); }, onError: () => setError('The demo officer credentials were not accepted. Please try again.') }); };
  return <div className="login-page"><div className="login-aside"><Link href="/" className="brand-link" data-testid="link-login-brand"><WorkTruthLoginMark /></Link><div className="login-quote"><span className="eyebrow">OFFICER WORKSPACE</span><h1>Good decisions<br />need <em>good records.</em></h1><p>Open a calm, explainable view of every project that needs your attention.</p></div><div className="login-aside-foot"><span>WorkTruth / Evidence integrity platform</span><span>v0.9.4 · Demo environment</span></div></div><div className="login-panel"><div className="login-panel-inner"><div className="mobile-login-brand"><WorkTruthLoginMark /></div><div className="login-kicker">SECURE OFFICER ACCESS</div><h2>Welcome back, Ananya.</h2><p className="login-description">Sign in to continue to your district evidence desk.</p><form onSubmit={submit} className="login-form"><label>Email address<input data-testid="input-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label><label>Password<div className="password-wrap"><input data-testid="input-password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required /><LockKeyhole size={15} /></div></label>{error && <div className="form-error"><AlertCircle size={15} />{error}</div>}<button data-testid="button-login" className="button button-dark button-submit" type="submit" disabled={login.isPending}>{login.isPending ? 'Verifying access…' : 'Enter workspace'}<ArrowRight size={16} /></button></form><div className="demo-note"><Sparkles size={15} /><div><strong>Demo officer access</strong><span>Credentials are pre-filled for this workspace.</span></div></div><p className="login-legal">By continuing, you acknowledge that WorkTruth is a decision-support system. Final verification remains with the authorised officer.</p></div></div></div>;
}
function WorkTruthLoginMark() { return <span className="login-mark"><span className="brand-cross"><i /><i /></span><span>WORKTRUTH</span></span>; }

export function DashboardPage() {
  const [, setLocation] = useLocation();
  const statsQuery = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const activityQuery = useGetDashboardActivity({ query: { queryKey: getGetDashboardActivityQueryKey() } });
  const stats = statsQuery.data;
  return <ShellPage><PageIntro eyebrow="FIELD DESK / OVERVIEW" title="Good morning, Ananya." description="Here is the evidence picture across your MPLADS portfolio. Start with what changed, then work the queue." action={<Link href="/projects" className="button button-dark" data-testid="link-open-queue">Open verification queue <ArrowRight size={16} /></Link>} />{statsQuery.isLoading ? <DashboardSkeleton /> : statsQuery.isError ? <ErrorState onRetry={() => statsQuery.refetch()} /> : <><div className="metric-grid fade-up fade-up-delay-1"><MetricCard label="Projects monitored" value={stats?.totalProjects ?? 0} detail="Across 12 districts" icon={Layers} tone="navy" /><MetricCard label="Verification required" value={stats?.verificationRequired ?? 0} detail="Needs officer attention" icon={ShieldAlert} tone="red" /><MetricCard label="Average evidence" value={`${Math.round(stats?.averageEvidenceQuality ?? 0)}%`} detail="Portfolio confidence" icon={Gauge} tone="gold" trend="up" /><MetricCard label="Critical priority" value={stats?.criticalRisk ?? 0} detail="Immediate review" icon={AlertCircle} tone="red" /></div><div className="dashboard-grid fade-up fade-up-delay-2"><Card className="trend-card"><SectionHeading eyebrow="PORTFOLIO SIGNAL" title="Risk movement" detail="Projects by verification priority, last six months" action={<div className="chart-legend"><span><i className="legend-navy" />Low</span><span><i className="legend-gold" />Moderate</span><span><i className="legend-red" />High</span><span><i className="legend-green" />Critical</span></div>} />{stats?.trend?.length ? <LineChart points={stats.trend.map((point) => ({ label: point.month, values: [point.low, point.moderate, point.high, point.critical] }))} /> : <EmptyState icon={BarChart2} title="Trend is being prepared" description="Monthly portfolio history will appear after the first sync." />}</Card><Card className="distribution-card"><SectionHeading eyebrow="CURRENT MIX" title="Risk distribution" detail="A portfolio view, not a verdict" /><DonutChart points={stats?.riskDistribution} /></Card></div><div className="dashboard-grid lower-grid fade-up fade-up-delay-3"><Card className="flagged-card"><SectionHeading eyebrow="ATTENTION FIRST" title="Flagged projects" detail="Sorted by verification priority" action={<Link href="/projects" className="text-link" data-testid="link-view-all-flagged">View all <ArrowRight size={14} /></Link>} />{stats?.flaggedProjects?.length ? <div className="project-list">{stats.flaggedProjects.slice(0, 5).map((project) => <ProjectRow key={project.id} project={project} onSelect={() => setLocation(`/projects/${project.id}`)} />)}</div> : <EmptyState icon={CheckCircle2} title="No flagged projects" description="The portfolio is clear for now." />}</Card><Card className="activity-card"><SectionHeading eyebrow="AUDIT TRAIL" title="Recent activity" /><ActivityList items={activityQuery.data} compact /></Card></div></>}</ShellPage>;
}

function DashboardSkeleton() { return <><div className="metric-grid"><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" /></div><div className="dashboard-grid"><Skeleton className="h-80" /><Skeleton className="h-80" /></div></>; }
function ShellPage({ children }: { children: React.ReactNode }) { return <Shell>{children}</Shell>; }

export function ProjectsPage() {
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('');
  const [district, setDistrict] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('priority');
  const [showCreate, setShowCreate] = useState(false);
  const params = useMemo(() => ({ search: search || undefined, priority: (priority || undefined) as ProjectPriority | undefined, district: district || undefined, category: category || undefined, sort: sort as never, page: 1, pageSize: 50 }), [search, priority, district, category, sort]);
  const projectsQuery = useListProjects(params, { query: { queryKey: getListProjectsQueryKey(params) } });
  const createProject = useCreateProject();
  const [form, setForm] = useState({ id: '', name: '', category: 'Roads', district: '', state: 'Maharashtra', location: '', sanctionAmount: '', expenditure: '', progress: '', latitude: '', longitude: '', description: '' });
  const districts = projectsQuery.data?.districts ?? [];
  const categories = projectsQuery.data?.categories ?? [];
  const submitCreate = (event: React.FormEvent) => { event.preventDefault(); createProject.mutate({ data: { ...form, sanctionAmount: Number(form.sanctionAmount), expenditure: Number(form.expenditure), progress: Number(form.progress), latitude: Number(form.latitude), longitude: Number(form.longitude) } }, { onSuccess: (project) => { setShowCreate(false); setLocation(`/projects/${project.id}`); projectsQuery.refetch(); } }); };
  return <ShellPage><PageIntro eyebrow="VERIFICATION QUEUE" title="Projects that need proof." description="A ranked working list built from financial, visual, geographic, temporal, and text signals." action={<button className="button button-dark" data-testid="button-add-project" onClick={() => setShowCreate(true)}><Plus size={16} /> Add project</button>} /><Card className="queue-toolbar"><div className="search-field"><Search size={17} /><input data-testid="input-project-search" type="search" placeholder="Search project, district, or ID…" value={search} onChange={(e) => setSearch(e.target.value)} /></div><div className="toolbar-divider" /><div className="filter-label"><Filter size={15} /> Filters</div><select data-testid="select-priority-filter" value={priority} onChange={(e) => setPriority(e.target.value)}><option value="">All priorities</option><option value="CRITICAL">Critical</option><option value="HIGH">High</option><option value="MODERATE">Moderate</option><option value="LOW">Low</option></select><select data-testid="select-district-filter" value={district} onChange={(e) => setDistrict(e.target.value)}><option value="">All districts</option>{districts.map((item) => <option value={item} key={item}>{item}</option>)}</select><select data-testid="select-category-filter" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All categories</option>{categories.map((item) => <option value={item} key={item}>{item}</option>)}</select><select data-testid="select-sort-projects" value={sort} onChange={(e) => setSort(e.target.value)}><option value="priority">Sort: priority</option><option value="financial">Sort: financial</option><option value="visual">Sort: visual</option><option value="evidence">Sort: evidence</option><option value="date">Sort: date</option></select></Card>{projectsQuery.isLoading ? <div className="queue-list">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-24" />)}</div> : projectsQuery.isError ? <ErrorState onRetry={() => projectsQuery.refetch()} /> : projectsQuery.data?.items?.length ? <div className="queue-wrap"><div className="queue-head"><span>Project / location</span><span>Category</span><span>Evidence quality</span><span>Priority</span><span>Primary signal</span></div><div className="queue-list">{projectsQuery.data.items.map((project) => <ProjectRow key={project.id} project={project} onSelect={() => setLocation(`/projects/${project.id}`)} />)}</div><div className="queue-foot"><span>Showing {projectsQuery.data.items.length} of {projectsQuery.data.total} projects</span><button className="button button-quiet" data-testid="button-export-queue"><Download size={14} /> Export review list</button></div></div> : <EmptyState icon={Search} title="No projects match those filters" description="Try clearing a filter or search for a project ID." action={<button className="button button-secondary" data-testid="button-clear-filters" onClick={() => { setSearch(''); setPriority(''); setDistrict(''); setCategory(''); }}>Clear filters</button>} />}{showCreate && <CreateProjectModal form={form} setForm={setForm} pending={createProject.isPending} onClose={() => setShowCreate(false)} onSubmit={submitCreate} />}</ShellPage>;
}

function CreateProjectModal({ form, setForm, pending, onClose, onSubmit }: { form: Record<string, string>; setForm: React.Dispatch<React.SetStateAction<Record<string, string>>>; pending: boolean; onClose: () => void; onSubmit: (event: React.FormEvent) => void }) {
  const field = (name: string, label: string, type = 'text') => <label>{label}<input data-testid={`input-new-${name}`} type={type} value={form[name]} onChange={(e) => setForm((current) => ({ ...current, [name]: e.target.value }))} required={['id', 'name', 'district', 'sanctionAmount'].includes(name)} /></label>;
  return <div className="modal-scrim"><div className="modal-card modal-large"><div className="modal-head"><div><div className="eyebrow">NEW RECORD</div><h2>Add a project to the register</h2></div><button className="icon-button" data-testid="button-close-create" onClick={onClose}><X size={18} /></button></div><form onSubmit={onSubmit} className="modal-form"><div className="form-grid">{field('id', 'Project ID')}{field('name', 'Project name')}{field('category', 'Category')}{field('district', 'District')}{field('state', 'State')}{field('location', 'Location')}{field('sanctionAmount', 'Sanction amount', 'number')}{field('expenditure', 'Expenditure', 'number')}{field('progress', 'Progress %', 'number')}{field('latitude', 'Latitude', 'number')}{field('longitude', 'Longitude', 'number')}</div>{field('description', 'Description')}<div className="modal-actions"><button type="button" className="button button-secondary" data-testid="button-cancel-create" onClick={onClose}>Cancel</button><button type="submit" className="button button-dark" data-testid="button-submit-create" disabled={pending}>{pending ? 'Adding…' : 'Add project'} <ArrowRight size={15} /></button></div></form></div></div>;
}

export function ProjectDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const [, setLocation] = useLocation();
  const projectQuery = useGetProject(id, { query: { queryKey: getGetProjectQueryKey(id) } });
  const analysisQuery = useGetProjectAnalysis(id, { query: { queryKey: getGetProjectAnalysisQueryKey(id) } });
  const riskQuery = useGetProjectRisk(id, { query: { queryKey: getGetProjectRiskQueryKey(id) } });
  const financialQuery = useGetFinancialAnalysis(id, { query: { queryKey: getGetFinancialAnalysisQueryKey(id) } });
  const visualQuery = useGetVisualAnalysis(id, { query: { queryKey: getGetVisualAnalysisQueryKey(id) } });
  const textQuery = useGetTextAnalysis(id, { query: { queryKey: getGetTextAnalysisQueryKey(id) } });
  const geoQuery = useGetGeoAnalysis(id, { query: { queryKey: getGetGeoAnalysisQueryKey(id) } });
  const temporalQuery = useGetTemporalAnalysis(id, { query: { queryKey: getGetTemporalAnalysisQueryKey(id) } });
  const investigationQuery = useGetInvestigation(id, { query: { queryKey: getGetInvestigationQueryKey(id) } });
  const analyze = useAnalyzeProject();
  const updateProject = useUpdateProject();
  const updateInvestigation = useUpdateInvestigation();
  const [notes, setNotes] = useState('');
  const [decision, setDecision] = useState('');
  const [status, setStatus] = useState('Under Investigation');
  const [saved, setSaved] = useState(false);
  const project = projectQuery.data;
  const analysis = analysisQuery.data ?? project?.analysis;
  const risk = riskQuery.data ?? analysis?.risk;
  const financial = financialQuery.data ?? analysis?.financial;
  const visual = visualQuery.data ?? analysis?.visual;
  const text = textQuery.data ?? analysis?.text;
  const geo = geoQuery.data ?? analysis?.geo;
  const temporal = temporalQuery.data ?? analysis?.temporal;
  const investigation = investigationQuery.data ?? project?.investigation;
  const saveInvestigation = () => { updateInvestigation.mutate({ id, data: { status, notes, decision } }, { onSuccess: () => { setSaved(true); investigationQuery.refetch(); setTimeout(() => setSaved(false), 2200); } }); };
  const runAnalysis = () => analyze.mutate({ id }, { onSuccess: () => { analysisQuery.refetch(); riskQuery.refetch(); financialQuery.refetch(); visualQuery.refetch(); textQuery.refetch(); geoQuery.refetch(); temporalQuery.refetch(); } });
  if (projectQuery.isLoading) return <ShellPage><div className="detail-loading"><Skeleton className="h-8 w-48" /><Skeleton className="h-24" /><div className="detail-grid"><Skeleton className="h-96" /><Skeleton className="h-96" /></div></div></ShellPage>;
  if (projectQuery.isError || !project) return <ShellPage><ErrorState message="This project record could not be found." onRetry={() => projectQuery.refetch()} /></ShellPage>;
  return <ShellPage><div className="detail-back"><button className="text-link" data-testid="button-back-projects" onClick={() => setLocation('/projects')}><ArrowLeft size={15} /> Back to queue</button><DataStamp>{analysis?.updatedAt ? `Analysed ${dateLabel(analysis.updatedAt)}` : 'Analysis not run'}</DataStamp></div><div className="detail-hero fade-up"><div><div className="eyebrow">{project.id} · {project.category}</div><h1 className="display-title">{project.name}</h1><p className="intro-copy"><MapPin size={15} /> {project.location || project.district}, {project.state} <span className="inline-sep">·</span> {project.contractor || 'Contractor not recorded'}</p></div><div className="detail-actions"><button className="button button-secondary" data-testid="button-run-analysis" onClick={runAnalysis} disabled={analyze.isPending}><RefreshCw size={15} className={analyze.isPending ? 'spin' : ''} /> {analyze.isPending ? 'Analysing…' : 'Re-run analysis'}</button><StatusPill status={investigation?.status} /></div></div><div className="detail-grid detail-top-grid fade-up fade-up-delay-1"><Card className="risk-summary-card"><div className="card-overline"><span>EXPLAINABLE FUSION</span><Info size={14} /></div><div className="risk-summary-main"><RiskRing score={risk?.score ?? 0} priority={risk?.priority} /><div><PriorityBadge priority={risk?.priority} /><h2>{risk?.recommendation || 'Review the available evidence before deciding.'}</h2><p>Priority is a routing signal, not a finding. The officer makes the final determination.</p></div></div><RiskReasons risk={risk} /><div className="weights-row">{risk?.components?.slice(0, 4).map((component) => <div key={component.label}><span>{component.label}</span><b>{Math.round(component.contribution)}%</b><ScoreBar value={component.score} /></div>)}</div></Card><Card className="project-facts-card"><div className="card-overline"><span>PROJECT RECORD</span><FileText size={14} /></div><div className="facts-grid"><Fact label="Sanction amount" value={money(project.sanctionAmount)} /><Fact label="Expenditure" value={money(project.expenditure)} /><Fact label="Reported progress" value={`${project.progress}%`} /><Fact label="Evidence quality" value={`${Math.round(project.evidenceQuality)} / 100`} /><Fact label="Start date" value={dateLabel(project.startDate)} /><Fact label="Expected completion" value={dateLabel(project.expectedCompletion)} /></div><div className="project-description">{project.description}</div></Card></div><div className="section-rule"><span>Five lenses on the record</span><span>Confidence is cumulative, not automatic</span></div><div className="evidence-grid fade-up fade-up-delay-2"><EvidenceLens icon={BarChart2} label="Financial" status={financial?.status} score={financial?.score} summary={financial?.explanation}><div className="lens-numbers"><div><span>Sanction</span><b>{compactMoney(financial?.sanction)}</b></div><div><span>Spent</span><b>{compactMoney(financial?.expenditure)}</b></div><div><span>Deviation</span><b className={Number(financial?.deviation) > 0 ? 'text-danger' : ''}>{financial?.deviation ?? 0}%</b></div></div></EvidenceLens><EvidenceLens icon={ImageIcon} label="Visual" status={visual?.status} score={visual?.score} summary={visual?.explanation}><div className="evidence-images">{visual?.images?.slice(0, 2).map((image) => <div className="evidence-thumb" key={image.id}>{image.imageUrl ? <img src={image.imageUrl} alt={image.label} /> : <div className="thumb-placeholder"><ImageIcon size={19} /></div>}<span>{image.label}</span></div>)}</div></EvidenceLens><EvidenceLens icon={FileText} label="Text consistency" status={text?.status} score={text?.score} summary={text?.explanation}><div className="text-match"><span className="match-quote">“</span><p>{text?.current || 'No project description was returned.'}</p><div className="match-footer"><span>Similarity to peer records</span><b>{text?.similarity ?? 0}%</b></div></div></EvidenceLens><EvidenceLens icon={MapPin} label="Geographic" status={geo?.status} score={geo?.score} summary={geo?.explanation}><div className="geo-mini"><div className="geo-points"><span className="geo-declared" /><span className="geo-route" /><span className="geo-photo" /></div><div><span>Declared → photograph</span><b>{geo?.distanceKm ?? 0} km variance</b></div></div></EvidenceLens><EvidenceLens icon={Waypoints} label="Temporal" status={temporal?.status} score={temporal?.score} summary={temporal?.explanation}><div className="timeline-mini">{temporal?.timeline?.slice(0, 4).map((point) => <div key={point.label}><span>{point.label}</span><i style={{ width: `${point.progress}%` }} /><b>{point.progress}%</b></div>)}</div></EvidenceLens></div><div className="investigation-area fade-up fade-up-delay-3"><Card className="workflow-card"><SectionHeading eyebrow="OFFICER WORKFLOW" title="Leave the next person a clear record." detail="Your decision and notes become part of the audit trail." action={saved ? <span className="saved-label"><Check size={14} /> Saved</span> : undefined} /><div className="workflow-fields"><label>Review status<select data-testid="select-investigation-status" value={status} onChange={(e) => setStatus(e.target.value)}><option>Pending Review</option><option>Under Investigation</option><option>Needs Field Visit</option><option>Verified</option><option>Resolved</option></select></label><label>Decision<textarea data-testid="textarea-decision" value={decision || investigation?.decision || ''} onChange={(e) => setDecision(e.target.value)} placeholder="What is the next defensible action?" /></label><label>Officer notes<textarea data-testid="textarea-notes" value={notes || investigation?.notes || ''} onChange={(e) => setNotes(e.target.value)} placeholder="Capture context, requests, and what to verify on the ground." /></label></div><button className="button button-dark" data-testid="button-save-investigation" onClick={saveInvestigation} disabled={updateInvestigation.isPending}>{updateInvestigation.isPending ? 'Saving…' : 'Save investigation record'} <Send size={15} /></button></Card><Card className="history-card"><SectionHeading eyebrow="AUDIT TRAIL" title="Investigation history" />{investigation?.history?.length ? <div className="history-list">{investigation.history.map((item) => <div className="history-item" key={item.id}><div className="history-line"><span className="history-dot" /><span /></div><div><div className="history-meta"><StatusPill status={item.status} /><time>{item.time}</time></div><p>{item.note}</p><span className="history-officer">{item.officer}</span></div></div>)}</div> : <EmptyState icon={NotebookPen} title="No history yet" description="Your first investigation update will start the audit trail." />}</Card></div></ShellPage>;
}

function Fact({ label, value }: { label: string; value: string }) { return <div className="fact"><span>{label}</span><strong>{value}</strong></div>; }
function EvidenceLens({ icon: Icon, label, status, score, summary, children }: { icon: typeof BarChart2; label: string; status?: string; score?: number; summary?: string; children: React.ReactNode }) {
  const percentage = (score ?? 0) <= 1 ? (score ?? 0) * 100 : (score ?? 0);
  return <Card className="evidence-lens"><div className="lens-head"><div className="lens-icon"><Icon size={17} /></div><div><span className="lens-label">{label}</span><StatusPill status={status || 'Pending Review'} /></div><span className="lens-score">{Math.round(percentage)}%</span></div><p className="lens-explanation">{summary || 'Awaiting analysis for this evidence lens.'}</p>{children}</Card>;
}

export function MapPage() {
  const projectsQuery = useListProjects({ page: 1, pageSize: 100, sort: 'priority' }, { query: { queryKey: getListProjectsQueryKey({ page: 1, pageSize: 100, sort: 'priority' }) } });
  const projects = projectsQuery.data?.items ?? [];
  const [selected, setSelected] = useState<Project | null>(null);
  return <ShellPage><PageIntro eyebrow="PROJECT ATLAS" title="See the work in place." description="A geographic overview of the register. Select a marker to see the project’s priority and primary signal." action={<Link href="/upload" className="button button-secondary" data-testid="link-map-upload"><Upload size={15} /> Import register</Link>} /><div className="map-layout"><Card className="map-card"><div className="map-toolbar"><div><span className="eyebrow">MAHARASHTRA · PORTFOLIO VIEW</span><strong>{projects.length || 0} mapped projects</strong></div><div className="map-legend"><span><i className="map-dot critical" />Critical</span><span><i className="map-dot high" />High</span><span><i className="map-dot moderate" />Moderate</span><span><i className="map-dot low" />Low</span></div></div><div className="map-canvas"><div className="map-watermark">WORK<br />TRUTH</div><svg viewBox="0 0 760 530" className="india-map" aria-label="Project map"><path d="M310 28 C264 45 222 50 195 91 C177 119 143 128 159 168 C173 202 154 232 179 264 C196 286 183 320 209 349 C226 368 220 404 250 430 C282 457 291 491 328 503 C346 495 354 466 370 441 C391 407 409 389 421 354 C438 309 469 290 478 249 C485 214 527 185 507 149 C491 120 457 118 438 90 C415 57 364 52 349 26 Z" className="map-land" /><path d="M313 52 C287 87 275 120 250 146 M252 147 C227 195 238 248 220 285 M274 114 C335 130 394 114 451 147 M220 285 C290 271 339 281 404 252 M248 368 C302 350 351 369 409 345 M335 130 C329 184 352 219 339 281 M404 252 C401 300 378 337 349 390" className="map-river" />{projects.map((project, index) => { const x = 190 + ((project.longitude - 72) / 7.7) * 290 + ((index % 3) - 1) * 8; const y = 100 + ((21 - project.latitude) / 5.7) * 310; return <g key={project.id} onClick={() => setSelected(project)} className="map-marker" data-testid={`marker-project-${project.id}`}><circle cx={x} cy={y} r={project.priority === 'CRITICAL' ? 8 : 5.5} className={`marker-${priorityTone(project.priority)}`} /><circle cx={x} cy={y} r="13" className="marker-pulse" /></g>; })}</svg>{!projects.length && <div className="map-empty"><MapPin size={20} /><span>No mapped projects in this view</span></div>}</div></Card><Card className="map-side"><SectionHeading eyebrow="SELECTED PROJECT" title={selected?.name || 'Select a marker'} detail={selected ? 'Project details from the register' : 'Markers are colour-coded by verification priority.'} />{selected ? <div className="selected-project"><PriorityBadge priority={selected.priority} /><h3>{selected.name}</h3><p>{selected.district}, {selected.state}</p><div className="selected-stats"><Fact label="Evidence quality" value={`${Math.round(selected.evidenceQuality ?? 0)} / 100`} /><Fact label="Primary signal" value={selected.primaryFlag || 'Review evidence'} /></div><Link href={`/projects/${selected.id}`} className="button button-dark" data-testid="link-selected-project">Open investigation <ArrowRight size={15} /></Link></div> : <div className="map-side-note"><MapPin size={27} /><p>Choose a project marker to inspect its record and open an investigation.</p></div>}<div className="map-summary"><div><span>Highest concentration</span><strong>{projects[0]?.district || 'Awaiting data'}</strong></div><div><span>Projects requiring proof</span><strong>{projects.filter((p) => p.priority === 'HIGH' || p.priority === 'CRITICAL').length}</strong></div></div></Card></div></ShellPage>;
}

export function AnalyticsPage() {
  const statsQuery = useGetDashboardStats({ query: { queryKey: getGetDashboardStatsQueryKey() } });
  const projectsQuery = useListProjects({ page: 1, pageSize: 100, sort: 'financial' }, { query: { queryKey: getListProjectsQueryKey({ page: 1, pageSize: 100, sort: 'financial' }) } });
  const stats = statsQuery.data;
  const projects = projectsQuery.data?.items ?? [];
  return <ShellPage><PageIntro eyebrow="EVIDENCE ANALYTICS" title="Patterns worth a closer look." description="Cross-project context for the questions that do not fit inside one project record." action={<button className="button button-secondary" data-testid="button-export-analytics"><Download size={15} /> Export briefing</button>} /><div className="analytics-feature-grid"><Card className="analytics-chart-card"><SectionHeading eyebrow="RISK OVER TIME" title="Where the portfolio is moving" detail="Monthly project priority mix" /><LineChart points={stats?.trend?.map((point) => ({ label: point.month, values: [point.low, point.moderate, point.high, point.critical] })) ?? []} height={220} /><div className="analytics-callout"><Sparkles size={16} /><span><b>Signal:</b> {stats?.trend?.length ? 'High-priority projects have increased across the last two reporting cycles.' : 'Connect the register to establish a trend baseline.'}</span></div></Card><Card className="analytics-donut-card"><SectionHeading eyebrow="BY CATEGORY" title="What the register holds" detail="Distribution across the current portfolio" /><DonutChart points={stats?.categoryBreakdown} /></Card></div><div className="analytics-grid"><Card><SectionHeading eyebrow="ANOMALY SIGNALS" title="What is creating friction" detail="Count of projects with each signal" />{stats?.anomalySignals?.length ? <div className="signal-bars">{stats.anomalySignals.map((signal, index) => <div key={signal.label}><div className="signal-label"><span>{signal.label}</span><b>{signal.value}</b></div><div className="signal-track"><i style={{ width: `${Math.min(100, (signal.value / Math.max(...stats.anomalySignals.map((item) => item.value), 1)) * 100)}%`, background: ['#bf4e43', '#e3ad45', '#244f5c', '#5a8d7a'][index % 4] }} /></div></div>)}</div> : <EmptyState icon={BarChart2} title="No anomaly signals" description="Signal counts appear after the evidence register is analysed." />}</Card><Card><SectionHeading eyebrow="FINANCIAL LENS" title="Spend against progress" detail="Projects with the widest spread" /><div className="spend-list">{projects.slice(0, 6).map((project) => <div className="spend-row" key={project.id}><div><strong>{project.name}</strong><span>{project.id} · {project.category}</span></div><div className="spend-progress"><div><span>Spend</span><i style={{ width: `${Math.min(100, (project.expenditure / Math.max(project.sanctionAmount, 1)) * 100)}%` }} /></div><div><span>Progress</span><i className="progress-gold" style={{ width: `${Math.min(100, project.progress)}%` }} /></div></div><PriorityBadge priority={project.priority} small /></div>)}</div></Card></div><Card className="analytics-table-card"><SectionHeading eyebrow="CROSS-PROJECT COMPARISON" title="Evidence quality by category" detail="A directional view to guide sampling" /><div className="category-table"><div className="category-table-head"><span>Category</span><span>Projects</span><span>Avg evidence</span><span>Priority mix</span></div>{(stats?.categoryBreakdown ?? []).map((category) => <div className="category-table-row" key={category.label}><strong>{category.label}</strong><span>{category.value}</span><div className="table-score"><ScoreBar value={Math.min(100, 52 + category.value * 2)} /><b>{Math.min(100, 52 + category.value * 2)}%</b></div><span className="priority-mix"><i className="mix-low" /><i className="mix-high" /><i className="mix-critical" /></span></div>)}</div></Card></ShellPage>;
}

export function UploadPage() {
  const upload = useUploadProjects();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [parseResult, setParseResult] = useState<RegisterParseResult | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [parsing, setParsing] = useState(false);

  const chooseFile = (candidate?: File) => {
    if (!candidate) return;
    setFile(candidate);
    setParseResult(null);
    setResult(null);
    setServerError(null);
  };

  const processFile = async () => {
    if (!file) return;
    setResult(null);
    setServerError(null);
    setParsing(true);
    const parsed = await parseRegisterFile(file);
    setParsing(false);
    setParseResult(parsed);
    if (parsed.errors.length || !parsed.records.length) return;
    upload.mutate(
      { data: { filename: file.name, records: parsed.records, rowNumbers: parsed.rowNumbers } },
      {
        onSuccess: (data) => setResult(data),
        onError: () => setServerError('The register could not be imported. The API rejected the file before any invalid record was committed.'),
      },
    );
  };

  const parseHasErrors = Boolean(parseResult?.errors.length);
  const rowIssueCount = parseResult?.errors.filter((item) => item.row !== 'header').length ?? 0;
  const qualityPercent = result ? Math.round(result.qualityScore * 100) : 0;

  return <ShellPage><PageIntro eyebrow="IMPORT REGISTER" title="Bring in the next record." description="Load the CSV or XLSX register your team already uses. WorkTruth maps its headers, checks every row, and only then sends valid records to the import API." action={<button className="button button-secondary" data-testid="button-download-template"><Download size={15} /> Download template</button>} /><div className="upload-layout"><Card className={cn('upload-dropzone', dragging && 'upload-dragging')} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); chooseFile(e.dataTransfer.files?.[0]); }}><input ref={fileRef} type="file" accept=".csv,.xlsx" className="sr-only" data-testid="input-upload-file" onChange={(e) => chooseFile(e.target.files?.[0])} /><div className="upload-icon"><CloudUpload size={25} /></div><h2>{file ? file.name : 'Drop a project register here'}</h2><p>{file ? 'Ready to map headers and validate every row.' : 'CSV or XLSX · up to 10,000 project records'}</p><button className="button button-dark" data-testid="button-choose-file" onClick={() => fileRef.current?.click()}>{file ? 'Choose another file' : 'Choose file'} <Upload size={15} /></button>{file && <button className="button button-gold upload-process" data-testid="button-process-upload" onClick={processFile} disabled={upload.isPending || parsing}>{parsing ? 'Reading register…' : upload.isPending ? 'Importing…' : 'Map, validate & import'} <ArrowRight size={15} /></button>}<div className="upload-note"><Shield size={14} /> No record is committed until validation completes.</div></Card><div className="upload-aside"><Card><div className="card-overline"><span>EXPECTED SHAPE</span><FileSpreadsheet size={14} /></div><div className="field-list">{['Project ID + name', 'Category, district, state', 'Sanction + expenditure', 'Progress + coordinates', 'Description + dates'].map((item) => <div key={item}><Check size={14} />{item}</div>)}</div><button className="text-link" data-testid="button-view-schema">View data schema <ChevronRight size={14} /></button></Card><Card className="upload-integrity-card"><div className="card-overline"><span>IMPORT PRINCIPLE</span><Shield size={14} /></div><p>Importing data does not create a finding. It creates a record that can be checked, explained, and corrected.</p></Card></div></div>{parseResult && <Card className={cn('upload-validation', parseHasErrors && 'upload-validation-error')}><div className="validation-heading"><div><div className="eyebrow">{parseHasErrors ? 'ACTION REQUIRED' : 'REGISTER MAPPED'}</div><h2>{parseHasErrors ? rowIssueCount ? `${rowIssueCount} row issues found` : 'Header mapping needs attention' : `${parseResult.records.length} rows ready to import`}</h2></div>{parseHasErrors ? <AlertCircle size={21} /> : <CheckCircle2 size={21} />}</div>{parseResult.headerMappings.length > 0 && <div className="header-mapping"><strong>Mapped columns</strong><div>{parseResult.headerMappings.map((mapping, index) => <span key={`${index}-${mapping.source}-${mapping.target ?? 'unknown'}`} className={cn(!mapping.target && 'mapping-unmatched')}>{mapping.source || '(blank)'}{mapping.target ? ` → ${mapping.target}` : ' · not recognised'}</span>)}</div></div>}{parseHasErrors && <div className="row-errors">{parseResult.errors.map((item) => <div className="row-error" key={`${item.row}-${item.errors.join('|')}`}><strong>{item.row === 'header' ? 'Header' : `Row ${item.row}`}</strong><ul>{item.errors.map((message) => <li key={message}>{message}</li>)}</ul></div>)}</div>}</Card>}{serverError && <Card className="upload-validation upload-validation-error"><div className="validation-heading"><div><div className="eyebrow">IMPORT NOT COMPLETED</div><h2>Server validation stopped the import</h2><p>{serverError}</p></div><AlertCircle size={21} /></div></Card>}{result && <Card className="upload-result fade-up"><div className="result-icon"><CheckCircle2 size={22} /></div><div><div className="eyebrow">VALIDATION COMPLETE</div><h2>{result.imported} records imported</h2><p>{result.rejected} rejected · {qualityPercent}% register quality{result.missingFields.length ? ` · Missing: ${result.missingFields.join(', ')}` : ''}</p>{result.rowErrors.length > 0 && <div className="row-errors result-row-errors">{result.rowErrors.map((item) => <div className="row-error" key={`${item.row}-${item.errors.join('|')}`}><strong>Row {item.row}</strong><span>{item.errors.join(' · ')}</span></div>)}</div>}</div><Link href="/projects" className="button button-dark" data-testid="link-view-imported">Review queue <ArrowRight size={15} /></Link></Card>}</ShellPage>;
}

export function SettingsPage() {
  const [saved, setSaved] = useState(false);
  const [notifications, setNotifications] = useState(true);
  const [sampling, setSampling] = useState('Balanced');
  return <ShellPage><PageIntro eyebrow="METHOD & ACCESS" title="A clear method, by design." description="Understand how WorkTruth prioritises verification and configure the officer workspace around your review practice." action={saved ? <span className="saved-label"><Check size={14} /> Settings saved</span> : <button className="button button-dark" data-testid="button-save-settings" onClick={() => { setSaved(true); setTimeout(() => setSaved(false), 2200); }}>Save settings <Check size={15} /></button>} /><div className="settings-layout"><div className="settings-main"><Card><SectionHeading eyebrow="RESPONSIBLE AI METHOD" title="Evidence fusion, not automated judgement." detail="The system routes attention; it does not certify a project." /><div className="method-rows"><MethodRow number="01" title="Signals stay separate" description="Financial, visual, geographic, temporal, and text checks are calculated independently before they are combined." /><MethodRow number="02" title="Weights are visible" description="Each signal’s contribution is shown on the investigation page so an officer can challenge the priority." /><MethodRow number="03" title="Context remains human" description="A flagged project is a prompt for verification, never a conclusion about delivery or intent." /></div></Card><Card><SectionHeading eyebrow="PRIORITISATION PROFILE" title="How much to sample" detail="This affects routing, not the underlying evidence." /><div className="sampling-options">{['Focused', 'Balanced', 'Broad'].map((option) => <button key={option} className={cn('sampling-option', sampling === option && 'sampling-selected')} data-testid={`button-sampling-${option.toLowerCase()}`} onClick={() => setSampling(option)}><span>{option}</span><small>{option === 'Focused' ? 'Only high and critical signals' : option === 'Broad' ? 'Include moderate variance' : 'Balanced officer workload'}</small>{sampling === option && <Check size={15} />}</button>)}</div></Card></div><div className="settings-side"><Card className="account-card"><div className="settings-avatar">AR</div><div className="eyebrow">SIGNED IN AS</div><h2>Ananya Rao</h2><p>District Officer<br />Maharashtra · Nashik division</p><button className="button button-secondary" data-testid="button-manage-account">Manage account <ArrowRight size={14} /></button></Card><Card><SectionHeading eyebrow="WORKSPACE" title="Desk preferences" /><div className="preference-row"><div><strong>Evidence alerts</strong><span>Notify me when a critical signal appears.</span></div><button className={cn('toggle', notifications && 'toggle-on')} data-testid="button-toggle-alerts" onClick={() => setNotifications((value) => !value)}><i /></button></div><div className="preference-row"><div><strong>Show methodology notes</strong><span>Keep explanations expanded by default.</span></div><button className="toggle toggle-on" data-testid="button-toggle-method"><i /></button></div></Card><Card className="privacy-card"><LockKeyhole size={17} /><div><strong>Protected workspace</strong><span>Session activity and investigation updates are logged for accountability.</span></div></Card></div></div></ShellPage>;
}
function MethodRow({ number, title, description }: { number: string; title: string; description: string }) { return <div className="method-row"><span>{number}</span><div><h3>{title}</h3><p>{description}</p></div><CheckCircle2 size={17} /></div>; }