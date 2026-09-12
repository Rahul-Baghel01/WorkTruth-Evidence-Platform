import { type ComponentType, type ReactNode, useEffect } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { getGetSessionQueryKey, useGetSession } from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import {
  AnalyticsPage,
  DashboardPage,
  LandingPage,
  LoginPage,
  MapPage,
  ProjectDetailPage,
  ProjectsPage,
  SettingsPage,
  UploadPage,
  UserManagementPage,
} from '@/pages/worktruth-pages';
import {
  Route,
  Switch,
  useLocation,
  Router as WouterRouter,
} from 'wouter';

const queryClient = new QueryClient();

// Gates a page behind a real server-verified session (GET /api/auth/session).
// Unauthenticated visitors are redirected to /login rather than shown any
// protected content or fabricated user state.
function RequireAuth({ component: Component }: { component: ComponentType }) {
  const [, setLocation] = useLocation();
  const sessionQuery = useGetSession({ query: { queryKey: getGetSessionQueryKey(), retry: false } });
  useEffect(() => {
    if (sessionQuery.isError) setLocation('/login');
  }, [sessionQuery.isError, setLocation]);
  if (sessionQuery.isLoading) {
    return <div className="auth-check" role="status" aria-live="polite">Checking session…</div>;
  }
  if (sessionQuery.isError || !sessionQuery.data) return null;
  return <Component />;
}

function protect(component: ComponentType) {
  return () => <RequireAuth component={component} />;
}

// Same server-verified session check as RequireAuth, plus a role check —
// this is a UX redirect only (straight to a page a non-admin can actually
// use), never the actual access control: the admin API itself rejects a
// non-admin with 403 regardless of what route the frontend renders, so
// there is no path to the data even if this component were bypassed.
function RequireAdmin({ component: Component }: { component: ComponentType }) {
  const [, setLocation] = useLocation();
  const sessionQuery = useGetSession({ query: { queryKey: getGetSessionQueryKey(), retry: false } });
  const user = sessionQuery.data?.user;
  useEffect(() => {
    if (sessionQuery.isError) setLocation('/login');
    else if (user && user.role !== 'ADMIN') setLocation('/dashboard');
  }, [sessionQuery.isError, user, setLocation]);
  if (sessionQuery.isLoading) {
    return <div className="auth-check" role="status" aria-live="polite">Checking session…</div>;
  }
  if (sessionQuery.isError || !user || user.role !== 'ADMIN') return null;
  return <Component />;
}

function protectAdmin(component: ComponentType) {
  return () => <RequireAdmin component={component} />;
}

function Router() {
  return (
    // Keep a shared shell (sidebar, navbar) outside the boundary so it
    // survives a page crash.
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={LandingPage} />
        <Route path="/login" component={LoginPage} />
        <Route path="/dashboard" component={protect(DashboardPage)} />
        <Route path="/projects" component={protect(ProjectsPage)} />
        <Route path="/projects/:id" component={protect(ProjectDetailPage)} />
        <Route path="/map" component={protect(MapPage)} />
        <Route path="/analytics" component={protect(AnalyticsPage)} />
        <Route path="/upload" component={protect(UploadPage)} />
        <Route path="/settings" component={protect(SettingsPage)} />
        <Route path="/admin/users" component={protectAdmin(UserManagementPage)} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
