'use client'

import { useState } from 'react'
import { useApiCache } from '@/lib/useApiCache'
import { PackageCheck, ChevronDown, ChevronUp, Truck, Check } from 'lucide-react'
import SupplierBadge from '@/components/SupplierBadge'
import { useT } from '@/lib/i18n'

type POItem = {
  id: number; quantity: number; confirmedQty: number | null; receivedQty: number; memo: string
  product: { name: string; productCode: string; optionSize: string; optionColor: string; supplierCode: string }
}
type PO = {
  id: number; poNo: string; supplierCode: string; status: string
  orderDate: string; expectedDate?: string
  supplier: { name: string }
  items: POItem[]
}

const target = (it: POItem) => it.confirmedQty ?? it.quantity
const isSameDay = (iso?: string) => {
  if (!iso) return false
  const d = new Date(iso), n = new Date()
  return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth() && d.getDate() === n.getDate()
}

export default function ReceivingPage() {
  const t = useT()
  const { data, isLoading, refresh } = useApiCache<{ orders: PO[] }>(
    '/api/purchase-orders?status=ordered,confirmed,partial&limit=200',
  )
  const pos = data?.orders ?? []

  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [inputs, setInputs] = useState<Record<number, Record<number, string>>>({})  // poId → itemId → 수량
  const [savingId, setSavingId] = useState<number | null>(null)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [partialOnly, setPartialOnly] = useState(false)

  const suppliers = [...new Set(pos.map(p => p.supplierCode))]
  const filtered = pos.filter(p =>
    (!supplierFilter || p.supplierCode === supplierFilter) &&
    (!partialOnly || p.status === 'partial'),
  )

  // 요약
  const waiting = pos.length
  const arriving = pos.filter(p => isSameDay(p.expectedDate)).length
  const partial = pos.filter(p => p.status === 'partial').length
  const delayed = pos.filter(p => p.expectedDate && new Date(p.expectedDate) < new Date() && !isSameDay(p.expectedDate)).length

  const toggle = (id: number) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const setQty = (poId: number, itemId: number, v: string) =>
    setInputs(prev => ({ ...prev, [poId]: { ...(prev[poId] || {}), [itemId]: v.replace(/[^0-9]/g, '') } }))

  const submit = async (po: PO, mode: 'all' | 'confirm') => {
    if (mode === 'all' && !window.confirm(`${po.supplierCode} · ${po.poNo}\n${t.receiving.receiveAllConfirm}`)) return
    setSavingId(po.id)
    const map = inputs[po.id] || {}
    const receiveItems = po.items.map(it => ({
      itemId: it.id,
      receivedQty: mode === 'all' ? target(it) : Number(map[it.id] ?? it.receivedQty),
    }))
    await fetch(`/api/purchase-orders/${po.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiveItems }),
    })
    setInputs(prev => { const n = { ...prev }; delete n[po.id]; return n })
    setSavingId(null)
    refresh()
  }

  const doneCount = (po: PO) => po.items.filter(it => it.receivedQty >= target(it)).length

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <PackageCheck className="w-6 h-6 text-blue-600" />{t.receiving.title}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{t.receiving.subtitle}</p>
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { label: t.receiving.waiting, value: waiting, cls: 'text-gray-900 dark:text-white' },
          { label: t.receiving.arrivingToday, value: arriving, cls: 'text-blue-600' },
          { label: t.receiving.partialCount, value: partial, cls: 'text-yellow-600' },
          { label: t.receiving.delayed, value: delayed, cls: 'text-red-600' },
        ].map(c => (
          <div key={c.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400">{c.label}</p>
            <p className={`text-2xl font-bold ${c.cls}`}>{c.value}</p>
          </div>
        ))}
      </div>

      {/* 필터 */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <button onClick={() => setSupplierFilter('')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${!supplierFilter ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
          {t.common.all}
        </button>
        {suppliers.map(s => (
          <button key={s} onClick={() => setSupplierFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${supplierFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
            {s}
          </button>
        ))}
        <button onClick={() => setPartialOnly(v => !v)}
          className={`ml-auto px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${partialOnly ? 'border-yellow-500 text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20' : 'border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400'}`}>
          {t.receiving.partialOnly}
        </button>
      </div>

      {isLoading ? (
        <div className="text-center py-16 text-gray-400">{t.common.loading}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <PackageCheck className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p>{t.receiving.noWaiting}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(po => {
            const done = doneCount(po)
            const totalItems = po.items.length
            const pct = totalItems > 0 ? Math.round((done / totalItems) * 100) : 0
            const overdue = po.expectedDate && new Date(po.expectedDate) < new Date() && !isSameDay(po.expectedDate)
            const isOpen = expanded.has(po.id)
            const saving = savingId === po.id
            return (
              <div key={po.id} className={`bg-white dark:bg-gray-800 rounded-xl border ${isOpen ? 'border-blue-300 dark:border-blue-700' : 'border-gray-100 dark:border-gray-700/60'} overflow-hidden`}>
                {/* 헤더 */}
                <div className="flex items-center justify-between gap-3 p-4 flex-wrap">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <SupplierBadge code={po.supplierCode} />
                    <span className="font-semibold text-gray-900 dark:text-gray-100">{po.poNo}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(po.orderDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                      {po.expectedDate && <> · {new Date(po.expectedDate).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}</>}
                    </span>
                    {po.status === 'partial' && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-300">{t.purchaseOrders.statusPartial}</span>
                    )}
                    {overdue && (
                      <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300">{t.receiving.delayed}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="hidden sm:flex items-center gap-2 w-40">
                      <div className="flex-1 h-1.5 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 shrink-0">{t.receiving.progressLabel} {done}/{totalItems}</span>
                    </div>
                    <button onClick={() => submit(po, 'all')} disabled={saving}
                      className="flex items-center gap-1.5 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                      <Truck className="w-3.5 h-3.5" />{t.receiving.receiveAll}
                    </button>
                    <button onClick={() => toggle(po.id)} className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                      {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* 펼침: 품목별 입고 */}
                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-gray-700 px-4 py-3">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-gray-500 dark:text-gray-400 text-xs">
                          <th className="text-left font-medium py-1.5">{t.receiving.colProduct}</th>
                          <th className="text-right font-medium py-1.5 w-16">{t.receiving.colOrdered}</th>
                          <th className="text-right font-medium py-1.5 w-16">{t.receiving.colReceivedSoFar}</th>
                          <th className="text-center font-medium py-1.5 w-28">{t.receiving.colReceiveQty}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {po.items.map(it => {
                          const tgt = target(it)
                          const soldOut = it.confirmedQty === 0
                          const isDone = it.receivedQty >= tgt && tgt > 0
                          const opt = [it.product.optionSize, it.product.optionColor, it.memo].filter(Boolean).join(' / ')
                          const val = inputs[po.id]?.[it.id] ?? String(it.receivedQty)
                          return (
                            <tr key={it.id} className={`border-t border-gray-50 dark:border-gray-700/50 ${soldOut ? 'opacity-50' : ''}`}>
                              <td className="py-2">
                                <p className="text-gray-800 dark:text-gray-100">{it.product.name}</p>
                                {opt && <p className="text-xs text-gray-400">{opt}</p>}
                              </td>
                              <td className="py-2 text-right text-gray-500 dark:text-gray-400">{it.quantity}</td>
                              <td className="py-2 text-right text-gray-400">{it.receivedQty}</td>
                              <td className="py-2 text-center">
                                {soldOut ? (
                                  <span className="text-xs text-red-500">{t.purchaseOrders.soldOut}</span>
                                ) : isDone ? (
                                  <span className="inline-flex items-center gap-1 text-green-600 text-xs"><Check className="w-3.5 h-3.5" />{tgt}</span>
                                ) : (
                                  <input type="text" inputMode="numeric" value={val}
                                    onChange={e => setQty(po.id, it.id, e.target.value)}
                                    className="w-16 text-right border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder={String(tgt)} />
                                )}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                    <div className="flex items-center justify-between gap-2 mt-3 flex-wrap">
                      <p className="text-xs text-gray-400">{t.receiving.partialHint}</p>
                      <button onClick={() => submit(po, 'confirm')} disabled={saving}
                        className="bg-blue-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors">
                        {saving ? t.common.saving : t.receiving.confirmReceive}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
