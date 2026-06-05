'use client'

import React, { useState, useEffect, useCallback } from 'react'
import {
  ShoppingCart, Plus, FileText, Truck, CreditCard, Search,
  Download, ChevronLeft, ChevronRight, CheckCircle2, Circle,
  Package, Banknote, ClipboardList, MapPin, CheckCheck, Trash2, Pencil,
  Image as ImageIcon
} from 'lucide-react'
import { formatJpy, calcProfitRate, formatNumber } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import DateInput from '@/components/DateInput'
import { useT } from '@/lib/i18n'

const PAGE_SIZE = 30

type Order = {
  id: number; orderNo: string; orderDate: string; status: string; paymentStatus: string
  totalAmountJpy: number; totalCostJpy: number; paidAmountJpy: number
  dueDate?: string; delayNotifyDate?: string; shippingDate?: string
  deliveryDate?: string; completedAt?: string; trackingNo: string; memo: string
  customer: { id: number; name: string; company: string }
  items: {
    id: number; quantity: number; salePriceJpy: number; costPriceJpy: number
    procureStatus: string
    product: { name: string; supplierCode: string; supplier: { name: string }; optionSize: string; optionColor: string }
    optionMemo: string
    catalogImage?: string
  }[]
}

const STEP_ICONS = [ShoppingCart, Banknote, ClipboardList, Package, Truck, MapPin]

// 카탈로그 상품 썸네일 (이미지 없거나 로딩 실패 시 플레이스홀더)
function Thumb({ src, size = 32 }: { src?: string; size?: number }) {
  const [err, setErr] = useState(false)
  const px = `${size}px`
  if (!src || err) {
    return (
      <div
        className="flex-shrink-0 flex items-center justify-center rounded bg-gray-100 dark:bg-gray-700 text-gray-300 dark:text-gray-500"
        style={{ width: px, height: px }}
      >
        <ImageIcon className="w-1/2 h-1/2" />
      </div>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src} alt="" loading="lazy" onError={() => setErr(true)}
      className="flex-shrink-0 rounded object-cover bg-white border border-gray-100 dark:border-gray-700"
      style={{ width: px, height: px }}
    />
  )
}

function getStepDone(order: Order): boolean[] {
  const allReceived = order.items.length > 0
    ? order.items.every(i => i.procureStatus === 'received')
    : false
  const anyOrdered = order.items.some(i => i.procureStatus === 'ordered' || i.procureStatus === 'received')

  return [
    true,                                                        // 주문접수: 항상 완료
    order.paymentStatus === 'paid',                              // 입금
    anyOrdered || allReceived,                                   // 발주
    allReceived,                                                 // 입고
    ['shipped', 'delivered'].includes(order.status),             // 발송
    order.status === 'delivered' || !!order.completedAt,         // 배송완료
  ]
}

function getCurrentStep(done: boolean[]): number {
  let cur = 0
  for (let i = 0; i < done.length; i++) if (done[i]) cur = i
  return cur
}

// ── 상태 레이블 ───────────────────────────────────────

