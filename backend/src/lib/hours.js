// Opening hours are stored per weekday in Asia/Kolkata: { mon: [{ open: "08:00", close: "22:00" }], ... }. open === close means 24 h. Empty = closed.
const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export function isOpenNow(hours, now = new Date()) {
  if (!hours) return false;
  const ist = new Date(now.getTime() + 330 * 60000); // UTC+05:30, no DST in India
  const day = DAYS[ist.getUTCDay()];
  const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const toMin = (t) => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
  return (hours[day] || []).some(({ open: o, close: c }) => {
    const a = toMin(o), b = toMin(c);
    return b > a ? mins >= a && mins < b : mins >= a || mins < b; // overnight range
  });
}
export const HOURS_DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
