'use client'

import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Truck, CheckCircle, Clock, Package,
  AlertCircle, Edit2, Save, X, Trash2, FileText, ClipboardCheck, Banknote
} from 'lucide-react'
import { formatJpy } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import DateInput from '@/components/DateInput'
import { useT } from '@/lib/i18n'

type StockLevel = { quantity: number; reservedQty: number; reorderPoint: number } | null
type POItem = {
  id: number; quantity: number; confirmedQty: number | null; receivedQty: number; unitCostJpy: number; memo: string
  product: { id: number; name: string; productCode: string; supplierCode: string; stockLevel: StockLevel; optionSize: string; optionColor: string }
}
type LinkedOrderItem = {
  id: number; quantity: number; procureStatus: string; optionMemo: string
  order:   { id: number; orderNo: string; orderDate: string; customer: { name: string; company: string } }
  product: { name: string; productCode: string }
}
type PurchaseOrder = {
  id: number; poNo: string; supplierCode: string; status: string
  orderDate: string; expectedDate?: string; receivedDate?: string
  totalCostJpy: number; memo: string
  confirmedDate?: string; supplierInvoiceNo: string
  confirmedForeign: number; confirmedCurrency: string; confirmedTotalJpy: number
  paymentStatus: string; paidAmountJpy: number; paidDate?: string
  supplier: { name: string; color: string; currency: string }
  items:      POItem[]
  orderItems: LinkedOrderItem[]
}

const STATUS_COLOR: Record<string, string> = {
  draft:    'bg-gray-100 text-gray-600',
  ordered:  'bg-blue-100 text-blue-700',
  confirmed:'bg-indigo-100 text-indigo-700',
  paid:     'bg-purple-100 text-purple-700',
  partial:  'bg-yellow-100 text-yellow-700',
  received: 'bg-green-100 text-green-700',
  cancelled:'bg-red-100 text-red-700',
}

