'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Truck, Plus, ChevronRight, ChevronLeft, Package,
  Clock, CheckCircle, AlertCircle, XCircle, RotateCcw, Trash2,
  ClipboardCheck, Banknote
} from 'lucide-react'
import { formatJpy, SUPPLIER_COLORS, SUPPLIER_LIST } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import { useT } from '@/lib/i18n'

const PAGE_SIZE = 20

type POItem = {
  id: number; quantity: number; confirmedQty: number | null; receivedQty: number; unitCostJpy: number
  product: { name: string; productCode: string; supplierCode: string }
}
type PurchaseOrder = {
  id: number; poNo: string; supplierCode: string; status: string
  orderDate: string; expectedDate?: string; receivedDate?: string
  totalCostJpy: number; memo: string
  paymentStatus: string; confirmedTotalJpy: number
  supplier: { name: string; color: string }
  items: POItem[]
}

const STATUS_STYLE: Record<string, { color: string; icon: React.ReactNode }> = {
  draft:    { color: 'bg-gray-100 text-gray-600',    icon: <Clock className="w-3 h-3" /> },
  ordered:  { color: 'bg-blue-100 text-blue-700',    icon: <Truck className="w-3 h-3" /> },
  confirmed:{ color: 'bg-indigo-100 text-indigo-700', icon: <ClipboardCheck className="w-3 h-3" /> },
  paid:     { color: 'bg-purple-100 text-purple-700', icon: <Banknote className="w-3 h-3" /> },
  partial:  { color: 'bg-yellow-100 text-yellow-700', icon: <RotateCcw className="w-3 h-3" /> },
  received: { color: 'bg-green-100 text-green-700',  icon: <CheckCircle className="w-3 h-3" /> },
  cancelled:{ color: 'bg-red-100 text-red-700',      icon: <XCircle className="w-3 h-3" /> },
}

