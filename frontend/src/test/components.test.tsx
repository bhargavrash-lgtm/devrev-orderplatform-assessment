import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Badge, Button, Modal, PlainText, Tabs } from "../components/ui";

describe("PlainText", () => {
  it("shows HTML-looking user text as text, never as markup", () => {
    const evil = "<img src=x onerror=alert(1)>";
    const { container } = render(<PlainText text={evil} />);
    expect(screen.getByText(evil)).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(container.innerHTML).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("keeps line breaks", () => {
    render(<PlainText text={"line one\nline two"} />);
    expect(screen.getByText(/line one/)).toHaveClass("whitespace-pre-wrap");
  });
});

describe("Badge", () => {
  it.each([
    ["status", "placed", "Placed", "bg-neutral-bg"],
    ["status", "confirmed", "Confirmed", "bg-blue-bg"],
    ["status", "packed", "Packed", "bg-amber-bg"],
    ["status", "shipped", "Shipped", "bg-violet-bg"],
    ["status", "delivered", "Delivered", "bg-green-bg"],
    ["status", "cancelled", "Cancelled", "bg-red-bg"],
    ["severity", "low", "Low", "bg-neutral-bg"],
    ["severity", "medium", "Medium", "bg-amber-bg"],
    ["severity", "high", "High", "bg-red-bg"],
    ["sentiment", "positive", "Positive", "bg-green-bg"],
    ["sentiment", "neutral", "Neutral", "bg-neutral-bg"],
    ["sentiment", "negative", "Negative", "bg-red-bg"],
  ] as const)("%s %s reads %s", (kind, value, label, colour) => {
    const props = { kind, value } as Parameters<typeof Badge>[0];
    const { container } = render(<Badge {...props} />);
    const badge = container.firstElementChild!;
    expect(badge).toHaveTextContent(label);
    expect(badge).toHaveClass(colour);
    // The kind is announced too, so colour is never the only signal.
    expect(badge.textContent).toBe(`${kind.charAt(0).toUpperCase()}${kind.slice(1)}: ${label}`);
  });

  it("renders a custom tone with its own text", () => {
    render(<Badge tone="accent">Ops</Badge>);
    expect(screen.getByText("Ops")).toHaveClass("bg-accent-50");
  });
});

describe("Button", () => {
  it("is disabled and busy while loading", () => {
    render(<Button loading loadingLabel="Saving">Save</Button>);
    const button = screen.getByRole("button", { name: "Saving" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
  });
});

describe("Modal", () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>Open</button>
        <Modal open={open} onClose={() => setOpen(false)} title="Confirm">
          <button>Inside</button>
        </Modal>
      </>
    );
  }

  it("traps focus, closes on Escape and returns focus", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const opener = screen.getByRole("button", { name: "Open" });
    await user.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Confirm" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.tab();
    await user.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(opener).toHaveFocus();
  });
});

describe("Modal typing", () => {
  function TypingHarness() {
    const [value, setValue] = useState("");
    // An inline onClose and a parent that re-renders on every keystroke, like real forms.
    return (
      <Modal open onClose={() => setValue("")} title="Form">
        <button type="button">First</button>
        <label>Name<input value={value} onChange={(e) => setValue(e.target.value)} /></label>
      </Modal>
    );
  }

  it("keeps focus in the field while typing", async () => {
    const user = userEvent.setup();
    render(<TypingHarness />);
    await user.type(screen.getByLabelText("Name"), "Three bags split open.");
    expect(screen.getByLabelText("Name")).toHaveValue("Three bags split open.");
  });
});

describe("Tabs", () => {
  function Harness() {
    const [value, setValue] = useState("a");
    return (
      <Tabs label="Sections" value={value} onChange={setValue}
        items={[{ id: "a", label: "First", content: "Panel A" }, { id: "b", label: "Second", content: "Panel B" }]} />
    );
  }

  it("moves with the arrow keys", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole("tab", { name: "First" }));
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Second" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel B");
  });
});

describe("frontend security rules", () => {
  const srcDir = join(__dirname, "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (/\.(ts|tsx)$/.test(name) && !path.includes(`${join("src", "test")}`)) files.push(path);
    }
  };
  walk(srcDir);

  it.each([
    ["dangerouslySetInnerHTML", /dangerouslySetInnerHTML/],
    ["innerHTML assignment", /\.innerHTML\s*=/],
    ["localStorage", /localStorage/],
    ["sessionStorage", /sessionStorage/],
    ["VITE_ environment variables", /VITE_/],
    ["the MCP key", /MCP_API_KEY|mcp_api_key/i],
  ])("source never uses %s", (_label, pattern) => {
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf-8")));
    expect(offenders).toEqual([]);
  });
});
