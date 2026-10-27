import type { ChangesFileEntry } from "../../../../types.js";

const MOCK_HUNKS: Record<string, string> = {
  "src/pages/reports.tsx": `@@ -1,12 +1,26 @@
 import { useState } from 'react';
+import { exportCsv } from '../lib/csv';
 import { useReports } from '../hooks/use-reports';
 import { DataTable } from '../components/data-table';

 export function ReportsPage() {
   const { data, columns } = useReports();
-  return (
-    <div className="p-6">
-      <h1 className="text-2xl font-semibold mb-4">Reports</h1>
-      <DataTable data={data} columns={columns} />
-    </div>
+
+  const handleExport = () => {
+    const csv = exportCsv(columns, data);
+    const blob = new Blob([csv], { type: 'text/csv' });
+    const url = URL.createObjectURL(blob);
+    const a = document.createElement('a');
+    a.href = url;
+    a.download = 'reports.csv';
+    a.click();
+    URL.revokeObjectURL(url);
+  };
+
+  return (
+    <div className="p-6">
+      <div className="flex items-center justify-between mb-4">
+        <h1 className="text-2xl font-semibold">Reports</h1>
+        <button onClick={handleExport} className="btn btn-secondary">
+          Export CSV
+        </button>
+      </div>
+      <DataTable data={data} columns={columns} />
+    </div>
   );
 }`,
  "src/lib/csv.ts": `@@ -0,0 +1,28 @@
+export interface Column {
+  key: string;
+  header: string;
+}
+
+function escapeField(value: unknown): string {
+  const str = String(value ?? '');
+  if (str.includes(',') || str.includes('"') || str.includes('\\n')) {
+    return '"' + str.replace(/"/g, '""') + '"';
+  }
+  return str;
+}
+
+export function exportCsv(
+  columns: Column[],
+  rows: Record<string, unknown>[],
+): string {
+  const header = columns.map((c) => escapeField(c.header)).join(',');
+  const body = rows
+    .map((row) =>
+      columns
+        .map((c) => escapeField(row[c.key]))
+        .join(','),
+    )
+    .join('\\n');
+  return header + '\\n' + body;
+}`,
  "src/lib/__tests__/csv.test.ts": `@@ -0,0 +1,22 @@
+import { describe, it, expect } from 'vitest';
+import { exportCsv } from '../csv';
+
+const cols = [
+  { key: 'name', header: 'Name' },
+  { key: 'value', header: 'Value' },
+];
+
+describe('exportCsv', () => {
+  it('exports rows as CSV string', () => {
+    const csv = exportCsv(cols, [{ name: 'a', value: 1 }]);
+    expect(csv).toBe('Name,Value\\na,1');
+  });
+
+  it('escapes commas and quotes', () => {
+    const csv = exportCsv(cols, [{ name: 'a,b', value: '"x"' }]);
+    expect(csv).toContain('"a,b"');
+  });
+
+  it('handles empty data', () => {
+    expect(exportCsv(cols, [])).toBe('Name,Value\\n');
+  });
+});`,
};

export function getMockDiff(file: ChangesFileEntry): string {
  return MOCK_HUNKS[file.path] ?? generateFallbackDiff(file);
}

function generateFallbackDiff(file: ChangesFileEntry): string {
  const lines: string[] = [`@@ -1,${file.deletions} +1,${file.insertions} @@`];
  for (let i = 0; i < file.deletions; i++)
    lines.push(`-// removed line ${i + 1}`);
  for (let i = 0; i < file.insertions; i++)
    lines.push(`+// added line ${i + 1}`);
  return lines.join("\n");
}
