import { useMemo, useState } from 'react';
import './finance-reporting-forms.css';

type ClientOption = { clientId: string; displayName: string; status: string };

type Props = {
  apiBaseUrl: string;
  token: string;
  clients: ClientOption[];
  onSaved: () => Promise<void>;
  onError: (message: string) => void;
};

const today = () => new Date().toISOString().slice(0, 10);

function toMinorUnits(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Amount must be greater than zero.');
  const minor = Math.round(parsed * 100);
  if (!Number.isSafeInteger(minor) || minor <= 0) throw new Error('Amount is outside the supported range.');
  return minor;
}

async function postRecord<T>(url: string, token: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as { ok?: boolean; data?: T; error?: { message?: string } };
  if (!response.ok || payload.ok === false || payload.data === undefined) {
    throw new Error(payload.error?.message ?? `Finance request failed with HTTP ${response.status}.`);
  }
  return payload.data;
}

export function FinanceReportingForms({ apiBaseUrl, token, clients, onSaved, onError }: Props) {
  const [busy, setBusy] = useState<'expense' | 'subscription' | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expense, setExpense] = useState({
    category: 'SOFTWARE', vendor: '', description: '', amount: '', currency: 'ZAR',
    billingType: 'ONE_TIME', billingPeriod: 'MONTHLY', expenseDate: today(), status: 'PLANNED',
    clientId: '', receiptReference: '', evidenceReference: '',
  });
  const [subscription, setSubscription] = useState({
    clientId: '', service: '', billingFrequency: 'MONTHLY', amount: '', currency: 'ZAR',
    startDate: today(), nextBillingDate: today(), status: 'ACTIVE', autoRenew: true,
    invoicePolicy: 'Invoice before each billing cycle.', commercialReference: '', evidenceReference: '',
  });

  const usableClients = useMemo(() => clients.filter((client) => client.status !== 'archived'), [clients]);

  async function saveExpense(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('expense'); setNotice(null); onError('');
    try {
      const body: Record<string, unknown> = {
        category: expense.category,
        vendor: expense.vendor.trim(),
        description: expense.description.trim(),
        amountMinor: toMinorUnits(expense.amount),
        currency: expense.currency.trim().toUpperCase(),
        billingType: expense.billingType,
        expenseDate: expense.expenseDate,
        status: expense.status,
        evidenceReference: expense.evidenceReference.trim(),
      };
      if (expense.billingType === 'RECURRING') body.billingPeriod = expense.billingPeriod;
      if (expense.clientId) body.clientId = expense.clientId;
      if (expense.receiptReference.trim()) body.receiptReference = expense.receiptReference.trim();
      const result = await postRecord<{ expenseId: string }>(`${apiBaseUrl}/api/v1/control/finance/reporting/expense`, token, body);
      setNotice(`Expense recorded: ${result.expenseId}`);
      setExpense((current) => ({ ...current, vendor: '', description: '', amount: '', receiptReference: '', evidenceReference: '' }));
      await onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(null); }
  }

  async function saveSubscription(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy('subscription'); setNotice(null); onError('');
    try {
      const result = await postRecord<{ subscriptionId: string }>(`${apiBaseUrl}/api/v1/control/finance/reporting/subscription`, token, {
        clientId: subscription.clientId,
        service: subscription.service.trim(),
        billingFrequency: subscription.billingFrequency,
        amountMinor: toMinorUnits(subscription.amount),
        currency: subscription.currency.trim().toUpperCase(),
        startDate: subscription.startDate,
        nextBillingDate: subscription.nextBillingDate,
        status: subscription.status,
        autoRenew: subscription.autoRenew,
        invoicePolicy: subscription.invoicePolicy.trim(),
        commercialReference: subscription.commercialReference.trim(),
        evidenceReference: subscription.evidenceReference.trim(),
      });
      setNotice(`Recurring plan recorded: ${result.subscriptionId}`);
      setSubscription((current) => ({ ...current, service: '', amount: '', commercialReference: '', evidenceReference: '' }));
      await onSaved();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally { setBusy(null); }
  }

  return (
    <section className="finance-entry-section" aria-labelledby="finance-entry-title">
      <div className="finance-entry-heading">
        <div><p className="eyebrow">Human Executive · Finance records</p><h2 id="finance-entry-title">Record authoritative financial state</h2></div>
        <span className="status-badge">PostgreSQL backed</span>
      </div>
      <p className="finance-entry-intro">These forms write directly to the governed Finance reporting stores. Values are included in dashboard totals only after a successful authenticated save.</p>
      {notice && <div className="finance-success">{notice}</div>}

      <div className="finance-form-grid">
        <form className="finance-form-card" onSubmit={saveExpense}>
          <div><p className="eyebrow">Expenses</p><h3>Record expense</h3></div>
          <div className="form-grid two-col">
            <label>Category<select value={expense.category} onChange={(e) => setExpense({ ...expense, category: e.target.value })}><option>SOFTWARE</option><option>HOSTING</option><option>DOMAIN</option><option>AI</option><option>MARKETING</option><option>ADMINISTRATION</option><option>PROFESSIONAL_SERVICES</option><option>DIRECT_PROJECT_COST</option><option>VARIABLE_OPERATING_COST</option><option>FIXED_OPERATING_COST</option><option>PAYMENT_PROCESSING_FEE</option><option>FOUNDER_EXPENSE</option><option>REFUND</option><option>OTHER</option></select></label>
            <label>Vendor<input required value={expense.vendor} onChange={(e) => setExpense({ ...expense, vendor: e.target.value })} placeholder="e.g. Vercel" /></label>
            <label className="full">Description<input required value={expense.description} onChange={(e) => setExpense({ ...expense, description: e.target.value })} placeholder="What the cost is for" /></label>
            <label>Amount<input required inputMode="decimal" value={expense.amount} onChange={(e) => setExpense({ ...expense, amount: e.target.value })} placeholder="0.00" /></label>
            <label>Currency<input required maxLength={3} value={expense.currency} onChange={(e) => setExpense({ ...expense, currency: e.target.value.toUpperCase() })} /></label>
            <label>Billing type<select value={expense.billingType} onChange={(e) => setExpense({ ...expense, billingType: e.target.value })}><option value="ONE_TIME">One-time</option><option value="RECURRING">Recurring</option></select></label>
            {expense.billingType === 'RECURRING' && <label>Billing period<select value={expense.billingPeriod} onChange={(e) => setExpense({ ...expense, billingPeriod: e.target.value })}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option></select></label>}
            <label>Expense date<input required type="date" value={expense.expenseDate} onChange={(e) => setExpense({ ...expense, expenseDate: e.target.value })} /></label>
            <label>Status<select value={expense.status} onChange={(e) => setExpense({ ...expense, status: e.target.value })}><option value="PLANNED">Planned</option><option value="INCURRED">Incurred</option><option value="PAID">Paid</option></select></label>
            <label>Client (optional)<select value={expense.clientId} onChange={(e) => setExpense({ ...expense, clientId: e.target.value })}><option value="">Agency / no client</option>{usableClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName} · {client.status}</option>)}</select></label>
            <label>Receipt/reference (optional)<input value={expense.receiptReference} onChange={(e) => setExpense({ ...expense, receiptReference: e.target.value })} placeholder="Invoice or receipt reference" /></label>
            <label className="full">Evidence reference<input required value={expense.evidenceReference} onChange={(e) => setExpense({ ...expense, evidenceReference: e.target.value })} placeholder="Receipt, invoice, approval note, or evidence URI" /></label>
          </div>
          <button type="submit" disabled={busy !== null}>{busy === 'expense' ? 'Recording…' : 'Record expense'}</button>
        </form>

        <form className="finance-form-card" onSubmit={saveSubscription}>
          <div><p className="eyebrow">Recurring revenue</p><h3>Record client plan</h3></div>
          {usableClients.length === 0 && <p className="form-warning">No non-archived clients exist yet. A recurring plan can be recorded once Sales/Operations has created the client record.</p>}
          <div className="form-grid two-col">
            <label className="full">Client<select required value={subscription.clientId} onChange={(e) => setSubscription({ ...subscription, clientId: e.target.value })}><option value="">Select client</option>{usableClients.map((client) => <option key={client.clientId} value={client.clientId}>{client.displayName} · {client.status}</option>)}</select></label>
            <label className="full">Service<input required value={subscription.service} onChange={(e) => setSubscription({ ...subscription, service: e.target.value })} placeholder="e.g. Website maintenance" /></label>
            <label>Amount per billing period<input required inputMode="decimal" value={subscription.amount} onChange={(e) => setSubscription({ ...subscription, amount: e.target.value })} placeholder="0.00" /></label>
            <label>Currency<input required maxLength={3} value={subscription.currency} onChange={(e) => setSubscription({ ...subscription, currency: e.target.value.toUpperCase() })} /></label>
            <label>Billing frequency<select value={subscription.billingFrequency} onChange={(e) => setSubscription({ ...subscription, billingFrequency: e.target.value })}><option value="MONTHLY">Monthly</option><option value="QUARTERLY">Quarterly</option><option value="ANNUAL">Annual</option></select></label>
            <label>Status<select value={subscription.status} onChange={(e) => setSubscription({ ...subscription, status: e.target.value })}><option value="ACTIVE">Active</option><option value="TRIAL">Trial</option><option value="PAST_DUE">Past due</option><option value="SUSPENDED">Suspended</option></select></label>
            <label>Start date<input required type="date" value={subscription.startDate} onChange={(e) => setSubscription({ ...subscription, startDate: e.target.value })} /></label>
            <label>Next billing date<input required type="date" value={subscription.nextBillingDate} onChange={(e) => setSubscription({ ...subscription, nextBillingDate: e.target.value })} /></label>
            <label className="full">Commercial reference<input required value={subscription.commercialReference} onChange={(e) => setSubscription({ ...subscription, commercialReference: e.target.value })} placeholder="Approved proposal / contract / sales record reference" /></label>
            <label className="full">Invoice policy<input required value={subscription.invoicePolicy} onChange={(e) => setSubscription({ ...subscription, invoicePolicy: e.target.value })} /></label>
            <label className="full">Evidence reference<input required value={subscription.evidenceReference} onChange={(e) => setSubscription({ ...subscription, evidenceReference: e.target.value })} placeholder="Signed approval, contract, or evidence URI" /></label>
            <label className="check-row"><input type="checkbox" checked={subscription.autoRenew} onChange={(e) => setSubscription({ ...subscription, autoRenew: e.target.checked })} />Auto-renew</label>
          </div>
          <button type="submit" disabled={busy !== null || usableClients.length === 0}>{busy === 'subscription' ? 'Recording…' : 'Record recurring plan'}</button>
        </form>
      </div>
    </section>
  );
}
