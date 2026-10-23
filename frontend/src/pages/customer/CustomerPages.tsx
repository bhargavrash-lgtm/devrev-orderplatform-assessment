import { ClipboardList, PackageSearch, Store } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { PlaceholderPage } from "../PlaceholderPage";

const linkButton =
  "focus-ring inline-flex h-9 items-center rounded border border-line-strong bg-white px-4 text-sm font-medium text-ink shadow-xs hover:bg-page";

export function ShopPage() {
  return (
    <PlaceholderPage
      title="Shop"
      description="Seeds, fertilisers, crop protection and equipment for your next order."
      icon={<Store className="h-6 w-6" />}
      emptyTitle="The catalogue is on its way"
      emptyDescription="Products with live prices and stock will be listed here in the next build step."
    />
  );
}

export function MyOrdersPage() {
  return (
    <PlaceholderPage
      title="My orders"
      description="Everything your team has ordered, newest first."
      icon={<ClipboardList className="h-6 w-6" />}
      emptyTitle="Order history is on its way"
      emptyDescription="Your orders, their status and delivery progress will show here in the next build step."
      action={<Link to="/shop" className={linkButton}>Go to the shop</Link>}
    />
  );
}

export function OrderDetailPage() {
  const { id } = useParams();
  return (
    <PlaceholderPage
      eyebrow={<Link to="/orders" className="focus-ring rounded hover:text-ink">My orders</Link>}
      title={`Order #${id ?? ""}`}
      icon={<PackageSearch className="h-6 w-6" />}
      emptyTitle="Order details are on their way"
      emptyDescription="Items, delivery progress, messages and issues for this order will show here in the next build step."
      action={<Link to="/orders" className={linkButton}>Back to my orders</Link>}
    />
  );
}
