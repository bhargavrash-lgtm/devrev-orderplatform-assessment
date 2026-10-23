import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FileText, Paperclip, UploadCloud } from "lucide-react";
import { attachmentUrl, orders } from "../../api";
import { Button, EmptyState, ErrorState, PlainText, Select, SkeletonRows, useToast } from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatBytes, formatDateTime } from "../../lib/format";

// Mirrors records_api.py: MAX_UPLOAD_BYTES and UPLOAD_KINDS. The server also checks the file's
// real content; these checks just catch obvious mistakes before uploading.
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = [".png", ".jpg", ".jpeg", ".pdf", ".txt"];

export function checkFile(file: File): string | null {
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(extension)) return "Only PNG, JPG, PDF and text (.txt) files can be attached.";
  if (file.size === 0) return "That file is empty.";
  if (file.size > MAX_UPLOAD_BYTES) return `That file is ${formatBytes(file.size)}; the limit is 5 MB.`;
  return null;
}

function typeLabel(contentType: string): string {
  if (contentType.startsWith("image/png")) return "PNG image";
  if (contentType.startsWith("image/jpeg")) return "JPG image";
  if (contentType.startsWith("application/pdf")) return "PDF";
  if (contentType.startsWith("text/plain")) return "Text";
  return contentType;
}

export function AttachmentsTab({ orderId, canUpload = true }: { orderId: number; canUpload?: boolean }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [issueId, setIssueId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const list = useQuery({ queryKey: ["order", orderId, "attachments"], queryFn: () => orders.attachments(orderId) });
  const issues = useQuery({ queryKey: ["order", orderId, "issues"], queryFn: () => orders.issues(orderId), enabled: canUpload });
  const upload = useMutation({
    mutationFn: (file: File) => orders.upload(orderId, file, issueId ? Number(issueId) : null),
    onSuccess: (attachment) => {
      setError(null);
      toast({ tone: "success", title: "File attached", description: attachment.filename });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId, "attachments"] });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId], exact: true });
    },
    onError: (err) => setError(err.message),
  });

  const start = (file: File | undefined) => {
    if (!file || upload.isPending) return;
    const problem = checkFile(file);
    if (problem) return setError(problem);
    setError(null);
    upload.mutate(file);
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    start(event.dataTransfer.files[0]);
  };

  return (
    <div className="space-y-5">
      {canUpload && (
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex flex-col items-center justify-center rounded-card border-2 border-dashed px-6 py-8 text-center transition-colors",
          dragging ? "border-accent-500 bg-accent-50" : "border-line-strong bg-page/60",
        )}
      >
        <UploadCloud className="h-8 w-8 text-accent-500" aria-hidden="true" />
        <p className="mt-3 text-sm font-medium text-ink">Drop a file here, or choose one</p>
        <p className="mt-1 text-xs text-ink-subtle">PNG, JPG, PDF or text · up to 5 MB</p>
        <div className="mt-4 flex flex-wrap items-end justify-center gap-3">
          {issues.data && issues.data.items.length > 0 && (
            <div className="w-56 text-left">
              <Select label="Related issue (optional)" placeholder="None" value={issueId} onChange={(e) => setIssueId(e.target.value)}
                options={issues.data.items.map((i) => ({ value: String(i.id), label: `#${i.id} · ${i.category.replace(/_/g, " ")}` }))} />
            </div>
          )}
          <Button variant="secondary" loading={upload.isPending} loadingLabel="Uploading"
            icon={<Paperclip className="h-4 w-4" aria-hidden="true" />} onClick={() => inputRef.current?.click()}>
            Choose a file
          </Button>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_EXTENSIONS.join(",")}
          className="sr-only"
          aria-label="Attach a file"
          tabIndex={-1}
          onChange={(e) => { start(e.target.files?.[0]); e.target.value = ""; }}
        />
        {error && <p role="alert" className="mt-4 text-sm font-medium text-red-fg">{error}</p>}
      </div>
      )}

      {list.isPending ? (
        <SkeletonRows rows={2} label="Loading attachments" />
      ) : list.isError ? (
        <ErrorState title="Couldn't load attachments" message={list.error.message} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState icon={<FileText className="h-6 w-6" />} title="No files attached"
          description={canUpload ? "Attach photos of damaged goods, delivery notes or invoices." : "The customer hasn't attached any files to this order."} className="py-8" />
      ) : (
        <ul className="divide-y divide-line-soft rounded-card border border-line" aria-label="Attached files">
          {list.data.items.map((file) => (
            <li key={file.id} className="flex items-center gap-4 px-4 py-3">
              <FileText className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <PlainText as="span" text={file.filename} className="block truncate text-sm font-medium text-ink" />
                <p className="text-xs text-ink-subtle">
                  {typeLabel(file.content_type)} · {formatBytes(file.size_bytes)} · {formatDateTime(file.created_at)} · {file.uploaded_by_name}
                  {file.issue_id !== null && ` · issue #${file.issue_id}`}
                </p>
              </div>
              <a
                href={attachmentUrl(file.id)}
                download
                aria-label={`Download ${file.filename}`}
                className="focus-ring inline-flex h-8 items-center gap-1.5 rounded border border-line-strong bg-white px-3 text-sm font-medium text-ink hover:bg-page"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
