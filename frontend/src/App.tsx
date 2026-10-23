import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Routes, useLocation } from "react-router-dom";
import { ApiError } from "./api";
import { AuthProvider } from "./auth/AuthContext";
import { RedirectIfSignedIn, RequireRole, RootRedirect } from "./auth/guards";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider } from "./components/ui";
import { CustomerLayout } from "./layouts/CustomerLayout";
import { OpsLayout } from "./layouts/OpsLayout";
import { MyOrdersPage, OrderDetailPage, ShopPage } from "./pages/customer/CustomerPages";
import { LoginPage } from "./pages/LoginPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import {
  CustomerDetailPage, CustomersPage, DashboardPage, IssuesPage, OpsOrderDetailPage, OpsOrdersPage,
} from "./pages/ops/OpsPages";

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Don't retry answers that won't change (4xx); retry network and server errors once.
        retry: (failures, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failures < 1,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
    },
  });
}

/** Everything except the router, so tests can supply a MemoryRouter. */
export function AppProviders({ children, queryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const [client] = useState(() => queryClient ?? createQueryClient());
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}

export function AppRoutes() {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Routes>
        <Route path="/" element={<RootRedirect />} />
        <Route path="/login" element={<RedirectIfSignedIn><LoginPage /></RedirectIfSignedIn>} />

        <Route element={<RequireRole role="customer" />}>
          <Route element={<CustomerLayout />}>
            <Route path="/shop" element={<ShopPage />} />
            <Route path="/orders" element={<MyOrdersPage />} />
            <Route path="/orders/:id" element={<OrderDetailPage />} />
          </Route>
        </Route>

        <Route path="/ops" element={<RequireRole role="ops" />}>
          <Route element={<OpsLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="orders" element={<OpsOrdersPage />} />
            <Route path="orders/:id" element={<OpsOrderDetailPage />} />
            <Route path="issues" element={<IssuesPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            {/* Unknown /ops paths: the role guard above runs first, so customers are redirected. */}
            <Route path="*" element={<NotFoundPage />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
