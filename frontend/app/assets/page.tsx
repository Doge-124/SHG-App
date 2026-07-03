'use client'

import { useEffect, useState, useCallback } from 'react'
import { Plus, Package, Boxes, Coins } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { DataTable, type Column } from '@/components/data-table'
import { PageHeader } from '@/components/page-header'
import { formatCurrency } from '@/lib/format'
import { getAssets, getAssetSummary, addAsset, disposeAsset } from '@/lib/api/assets'
import type { Asset, AssetSummary, NewAssetInput } from '@/lib/types'

const CATEGORIES = ['Office / Building', 'Computer / Electronics', 'Furniture', 'Equipment', 'Vehicle', 'Other']

function todayIso() {
  return new Date().toISOString().split('T')[0]
}

const EMPTY_FORM: NewAssetInput = {
  name: '', category: 'Other', purchaseDate: todayIso(), cost: 0,
  supplier: '', location: '', referenceNo: '', note: '', fundingMethod: 'OPENING', bankTxnId: '',
}

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([])
  const [summary, setSummary] = useState<AssetSummary | null>(null)
  const [loading, setLoading] = useState(false)

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState<NewAssetInput>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)

  const [disposeTarget, setDisposeTarget] = useState<Asset | null>(null)
  const [disposeProceeds, setDisposeProceeds] = useState('')
  const [disposeMethod, setDisposeMethod] = useState<'CASH' | 'BANK'>('CASH')
  const [disposeDate, setDisposeDate] = useState(todayIso())
  const [disposing, setDisposing] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, s] = await Promise.all([getAssets(), getAssetSummary()])
      if (a.success && a.data) setAssets(a.data)
      if (s.success && s.data) setSummary(s.data)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleAdd = async () => {
    if (!form.name.trim()) { toast.error('Enter an asset name'); return }
    if (!(form.cost > 0)) { toast.error('Enter a cost greater than 0'); return }
    setSaving(true)
    try {
      const res = await addAsset({
        ...form,
        supplier: form.supplier || null,
        location: form.location || null,
        referenceNo: form.referenceNo || null,
        note: form.note || null,
        bankTxnId: form.fundingMethod === 'BANK' ? (form.bankTxnId || null) : null,
      })
      if (res.success) {
        toast.success('Asset added')
        setAddOpen(false)
        setForm(EMPTY_FORM)
        load()
      } else {
        toast.error(res.error || 'Failed to add asset')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDispose = async () => {
    if (!disposeTarget) return
    const proceeds = parseFloat(disposeProceeds) || 0
    if (proceeds < 0) { toast.error('Proceeds cannot be negative'); return }
    setDisposing(true)
    try {
      const res = await disposeAsset(
        disposeTarget.id,
        proceeds,
        proceeds > 0 ? disposeMethod : null,
        disposeDate,
      )
      if (res.success) {
        toast.success('Asset disposed')
        setDisposeTarget(null)
        setDisposeProceeds('')
        load()
      } else {
        toast.error(res.error || 'Failed to dispose asset')
      }
    } finally {
      setDisposing(false)
    }
  }

  const fundingLabel = (a: Asset) =>
    a.isOpening ? 'Opening (owned)' : a.fundingMethod === 'CASH' ? 'Cash' : 'Bank'

  const columns: Column<Asset>[] = [
    { key: 'name', header: 'Asset', cell: (a) => (
        <div>
          <p className="font-medium">{a.name}</p>
          {a.location && <p className="text-xs text-muted-foreground">{a.location}</p>}
        </div>
      ), sortable: true },
    { key: 'category', header: 'Category', cell: (a) => <span className="text-sm">{a.category}</span>, sortable: true },
    { key: 'purchaseDate', header: 'Acquired', cell: (a) => <span className="text-sm">{a.purchaseDate?.slice(0, 10)}</span>, sortable: true },
    { key: 'cost', header: 'Cost', cell: (a) => <span className="font-medium">{formatCurrency(a.cost)}</span>, sortable: true },
    { key: 'fundingMethod', header: 'Funding', cell: (a) => <span className="text-sm text-muted-foreground">{fundingLabel(a)}</span> },
    { key: 'status', header: 'Status', cell: (a) => (
        a.status === 'ACTIVE'
          ? <Badge className="bg-success/10 text-success hover:bg-success/20">Active</Badge>
          : <Badge variant="secondary">Disposed{a.disposalAmount ? ` · ${formatCurrency(a.disposalAmount)}` : ''}</Badge>
      ) },
    { key: 'actions', header: '', cell: (a) => (
        a.status === 'ACTIVE'
          ? <Button variant="outline" size="sm" onClick={(e) => { e.stopPropagation(); setDisposeTarget(a); setDisposeProceeds(''); setDisposeMethod('CASH'); setDisposeDate(todayIso()) }}>Dispose</Button>
          : null
      ), className: 'w-24' },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title={<span className="flex items-center gap-3"><Package className="h-6 w-6" />Asset Ledger</span>}
        description="Fixed assets owned by the SHG, recorded at cost. Purchases reduce cash/bank and appear on the Balance Sheet."
      >
        <Button onClick={() => { setForm({ ...EMPTY_FORM, purchaseDate: todayIso() }); setAddOpen(true) }}>
          <Plus className="mr-2 h-4 w-4" />Add Asset
        </Button>
      </PageHeader>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Coins className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Total Assets (at cost)</p>
              <p className="text-2xl font-bold">{formatCurrency(summary?.totalCost ?? 0)}</p>
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <div className="flex items-center gap-3">
            <Boxes className="h-8 w-8 text-primary" />
            <div>
              <p className="text-sm text-muted-foreground">Active Assets</p>
              <p className="text-2xl font-bold">{summary?.activeCount ?? 0}</p>
            </div>
          </div>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground mb-2">By Category</p>
          {summary && summary.byCategory.length > 0 ? (
            <div className="space-y-1">
              {summary.byCategory.map((c) => (
                <div key={c.category} className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{c.category} ({c.count})</span>
                  <span className="font-medium">{formatCurrency(c.cost)}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-sm text-muted-foreground">No assets yet</p>}
        </CardContent></Card>
      </div>

      <DataTable
        data={assets}
        columns={columns}
        searchKey="name"
        searchPlaceholder="Search assets..."
        isLoading={loading}
        emptyMessage="No assets recorded yet"
      />

      {/* Add Asset dialog */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Asset</DialogTitle>
            <DialogDescription>Record a fixed asset owned by the SHG.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="a-name">Name</Label>
              <Input id="a-name" placeholder="e.g. Dell Laptop" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="a-cat">Category</Label>
                <select id="a-cat"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-date">Acquired On</Label>
                <Input id="a-date" type="date" value={form.purchaseDate}
                  onChange={(e) => setForm((f) => ({ ...f, purchaseDate: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="a-cost">Cost (Rs.)</Label>
                <Input id="a-cost" type="number" min={1} placeholder="0"
                  value={form.cost === 0 ? '' : form.cost}
                  onChange={(e) => setForm((f) => ({ ...f, cost: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-fund">Funding</Label>
                <select id="a-fund"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={form.fundingMethod}
                  onChange={(e) => setForm((f) => ({ ...f, fundingMethod: e.target.value as NewAssetInput['fundingMethod'] }))}>
                  <option value="OPENING">Already owned (opening)</option>
                  <option value="CASH">Paid in Cash</option>
                  <option value="BANK">Paid from Bank</option>
                </select>
              </div>
            </div>
            {form.fundingMethod !== 'OPENING' && (
              <p className="text-xs text-muted-foreground">
                This deducts {form.fundingMethod === 'CASH' ? 'cash' : 'bank'} from SHG funds and appears on the Balance Sheet as a fixed asset.
              </p>
            )}
            {form.fundingMethod === 'BANK' && (
              <div className="space-y-1">
                <Label htmlFor="a-utr">Bank Reference (optional)</Label>
                <Input id="a-utr" placeholder="UTR / cheque no." value={form.bankTxnId ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, bankTxnId: e.target.value }))} />
              </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="a-supplier">Supplier (optional)</Label>
                <Input id="a-supplier" value={form.supplier ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, supplier: e.target.value }))} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="a-loc">Location (optional)</Label>
                <Input id="a-loc" value={form.location ?? ''}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label htmlFor="a-note">Note (optional)</Label>
              <Textarea id="a-note" rows={2} className="resize-none" value={form.note ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleAdd} disabled={saving}>
              {saving && <Spinner className="mr-2 h-4 w-4" />}Add Asset
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dispose dialog */}
      <Dialog open={!!disposeTarget} onOpenChange={(o) => !o && setDisposeTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Dispose Asset</DialogTitle>
            <DialogDescription>
              Sell or scrap &quot;{disposeTarget?.name}&quot;. Enter sale proceeds (0 if scrapped).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <Label htmlFor="d-proceeds">Sale Proceeds (Rs.)</Label>
              <Input id="d-proceeds" type="number" min={0} placeholder="0"
                value={disposeProceeds}
                onChange={(e) => setDisposeProceeds(e.target.value)} />
            </div>
            {(parseFloat(disposeProceeds) || 0) > 0 && (
              <div className="space-y-1">
                <Label htmlFor="d-method">Received In</Label>
                <select id="d-method"
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  value={disposeMethod}
                  onChange={(e) => setDisposeMethod(e.target.value as 'CASH' | 'BANK')}>
                  <option value="CASH">Cash</option>
                  <option value="BANK">Bank</option>
                </select>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="d-date">Date</Label>
              <Input id="d-date" type="date" value={disposeDate}
                onChange={(e) => setDisposeDate(e.target.value)} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisposeTarget(null)} disabled={disposing}>Cancel</Button>
            <Button variant="destructive" onClick={handleDispose} disabled={disposing}>
              {disposing && <Spinner className="mr-2 h-4 w-4" />}Dispose
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