export default function PurchaseOrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router  = useRouter()
  const t = useT()
  const [po, setPo]           = useState<PurchaseOrder | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [editingMemo, setEditingMemo] = useState(false)
  const [memo, setMemo]       = useState('')
  const [expectedDate, setExpectedDate] = useState('')
  const [receiveQty, setReceiveQty] = useState<Record<number, string>>({})
  const [deleteConfirm, setDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // 재고확인(제조사 청구서)
  const [confirmQty, setConfirmQty] = useState<Record<number, string>>({})
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('')
  const [confirmedForeign, setConfirmedForeign] = useState('')
  const [confirmedTotalJpy, setConfirmedTotalJpy] = useState('')
  const [confirming, setConfirming] = useState(false)
  // 매입 지급
  const [payDate, setPayDate] = useState('')
  const [paying, setPaying] = useState(false)

  const statusLabel = (s: string) => ({
    draft: t.purchaseOrders.statusDraft, ordered: t.purchaseOrders.statusOrdered,
    confirmed: t.purchaseOrders.statusConfirmed, paid: t.purchaseOrders.statusPaid,
    partial: t.purchaseOrders.statusPartial, received: t.purchaseOrders.statusReceived,
    cancelled: t.purchaseOrders.statusCancelled,
  } as Record<string,string>)[s] ?? s

  const procureLabel = (s: string) => ({
    needed:   t.purchaseOrders.detailProcureNeeded,
    ordered:  t.purchaseOrders.detailProcureOrdered,
    received: t.purchaseOrders.detailProcureReceived,
  } as Record<string,string>)[s] ?? s

  const procureColor = (s: string) => ({
    needed:   'bg-red-100 text-red-700',
    ordered:  'bg-blue-100 text-blue-700',
    received: 'bg-green-100 text-green-700',
  } as Record<string,string>)[s] ?? 'bg-gray-100 text-gray-600'

  const fetchPo = async () => {
    const res  = await fetch(`/api/purchase-orders/${id}`)
    const data = await res.json()
    setPo(data)
    setMemo(data.memo ?? '')
    setExpectedDate(data.expectedDate?.slice(0, 10) ?? '')
    setSupplierInvoiceNo(data.supplierInvoiceNo ?? '')
    setConfirmedForeign(data.confirmedForeign ? String(data.confirmedForeign) : '')
    setConfirmedTotalJpy(data.confirmedTotalJpy ? String(data.confirmedTotalJpy) : '')
    setLoading(false)
  }

  // 재고확인 저장 (제조사 청구서 수령 → 확정수량·청구액 입력)
  const handleConfirm = async () => {
    if (!po) return
    setConfirming(true)
    const confirmItems = po.items.map(item => ({
      itemId: item.id,
      confirmedQty: Number(confirmQty[item.id] ?? (item.confirmedQty ?? item.quantity)),
    }))
    // 확정 JPY 미입력 시 확정수량×단가 합계로 자동 계산
    const autoJpy = confirmItems.reduce((s, ci) => {
      const it = po.items.find(i => i.id === ci.itemId)
      return s + (it ? it.unitCostJpy * ci.confirmedQty : 0)
    }, 0)
    await fetch(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        confirmItems,
        supplierInvoiceNo,
        confirmedCurrency: po.supplier.currency,
        confirmedForeign: Number(confirmedForeign) || 0,
        confirmedTotalJpy: Number(confirmedTotalJpy) || autoJpy,
      }),
    })
    setConfirming(false)
    setConfirmQty({})
    fetchPo()
  }

  // 매입 지급(제조사 입금) 처리
  const handlePay = async () => {
    if (!po) return
    setPaying(true)
    const amount = po.confirmedTotalJpy || po.totalCostJpy
    await fetch(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pay: { paidAmountJpy: amount, paidDate: payDate || null } }),
    })
    setPaying(false)
    fetchPo()
  }

  useEffect(() => { fetchPo() }, []) // eslint-disable-line

  const handleReceive = async () => {
    if (!po) return
    setSaving(true)
    const receiveItems = po.items
      .map(item => ({ itemId: item.id, receivedQty: Number(receiveQty[item.id] ?? item.receivedQty) }))
      .filter(ri => ri.receivedQty > 0)
    await fetch(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiveItems }),
    })
    setSaving(false)
    setReceiveQty({})
    fetchPo()
  }

  const handleDelete = async () => {
    setDeleting(true)
    await fetch(`/api/purchase-orders/${id}`, { method: 'DELETE' })
    router.push('/purchase-orders')
  }

  const saveFields = async () => {
    if (!po) return
    await fetch(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memo, expectedDate: expectedDate || null }),
    })
    setEditingMemo(false)
    fetchPo()
  }

  const updateStatus = async (status: string) => {
    await fetch(`/api/purchase-orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchPo()
  }

  if (loading || !po) {
    return (
      <div className="p-6 flex items-center justify-center h-64 text-gray-400">
        {loading ? t.purchaseOrders.detailLoading : t.purchaseOrders.detailNotFound}
      </div>
    )
  }

  const target = (i: POItem) => i.confirmedQty ?? i.quantity
  const allDone  = po.items.every(i => i.receivedQty >= target(i))
  const overdue  = po.expectedDate && new Date(po.expectedDate) < new Date() && po.status !== 'received' && po.status !== 'cancelled'
  const totalReceived = po.items.reduce((s, i) => s + i.receivedQty * i.unitCostJpy, 0)

  // 매입 진행 단계 (발주 → 재고확인 → 매입지급 → 입고)
  const isCancelled = po.status === 'cancelled'
  const stepOrdered   = ['ordered', 'confirmed', 'paid', 'partial', 'received'].includes(po.status)
  const stepConfirmed = !!po.confirmedDate || ['confirmed', 'paid', 'partial', 'received'].includes(po.status)
  const stepPaid      = po.paymentStatus === 'paid' || ['paid', 'partial', 'received'].includes(po.status)
  const stepReceived  = po.status === 'received'
  const steps = [
    { label: t.purchaseOrders.stepOrdered, done: stepOrdered },
    { label: t.purchaseOrders.stepConfirmed, done: stepConfirmed },
    { label: t.purchaseOrders.stepPaid, done: stepPaid },
    { label: t.purchaseOrders.stepReceived, done: stepReceived },
  ]
  const canConfirm = !isCancelled && (po.status === 'ordered' || po.status === 'confirmed')
  const canReceive = !isCancelled && stepConfirmed && !allDone
  const confirmedTotalForView = po.confirmedTotalJpy || po.totalCostJpy
  const fmtCur = (v: number, cur: string) => `${cur === 'JPY' || !cur ? '¥' : '$'}${v.toLocaleString()}`

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{po.poNo}</h1>
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium ${STATUS_COLOR[po.status] ?? STATUS_COLOR.draft}`}>
              {statusLabel(po.status)}
            </span>
            {overdue && (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-orange-100 text-orange-600">
                <AlertCircle className="w-3 h-3" />{t.purchaseOrders.detailDelay}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1">
            <SupplierBadge code={po.supplierCode} />
            <span className="text-gray-400 text-sm">
              {t.purchaseOrders.detailOrderDateLabel}: {new Date(po.orderDate).toLocaleDateString('ja-JP')}
            </span>
          </div>
        </div>
        {/* 발주서 발급 (일/한/영 양식 전환 가능) */}
        <a
          href={`/documents/po/${po.id}?lang=ja`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 bg-slate-800 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-slate-700 transition-colors"
        >
          <FileText className="w-4 h-4" /> {t.purchaseOrders.docPo}
        </a>

        <select
          value={po.status}
          onChange={e => updateStatus(e.target.value)}
          className="border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-700 dark:text-gray-200 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          {Object.keys(STATUS_COLOR).map(v => (
            <option key={v} value={v}>{statusLabel(v)}</option>
          ))}
        </select>

        {/* 삭제 버튼 */}
        {deleteConfirm ? (
          <div className="flex items-center gap-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg px-3 py-2">
            <span className="text-xs text-red-700 dark:text-red-400 font-medium whitespace-nowrap">
              {t.purchaseOrders.deleteConfirm}
            </span>
            <button
              onClick={handleDelete}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-xs font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
            >
              {deleting ? t.common.deleting : t.purchaseOrders.deleteBtn}
            </button>
            <button
              onClick={() => setDeleteConfirm(false)}
              className="text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 p-1 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            onClick={() => setDeleteConfirm(true)}
            className="p-2 text-gray-400 hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            title={t.purchaseOrders.deleteBtn}
          >
            <Trash2 className="w-5 h-5" />
          </button>
        )}
      </div>

      {/* 매입 진행 단계 스텝퍼 */}
      {!isCancelled && (
        <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4">
          <div className="flex items-center">
            {steps.map((st, i) => (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className="flex items-center gap-2">
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${st.done ? 'bg-green-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-400'}`}>
                    {st.done ? <CheckCircle className="w-4 h-4" /> : i + 1}
                  </div>
                  <span className={`text-sm font-medium whitespace-nowrap ${st.done ? 'text-gray-900 dark:text-gray-100' : 'text-gray-400'}`}>{st.label}</span>
                </div>
                {i < steps.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-3 ${steps[i + 1].done ? 'bg-green-500' : 'bg-gray-200 dark:bg-gray-700'}`} />
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 입고/부분입고 경고 */}
      {deleteConfirm && (po.status === 'received' || po.status === 'partial') && (
        <div className="mb-4 px-4 py-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg text-xs text-orange-700 dark:text-orange-400">
          {t.purchaseOrders.deleteReceivedWarning}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Package className="w-4 h-4 text-gray-400" />
                {t.purchaseOrders.detailItemsHeader} ({po.items.length}{t.common.cases})
              </h2>
              {canReceive && (
                <button
                  onClick={handleReceive}
                  disabled={saving}
                  className="flex items-center gap-1.5 bg-green-600 text-white px-4 py-1.5 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
                >
                  <Truck className="w-3.5 h-3.5" />
                  {saving ? t.common.processing : t.purchaseOrders.detailReceiveBtn}
                </button>
              )}
              {allDone && (
                <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />{t.purchaseOrders.detailAllDone}
                </span>
              )}
            </div>

            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                  <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{t.purchaseOrders.detailColProduct}</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-20">{t.purchaseOrders.detailColOrdered}</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-24">{t.purchaseOrders.detailColConfirmed}</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-28">{t.purchaseOrders.detailColReceived}</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-28">{t.purchaseOrders.detailColStock}</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-28">{t.purchaseOrders.detailColSubtotal}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                {po.items.map(item => {
                  const stock    = item.product.stockLevel
                  const tgt      = item.confirmedQty ?? item.quantity
                  const done     = item.receivedQty >= tgt
                  const inputVal = receiveQty[item.id] ?? String(item.receivedQty)
                  const cVal     = confirmQty[item.id] ?? (item.confirmedQty != null ? String(item.confirmedQty) : String(item.quantity))
                  const soldOut  = item.confirmedQty === 0
                  return (
                    <tr key={item.id} className={soldOut ? 'bg-red-50/40 dark:bg-red-900/10' : done && item.receivedQty > 0 ? 'bg-green-50/30 dark:bg-green-900/10' : ''}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{item.product.name}</p>
                        <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                          <p className="text-xs text-gray-400">{item.product.productCode}</p>
                          {item.product.optionSize && <span className="text-xs px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium">{item.product.optionSize}</span>}
                          {item.product.optionColor && <span className="text-xs px-1 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 font-medium">{item.product.optionColor}</span>}
                          {soldOut && <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-300 font-semibold">{t.purchaseOrders.soldOut}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-gray-500 dark:text-gray-400">{item.quantity}</td>
                      <td className="px-4 py-3 text-center">
                        {canConfirm ? (
                          <input
                            type="number" min="0" max={item.quantity}
                            className="w-16 text-center border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            value={cVal}
                            onChange={e => setConfirmQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        ) : item.confirmedQty != null ? (
                          <span className={`font-medium ${soldOut ? 'text-red-500' : 'text-indigo-600 dark:text-indigo-300'}`}>{item.confirmedQty}</span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {soldOut ? (
                          <span className="text-gray-300">—</span>
                        ) : done && item.receivedQty > 0 ? (
                          <span className="flex items-center justify-center gap-1 text-green-600 font-medium">
                            <CheckCircle className="w-3.5 h-3.5" />{item.receivedQty}
                          </span>
                        ) : canReceive ? (
                          <input
                            type="number" min="0" max={tgt}
                            className="w-20 text-center border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            value={inputVal}
                            onChange={e => setReceiveQty(prev => ({ ...prev, [item.id]: e.target.value }))}
                          />
                        ) : (
                          <span className="text-gray-400">{item.receivedQty}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {stock ? (
                          <span className={`font-medium tabular-nums ${stock.quantity <= stock.reorderPoint && stock.reorderPoint > 0 ? 'text-orange-500' : 'text-gray-700 dark:text-gray-200'}`}>
                            {stock.quantity}
                            {stock.reorderPoint > 0 && stock.quantity <= stock.reorderPoint && (
                              <AlertCircle className="w-3 h-3 inline ml-1 text-orange-400" />
                            )}
                          </span>
                        ) : (
                          <span className="text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-200 tabular-nums">
                        {formatJpy(item.unitCostJpy * item.quantity)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700">
                  <td colSpan={5} className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">{t.purchaseOrders.detailReceivedTotal}</td>
                  <td className="px-4 py-3 text-right font-bold text-green-700 tabular-nums">{formatJpy(totalReceived)}</td>
                </tr>
                <tr className="bg-gray-50 dark:bg-gray-700/50">
                  <td colSpan={5} className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">{t.purchaseOrders.detailTotalCost}</td>
                  <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100 tabular-nums">{formatJpy(po.totalCostJpy)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        <div className="space-y-4">
          {/* 재고확인 (제조사 청구서 수령) */}
          {!isCancelled && (canConfirm || stepConfirmed) && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-2">
                <ClipboardCheck className="w-4 h-4 text-indigo-500" />{t.purchaseOrders.confirmTitle}
              </h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.purchaseOrders.confirmDesc}</p>
              <div>
                <label className="text-xs text-gray-400 mb-1 block">{t.purchaseOrders.supplierInvoiceNo}</label>
                <input
                  type="text" value={supplierInvoiceNo} onChange={e => setSupplierInvoiceNo(e.target.value)}
                  disabled={!canConfirm}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="INV-..."
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{t.purchaseOrders.confirmedForeign} ({po.supplier.currency})</label>
                  <input
                    type="number" value={confirmedForeign} onChange={e => setConfirmedForeign(e.target.value)}
                    disabled={!canConfirm}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">{t.purchaseOrders.confirmedJpy} (¥)</label>
                  <input
                    type="number" value={confirmedTotalJpy} onChange={e => setConfirmedTotalJpy(e.target.value)}
                    disabled={!canConfirm}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 disabled:opacity-60 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    placeholder={t.purchaseOrders.confirmedAuto}
                  />
                </div>
              </div>
              {canConfirm ? (
                <button
                  onClick={handleConfirm} disabled={confirming}
                  className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                >
                  <ClipboardCheck className="w-4 h-4" />{confirming ? t.common.processing : t.purchaseOrders.confirmBtn}
                </button>
              ) : (
                <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                  <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                  {t.purchaseOrders.confirmedOn} {po.confirmedDate ? new Date(po.confirmedDate).toLocaleDateString('ja-JP') : ''}
                </div>
              )}
            </div>
          )}

          {/* 매입 지급 (제조사 입금) */}
          {!isCancelled && stepConfirmed && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 space-y-3">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm flex items-center gap-2">
                <Banknote className="w-4 h-4 text-purple-500" />{t.purchaseOrders.payTitle}
              </h3>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">{t.purchaseOrders.payAmount}</span>
                <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{formatJpy(confirmedTotalForView)}</span>
              </div>
              {po.confirmedForeign > 0 && (
                <div className="flex justify-between text-xs text-gray-400">
                  <span>{po.supplier.currency}</span>
                  <span className="tabular-nums">{fmtCur(po.confirmedForeign, po.supplier.currency)}</span>
                </div>
              )}
              {po.paymentStatus === 'paid' ? (
                <div className="bg-purple-50 dark:bg-purple-900/20 rounded-lg p-3 text-sm">
                  <p className="flex items-center gap-1.5 text-purple-700 dark:text-purple-300 font-medium">
                    <CheckCircle className="w-4 h-4" />{t.purchaseOrders.paidLabel}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {po.paidDate ? new Date(po.paidDate).toLocaleDateString('ja-JP') : ''} · {formatJpy(po.paidAmountJpy)}
                  </p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="text-xs text-gray-400 mb-1 block">{t.purchaseOrders.payDate}</label>
                    <DateInput value={payDate} onChange={setPayDate} />
                  </div>
                  <button
                    onClick={handlePay} disabled={paying}
                    className="w-full flex items-center justify-center gap-1.5 bg-purple-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-purple-700 disabled:opacity-50 transition-colors"
                  >
                    <Banknote className="w-4 h-4" />{paying ? t.common.processing : t.purchaseOrders.payBtn}
                  </button>
                </>
              )}
            </div>
          )}

          {/* 일정 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 space-y-4">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{t.purchaseOrders.detailSchedule}</h3>
            <div className="space-y-3">
              <div>
                <p className="text-xs text-gray-400 mb-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />{t.purchaseOrders.detailOrderDateLabel}
                </p>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-200">
                  {new Date(po.orderDate).toLocaleDateString('ja-JP')}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">{t.purchaseOrders.detailExpectedDate}</p>
                {editingMemo ? (
                  <DateInput
                    value={expectedDate}
                    onChange={setExpectedDate}
                    className="mt-0.5"
                  />
                ) : (
                  <p className={`text-sm font-medium ${overdue ? 'text-orange-500' : 'text-gray-700 dark:text-gray-200'}`}>
                    {po.expectedDate ? new Date(po.expectedDate).toLocaleDateString('ja-JP') : '—'}
                  </p>
                )}
              </div>
              {po.receivedDate && (
                <div>
                  <p className="text-xs text-gray-400 mb-1">{t.purchaseOrders.detailActualDate}</p>
                  <p className="text-sm font-medium text-green-600">
                    {new Date(po.receivedDate).toLocaleDateString('ja-JP')}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* 메모 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{t.purchaseOrders.detailMemo}</h3>
              {editingMemo ? (
                <div className="flex gap-1">
                  <button onClick={saveFields} className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                    <Save className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { setEditingMemo(false); setMemo(po.memo) }} className="p-1 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button onClick={() => setEditingMemo(true)} className="p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
            {editingMemo ? (
              <textarea
                className="w-full border border-gray-200 dark:border-gray-600 rounded px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                rows={4}
                value={memo}
                onChange={e => setMemo(e.target.value)}
              />
            ) : (
              <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-wrap min-h-8">
                {po.memo || <span className="text-gray-400">{t.purchaseOrders.detailNoMemo}</span>}
              </p>
            )}
          </div>

          {/* 연결된 주문 */}
          {po.orderItems.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-3 flex items-center gap-1.5">
                <span>{t.purchaseOrders.detailLinkedOrders}</span>
                <span className="text-xs text-gray-400 font-normal">({po.orderItems.length}{t.common.cases})</span>
              </h3>
              <div className="space-y-2.5">
                {po.orderItems.map(oi => (
                  <div key={oi.id} className="border border-gray-100 dark:border-gray-700 rounded-lg p-2.5">
                    <div className="flex items-start justify-between gap-1">
                      <Link href={`/orders?q=${oi.order.orderNo}`} className="text-xs font-medium text-blue-600 hover:underline">
                        {oi.order.orderNo}
                      </Link>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${procureColor(oi.procureStatus)}`}>
                        {procureLabel(oi.procureStatus)}
                      </span>
                    </div>
                    <p className="text-xs text-gray-700 dark:text-gray-200 mt-1 font-medium">{oi.order.customer.name}</p>
                    <p className="text-xs text-gray-400 truncate">{oi.product.name}</p>
                    {oi.optionMemo && (
                      <p className="text-xs mt-0.5">
                        <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium border border-amber-200 dark:border-amber-700/50">
                          {oi.optionMemo}
                        </span>
                      </p>
                    )}
                    <p className="text-xs text-gray-400">{t.purchaseOrders.detailQtyLabel}: {oi.quantity}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 바로가기 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-3">{t.purchaseOrders.detailQuickLinks}</h3>
            <div className="space-y-2">
              <a href={`/purchase-orders?supplier=${po.supplierCode}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <SupplierBadge code={po.supplierCode} />
                <span>{po.supplier.name} {t.purchaseOrders.detailAllPOs}</span>
              </a>
              <a href={`/products?supplier=${po.supplierCode}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                <Package className="w-3.5 h-3.5" />
                {po.supplier.name} {t.purchaseOrders.detailProductList}
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
