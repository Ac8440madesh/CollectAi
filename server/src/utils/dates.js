/**
 * Date utilities in the Asia/Kolkata (IST) timezone.
 *
 * All application date arithmetic (today, due dates, extensions) is computed
 * here using Asia/Kolkata as the single source of truth, avoiding discrepancies
 * between local Node.js environments, UTC servers (Render), and PostgreSQL.
 */

/**
 * Returns the current date in Asia/Kolkata (IST) as 'YYYY-MM-DD'.
 *
 * @param {Date} [now=new Date()]
 * @returns {string} 'YYYY-MM-DD'
 */
export function getTodayIST(now = new Date()) {
  // 'en-CA' outputs ISO date format YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * Computes a new extended due date string ('YYYY-MM-DD') in IST.
 * Rule: Extension is granted from the LATER of (today IST, current due date).
 *
 * @param {string|Date} currentDueDate Current due date ('YYYY-MM-DD' or Date)
 * @param {number} extDays Number of extension days to add
 * @param {Date} [now=new Date()]
 * @returns {string} New extended due date 'YYYY-MM-DD'
 */
export function computeExtendedDueDate(currentDueDate, extDays = 7, now = new Date()) {
  const todayStr = getTodayIST(now);
  let dueStr = currentDueDate;
  if (currentDueDate instanceof Date) {
    dueStr = currentDueDate.toISOString().slice(0, 10);
  } else if (typeof currentDueDate === 'string') {
    dueStr = currentDueDate.slice(0, 10);
  }

  // Pick the later of today or current due date
  const baseStr = !dueStr || dueStr < todayStr ? todayStr : dueStr;

  const [y, m, d] = baseStr.split('-').map(Number);
  const targetDate = new Date(Date.UTC(y, m - 1, d + extDays));
  return targetDate.toISOString().slice(0, 10);
}
