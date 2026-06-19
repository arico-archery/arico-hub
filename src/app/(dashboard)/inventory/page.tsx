'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Trash2, X, ScanLine, RefreshCw, Boxes, ChevronLeft, ChevronRight, CheckCircle } from 'lucide-react'
import BarcodeScanner from '@/components/BarcodeScanner'
import { formatNumber } from '@/lib/utils'
import { useT } from '@/lib/i18n'

type Sku = {
  id: number; barcode: string; name: string; optionLabel: string
  stockQty: number; reorderPoint: number; source: string
  syncedAt: string | null
}

const PAGE_SIZE = 50

export default function InventoryPage() {
  const t = useT()
  const [rows, setRows] = useState<Sku[]>([])
  const [total, setTotal] = useState(0)
  const [totalSkus, setTotalSkus] = useState(0)
  const [totalStock, setTotalStock] = useState(0)
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)

  const [stockInputs, setStockInputs] = useState<Record<number, string>>({})
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [deleteId, setDeleteId] = useState<number | null>(null)

  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ name: '', optionLabel: '', barcode: '', stockQty: '0' })
  const [formSaving, setFormSaving] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)

  const [syncMsg, setSyncMsg] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)

  const fetchRows = useCallback(async (pageArg: number) => {
    setLoading(true)
    const params = new URLSearchParams({ q, page: String(pageArg) })
    const res = await fetch(`/api/online-sku?${params}`)
    const data = await res.json()
    setRows(data.rows || [])
    setTotal(data.total || 0)
    setTotalSkus(data.totalSkus || 0)
    setTotalStock(data.totalStock || 0)
    const init: Record<number, string> = {}
    for (const r of data.rows || []) init[r.id] = String(r.stockQty)
    setStockInputs(prev => ({ ...prev, ...init }))
    setLoading(false)
  }, [q])

  useEffect(() => { setPage(1); const timer = setTimeout(() => fetchRows(1), 300); return () => clearTimeout(timer) }, [fetchRows])
  useEffect(() => { fetchRows(page) }, [page]) // eslint-disable-line

  const saveStock = async (id: number) => {
    const val = Number(stockInputs[id] ?? 0)
    const cur = rows.find(r => r.id === id)?.stockQty ?? 0
    if (isNaN(val) || val === cur) return
    const res = await fetch(`/api/online-sku/${id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stockQty: val }),
    })
    if (!res.ok) return
    setRows(prev => prev.map(r => r.id === id ? { ...r, stockQty: val } : r))
    setTotalStock(prev => prev - cur + val)
    setSavedIds(prev => new Set(prev).add(id))
    setTimeout(() => setSavedIds(prev => { const s = new Set(prev); s.delete(id); return s }), 2000)
  }

  const submitForm = async () => {
    if (!form.name.trim()) return
    setFormSaving(true)
    try {
      const res = await fetch('/api/online-sku', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: form.name, optionLabel: form.optionLabel, barcode: form.barcode, stockQty: Number(form.stockQty) || 0 }),
      })
      if (res.ok) { setFormOpen(false); setForm({ name: '', optionLabel: '', barcode: '', stockQty: '0' }); fetchRows(page) }
    } finally { setFormSaving(false) }
  }

  const removeSku = async (id: number) => {
    const res = await fetch(`/api/online-sku/${id}`, { method: 'DELETE' })
    setDeleteId(null)
    if (res.ok) fetchRows(page)
  }

  const handleSync = async () => {
    setSyncing(true); setSyncMsg(null)
    try {
      const d = await fetch('/api/online-sku/sync', { method: 'POST' }).then(r => r.json())
      if (d.ok) { setSyncMsg(`✅ ${d.updated}/${d.total}`); fetchRows(page) }
      else setSyncMsg(`⚠️ ${d.message ?? 'not configured'}`)
    } catch { setSyncMsg('⚠️ error') }
    setSyncing(false)
  }

  const sourceLabel = (s: string) => s === 'smaregi' ? t.inventory.sourceSmaregi : s === 'makeshop' ? t.inventory.sourceMakeshop : t.inventory.sourceManual
  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2"><Boxes className="w-6 h-6 text-blue-600" />{t.inventory.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 text-sm mt-1 font-medium">
            {t.inventory.subtitle} · {formatNumber(totalSkus)} {t.inventory.skuCount} · {t.inventory.totalStock} {formatNumber(totalStock)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={() => { setForm({ name: '', optionLabel: '', barcode: '', stockQty: '0' }); setFormOpen(true) }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
            <Plus className="w-4 h-4" />{t.inventory.addSku}
          </button>
          <button onClick={handleSync} disabled={syncing} title={t.inventory.syncTooltip}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50">
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />{t.inventory.sync}
          </button>
        </div>
      </div>

      {syncMsg && (
        <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300">{syncMsg}</div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4 mb-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder={t.inventory.searchPlaceholder}
            className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
        <table className="w-full text-sm min-w-[640px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colName}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colOption}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colBarcode}</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-28">{t.inventory.colStock}</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-24">{t.inventory.colSource}</th>
              <th className="w-12" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {loading && rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-16 text-gray-400">{t.common.loading}</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={6} className="text-center py-16 text-gray-400">
                <Boxes className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>{t.inventory.empty}</p>
              </td></tr>
            ) : rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{r.name}</td>
                <td className="px-4 py-3">
                  {r.optionLabel
                    ? <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">{r.optionLabel}</span>
                    : <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-gray-500 dark:text-gray-400">{r.barcode || '—'}</td>
                <td className="px-4 py-2 text-center">
                  <div className="relative inline-flex items-center">
                    <input type="number"
                      className={`w-16 text-center border rounded px-2 py-1.5 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                        savedIds.has(r.id) ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-gray-900 dark:text-gray-100' :
                        (Number(stockInputs[r.id] ?? 0) > 0 ? 'border-green-300 dark:border-green-700 bg-white dark:bg-gray-700 text-green-700 dark:text-green-300 font-medium' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-400')
                      }`}
                      value={stockInputs[r.id] ?? ''}
                      onChange={e => setStockInputs(prev => ({ ...prev, [r.id]: e.target.value }))}
                      onBlur={() => saveStock(r.id)}
                      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                    {savedIds.has(r.id) && <CheckCircle className="absolute -right-5 w-3.5 h-3.5 text-green-500" />}
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${r.source === 'manual' ? 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>{sourceLabel(r.source)}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  {deleteId === r.id ? (
                    <span className="inline-flex items-center gap-1">
                      <button onClick={() => removeSku(r.id)} className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-semibold hover:bg-red-700">{t.common.delete}</button>
                      <button onClick={() => setDeleteId(null)} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded text-[10px]">{t.common.cancel}</button>
                    </span>
                  ) : (
                    <button onClick={() => setDeleteId(r.id)} title={t.common.delete}
                      className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <p className="text-xs text-gray-500 dark:text-gray-400">{(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {formatNumber(total)}</p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="p-1.5 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30"><ChevronLeft className="w-4 h-4" /></button>
              <span className="px-2 text-xs text-gray-600 dark:text-gray-300">{page} / {totalPages}</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="p-1.5 rounded text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">{t.inventory.formTitle}</h2>
              <button onClick={() => setFormOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.inventory.fieldName} *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder={t.inventory.fieldNamePh}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.inventory.fieldOption}</label>
                <input type="text" value={form.optionLabel} onChange={e => setForm(f => ({ ...f, optionLabel: e.target.value }))} placeholder={t.inventory.fieldOptionPh}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.inventory.fieldBarcode}</label>
                  <div className="flex gap-1.5">
                    <input type="text" inputMode="numeric" value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                      className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="button" onClick={() => setScanOpen(true)} className="shrink-0 px-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><ScanLine className="w-4 h-4" /></button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.inventory.fieldStock}</label>
                  <input type="number" value={form.stockQty} onChange={e => setForm(f => ({ ...f, stockQty: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={submitForm} disabled={formSaving || !form.name.trim()}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{formSaving ? t.common.saving : t.common.save}</button>
              <button onClick={() => setFormOpen(false)} className="px-4 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {scanOpen && (
        <BarcodeScanner onResult={code => { setForm(f => ({ ...f, barcode: code })); setScanOpen(false) }} onClose={() => setScanOpen(false)} />
      )}
    </div>
  )
}
