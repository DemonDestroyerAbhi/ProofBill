"use client";

import { useMemo, useEffect, useState } from "react";
import { AgGridReact } from "ag-grid-react";
import { ModuleRegistry, themeQuartz, colorSchemeDark, type ColDef, type ICellRendererParams } from "ag-grid-community";
import { AllEnterpriseModule, LicenseManager } from "ag-grid-enterprise";
import type { LedgerRow } from "@proofbill/services";

ModuleRegistry.registerModules([AllEnterpriseModule]);

const STATUS_COLORS: Record<string, string> = {
  PAID: "#0d7a5f",
  PARTIALLY_PAID: "#a35d00",
  SENT: "#1d5fbf",
  CANCELLED: "#b42318",
  draft: "#7b8781",
};

function StatusCell(p: ICellRendererParams<LedgerRow>) {
  const s = p.value as string;
  return <span style={{ color: STATUS_COLORS[s] ?? "inherit", fontWeight: 600 }}>{s === "PARTIALLY_PAID" ? "Partially paid" : s}</span>;
}

function InvoiceLink(p: ICellRendererParams<LedgerRow>) {
  return <a href={`/app/invoices/${p.data?.invoiceId}`} style={{ fontFamily: "var(--mono)" }}>{p.value}</a>;
}

/**
 * AG Grid receivables ledger. Master-detail (Enterprise) shows the evidence behind each line;
 * grouping/aggregation by client works from the column menu. Trial watermark without a license key.
 */
export function LedgerGrid({ rows, licenseKey }: { rows: LedgerRow[]; licenseKey: string }) {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    if (licenseKey) LicenseManager.setLicenseKey(licenseKey);
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [licenseKey]);

  const theme = useMemo(() => {
    const t = themeQuartz.withParams({ accentColor: dark ? "#34c08f" : "#0d7a5f", fontFamily: "inherit", headerFontWeight: 650 });
    return dark ? t.withPart(colorSchemeDark) : t;
  }, [dark]);

  const money = (v: number | null | undefined, cur = "USD") => (v == null ? "" : v.toLocaleString("en-US", { style: "currency", currency: cur }));

  const columnDefs = useMemo<ColDef<LedgerRow>[]>(
    () => [
      { field: "client", rowGroup: false, enableRowGroup: true, cellRenderer: "agGroupCellRenderer", minWidth: 170 },
      { field: "invoiceNumber", headerName: "Invoice", cellRenderer: InvoiceLink, minWidth: 170 },
      { field: "milestone", flex: 1, minWidth: 220, enableRowGroup: true },
      { field: "line", headerName: "Line item", minWidth: 220, hide: true },
      { field: "kind", width: 110, enableRowGroup: true },
      { headerName: "Evidence", valueGetter: (p) => p.data?.evidence.length ?? 0, width: 135, type: "numericColumn" },
      { field: "hours", width: 115, type: "numericColumn" },
      { field: "amount", width: 135, type: "numericColumn", aggFunc: "sum", valueFormatter: (p) => money(p.value, p.data?.currency) },
      { field: "paid", width: 125, type: "numericColumn", valueFormatter: (p) => money(p.value, p.data?.currency) },
      { field: "balance", width: 135, type: "numericColumn", valueFormatter: (p) => money(p.value, p.data?.currency), cellStyle: (p) => (p.value > 0 ? { fontWeight: 600 } : null) },
      { field: "fees", headerName: "PayPal fees", width: 135, type: "numericColumn", valueFormatter: (p) => money(p.value, p.data?.currency) },
      {
        field: "net",
        headerName: "Net received",
        width: 140,
        type: "numericColumn",
        valueFormatter: (p) => money(p.value, p.data?.currency),
        tooltipValueGetter: (p) => (p.data?.reconcile ? `Transaction Search: ${p.data.reconcile}` : "Not reconciled yet"),
        cellStyle: (p) => (p.data?.reconcile === "mismatch" ? { color: "#b42318", fontWeight: 700 } : null),
      },
      { field: "status", width: 150, cellRenderer: StatusCell, enableRowGroup: true },
      { field: "dueDate", headerName: "Due", width: 120 },
      {
        field: "daysOverdue",
        headerName: "Days overdue",
        width: 130,
        type: "numericColumn",
        cellStyle: (p) => (p.value > 0 ? { color: "#b42318", fontWeight: 700 } : null),
      },
      { field: "reminders", width: 125, type: "numericColumn" },
      { field: "contractTitle", headerName: "Contract", minWidth: 200, hide: true, enableRowGroup: true },
    ],
    [],
  );

  return (
    <div className="ledger-grid">
      <AgGridReact<LedgerRow>
        theme={theme}
        rowData={rows}
        columnDefs={columnDefs}
        defaultColDef={{ sortable: true, filter: true, resizable: true, minWidth: 90 }}
        getRowId={(p) => p.data.lineId}
        masterDetail
        detailRowAutoHeight
        rowGroupPanelShow="always"
        sideBar={{ toolPanels: ["columns", "filters"], defaultToolPanel: "" }}
        detailCellRendererParams={{
          detailGridOptions: {
            columnDefs: [
              { field: "type", width: 110 },
              {
                field: "title",
                flex: 2,
                cellRenderer: (p: ICellRendererParams<LedgerRow["evidence"][number]>) =>
                  p.data?.url ? <a href={p.data.url} target="_blank" rel="noreferrer">{p.value}</a> : p.value,
              },
              { field: "confidence", width: 120, valueFormatter: (p: { value: number | null }) => (p.value == null ? "manual" : `${Math.round(p.value * 100)}%`) },
              { field: "rationale", flex: 3, tooltipField: "rationale" },
            ],
            defaultColDef: { resizable: true },
          },
          getDetailRowData: (p: { data: LedgerRow; successCallback: (rows: LedgerRow["evidence"]) => void }) => p.successCallback(p.data.evidence),
        }}
        overlayNoRowsTemplate="No invoices yet — accept a milestone and build its invoice."
      />
    </div>
  );
}
