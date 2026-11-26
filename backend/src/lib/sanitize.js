// Spreadsheet formula-injection guard: cells starting with = + - @ tab or CR are prefixed with '.
export function sheetSafe(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  const s = String(v).slice(0, 5000);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}
export const normalizeIndianMobile = (raw) => {
  const d = String(raw || '').replace(/[\s-]/g, '');
  const m = d.match(/^(?:\+?91)?([6-9]\d{9})$/);
  return m ? `+91${m[1]}` : null;
};
