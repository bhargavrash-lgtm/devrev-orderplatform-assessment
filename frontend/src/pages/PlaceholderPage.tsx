import type { ReactNode } from "react";
import { Card, EmptyState, PageHeader } from "../components/ui";

/** A real page frame whose content arrives in a later build step. */
export function PlaceholderPage({ title, description, icon, emptyTitle, emptyDescription, action, eyebrow }: {
  title: string;
  description?: ReactNode;
  icon: ReactNode;
  emptyTitle: string;
  emptyDescription: ReactNode;
  action?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <>
      <PageHeader title={title} description={description} eyebrow={eyebrow} />
      <Card>
        <EmptyState icon={icon} title={emptyTitle} description={emptyDescription} action={action} />
      </Card>
    </>
  );
}
