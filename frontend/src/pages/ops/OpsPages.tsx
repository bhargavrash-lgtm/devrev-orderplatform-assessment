import { CircleAlert, LayoutDashboard, Package, PackageSearch, UserRound, Users } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PlaceholderPage } from "../PlaceholderPage";

const linkButton =
  "focus-ring inline-flex h-9 items-center rounded border border-line-strong bg-white px-4 text-sm font-medium text-ink shadow-xs hover:bg-page";

export function DashboardPage() {
  return (
    <PlaceholderPage
      title="Dashboard"
      description="How orders, issues and accounts are doing today."
      icon={<LayoutDashboard className="h-6 w-6" />}
      emptyTitle="Insights are on their way"
      emptyDescription="Order and issue counts, feedback, recurring problems and accounts at risk will show here in the next build step."
    />
  );
}

export function OpsOrdersPage() {
  return (
    <PlaceholderPage
      title="Orders"
      description="Every customer order, with filters for status, product, network and dates."
      icon={<Package className="h-6 w-6" />}
      emptyTitle="The order list is on its way"
      emptyDescription="Search, filter and update orders here in the next build step."
    />
  );
}

export function OpsOrderDetailPage() {
  const { id } = useParams();
  return (
    <PlaceholderPage
      eyebrow={<Link to="/ops/orders" className="focus-ring rounded hover:text-ink">Orders</Link>}
      title={`Order #${id ?? ""}`}
      icon={<PackageSearch className="h-6 w-6" />}
      emptyTitle="Order details are on their way"
      emptyDescription="Status changes, items, the conversation, issues and attachments will show here in the next build step."
      action={<Link to="/ops/orders" className={linkButton}>Back to orders</Link>}
    />
  );
}

export function IssuesPage() {
  return (
    <PlaceholderPage
      title="Issues"
      description="Problems reported on orders, unresolved first."
      icon={<CircleAlert className="h-6 w-6" />}
      emptyTitle="The issue queue is on its way"
      emptyDescription="Triage issues, set severity and link Jira keys here in the next build step."
    />
  );
}

export function CustomersPage() {
  return (
    <PlaceholderPage
      title="Customers"
      description="Accounts, their health and who owns them."
      icon={<Users className="h-6 w-6" />}
      emptyTitle="The customer list is on its way"
      emptyDescription="Account details, summary numbers and owners will show here in the next build step."
    />
  );
}

export function CustomerDetailPage() {
  const { id } = useParams();
  return (
    <PlaceholderPage
      eyebrow={<Link to="/ops/customers" className="focus-ring rounded hover:text-ink">Customers</Link>}
      title={`Customer #${id ?? ""}`}
      icon={<UserRound className="h-6 w-6" />}
      emptyTitle="The account view is on its way"
      emptyDescription="Contacts, orders, the timeline and interactions for this account will show here in the next build step."
      action={<Link to="/ops/customers" className={linkButton}>Back to customers</Link>}
    />
  );
}
