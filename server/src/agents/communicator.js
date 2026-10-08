import { query } from '../config/db.js';
import { promptJSON, registerMock } from '../services/llm.js';
import { communicatorOutputSchema } from '../schemas/agents.js';

/**
 * Communicator Agent.
 *
 * Drafts follow-up communication based on the Analyst's tone and timing recommendations.
 * Can handle a single invoice or a group of overdue invoices for the same client.
 *
 * Grounding Rule: Strictly references real invoice numbers, amounts, and dates from the database.
 */
export async function runCommunicator({ userId, invoice, invoices, client, user, recommendation }) {
  const invoiceList = invoices && invoices.length > 0 ? invoices : [invoice];
  const isGrouped = invoiceList.length > 1;

  let totalRemaining = 0;
  const invoiceDescriptions = invoiceList.map((inv) => {
    const total = parseFloat(inv.amount);
    const paid = parseFloat(inv.paid_amount || 0);
    const rem = Math.round((total - paid) * 100) / 100;
    totalRemaining += rem;
    return `${inv.invoice_no}: ₹${rem.toLocaleString('en-IN')} (due ${inv.due_date?.slice ? inv.due_date.slice(0, 10) : inv.due_date})`;
  });

  const balanceFormatted = `₹${totalRemaining.toLocaleString('en-IN')}`;
  const invoiceNumbersStr = invoiceList.map((i) => i.invoice_no).join(', ');

  const system = `You are a polite, professional Accounts Receivable Communicator representing "${user.business_name || user.name}".
Your task is to draft a follow-up email to a client regarding outstanding receivables.

Tone guidance:
- "friendly": First polite reminder or healthy payment history. Warm and collaborative.
- "firm": Moderately overdue or repeat late payer. Clear urgency and request for payment date.
- "final": Severely overdue. Formal, strict deadline.
- "dispute_resolution": For disputed invoices. Neutral, open, asking for clarification on client concerns. NEVER aggressive.

STRICT GROUNDING RULES:
1. Reference the exact invoice number(s): ${invoiceNumbersStr}
2. Reference the exact total outstanding balance: ${balanceFormatted}
3. DO NOT invent or mention any other monetary amounts, discounts, penalties, or fabricated dates.
4. Address the client as "${client.name}".
5. Sign off from "${user.business_name || user.name}".

Return JSON: { "subject": "...", "body": "..." }`;

  const userPrompt = `Draft a ${recommendation.tone} email for client ${client.name}:
Invoice(s):
${invoiceDescriptions.map((d) => `- ${d}`).join('\n')}
Total Outstanding Balance: ${balanceFormatted}
Analyst Reasoning: ${recommendation.reasoning}`;

  const { data } = await promptJSON({
    agent: 'communicator',
    system,
    user: userPrompt,
    schema: communicatorOutputSchema,
    context: {
      invoice: invoiceList[0],
      invoices: invoiceList,
      client,
      user,
      recommendation,
      balanceFormatted,
      invoiceNumbersStr,
    },
  });

  // Log to agent_logs for all included invoices
  for (const inv of invoiceList) {
    await query(
      `insert into agent_logs (user_id, agent, invoice_id, input_summary, output_json, reasoning)
       values ($1, 'communicator', $2, $3, $4, $5)`,
      [
        userId,
        inv.id,
        `Drafted ${recommendation.tone} follow-up for ${inv.invoice_no}${isGrouped ? ` (part of grouped reminder for ${invoiceNumbersStr})` : ''}`,
        JSON.stringify(data),
        `Drafted ${recommendation.tone} email for balance ${balanceFormatted}`,
      ],
    );
  }

  return data;
}

// ── Mock for LLM_MODE=mock ───────────────────────────────────────────────────

registerMock('communicator', (ctx) => {
  const invoices = ctx?.invoices || (ctx?.invoice ? [ctx.invoice] : []);
  const client = ctx?.client || {};
  const user = ctx?.user || {};
  const rec = ctx?.recommendation || {};
  const balanceFormatted = ctx?.balanceFormatted || '₹0';
  const invoiceNumbersStr = ctx?.invoiceNumbersStr || invoices.map((i) => i.invoice_no).join(', ');
  const sender = user.business_name || user.name || 'Accounts Team';

  // 1. Dispute Resolution Tone
  if (rec.tone === 'dispute_resolution') {
    return {
      subject: `Dispute Clarification: Invoice ${invoiceNumbersStr}`,
      body: `Dear ${client.name},\n\nWe understand that invoice ${invoiceNumbersStr} with an outstanding balance of ${balanceFormatted} is currently under dispute or review.\n\nWe would appreciate the opportunity to clarify any concerns regarding the billed services or deliverables so we can resolve this together.\n\nPlease let us know the details or reach out to our team.\n\nBest regards,\n${sender}`,
    };
  }

  // 2. Final Notice Tone
  if (rec.tone === 'final') {
    return {
      subject: `URGENT: Final Notice for Invoice ${invoiceNumbersStr} (${balanceFormatted})`,
      body: `Dear ${client.name},\n\nThis is a final notice regarding invoice ${invoiceNumbersStr} with an outstanding balance of ${balanceFormatted}.\n\nPlease arrange for immediate payment or contact our office today to settle this account.\n\nRegards,\n${sender}`,
    };
  }

  // 3. Firm Reminder Tone
  if (rec.tone === 'firm') {
    return {
      subject: `Payment Reminder: Invoice ${invoiceNumbersStr} (${balanceFormatted}) is overdue`,
      body: `Hi ${client.name},\n\nWe are following up on invoice ${invoiceNumbersStr} with a total balance of ${balanceFormatted}.\n\nPlease let us know when we can expect this payment.\n\nThank you,\n${sender}`,
    };
  }

  // 4. Friendly Reminder Tone
  return {
    subject: `Friendly Reminder: Invoice ${invoiceNumbersStr} (${balanceFormatted})`,
    body: `Hi ${client.name},\n\nHope you are doing well. Just a friendly reminder regarding invoice ${invoiceNumbersStr} with an outstanding balance of ${balanceFormatted}.\n\nPlease find the details and let us know if you have any questions.\n\nBest regards,\n${sender}`,
  };
});
