import { useEffect, useMemo, useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { zodResolver } from '@hookform/resolvers/zod'

import type { MemberProfile, OpeningDataInput, PaymentMethod } from '../types/member'
import { getMemberProfile, setMemberOpeningData } from '../api/members'
import { useToast } from '../components/Toast'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(n)
}

function formatLocalDate(iso?: string | null) {
  if (!iso) return '-'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString()
}

const openingSchema = z
  .object({
    opening_balance: z.number().min(0, 'Opening balance must be ≥ 0'),
    payment_method: z.enum(['CASH', 'BANK']).optional(),
    past_installments: z.number().int().min(0, 'Installments must be ≥ 0'),
  })
  .superRefine((val, ctx) => {
    if (val.opening_balance > 0 && !val.payment_method) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Payment method is required when opening balance > 0',
        path: ['payment_method'],
      })
    }
  })

type OpeningFormValues = z.infer<typeof openingSchema>

export default function MemberProfilePage({ memberId }: { memberId: number }) {
  const { showToast } = useToast()
  const [profile, setProfile] = useState<MemberProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const regularBalance = useMemo(() => {
    if (!profile) return 0
    return profile.current_balance - profile.opening_balance
  }, [profile])

  const form = useForm<OpeningFormValues>({
    resolver: zodResolver(openingSchema),
    defaultValues: {
      opening_balance: 0,
      payment_method: undefined,
      past_installments: 0,
    },
    mode: 'onChange',
  })

  const openingBalance = form.watch('opening_balance')

  async function load() {
    setLoading(true)
    try {
      const p = await getMemberProfile(memberId)
      setProfile(p)
      if (!p.opening_data_locked) {
        form.reset({
          opening_balance: 0,
          payment_method: undefined,
          past_installments: 0,
        })
      }
    } catch (e) {
      showToast({ kind: 'error', title: 'Failed to load member', description: String(e) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId])

  async function onSubmit(values: OpeningFormValues) {
    if (!profile) return
    setSaving(true)
    try {
      const input: OpeningDataInput = {
        member_id: profile.member.id,
        opening_balance: values.opening_balance,
        payment_method:
          values.opening_balance > 0
            ? (values.payment_method as PaymentMethod)
            : null,
        past_installments: values.past_installments,
      }

      await setMemberOpeningData(input)
      showToast({ kind: 'success', title: 'Past data saved' })
      await load()
    } catch (e) {
      showToast({ kind: 'error', title: 'Unable to save past data', description: String(e) })
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div>Loading member profile…</div>
  if (!profile) return <div>No member profile.</div>

  return (
    <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 12 }}>
      <h2 style={{ marginTop: 0 }}>
        {profile.member.name} ({profile.member.member_code})
      </h2>

      <div style={{ display: 'grid', gap: 6, marginBottom: 12 }}>
        <div>
          <b>Opening Balance:</b> {formatINR(profile.opening_balance)}
        </div>
        <div>
          <b>Regular Balance:</b> {formatINR(regularBalance)}
        </div>
        <div>
          <b>Total Balance:</b> {formatINR(profile.current_balance)}
        </div>
        <div>
          <b>Total Installments Paid:</b> {profile.total_installments}
        </div>
      </div>

      {!profile.opening_data_locked ? (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Enter Past Data (One-Time Migration)</h3>
          <p style={{ color: '#374151', marginTop: 6 }}>
            This is a one-time entry for records that existed before this app was adopted. Once
            saved, this cannot be modified.
          </p>

          <form onSubmit={form.handleSubmit(onSubmit)} style={{ display: 'grid', gap: 10 }}>
            <label>
              Opening Balance (₹)
              <input
                type="number"
                step="0.01"
                min={0}
                {...form.register('opening_balance', { valueAsNumber: true })}
              />
            </label>
            {form.formState.errors.opening_balance ? (
              <div style={{ color: '#dc2626' }}>{form.formState.errors.opening_balance.message}</div>
            ) : null}

            {openingBalance > 0 ? (
              <label>
                Payment Method
                <select {...form.register('payment_method')}>
                  <option value="">Select…</option>
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank</option>
                </select>
              </label>
            ) : null}
            {form.formState.errors.payment_method ? (
              <div style={{ color: '#dc2626' }}>{form.formState.errors.payment_method.message}</div>
            ) : null}

            <label>
              Past Number of Installments
              <input
                type="number"
                min={0}
                step={1}
                {...form.register('past_installments', { valueAsNumber: true })}
              />
            </label>
            {form.formState.errors.past_installments ? (
              <div style={{ color: '#dc2626' }}>
                {form.formState.errors.past_installments.message}
              </div>
            ) : null}

            <button type="submit" disabled={saving || !form.formState.isValid}>
              {saving ? 'Saving…' : 'Save Past Data'}
            </button>
          </form>
        </div>
      ) : (
        <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Past Data (Migration Record)</h3>
          <div style={{ display: 'grid', gap: 6 }}>
            <div>
              <b>Opening Balance:</b> {formatINR(profile.opening_balance)}{' '}
              {profile.opening_balance_method ? `via ${profile.opening_balance_method}` : ''}
            </div>
            <div>
              <b>Recorded on:</b> {formatLocalDate(profile.opening_balance_set_at)}
            </div>
            <div>
              <b>Past Installments Seeded:</b> {profile.total_installments}
            </div>
          </div>
        </div>
      )}

      <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12, marginTop: 12 }}>
        <h3 style={{ marginTop: 0 }}>Recent Member Transactions</h3>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Date</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Type</th>
              <th style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>Reason</th>
              <th style={{ textAlign: 'right', borderBottom: '1px solid #e5e7eb' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {profile.recent_transactions.map(txn => (
              <tr key={txn.id}>
                <td style={{ padding: '6px 0' }}>{formatLocalDate(txn.created_at)}</td>
                <td style={{ padding: '6px 0' }}>{txn.txn_type}</td>
                <td style={{ padding: '6px 0' }}>{txn.reason}</td>
                <td style={{ padding: '6px 0', textAlign: 'right' }}>{formatINR(txn.amount)}</td>
              </tr>
            ))}
            {profile.recent_transactions.length === 0 ? (
              <tr>
                <td colSpan={4} style={{ padding: '8px 0', color: '#6b7280' }}>
                  No transactions yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}

