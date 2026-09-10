import "server-only";
import React from "react";
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import { formatCents } from "@/lib/money";

/**
 * Renders an invoice as a PDF buffer, server-side only. Uses react-pdf's
 * built-in standard fonts (Helvetica for structure, Times-Bold/Times-Roman
 * standing in for Fable's serif "voice") rather than embedding the actual
 * Fraunces/Inter webfonts — those are loaded from Google Fonts at request
 * time in the web app (next/font), and pulling the same files into a PDF
 * render means either fetching them over the network on every invoice
 * send (a real failure point) or vendoring font files into the repo.
 * Standard PDF fonts render identically and reliably with zero external
 * dependency; matching the web typography exactly is a nice-to-have, not
 * a correctness requirement, so this is a deliberate simplification, not
 * an oversight.
 */

const INK = "#1c1a16";
const MUTED = "#7c7566";
const LINE = "#e7e2d5";

const styles = StyleSheet.create({
  page: { padding: 48, fontFamily: "Helvetica", fontSize: 10, color: INK },
  headerRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 32 },
  businessName: { fontFamily: "Times-Bold", fontSize: 18 },
  muted: { color: MUTED },
  invoiceTitle: { fontFamily: "Times-Bold", fontSize: 22, textAlign: "right" },
  metaRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 24 },
  metaBlock: { flexDirection: "column" },
  label: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 3 },
  table: { borderTopWidth: 1, borderTopColor: LINE, borderBottomWidth: 1, borderBottomColor: LINE, marginTop: 12 },
  tableHeaderRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: LINE },
  tableRow: { flexDirection: "row", paddingVertical: 6, borderBottomWidth: 0.5, borderBottomColor: LINE },
  colDescription: { flex: 3 },
  colQty: { flex: 1, textAlign: "right" },
  colPrice: { flex: 1, textAlign: "right" },
  colAmount: { flex: 1, textAlign: "right" },
  headerCell: { fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 0.5 },
  totalsBlock: { marginTop: 16, alignSelf: "flex-end", width: 200 },
  totalsRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  totalsLabel: { color: MUTED },
  grandTotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingTop: 6,
    marginTop: 3,
    borderTopWidth: 1,
    borderTopColor: LINE,
  },
  grandTotalLabel: { fontFamily: "Helvetica-Bold" },
  grandTotalValue: { fontFamily: "Helvetica-Bold" },
  notes: { marginTop: 32, fontSize: 9, color: MUTED },
  footer: { position: "absolute", bottom: 32, left: 48, right: 48, fontSize: 8, color: MUTED, textAlign: "center" },
});

export interface InvoicePdfData {
  businessName: string;
  currency: string;
  invoiceNumber: string;
  issueDate: Date;
  dueDate: Date;
  customerName: string;
  customerEmail: string | null;
  lineItems: { description: string; quantity: number; unitPriceCents: number; amountCents: number }[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  notes: string | null;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function InvoiceDocument({ data }: { data: InvoicePdfData }) {
  return (
    <Document title={`Invoice ${data.invoiceNumber}`}>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.headerRow}>
          <Text style={styles.businessName}>{data.businessName}</Text>
          <Text style={styles.invoiceTitle}>Invoice</Text>
        </View>

        <View style={styles.metaRow}>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Billed to</Text>
            <Text>{data.customerName}</Text>
            {data.customerEmail && <Text style={styles.muted}>{data.customerEmail}</Text>}
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Invoice number</Text>
            <Text>{data.invoiceNumber}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Issue date</Text>
            <Text>{formatDate(data.issueDate)}</Text>
          </View>
          <View style={styles.metaBlock}>
            <Text style={styles.label}>Due date</Text>
            <Text>{formatDate(data.dueDate)}</Text>
          </View>
        </View>

        <View style={styles.table}>
          <View style={styles.tableHeaderRow}>
            <Text style={[styles.colDescription, styles.headerCell]}>Description</Text>
            <Text style={[styles.colQty, styles.headerCell]}>Qty</Text>
            <Text style={[styles.colPrice, styles.headerCell]}>Unit price</Text>
            <Text style={[styles.colAmount, styles.headerCell]}>Amount</Text>
          </View>
          {data.lineItems.map((li, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.colDescription}>{li.description}</Text>
              <Text style={styles.colQty}>{li.quantity}</Text>
              <Text style={styles.colPrice}>{formatCents(li.unitPriceCents, data.currency)}</Text>
              <Text style={styles.colAmount}>{formatCents(li.amountCents, data.currency)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalsBlock}>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Subtotal</Text>
            <Text>{formatCents(data.subtotalCents, data.currency)}</Text>
          </View>
          <View style={styles.totalsRow}>
            <Text style={styles.totalsLabel}>Tax</Text>
            <Text>{formatCents(data.taxCents, data.currency)}</Text>
          </View>
          <View style={styles.grandTotalRow}>
            <Text style={styles.grandTotalLabel}>Total due</Text>
            <Text style={styles.grandTotalValue}>{formatCents(data.totalCents, data.currency)}</Text>
          </View>
        </View>

        {data.notes && (
          <View style={styles.notes}>
            <Text style={styles.label}>Notes</Text>
            <Text>{data.notes}</Text>
          </View>
        )}

        <Text style={styles.footer}>
          {data.businessName} · Invoice {data.invoiceNumber} · Generated by Fable
        </Text>
      </Page>
    </Document>
  );
}

export async function renderInvoicePdf(data: InvoicePdfData): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument data={data} />);
}