// ── 컴포넌트 ─────────────────────────────────────────
export default function OrdersPage() {
  const t = useT()

  const STEPS = [
    { key: 'order',    label: t.orders.stepOrder,    icon: STEP_ICONS[0] },
    { key: 'paid',     label: t.orders.stepPaid,     icon: STEP_ICONS[1] },
    { key: 'po',       label: t.orders.stepPo,       icon: STEP_ICONS[2] },
    { key: 'received', label: t.orders.stepReceived, icon: STEP_ICONS[3] },
    { key: 'shipped',  label: t.orders.stepShipped,  icon: STEP_ICONS[4] },
    { key: 'done',     label: t.orders.stepDone,     icon: STEP_ICONS[5] },
  ]

  const STATUS_LABELS_T: Record<string, { label: string; color: string }> = {
    pending:   { label: t.orders.statusPending,   color: 'bg-gray-100 text-gray-600' },
    confirmed: { label: t.orders.statusConfirmed, color: 'bg-blue-100 text-blue-700' },
    shipped:   { label: t.orders.statusShipped,   color: 'bg-yellow-100 text-yellow-700' },
    delivered: { label: t.orders.statusDelivered, color: 'bg-green-100 text-green-700' },
    cancelled: { label: t.common.cancel,          color: 'bg-red-100 text-red-700' },
  }
  const PAY_LABELS_T: Record<string, { label: string; color: string }> = {
    unpaid:  { label: t.orders.payUnpaid,  color: 'bg-red-100 text-red-700' },
    partial: { label: t.orders.payPartial, color: 'bg-yellow-100 text-yellow-700' },
    paid:    { label: t.orders.payPaid,    color: 'bg-green-100 text-green-700' },
  }

  const [orders, setOrders]   = useState<Order[]>([])
  const [total, setTotal]     = useState(0)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]         = useState<'active' | 'done'>('active')   // 진행중 / 완료
  const [statusFilter, setStatusFilter]   = useState('')
  const [payFilter, setPayFilter]         = useState('')
  const [searchQ, setSearchQ]             = useState('')
  const [page, setPage]       = useState(1)
  const [expanded, setExpanded] = useState<number | null>(null)
  const [shipInfo, setShipInfo] = useState<Record<number, { date: string; trackingNo: string }>>({})
  const [partialPayInputs, setPartialPayInputs] = useState<Record<number, string>>({})
  const [delayInputs, setDelayInputs] = useState<Record<number, string>>({})
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)   // 삭제 확인 중인 주문 id
  const [deleting, setDeleting] = useState<number | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('q') ?? ''
      if (q) setSearchQ(q)
    }
  }, [])

  const fetchOrders = useCallback(async (currentPage = 1) => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusFilter) params.set('status', statusFilter)
    if (payFilter)    params.set('paymentStatus', payFilter)
    if (searchQ)      params.set('q', searchQ)
    params.set('completed', tab === 'done' ? '1' : '0')
    params.set('limit', String(PAGE_SIZE))
    params.set('page',  String(currentPage))
    const res  = await fetch(`/api/orders?${params}`)
    const data = await res.json()
    setOrders(data.orders)
    setTotal(data.total)
    setLoading(false)
  }, [statusFilter, payFilter, searchQ, tab])

  useEffect(() => { setPage(1); fetchOrders(1) }, [statusFilter, payFilter, searchQ, tab]) // eslint-disable-line
  useEffect(() => { fetchOrders(page) }, [page]) // eslint-disable-line

  const updateStatus = async (id: number, field: string, value: string) => {
    const body: Record<string, string | number> = { [field]: value }
    if (field === 'paymentStatus' && value === 'paid') {
      const order = orders.find(o => o.id === id)
      if (order) body.paidAmountJpy = order.totalAmountJpy
    }
    if (field === 'paymentStatus' && value === 'unpaid') body.paidAmountJpy = 0
    if (field === 'status' && value === 'delivered')     body.deliveryDate  = new Date().toISOString()
    await fetch(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    fetchOrders(page)
  }

  const savePartialPay = async (order: Order) => {
    const input = partialPayInputs[order.id]
    if (!input) return
    const amount    = Number(input)
    if (!amount || amount <= 0) return
    const newPaid   = Math.min(order.paidAmountJpy + amount, order.totalAmountJpy)
    const newStatus = newPaid >= order.totalAmountJpy ? 'paid' : 'partial'
    await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paidAmountJpy: newPaid, paymentStatus: newStatus, paymentDate: new Date().toISOString() }),
    })
    setPartialPayInputs(prev => { const n = { ...prev }; delete n[order.id]; return n })
    fetchOrders(page)
  }

  const saveShipInfo = async (id: number) => {
    const info = shipInfo[id]
    if (!info) return
    const body: Record<string, string> = {}
    if (info.date)                       body.shippingDate = info.date
    if (info.trackingNo !== undefined)   body.trackingNo   = info.trackingNo
    if (Object.keys(body).length === 0)  return
    await fetch(`/api/orders/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, status: 'shipped' }),
    })
    fetchOrders(page)
  }

  const handleDelete = async (id: number) => {
    setDeleting(id)
    await fetch(`/api/orders/${id}`, { method: 'DELETE' })
    setDeleting(null)
    setDeleteConfirm(null)
    setExpanded(null)
    fetchOrders(page)
  }

  // 탭별 카운트용
  const [activeCount, setActiveCount] = useState(0)
  const [doneCount,   setDoneCount]   = useState(0)
  useEffect(() => {
    Promise.all([
      fetch('/api/orders?completed=0&limit=1').then(r => r.json()),
      fetch('/api/orders?completed=1&limit=1').then(r => r.json()),
    ]).then(([a, d]) => {
      setActiveCount(a.total ?? 0)
      setDoneCount(d.total ?? 0)
    })
  }, [orders]) // orders 변경 시 탭 카운트 갱신

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.orders.title}</h1>
          <p className="text-gray-600 font-medium text-sm mt-1">{t.common.total} {total}{t.common.cases}</p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href={`/api/orders?format=csv&completed=${tab === 'done' ? '1' : '0'}${statusFilter ? `&status=${statusFilter}` : ''}${payFilter ? `&paymentStatus=${payFilter}` : ''}${searchQ ? `&q=${encodeURIComponent(searchQ)}` : ''}`}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> CSV
          </a>
          <a href="/orders/new" className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" /> {t.orders.newOrder}
          </a>
        </div>
      </div>

      {/* 진행중 / 완료 탭 */}
      <div className="flex gap-1 mb-4">
        <button
          onClick={() => { setTab('active'); setPage(1) }}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'active' ? 'bg-blue-600 text-white shadow-sm' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'}`}
        >
          {t.orders.tabActive}
          <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold ${tab === 'active' ? 'bg-blue-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
            {activeCount}
          </span>
        </button>
        <button
          onClick={() => { setTab('done'); setPage(1) }}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold transition-colors ${tab === 'done' ? 'bg-green-600 text-white shadow-sm' : 'bg-white dark:bg-gray-800 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'}`}
        >
          <CheckCheck className="w-3.5 h-3.5 inline mr-1.5" />
          {t.orders.tabDone}
          <span className={`ml-2 px-1.5 py-0.5 rounded-full text-xs font-bold ${tab === 'done' ? 'bg-green-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400'}`}>
            {doneCount}
          </span>
        </button>
      </div>

      {/* 검색 & 필터 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4 flex gap-3 items-center flex-wrap">
        <div className="relative min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="pl-9 pr-4 py-1.5 border border-gray-200 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
            placeholder={t.orders.searchPlaceholder}
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
        </div>
        {tab === 'active' && (
          <>
            <div className="w-px h-5 bg-gray-200" />
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-600 font-medium">{t.common.status}:</span>
              {['', ...Object.keys(STATUS_LABELS_T)].map(s => (
                <button key={s || 'all'} onClick={() => setStatusFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${statusFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {s ? STATUS_LABELS_T[s].label : t.common.all}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-gray-200" />
            <div className="flex gap-2 items-center">
              <span className="text-xs text-gray-600 font-medium">{t.payments.colPaid}:</span>
              {['', ...Object.keys(PAY_LABELS_T)].map(s => (
                <button key={s || 'all'} onClick={() => setPayFilter(s)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${payFilter === s ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {s ? PAY_LABELS_T[s].label : t.common.all}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-600">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.orders.colOrderNo}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.orders.colCustomer}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.orders.colDate}</th>
              <th className="text-center px-2 py-3 font-semibold text-gray-700 dark:text-gray-200" colSpan={6}>
                <span className="text-xs">{t.orders.stepHeader}</span>
              </th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.orders.colAmount}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.orders.colMarginPct}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              <tr><td colSpan={12} className="text-center py-16 text-gray-400">{t.common.loading}</td></tr>
            ) : orders.length === 0 ? (
              <tr><td colSpan={12} className="text-center py-16 text-gray-400">
                <ShoppingCart className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>{t.orders.noOrders}</p>
              </td></tr>
            ) : orders.map(order => {
              const { margin }   = calcProfitRate(order.totalAmountJpy, order.totalCostJpy)
              const unpaid       = order.totalAmountJpy - order.paidAmountJpy
              const stepDone     = getStepDone(order)
              const currentStep  = getCurrentStep(stepDone)
              const isComplete   = !!order.completedAt
              const suppliers    = [...new Set(order.items.map(i => i.product.supplierCode))]

              return (
                <React.Fragment key={order.id}>
                  <tr
                    className={`hover:bg-gray-50/80 dark:hover:bg-gray-700/50 cursor-pointer transition-colors ${isComplete ? 'opacity-70' : ''}`}
                    onClick={() => setExpanded(expanded === order.id ? null : order.id)}
                  >
                    {/* 주문번호 */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{order.orderNo}</p>
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {suppliers.map(s => <SupplierBadge key={s} code={s} />)}
                      </div>
                    </td>
                    {/* 거래처 */}
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-gray-100">{order.customer.name}</p>
                      <p className="text-gray-500 text-xs">{order.customer.company}</p>
                    </td>
                    {/* 날짜 */}
                    <td className="px-4 py-3 text-gray-600 font-medium text-xs whitespace-nowrap">
                      <p>{new Date(order.orderDate).toLocaleDateString('ja-JP')}</p>
                      {isComplete && order.completedAt && (
                        <p className="text-green-600 font-medium">
                          {t.orders.completedOn} {new Date(order.completedAt).toLocaleDateString('ja-JP')}
                        </p>
                      )}
                    </td>

                    {/* 6단계 진행 아이콘 */}
                    {STEPS.map((step, idx) => {
                      const done    = stepDone[idx]
                      const current = idx === currentStep && !isComplete
                      const Icon    = step.icon
                      return (
                        <td key={step.key} className="px-1 py-3 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                              done && isComplete   ? 'bg-green-500 text-white' :
                              done                 ? 'bg-blue-500 text-white' :
                              current              ? 'bg-blue-100 text-blue-500 ring-2 ring-blue-300' :
                              'bg-gray-100 text-gray-300'
                            }`}>
                              {done
                                ? <CheckCircle2 className="w-3.5 h-3.5" />
                                : <Icon className="w-3 h-3" />
                              }
                            </div>
                            <span className={`text-[10px] leading-none ${
                              done && isComplete ? 'text-green-600 font-medium' :
                              done               ? 'text-blue-500 font-medium' :
                              current            ? 'text-blue-400' :
                              'text-gray-400'
                            }`}>{step.label}</span>
                          </div>
                        </td>
                      )
                    })}

                    {/* 금액 */}
                    <td className="px-4 py-3 text-right font-medium text-gray-900 tabular-nums">
                      {formatJpy(order.totalAmountJpy)}
                      {unpaid > 0 && (
                        <p className="text-red-500 text-xs">{t.orders.unpaidAmount} {formatJpy(unpaid)}</p>
                      )}
                    </td>
                    {/* 마진 + 액션 */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-3">
                        <span className={`font-semibold ${margin >= 40 ? 'text-green-600' : margin >= 25 ? 'text-yellow-600' : 'text-red-600'}`}>
                          {margin.toFixed(1)}%
                        </span>
                        <a
                          href={`/orders/new?edit=${order.id}`}
                          onClick={e => e.stopPropagation()}
                          title={t.common.edit}
                          className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </a>
                        <button
                          onClick={e => { e.stopPropagation(); setExpanded(order.id); setDeleteConfirm(order.id) }}
                          title={t.orders.deleteBtn}
                          className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>

                  {/* 확장 패널 */}
                  {expanded === order.id && (
                    <tr className="bg-blue-50/20 dark:bg-blue-900/10">
                      <td colSpan={12} className="px-8 py-4">
                        <div className="flex gap-6">
                          {/* 품목 */}
                          <div className="flex-1">
                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">{t.orders.expandedItems}</p>
                            <div className="space-y-1">
                              {order.items.map(item => (
                                <div key={item.id} className="flex items-center justify-between text-sm">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <Thumb src={item.catalogImage} size={32} />
                                    <SupplierBadge code={item.product.supplierCode} />
                                    <span className="text-gray-700 dark:text-gray-300">{item.product.name}</span>
                                    {item.optionMemo && (
                                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium border border-amber-200 dark:border-amber-700/50">
                                        {item.optionMemo}
                                      </span>
                                    )}
                                    <span className="text-gray-500">×{item.quantity}</span>
                                    {/* 조달 상태 */}
                                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                                      item.procureStatus === 'received' ? 'bg-green-100 text-green-700' :
                                      item.procureStatus === 'ordered'  ? 'bg-blue-100 text-blue-700' :
                                      'bg-red-100 text-red-600'
                                    }`}>
                                      {item.procureStatus === 'received' ? t.orders.procureReceived :
                                       item.procureStatus === 'ordered'  ? t.orders.procureOrdered : t.orders.procureNeeded}
                                    </span>
                                  </div>
                                  <span className="font-medium text-gray-900">{formatJpy(item.salePriceJpy * item.quantity)}</span>
                                </div>
                              ))}
                            </div>
                          </div>

                          {/* 액션 패널 */}
                          <div className="w-56 space-y-2 text-sm shrink-0 text-gray-900 dark:text-gray-100">

                            {/* 입금 */}
                            <div>
                              <p className="text-xs text-gray-600 font-medium mb-1 flex items-center gap-1">
                                <CreditCard className="w-3 h-3" /> {t.orders.paymentStatusLabel}
                              </p>
                              <select
                                className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
                                value={order.paymentStatus}
                                onChange={e => updateStatus(order.id, 'paymentStatus', e.target.value)}
                              >
                                {Object.entries(PAY_LABELS_T).map(([v, l]) => <option key={v} value={v}>{l.label}</option>)}
                              </select>
                              {order.paymentStatus !== 'paid' && (
                                <div className="mt-1.5 flex gap-1">
                                  <input
                                    type="number"
                                    className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs text-gray-900 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    placeholder={`잔액 ¥${(order.totalAmountJpy - order.paidAmountJpy).toLocaleString()}`}
                                    value={partialPayInputs[order.id] ?? ''}
                                    onChange={e => setPartialPayInputs(p => ({ ...p, [order.id]: e.target.value }))}
                                  />
                                  <button onClick={() => savePartialPay(order)}
                                    className="px-2 bg-green-600 text-white rounded text-xs hover:bg-green-700">{t.orders.paymentRecord}</button>
                                </div>
                              )}
                            </div>

                            {/* 주문 상태 */}
                            <div>
                              <p className="text-xs text-gray-600 font-medium mb-1">{t.orders.orderStatusLabel}</p>
                              <select
                                className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
                                value={order.status}
                                onChange={e => updateStatus(order.id, 'status', e.target.value)}
                              >
                                {Object.entries(STATUS_LABELS_T).map(([v, l]) => <option key={v} value={v}>{l.label}</option>)}
                              </select>
                            </div>

                            {/* 발송 */}
                            <div className="pt-1 border-t border-gray-100">
                              <p className="text-xs text-gray-600 font-medium mb-1.5 flex items-center gap-1">
                                <Truck className="w-3 h-3" /> {t.orders.shipProcess}
                              </p>
                              {/* 입고 진행 — 입고된 품목만 부분발송 가능 */}
                              {(() => {
                                const recv = order.items.filter(i => i.procureStatus === 'received').length
                                const totalItems = order.items.length
                                const partial = recv > 0 && recv < totalItems
                                return (
                                  <div className={`mb-1.5 px-2 py-1 rounded text-xs font-medium flex items-center justify-between ${recv === 0 ? 'bg-gray-50 dark:bg-gray-700/50 text-gray-500' : partial ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300' : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'}`}>
                                    <span>{t.orders.shipReceived} {recv}/{totalItems}</span>
                                    {partial && <span>{t.orders.partialShip}</span>}
                                    {recv === totalItems && recv > 0 && <CheckCircle2 className="w-3.5 h-3.5" />}
                                  </div>
                                )
                              })()}
                              {order.shippingDate && (
                                <p className="text-xs text-blue-600 mb-1">
                                  {t.orders.shippedOn}: {new Date(order.shippingDate).toLocaleDateString('ja-JP')}
                                  {order.trackingNo && <span className="text-gray-400 ml-1">({order.trackingNo})</span>}
                                </p>
                              )}
                              <DateInput
                                size="sm"
                                className="mb-1"
                                value={shipInfo[order.id]?.date ?? order.shippingDate?.slice(0, 10) ?? ''}
                                onChange={v => setShipInfo(prev => ({ ...prev, [order.id]: { ...prev[order.id], date: v } }))}
                              />
                              <input type="text"
                                className="w-full border border-gray-200 rounded px-2 py-1 text-xs mb-1.5"
                                placeholder={t.orders.trackingNoPlaceholder}
                                defaultValue={order.trackingNo}
                                onChange={e => setShipInfo(prev => ({ ...prev, [order.id]: { ...prev[order.id], trackingNo: e.target.value } }))}
                              />
                              <button onClick={() => saveShipInfo(order.id)}
                                disabled={!order.items.some(i => i.procureStatus === 'received')}
                                className="w-full bg-yellow-500 hover:bg-yellow-600 text-white py-1.5 rounded text-xs font-medium flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed">
                                <Truck className="w-3 h-3" />
                                {order.items.filter(i => i.procureStatus === 'received').length < order.items.length && order.items.some(i => i.procureStatus === 'received')
                                  ? t.orders.partialShipBtn : t.orders.shipProcess}
                              </button>
                            </div>

                            {/* 배송완료 → 완료 처리 */}
                            <div className="pt-1 border-t border-gray-100">
                              <p className="text-xs text-gray-600 font-medium mb-1.5 flex items-center gap-1">
                                <MapPin className="w-3 h-3" /> {t.orders.btnDone}
                              </p>
                              {order.completedAt ? (
                                <div>
                                  <p className="text-xs text-green-600 font-medium mb-1.5 flex items-center gap-1">
                                    <CheckCircle2 className="w-3.5 h-3.5" />
                                    {t.orders.completedOn} {new Date(order.completedAt).toLocaleDateString('ja-JP')}
                                  </p>
                                  <button
                                    onClick={() => updateStatus(order.id, 'status', 'shipped')}
                                    className="w-full border border-gray-200 text-gray-500 py-1.5 rounded text-xs hover:bg-gray-50"
                                  >{t.orders.cancelDone}</button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => updateStatus(order.id, 'status', 'delivered')}
                                  disabled={order.status !== 'shipped' && order.status !== 'delivered'}
                                  className="w-full bg-green-600 hover:bg-green-700 text-white py-2 rounded text-xs font-semibold flex items-center justify-center gap-1 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                >
                                  <CheckCheck className="w-3.5 h-3.5" />
                                  {t.orders.btnDone}
                                </button>
                              )}
                              {order.status !== 'shipped' && !order.completedAt && (
                                <p className="text-xs text-gray-400 mt-1 text-center">{t.orders.enableAfterShipped}</p>
                              )}
                            </div>

                            {/* 지연 연락 날짜 */}
                            <div className="pt-1 border-t border-gray-100">
                              <p className="text-xs text-gray-600 font-medium mb-1">{t.orders.delayNotifyLabel}</p>
                              <div className="flex gap-1">
                                <DateInput
                                  size="sm"
                                  value={delayInputs[order.id] ?? order.delayNotifyDate?.slice(0, 10) ?? ''}
                                  onChange={v => setDelayInputs(p => ({ ...p, [order.id]: v }))}
                                />
                                <button onClick={async () => {
                                  const v = delayInputs[order.id]
                                  if (v === undefined) return
                                  await fetch(`/api/orders/${order.id}`, {
                                    method: 'PATCH',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ delayNotifyDate: v || null }),
                                  })
                                  fetchOrders(page)
                                }} className="px-2 bg-blue-500 text-white rounded text-xs hover:bg-blue-600">{t.common.save}</button>
                              </div>
                              {order.delayNotifyDate && (
                                <p className="text-xs text-blue-600 mt-1">✓ {new Date(order.delayNotifyDate).toLocaleDateString('ja-JP')} {t.orders.delayNotifySaved.replace('{date}', '')}</p>
                              )}
                            </div>

                            {/* 메모 */}
                            <div className="pt-1 border-t border-gray-100">
                              <p className="text-xs text-gray-600 font-medium mb-1">{t.common.memo}</p>
                              <textarea
                                className="w-full border border-gray-200 rounded px-2 py-1 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
                                rows={2}
                                placeholder={t.orders.orderMemoPlaceholder}
                                defaultValue={order.memo}
                                onBlur={e => {
                                  if (e.target.value !== order.memo) {
                                    fetch(`/api/orders/${order.id}`, {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ memo: e.target.value }),
                                    }).then(() => fetchOrders())
                                  }
                                }}
                              />
                            </div>

                            {/* 문서 발급: 청구서 / 견적서 (열린 문서에서 언어·종류 전환 가능) */}
                            <div className="grid grid-cols-2 gap-1.5">
                              <a href={`/documents/invoice/${order.id}?lang=ja`} target="_blank" rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1.5 bg-slate-800 text-white py-2 rounded-lg text-xs font-medium hover:bg-slate-700 transition-colors">
                                <FileText className="w-3.5 h-3.5" /> {t.orders.docInvoice}
                              </a>
                              <a href={`/documents/quote/${order.id}?lang=ja`} target="_blank" rel="noopener noreferrer"
                                className="flex items-center justify-center gap-1.5 bg-slate-600 text-white py-2 rounded-lg text-xs font-medium hover:bg-slate-500 transition-colors">
                                <FileText className="w-3.5 h-3.5" /> {t.orders.docQuote}
                              </a>
                            </div>

                            {/* 삭제 */}
                            <div className="pt-1 border-t border-gray-100 dark:border-gray-700">
                              {deleteConfirm === order.id ? (
                                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg p-2.5">
                                  <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-2 text-center">
                                    {t.orders.deleteConfirmText}<br/>
                                    <span className="font-normal text-red-500">{t.orders.deleteConfirmSub}</span>
                                  </p>
                                  <div className="flex gap-1.5">
                                    <button
                                      onClick={() => handleDelete(order.id)}
                                      disabled={deleting === order.id}
                                      className="flex-1 bg-red-600 text-white py-1.5 rounded text-xs font-semibold hover:bg-red-700 disabled:opacity-50 transition-colors"
                                    >
                                      {deleting === order.id ? t.common.deleting : t.common.delete}
                                    </button>
                                    <button
                                      onClick={() => setDeleteConfirm(null)}
                                      className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-1.5 rounded text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
                                    >
                                      {t.common.cancel}
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => setDeleteConfirm(order.id)}
                                  className="flex items-center justify-center gap-1.5 w-full text-gray-400 dark:text-gray-500 hover:text-red-500 dark:hover:text-red-400 py-1.5 rounded-lg text-xs hover:bg-red-50 dark:hover:bg-red-900/10 transition-colors border border-transparent hover:border-red-200 dark:hover:border-red-800/50"
                                >
                                  <Trash2 className="w-4 h-4" /> {t.orders.deleteBtn}
                                </button>
                              )}
                            </div>
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

        {/* 페이지네이션 */}
        {total > PAGE_SIZE && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/50">
            <p className="text-xs text-gray-600 font-medium">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {formatNumber(total)}건
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p: number
                if (totalPages <= 7) p = i + 1
                else if (page <= 4)           p = i + 1
                else if (page >= totalPages - 3) p = totalPages - 6 + i
                else p = page - 3 + i
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${page === p ? 'bg-blue-600 text-white' : 'text-gray-600 hover:bg-gray-200'}`}>
                    {p}
                  </button>
                )
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-200 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
