import { useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Plus } from "lucide-react";
import { orders, type IssueCategory, type IssueSeverity } from "../../../api";
import {
  Badge, Button, EmptyState, ErrorState, Modal, PlainText, Select, SkeletonRows, Textarea, useToast,
} from "../../../components/ui";
import { formatDateTime, humanize } from "../../../lib/format";

// From the issues table CHECK constraints and IssueIn (description 5 to 2000 characters, trimmed).
const CATEGORIES: IssueCategory[] = ["delay", "wrong_item", "damaged", "duplicate_order", "billing", "other"];
const SEVERITIES: IssueSeverity[] = ["low", "medium", "high"];
const MIN_DESCRIPTION = 5;
const MAX_DESCRIPTION = 2000;

function ReportIssueModal({ orderId, open, onClose }: { orderId: number; open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState<IssueCategory | "">("");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<{ category?: string; description?: string; form?: string }>({});

  const reset = () => {
    setCategory("");
    setSeverity("medium");
    setDescription("");
    setErrors({});
  };
  const report = useMutation({
    mutationFn: () => orders.reportIssue(orderId, { category: category as IssueCategory, severity, description: description.trim() }),
    onSuccess: () => {
      toast({ tone: "success", title: "Issue reported", description: "Our team will look into it and reply on the order." });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId, "issues"] });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId], exact: true });
      void queryClient.invalidateQueries({ queryKey: ["issues"] });
      reset();
      onClose();
    },
    onError: (err) => setErrors({ form: err.message }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const length = description.trim().length;
    const next: typeof errors = {};
    if (!category) next.category = "Choose what kind of problem this is.";
    if (length < MIN_DESCRIPTION) next.description = `Describe the problem in at least ${MIN_DESCRIPTION} characters.`;
    if (length > MAX_DESCRIPTION) next.description = `Keep it under ${MAX_DESCRIPTION} characters.`;
    setErrors(next);
    if (Object.keys(next).length === 0) report.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={() => { if (!report.isPending) { reset(); onClose(); } }}
      title="Report an issue"
      description={`About order #${orderId}`}
    >
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        <Select label="What went wrong?" placeholder="Choose a category" value={category} error={errors.category}
          options={CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))}
          onChange={(e) => setCategory(e.target.value as IssueCategory)} data-autofocus />
        <Select label="How serious is it?" value={severity}
          options={SEVERITIES.map((s) => ({ value: s, label: humanize(s) }))}
          onChange={(e) => setSeverity(e.target.value as IssueSeverity)} />
        <Textarea label="Description" rows={5} maxLength={MAX_DESCRIPTION} value={description} error={errors.description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened, which items, and anything we should know"
          hint={`${description.trim().length} / ${MAX_DESCRIPTION}`} />
        {errors.form && <p role="alert" className="text-sm font-medium text-red-fg">{errors.form}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => { reset(); onClose(); }} disabled={report.isPending}>Cancel</Button>
          <Button type="submit" loading={report.isPending} loadingLabel="Reporting">Report issue</Button>
        </div>
      </form>
    </Modal>
  );
}

export function IssuesTab({ orderId }: { orderId: number }) {
  const [open, setOpen] = useState(false);
  const issues = useQuery({ queryKey: ["order", orderId, "issues"], queryFn: () => orders.issues(orderId) });
  const reportButton = (
    <Button variant="secondary" size="sm" icon={<Plus className="h-4 w-4" aria-hidden="true" />} onClick={() => setOpen(true)}>
      Report an issue
    </Button>
  );

  return (
    <div className="space-y-4">
      {issues.isPending ? (
        <SkeletonRows rows={2} label="Loading issues" />
      ) : issues.isError ? (
        <ErrorState title="Couldn't load issues" message={issues.error.message} onRetry={() => void issues.refetch()} />
      ) : issues.data.items.length === 0 ? (
        <EmptyState icon={<CircleAlert className="h-6 w-6" />} title="No issues reported"
          description="If something's wrong with this order, report it and our team will follow up." action={reportButton} className="py-10" />
      ) : (
        <>
          <div className="flex justify-end">{reportButton}</div>
          <ul className="space-y-3" aria-label="Issues on this order">
            {issues.data.items.map((issue) => (
              <li key={issue.id} className="rounded-card border border-line p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="mr-auto text-sm font-semibold text-ink">{humanize(issue.category)}</h3>
                  <Badge kind="severity" value={issue.severity} />
                  <Badge kind="issueStatus" value={issue.status} />
                  {issue.jira_key && (
                    <Badge tone="accent"><span className="sr-only">Linked Jira issue </span><span className="font-mono">{issue.jira_key}</span></Badge>
                  )}
                </div>
                <PlainText text={issue.description} className="mt-2 text-sm text-ink-muted" />
                <p className="mt-2 text-xs text-ink-subtle">
                  Reported by {issue.reported_by_name} · {formatDateTime(issue.created_at)}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
      <ReportIssueModal orderId={orderId} open={open} onClose={() => setOpen(false)} />
    </div>
  );
}
