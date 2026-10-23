import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { MessagesSquare, Send } from "lucide-react";
import { orders, type Role } from "../../api";
import { Button, EmptyState, ErrorState, LoadingState, PlainText, Skeleton } from "../../components/ui";
import { cn } from "../../lib/cn";
import { formatDateTime } from "../../lib/format";

const MAX_BODY = 2000; // MessageIn.body: 1 to 2000 characters after trimming
const THREAD_LIMIT = 100; // the messages endpoint returns at most 100 per page

/** The order conversation. The viewer's own side is on the right; ops replies are labelled as the ops team. */
export function ConversationTab({ orderId, viewer }: { orderId: number; viewer: Role }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const threadRef = useRef<HTMLOListElement>(null);

  const thread = useQuery({
    queryKey: ["order", orderId, "messages"],
    queryFn: () => orders.messages(orderId, { page_size: THREAD_LIMIT }),
  });
  const send = useMutation({
    mutationFn: (body: string) => orders.postMessage(orderId, body),
    onSuccess: () => {
      setDraft("");
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["order", orderId, "messages"] });
      void queryClient.invalidateQueries({ queryKey: ["order", orderId], exact: true });
    },
    onError: (err) => setError(err.message),
  });

  // Newest at the bottom: keep the view scrolled to the latest message.
  useEffect(() => {
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.data]);

  const trimmed = draft.trim();
  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (!trimmed || send.isPending) return;
    if (trimmed.length > MAX_BODY) return setError(`Messages can be up to ${MAX_BODY} characters.`);
    send.mutate(trimmed);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <div className="space-y-4">
      {thread.isPending ? (
        <LoadingState label="Loading messages" className="space-y-3">
          <Skeleton className="h-14 w-2/3" />
          <Skeleton className="ml-auto h-14 w-1/2" />
        </LoadingState>
      ) : thread.isError ? (
        <ErrorState title="Couldn't load the conversation" message={thread.error.message} onRetry={() => void thread.refetch()} />
      ) : thread.data.items.length === 0 ? (
        <EmptyState icon={<MessagesSquare className="h-6 w-6" />} title="No messages yet"
          description={viewer === "ops" ? "No one has written on this order yet." : "Ask a question about this order and our support team will reply here."} className="py-10" />
      ) : (
        <>
          {thread.data.total > THREAD_LIMIT && (
            <p className="text-center text-xs text-ink-subtle">Showing the first {THREAD_LIMIT} of {thread.data.total} messages.</p>
          )}
          <ol ref={threadRef} aria-label="Conversation" className="max-h-[28rem] space-y-4 overflow-y-auto rounded-card bg-page/70 p-4">
            {thread.data.items.map((message) => {
              const mine = message.author_role === viewer;
              const who = message.author_role === "ops"
                ? (viewer === "ops" ? `${message.author_name} · ops team` : `OrderWave support · ${message.author_name}`)
                : (viewer === "ops" ? `${message.author_name} · customer` : message.author_name);
              return (
                <li key={message.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                  <div className={cn("max-w-[85%] sm:max-w-[70%]")}>
                    <p className={cn("mb-1 text-xs text-ink-subtle", mine && "text-right")}>
                      <span className="font-medium text-ink-muted">{who}</span>
                      {" · "}
                      <time dateTime={message.created_at}>{formatDateTime(message.created_at)}</time>
                    </p>
                    <PlainText
                      text={message.body}
                      className={cn(
                        "rounded-card px-4 py-2.5 text-sm leading-relaxed shadow-xs",
                        mine ? "rounded-br-sm bg-accent-600 text-white" : "rounded-bl-sm border border-line bg-white text-ink",
                      )}
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}

      <form onSubmit={submit} className="space-y-2" aria-label="Send a message">
        <label htmlFor={`composer-${orderId}`} className="block text-sm font-medium text-ink">
          {viewer === "ops" ? "Reply as the ops team" : "Write a message"}
        </label>
        <textarea
          id={`composer-${orderId}`}
          rows={3}
          value={draft}
          maxLength={MAX_BODY}
          disabled={send.isPending}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={viewer === "ops" ? "Reply to the customer. They'll see it on their order page." : "Ask about delivery, quantities or anything else on this order"}
          aria-describedby={`composer-help-${orderId}`}
          className="block w-full resize-y rounded border border-line-strong bg-white px-3 py-2 text-sm leading-relaxed text-ink shadow-xs outline-none placeholder:text-ink-faint focus-visible:border-accent-500 focus-visible:shadow-focus disabled:bg-page"
        />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p id={`composer-help-${orderId}`} className="text-xs text-ink-subtle">
            Ctrl + Enter to send · {draft.length} / {MAX_BODY}
          </p>
          <Button type="submit" size="sm" disabled={!trimmed} loading={send.isPending} loadingLabel="Sending"
            icon={<Send className="h-4 w-4" aria-hidden="true" />}>
            Send
          </Button>
        </div>
        {error && <p role="alert" className="text-sm font-medium text-red-fg">{error}</p>}
      </form>
    </div>
  );
}
