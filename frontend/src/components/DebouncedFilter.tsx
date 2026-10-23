import { useEffect, useRef, useState, type ReactNode } from "react";
import { Input } from "./ui";
import { useDebouncedValue } from "../lib/hooks";

interface DebouncedFilterProps {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  leading?: ReactNode;
  inputMode?: "text" | "numeric";
  /** Return an error message to hold back an invalid value. */
  validate?: (value: string) => string | null;
  maxLength?: number;
}

/** A text filter that sends its value 300 ms after typing stops, and follows outside changes. */
export function DebouncedFilter({ label, value, onCommit, placeholder, leading, inputMode = "text", validate, maxLength = 200 }: DebouncedFilterProps) {
  const [draft, setDraft] = useState(value);
  const typing = useRef(false);
  const debounced = useDebouncedValue(draft.trim(), 300);
  const error = validate && draft.trim() ? validate(draft.trim()) : null;

  useEffect(() => {
    if (!typing.current) setDraft(value);
  }, [value]);

  useEffect(() => {
    if (!typing.current) return;
    typing.current = false;
    if (debounced !== value && !(validate && debounced && validate(debounced))) onCommit(debounced);
    // Runs only when the debounced text changes.
  }, [debounced]);

  return (
    <Input
      label={label}
      value={draft}
      placeholder={placeholder}
      leading={leading}
      inputMode={inputMode}
      maxLength={maxLength}
      error={error}
      onChange={(e) => { typing.current = true; setDraft(e.target.value); }}
    />
  );
}
