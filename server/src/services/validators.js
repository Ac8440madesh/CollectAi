/**
 * Draft & Negotiator Validators.
 *
 * Guardrail before any communication is saved or sent:
 * 1. Must contain all required invoice numbers (case-insensitive).
 * 2. Must contain the correct amount or remaining balance.
 * 3. Must not contain hallucinated currency figures or fabricated numbers.
 * 4. Negotiator responses must be consistent with structured proposed_terms (days, dates, discounts).
 */

export function validateDraft({ subject = '', body = '', invoice, invoices, client = {}, user = {} }) {
  const invoiceList = invoices && invoices.length > 0 ? invoices : (invoice ? [invoice] : []);
  const errors = [];
  const fullText = `${subject} ${body}`;

  if (invoiceList.length === 0) {
    return { valid: true, errors: [] };
  }

  // 1. Check all invoice numbers are present
  for (const inv of invoiceList) {
    if (inv.invoice_no) {
      const invNoRegex = new RegExp(`\\b${escapeRegex(inv.invoice_no)}\\b`, 'i');
      if (!invNoRegex.test(fullText)) {
        errors.push(`Draft missing required invoice number (${inv.invoice_no})`);
      }
    }
  }

  // 2. Compute individual balances and total combined balance
  let totalCombinedBalance = 0;
  const validAmounts = new Set();

  for (const inv of invoiceList) {
    const total = parseFloat(inv.amount || 0);
    const paid = parseFloat(inv.paid_amount || 0);
    const rem = Math.round((total - paid) * 100) / 100;
    totalCombinedBalance += rem;

    validAmounts.add(total);
    validAmounts.add(paid);
    validAmounts.add(rem);
  }
  validAmounts.add(Math.round(totalCombinedBalance * 100) / 100);

  // Check if at least the total balance or any invoice amount is mentioned
  const totalStr = totalCombinedBalance.toString();
  const totalFormatted = totalCombinedBalance.toLocaleString('en-IN');

  const hasAnyValidAmount =
    fullText.includes(totalStr) ||
    fullText.includes(totalFormatted) ||
    [...validAmounts].some((amt) => fullText.includes(amt.toString()) || fullText.includes(amt.toLocaleString('en-IN')));

  if (!hasAnyValidAmount) {
    errors.push(
      `Draft missing accurate invoice amount or total balance (expected ₹${totalFormatted})`,
    );
  }

  // 3. Scan for hallucinated currency figures
  const currencyMatches = fullText.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{2})?)/gi) || [];
  for (const match of currencyMatches) {
    const numOnly = parseFloat(match.replace(/[^\d.]/g, ''));
    if (isNaN(numOnly)) continue;

    if (!validAmounts.has(numOnly)) {
      errors.push(`Draft contains ungrounded monetary figure: "${match}" (not found in invoice records)`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates that the Negotiator's text reply matches its structured proposed_terms.
 */
export function validateNegotiatorTermsConsistency({ proposed_response = '', proposed_terms = {}, invoice = {} }) {
  const errors = [];

  // 1. Check extension days consistency
  if (proposed_terms.extension_days !== undefined && proposed_terms.extension_days !== null) {
    const extDays = proposed_terms.extension_days;
    const expectedRegex = new RegExp(`\\b${extDays}[-\\s]*(?:day|days)\\b`, 'i');

    if (!expectedRegex.test(proposed_response)) {
      errors.push(`Proposed response text does not state the approved ${extDays}-day extension`);
    }

    // Check if conflicting different extension days are mentioned
    const otherDayMatches = proposed_response.match(/\b(\d+)[-\s]*(?:day|days)\b/gi) || [];
    for (const match of otherDayMatches) {
      const matchNum = parseInt(match.replace(/[^\d]/g, ''), 10);
      if (matchNum !== extDays) {
        errors.push(`Contradictory extension days found in text: "${match}" (structured terms specified ${extDays} days)`);
      }
    }
  }

  // 2. Check explicit new due date in response text
  if (proposed_terms.new_due_date) {
    const dateStr = proposed_terms.new_due_date;
    if (!proposed_response.includes(dateStr)) {
      errors.push(`Proposed response text missing exact approved new due date: ${dateStr}`);
    }
  }

  // 3. Check discount percentage consistency
  if (proposed_terms.discount_pct !== undefined && proposed_terms.discount_pct !== null && proposed_terms.discount_pct > 0) {
    const disc = proposed_terms.discount_pct;
    const discRegex = new RegExp(`\\b${disc}%\\b`, 'i');
    if (!discRegex.test(proposed_response)) {
      errors.push(`Proposed response text missing structured discount of ${disc}%`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
