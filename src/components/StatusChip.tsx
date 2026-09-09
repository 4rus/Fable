const config: Record<string, { label: string; dot: string; text: string }> = {
  DRAFT: { label: "Draft", dot: "bg-line", text: "text-muted" },
  SENT: { label: "Sent", dot: "bg-accent", text: "text-accent" },
  PARTIALLY_PAID: { label: "Partially paid", dot: "bg-warn", text: "text-warn" },
  PAID: { label: "Paid", dot: "bg-good", text: "text-good" },
  VOID: { label: "Void", dot: "bg-line", text: "text-muted" },
};

/** A quiet dot + label instead of a filled colored pill — reads as a
 * status indicator, not an alert banner. */
export default function StatusChip({ status }: { status: string }) {
  const c = config[status] ?? config.DRAFT!;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${c.text}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${c.dot}`} />
      {c.label}
    </span>
  );
}