export default function PurchaseOrdersPage() {
  const t = useT()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [deleting, setDeleting] = useState<number | null>(null)

  const statusLabel = (s: string) => ({
    draft: t.purchaseOrders.statusDraft, ordered: t.purchaseOrders.statusOrdered,
    confirmed: t.purchaseOrders.statusConfirmed, paid: t.purchaseOrders.statusPaid,
    partial: t.purchaseOrders.statusPartial, received: t.purchaseOrders.statusReceived,
    cancelled: t.purchaseOrders.statusCancelled,
  } as Record<string,string>)[s] ?? s

  const fetchOrders = useCallback(async (p = 1) => {
    setLoading(true)
    const params = new URLSearchParams({ page: String(p), limit: String(PAGE_SIZE) })
    if (supplierFilter) params.set('supplier', supplierFilter)
    if (statusFilter)   params.set('status',   statusFilter)
    const res  = await fetch(`/api/purchase-orders?${params}`)
    const data = await res.json()
    setOrders(data.orders)
    setTotal(data.total)
    setLoading(false)
  }, [supplierFilter, statusFilter])

  // URL ?status= 파라미터로 초기 필터 설정 (대시보드 "매입 지급 대기" 링크 등)
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const s = sp.get('status')
    if (s && s in STATUS_STYLE) setStatusFilter(s)
  }, [])

  useEffect(() => { setPage(1); fetchOrders(1) }, [supplierFilter, statusFilter]) // eslint-disable-line
  useEffect(() => { fetchOrders(page) }, [page]) // eslint-disable-line

  const deletePO = async (id: number) => {
    setDeleting(id)
    await fetch(`/api/purchase-orders/${id}`, { method: 'DELETE' })
    setDeleting(null)
    setDeleteConfirm(null)
    setExpanded(null)
    fetchOrders(page)
  }

  const updateStatus = async (id: number, status: string) => {
    await fetch(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchOrders(page)
  }

  const progress = (items: POItem[]) => {
    const total = items.reduce((s, i) => s + i.quantity, 0)
    const done  = items.reduce((s, i) => s + i.receivedQty, 0)
    return total > 0 ? Math.round((done / total) * 100) : 0
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.purchaseOrders.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 font-medium text-sm mt-1">
            {t.common.supplier} · {t.common.total} {total}{t.purchaseOrders.totalLabel}
          </p>
        </div>
        <Link
          href="/purchase-orders/new"
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t.purchaseOrders.new}
        </Link>
      </div>

      {/* 필터 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4 mb-4 flex gap-4 flex-wrap items-center">
        <div>
          <span className="text-xs text-gray-600 dark:text-gray-400 font-medium mr-2">{t.common.supplier}</span>
          <button
            onClick={() => setSupplierFilter('')}
            className={`px-3 py-1.5 rounded text-xs font-medium mr-1 transition-colors ${supplierFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
          >{t.purchaseOrders.all}</button>
          {SUPPLIER_LIST.map(s => (
            <button
              key={s}
              onClick={() => setSupplierFilter(supplierFilter === s ? '' : s)}
              className={`px-3 py-1.5 rounded text-xs font-medium mr-1 transition-colors ${supplierFilter === s ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              style={supplierFilter === s ? { backgroundColor: SUPPLIER_COLORS[s] } : {}}
            >{s}</button>
          ))}
        </div>
        <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
        <div>
          <span className="text-xs text-gray-600 dark:text-gray-400 font-medium mr-2">{t.common.status}</span>
          {['', ...Object.keys(STATUS_STYLE)].map(s => (
            <button
              key={s || 'all'}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded text-xs font-medium mr-1 transition-colors ${statusFilter === s ? 'bg-slate-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >{s ? statusLabel(s) : t.purchaseOrders.all}</button>
          ))}
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-40">{t.purchaseOrders.colPoNo}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-28">{t.common.supplier}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.purchaseOrders.colDate} / {t.purchaseOrders.colExpected}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.purchaseOrders.colAmount}</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-24">{t.purchaseOrders.colProgress}</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-28">{t.common.status}</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-16 text-gray-400">{t.common.loading}</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-16 text-gray-400">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>{t.purchaseOrders.noOrders}</p>
                <Link href="/purchase-orders/new" className="text-blue-500 text-xs mt-1 inline-block">{t.purchaseOrders.first}</Link>
              </td></tr>
            ) : orders.map(po => {
              const style = STATUS_STYLE[po.status] ?? STATUS_STYLE.draft
              const pct   = progress(po.items)
              const overdue = po.expectedDate &&
                new Date(po.expectedDate) < new Date() &&
                po.status !== 'received' && po.status !== 'cancelled'
              return (
                <React.Fragment key={po.id}>
                  <tr
                    className={`cursor-pointer transition-colors ${overdue ? 'bg-orange-50/60 dark:bg-orange-900/10 hover:bg-orange-50 dark:hover:bg-orange-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}
                    onClick={() => setExpanded(expanded === po.id ? null : po.id)}
                  >
                    <td className="px-4 py-3">
                      <Link
                        href={`/purchase-orders/${po.id}`}
                        onClick={e => e.stopPropagation()}
                        className="font-medium text-blue-600 hover:underline"
                      >{po.poNo}</Link>
                      {overdue && (
                        <p className="text-xs text-orange-500 flex items-center gap-0.5 mt-0.5">
                          <AlertCircle className="w-3 h-3" />{t.purchaseOrders.overdueBadge}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3"><SupplierBadge code={po.supplierCode} /></td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 font-medium">
                      <p>{new Date(po.orderDate).toLocaleDateString('ja-JP')}</p>
                      {po.expectedDate && (
                        <p className={`text-xs ${overdue ? 'text-orange-500 font-medium' : 'text-gray-500 dark:text-gray-400'}`}>
                          {t.purchaseOrders.colExpected}: {new Date(po.expectedDate).toLocaleDateString('ja-JP')}
                        </p>
                      )}
                      {po.receivedDate && (
                        <p className="text-xs text-green-600">
                          {t.purchaseOrders.statusReceived}: {new Date(po.receivedDate).toLocaleDateString('ja-JP')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100 tabular-nums">
                      {formatJpy(po.totalCostJpy)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-500' : pct > 0 ? 'bg-yellow-400' : 'bg-gray-200 dark:bg-gray-600'}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400 w-8 text-right">{pct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${style.color}`}>
                        {style.icon}{statusLabel(po.status)}
                      </span>
                      {po.paymentStatus === 'paid' && po.status !== 'paid' && (
                        <span className="block mt-1 text-[10px] text-purple-600 dark:text-purple-400 font-medium flex items-center justify-center gap-0.5">
                          <Banknote className="w-2.5 h-2.5" />{t.purchaseOrders.paidLabel}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ChevronRight className={`w-4 h-4 text-gray-400 transition-transform ${expanded === po.id ? 'rotate-90' : ''}`} />
                    </td>
                  </tr>

                  {expanded === po.id && (
                    <tr className="bg-slate-50/60 dark:bg-gray-700/30">
                      <td colSpan={7} className="px-8 py-4">
                        <div className="flex gap-6">
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2 uppercase tracking-wide">
                              {t.purchaseOrders.detailItemsHeader} ({po.items.length}{t.common.cases})
                            </p>
                            <div className="space-y-1.5">
                              {po.items.map(item => (
                                <div key={item.id} className="flex items-center gap-3 text-sm">
                                  <SupplierBadge code={item.product.supplierCode} />
                                  <span className="text-gray-700 dark:text-gray-200 flex-1 truncate">{item.product.name}</span>
                                  <span className="text-gray-500 dark:text-gray-400 text-xs">{item.product.productCode}</span>
                                  <span className="text-gray-500 dark:text-gray-400 tabular-nums">
                                    {item.receivedQty}/{item.quantity}
                                    {item.receivedQty >= item.quantity
                                      ? <CheckCircle className="w-3 h-3 text-green-500 inline ml-1" />
                                      : null}
                                  </span>
                                  <span className="text-gray-600 dark:text-gray-300 font-medium tabular-nums">
                                    {formatJpy(item.unitCostJpy * item.quantity)}
                                  </span>
                                </div>
                              ))}
                            </div>
                            {po.memo && (
                              <p className="mt-3 text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 border border-gray-100 dark:border-gray-600 rounded px-3 py-2">
                                💬 {po.memo}
                              </p>
                            )}
                          </div>
                          <div className="w-48 space-y-2 shrink-0">
                            <p className="text-xs text-gray-700 dark:text-gray-200 font-semibold uppercase tracking-wide">{t.common.status}</p>
                            <select
                              className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-xs text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                              value={po.status}
                              onChange={e => updateStatus(po.id, e.target.value)}
                              onClick={e => e.stopPropagation()}
                            >
                              {Object.keys(STATUS_STYLE).map(v => (
                                <option key={v} value={v}>{statusLabel(v)}</option>
                              ))}
                            </select>
                            <Link
                              href={`/purchase-orders/${po.id}`}
                              onClick={e => e.stopPropagation()}
                              className="flex items-center justify-center gap-1.5 w-full bg-slate-800 dark:bg-slate-600 text-white py-2 rounded-lg text-xs font-medium hover:bg-slate-700 dark:hover:bg-slate-500 transition-colors"
                            >
                              <Truck className="w-3.5 h-3.5" />
                              {t.purchaseOrders.receiveBtn}
                            </Link>

                            {/* 삭제 버튼 / 확인 다이얼로그 */}
                            {deleteConfirm === po.id ? (
                              <div
                                className="border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20 rounded-lg p-3 space-y-2"
                                onClick={e => e.stopPropagation()}
                              >
                                <p className="text-xs font-semibold text-red-700 dark:text-red-400">
                                  {t.purchaseOrders.deleteConfirm}
                                </p>
                                <p className="text-[10px] text-red-600 dark:text-red-400 leading-relaxed">
                                  {t.purchaseOrders.deleteConfirmSub}
                                </p>
                                {(po.status === 'received' || po.status === 'partial') && (
                                  <p className="text-[10px] text-orange-600 dark:text-orange-400 leading-relaxed">
                                    {t.purchaseOrders.deleteReceivedWarning}
                                  </p>
                                )}
                                <div className="flex gap-1.5">
                                  <button
                                    onClick={() => deletePO(po.id)}
                                    disabled={deleting === po.id}
                                    className="flex-1 bg-red-600 hover:bg-red-700 text-white py-1.5 rounded text-xs font-medium disabled:opacity-50 transition-colors"
                                  >
                                    {deleting === po.id ? t.common.deleting : t.purchaseOrders.deleteBtn}
                                  </button>
                                  <button
                                    onClick={() => setDeleteConfirm(null)}
                                    className="flex-1 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 py-1.5 rounded text-xs font-medium hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                                  >
                                    {t.common.cancel}
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <button
                                onClick={e => { e.stopPropagation(); setDeleteConfirm(po.id) }}
                                className="flex items-center justify-center gap-1.5 w-full border border-gray-200 dark:border-gray-600 text-gray-500 dark:text-gray-400 py-2 rounded-lg text-xs font-medium hover:border-red-300 hover:text-red-500 dark:hover:border-red-700 dark:hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                                {t.common.delete}
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>

        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <p className="text-xs text-gray-600 dark:text-gray-300 font-medium">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {total}{t.purchaseOrders.totalLabel}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                const p = totalPages <= 5 ? i + 1 : page <= 3 ? i + 1 : page >= totalPages - 2 ? totalPages - 4 + i : page - 2 + i
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${page === p ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                    {p}
                  </button>
                )
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
