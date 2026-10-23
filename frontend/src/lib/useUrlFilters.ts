import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";

/**
 * Filters kept in the URL query string, so a filtered view can be shared or reloaded.
 * Changing any filter (other than the page) goes back to page 1.
 */
export function useUrlFilters() {
  const [params, setParams] = useSearchParams();

  const get = useCallback((key: string, fallback = "") => params.get(key) ?? fallback, [params]);

  const set = useCallback((changes: Record<string, string | null | undefined>) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      for (const [key, value] of Object.entries(changes)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      if (!("page" in changes)) next.delete("page");
      return next;
    }, { replace: true });
  }, [setParams]);

  const clear = useCallback((keep: string[] = []) => {
    setParams((current) => {
      const next = new URLSearchParams();
      for (const key of keep) {
        const value = current.get(key);
        if (value) next.set(key, value);
      }
      return next;
    }, { replace: true });
  }, [setParams]);

  const page = Math.max(1, Number(params.get("page")) || 1);
  return { params, get, set, clear, page };
}
