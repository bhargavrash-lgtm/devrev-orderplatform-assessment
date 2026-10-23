import { useSearchParams } from "react-router-dom";
import { LoadingState, Skeleton } from "../../components/ui";

const TABS = ["conversation", "issues", "attachments", "feedback"] as const;
type TabId = (typeof TABS)[number];

export function useTab(): [TabId, (tab: string) => void] {
  const [params, setParams] = useSearchParams();
  const tab: TabId = (TABS as readonly string[]).includes(params.get("tab") ?? "") ? (params.get("tab") as TabId) : "conversation";
  const setTab = (next: string) => setParams((p) => { const n = new URLSearchParams(p); n.set("tab", next); return n; }, { replace: true });
  return [tab, setTab];
}

export function OrderDetailSkeleton() {
  return (
    <LoadingState label="Loading order" className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-9 w-64" />
      <div className="grid gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <Skeleton className="h-72" />
        <Skeleton className="h-72" />
      </div>
    </LoadingState>
  );
}
