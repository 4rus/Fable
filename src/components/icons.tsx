/**
 * Minimal inline stroke icons — no icon library dependency for a handful
 * of nav glyphs. Each is 20x20, currentColor, 1.5px stroke, matching a
 * single consistent visual weight.
 */
import type { SVGProps } from "react";

function Icon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    />
  );
}

export const OverviewIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <rect x="3" y="3" width="7" height="9" rx="1.5" />
    <rect x="14" y="3" width="7" height="5" rx="1.5" />
    <rect x="14" y="12" width="7" height="9" rx="1.5" />
    <rect x="3" y="16" width="7" height="5" rx="1.5" />
  </Icon>
);

export const InvoiceIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M6 2.5h9l3 3V21a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 21V3a.5.5 0 0 1 .5-.5Z" />
    <path d="M9 8.5h6M9 12.5h6M9 16.5h3.5" />
  </Icon>
);

export const CustomersIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <circle cx="9" cy="8" r="3.25" />
    <path d="M2.75 20c0-3.45 2.8-6 6.25-6s6.25 2.55 6.25 6" />
    <path d="M16 4.2c1.6.4 2.75 1.85 2.75 3.55 0 1.7-1.15 3.15-2.75 3.55" />
    <path d="M18.25 14.3c2 .5 3.5 2.3 3.5 4.5" />
  </Icon>
);

export const ExpensesIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 7.5h18M3 7.5v11A1.5 1.5 0 0 0 4.5 20h15a1.5 1.5 0 0 0 1.5-1.5v-11M3 7.5l2.2-3.7A1.5 1.5 0 0 1 6.5 3h11a1.5 1.5 0 0 1 1.3.8L21 7.5" />
    <circle cx="12" cy="13.5" r="2.5" />
  </Icon>
);

export const ForecastIcon = (p: SVGProps<SVGSVGElement>) => (
  <Icon {...p}>
    <path d="M3 17l5-5.5 4 3L21 6" />
    <path d="M15 6h6v6" />
  </Icon>
);

export const LogoMark = (p: SVGProps<SVGSVGElement>) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" {...p}>
    <rect width="24" height="24" rx="6" fill="currentColor" />
    <path d="M7 16.5V11l5-3.5 5 3.5v5.5" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
    <path d="M9.5 16.5v-3h5v3" stroke="white" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
