import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { issues, type Issue, type IssueCategory, type IssueSeverity, type IssueStatus, type IssueUpdate } from "../../api";
import { Badge, Button, Drawer, Input, PlainText, Select, useToast } from "../../components/ui";
import { formatDateTime, humanize } from "../../lib/format";

// From records_api.py: the IssueUpdate fields, the issues table CHECK values and the JIRA_KEY pattern.
export const ISSUE_STATUSES: IssueStatus[] = ["open", "investigating", "resolved"];
export const ISSUE_SEVERITIES: IssueSeverity[] = ["low", "medium", "high"];
export const ISSUE_CATEGORIES: IssueCategory[] = ["delay", "wrong_item", "damaged", "duplicate_order", "billing", "other"];
export const JIRA_KEY_PATTERN = /^[A-Z][A-Z0-9]+-[0-9]+$/;

export function jiraKeyError(value: string): string | null {
  if (value === "" || JIRA_KEY_PATTERN.test(value)) return null;
  return "Use the Jira format: capital letters or digits, a dash, then a number (e.g. SCRUM-24).";
}

/** Everything that shows an issue (lists, orders, the dashboard) is refreshed after an edit. */
export function invalidateIssueQueries(queryClient: ReturnType<typeof useQueryClient>, issue: Pick<Issue, "order_id" | "customer">) {
  void queryClient.invalidateQueries({ queryKey: ["issues"] });
  void queryClient.invalidateQueries({ queryKey: ["order", issue.order_id] });
  void queryClient.invalidateQueries({ queryKey: ["insights"] });
  void queryClient.invalidateQueries({ queryKey: ["customers"] });
  void queryClient.invalidateQueries({ queryKey: ["customer", issue.customer.id] });
}

/** Ops-only drawer to change an issue's status, severity, category and linked Jira key. */
export function IssueEditor({ issue, onClose }: { issue: Issue | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState<IssueStatus>("open");
  const [severity, setSeverity] = useState<IssueSeverity>("medium");
  const [category, setCategory] = useState<IssueCategory>("other");
  const [jiraKey, setJiraKey] = useState("");
  const [jiraTouched, setJiraTouched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!issue) return;
    setStatus(issue.status);
    setSeverity(issue.severity);
    setCategory(issue.category);
    setJiraKey(issue.jira_key ?? "");
    setJiraTouched(false);
    setError(null);
  }, [issue]);

  const save = useMutation({
    mutationFn: (changes: IssueUpdate) => issues.update(issue!.id, changes),
    onSuccess: (updated) => {
      invalidateIssueQueries(queryClient, updated);
      toast({ tone: "success", title: `Issue #${updated.id} updated` });
      onClose();
    },
    onError: (err) => setError(err.message),
  });

  if (!issue) return null;
  const keyError = jiraKeyError(jiraKey.trim());

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setJiraTouched(true);
    if (keyError) return;
    const changes: IssueUpdate = {};
    if (status !== issue.status) changes.status = status;
    if (severity !== issue.severity) changes.severity = severity;
    if (category !== issue.category) changes.category = category;
    const key = jiraKey.trim() || null;
    if (key !== issue.jira_key) changes.jira_key = key;
    if (Object.keys(changes).length === 0) return setError("Nothing has changed yet.");
    setError(null);
    save.mutate(changes);
  };

  return (
    <Drawer
      open
      onClose={() => { if (!save.isPending) onClose(); }}
      title={`Issue #${issue.id}`}
      description={`${humanize(issue.category)} · order #${issue.order_id}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={save.isPending}>Cancel</Button>
          <Button type="submit" form="issue-editor" loading={save.isPending} loadingLabel="Saving">Save changes</Button>
        </div>
      }
    >
      <div className="space-y-5">
        <div className="rounded-card border border-line-soft bg-page/60 p-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge kind="severity" value={issue.severity} />
            <Badge kind="issueStatus" value={issue.status} />
          </div>
          <PlainText text={issue.description} className="text-sm text-ink" />
          <p className="mt-2 text-xs text-ink-subtle">
            Reported by {issue.reported_by_name} · {formatDateTime(issue.created_at)} ·{" "}
            <Link to={`/ops/customers/${issue.customer.id}`} className="focus-ring rounded text-accent-700 hover:underline">{issue.customer.name}</Link>
            {" · "}
            <Link to={`/ops/orders/${issue.order_id}`} className="focus-ring rounded text-accent-700 hover:underline">Order #{issue.order_id}</Link>
          </p>
        </div>

        <form id="issue-editor" onSubmit={onSubmit} noValidate className="space-y-4">
          <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value as IssueStatus)} data-autofocus
            options={ISSUE_STATUSES.map((s) => ({ value: s, label: humanize(s) }))}
            hint="Open: newly reported. Investigating: being worked on. Resolved: closed." />
          <Select label="Severity" value={severity} onChange={(e) => setSeverity(e.target.value as IssueSeverity)}
            options={ISSUE_SEVERITIES.map((s) => ({ value: s, label: humanize(s) }))} />
          <Select label="Category" value={category} onChange={(e) => setCategory(e.target.value as IssueCategory)}
            options={ISSUE_CATEGORIES.map((c) => ({ value: c, label: humanize(c) }))} />
          <Input
            label="Jira key"
            value={jiraKey}
            placeholder="SCRUM-24"
            autoComplete="off"
            spellCheck={false}
            maxLength={50}
            onChange={(e) => setJiraKey(e.target.value.toUpperCase())}
            onBlur={() => setJiraTouched(true)}
            error={jiraTouched ? keyError : null}
            hint="Link a Jira issue, e.g. SCRUM-24. Leave empty to remove the link."
            trailing={jiraKey ? (
              <button type="button" onClick={() => { setJiraKey(""); setJiraTouched(true); }}
                className="focus-ring mr-1 rounded px-2 py-1 text-xs font-medium text-ink-subtle hover:text-ink">Clear</button>
            ) : undefined}
          />
          {error && <p role="alert" className="text-sm font-medium text-red-fg">{error}</p>}
        </form>
      </div>
    </Drawer>
  );
}
