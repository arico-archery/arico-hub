'use client'

import React, { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  ClipboardList, Truck, CheckCircle2, Clock, AlertCircle,
  ChevronDown, ChevronUp, Filter, RefreshCw
} from 'lucide-react'
import { formatJpy, SUPPLIER_COLORS, SUPPLIER_LIST } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import DateInput from '@/components/DateInput'
import { useT } from '@/lib/i18n'

// ── 타입 ──────────────────────────────────────────────
type BackorderItem = {
  id: number
  quantity: number
  salePriceJpy: number
  costPriceJpy: number
  procureStatus: 'needed' | 'ordered' | 'received'
  optionMemo: string
  purchaseOrderId: number | null
  order: {
    id: number
    orderNo: string
    orderDate: string
    delayNotifyDate: string | null
    customer: { name: string; company: string }
  }
  product: {
    id: number
    name: string
    productCode: string
    supplierCode: string
    optionSize: string
    optionColor: string
    supplier: { name: string; color: string }
  }
  purchaseOrder: {
    id: number
    poNo: string
    status: string
    expectedDate: string | null
  } | null
}

// ── 상수 ──────────────────────────────────────────────
const PROCURE_STYLE = {
  needed:   { color: 'bg-red-100 text-red-700',      icon: <Clock className="w-3 h-3" /> },
  ordered:  { color: 'bg-blue-100 text-blue-700',    icon: <Truck className="w-3 h-3" /> },
  received: { color: 'bg-green-100 text-green-700',  icon: <CheckCircle2 className="w-3 h-3" /> },
}

// 공급사별 그룹화 헬퍼
function groupBySupplier(items: BackorderItem[]) {
  const map = new Map<string, BackorderItem[]>()
  for (const item of items) {
    const sc = item.product.supplierCode
    if (!map.has(sc)) map.set(sc, [])
    map.get(sc)!.push(item)
  }
  return map
}

// ── 컴포넌트 ──────────────────────────────────────────
export default function BackordersPage() {
  const t = useT()
  const [items, setItems]           = useState<BackorderItem[]>([])
  const [loading, setLoading]       = useState(true)
  const [supplierFilter, setSupplierFilter] = useState('')
  const [statusFilter, setStatusFilter]     = useState('needed,ordered')
  const [selected, setSelected]     = useState<Set<number>>(new Set())
  const [collapsed, setCollapsed]   = useState<Set<string>>(new Set())
  const [expectedDate, setExpectedDate] = useState('')
  const [memo, setMemo]             = useState('')
  const [creating, setCreating]     = useState(false)
  const [lastResult, setLastResult] = useState<{ poNo: string; supplierCode: string; itemCount: number }[] | null>(null)

  const fetchItems = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ status: statusFilter })
    if (supplierFilter) params.set('supplier', supplierFilter)
    const res  = await fetch(`/api/backorders?${params}`)
    const data = await res.json()
    setItems(data)
    setSelected(new Set())
    setLoading(false)
  }, [supplierFilter, statusFilter])

  useEffect(() => { fetchItems() }, [fetchItems])

  // 전체 선택 / 해제
  const needItems   = items.filter(i => i.procureStatus === 'needed')
  const allSelected = needItems.length > 0 && needItems.every(i => selected.has(i.id))
  const toggleAll   = () => {
    if (allSelected) {
      setSelected(new Set())
    } else {
      setSelected(new Set(needItems.map(i => i.id)))
    }
  }

  const toggle = (id: number) => {
    setSelected(prev => {
      const n = new Set(prev)
      n.has(id) ? n.delete(id) : n.add(id)
      return n
    })
  }

  // 공급사 그룹 토글
  const toggleGroup = (sc: string) => {
    setCollapsed(prev => {
      const n = new Set(prev)
      n.has(sc) ? n.delete(sc) : n.add(sc)
      return n
    })
  }

  // 공급사별 전체 선택
  const toggleGroupSelect = (sc: string, groupItems: BackorderItem[]) => {
    const needInGroup = groupItems.filter(i => i.procureStatus === 'needed')
    const allGroupSelected = needInGroup.every(i => selected.has(i.id))
    setSelected(prev => {
      const n = new Set(prev)
      if (allGroupSelected) {
        needInGroup.forEach(i => n.delete(i.id))
      } else {
        needInGroup.forEach(i => n.add(i.id))
      }
      return n
    })
  }

  // 발주 생성
  const createPO = async () => {
    if (selected.size === 0) return
    setCreating(true)
    setLastResult(null)
    const res = await fetch('/api/backorders/create-po', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        orderItemIds: Array.from(selected),
        expectedDate: expectedDate || undefined,
        memo:         memo || undefined,
      }),
    })
    const data = await res.json()
    setCreating(false)
    if (res.ok) {
      setLastResult(data.created)
      setExpectedDate('')
      setMemo('')
      fetchItems()
    } else {
      alert(data.error ?? '발주 생성 실패')
    }
  }

  const grouped = groupBySupplier(items)

  // 선택 품목의 공급사 종류
  const selectedItems    = items.filter(i => selected.has(i.id))
  const selectedSuppliers = [...new Set(selectedItems.map(i => i.product.supplierCode))]
  const selectedCost     = selectedItems.reduce((s, i) => s + i.costPriceJpy * i.quantity, 0)

  return (
    <div className="p-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.backorders.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 font-medium text-sm mt-1">
            {t.backorders.needed} {items.filter(i => i.procureStatus === 'needed').length}{t.common.cases} ·
            {t.backorders.ordered} {items.filter(i => i.procureStatus === 'ordered').length}{t.common.cases}
          </p>
        </div>
        <button onClick={fetchItems} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="flex gap-5">
        {/* 왼쪽: 리스트 */}
        <div className="flex-1 min-w-0">
          {/* 필터 */}
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-4 mb-4 flex gap-4 flex-wrap items-center">
            <div className="flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5 text-gray-400" />
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">{t.backorders.supplierLabel}</span>
              <button onClick={() => setSupplierFilter('')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${supplierFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {t.backorders.all}
              </button>
              {SUPPLIER_LIST.map(s => (
                <button key={s} onClick={() => setSupplierFilter(supplierFilter === s ? '' : s)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${supplierFilter === s ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                  style={supplierFilter === s ? { backgroundColor: SUPPLIER_COLORS[s] } : {}}>
                  {s}
                </button>
              ))}
            </div>
            <div className="w-px h-5 bg-gray-200 dark:bg-gray-600" />
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">{t.backorders.statusLabel}</span>
              {[
                { v: 'needed,ordered', l: t.backorders.all },       // 전체 = 활성 백오더(미발주+발주)
                { v: 'needed',         l: t.backorders.needed },     // 미발주
                { v: 'ordered',        l: t.backorders.ordered },    // 발주
                { v: 'received',       l: t.backorders.received },   // 입고완료
              ].map(({ v, l }) => (
                <button key={v} onClick={() => setStatusFilter(v)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${statusFilter === v ? 'bg-slate-700 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          {/* 성공 알림 */}
          {lastResult && (
            <div className="mb-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/50 rounded-xl">
              <p className="text-sm font-medium text-green-800 dark:text-green-400 mb-2">✅ {t.backorders.successTitle} {lastResult.length}{t.backorders.items}</p>
              <div className="space-y-1">
                {lastResult.map(r => (
                  <div key={r.poNo} className="flex items-center gap-2 text-sm text-green-700 dark:text-green-400">
                    <SupplierBadge code={r.supplierCode} />
                    <Link href={`/purchase-orders`} className="font-medium hover:underline">{r.poNo}</Link>
                    <span className="text-green-600 dark:text-green-500">— {r.itemCount}{t.common.items}</span>
                  </div>
                ))}
              </div>
              <button onClick={() => setLastResult(null)} className="mt-2 text-xs text-green-600 dark:text-green-400 hover:underline">{t.common.close}</button>
            </div>
          )}

          {/* 리스트 (공급사별 그룹) */}
          {loading ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-16 text-center text-gray-400">{t.common.loading}</div>
          ) : items.length === 0 ? (
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-16 text-center text-gray-400">
              <ClipboardList className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{t.backorders.noItems}</p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* 전체 선택 헤더 */}
              {needItems.length > 0 && (
                <div className="flex items-center gap-3 px-4 py-2 bg-slate-50 dark:bg-gray-700/50 rounded-lg border border-slate-100 dark:border-gray-600">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    className="w-4 h-4 rounded accent-blue-600 cursor-pointer" />
                  <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">
                    {t.backorders.selectAll} ({needItems.length}{t.common.cases})
                  </span>
                  {selected.size > 0 && (
                    <span className="ml-auto text-xs text-blue-600 font-medium">{selected.size}{t.backorders.selectedCount}</span>
                  )}
                </div>
              )}

              {Array.from(grouped.entries()).map(([sc, groupItems]) => {
                const needInGroup    = groupItems.filter(i => i.procureStatus === 'needed')
                const allGrpSelected = needInGroup.length > 0 && needInGroup.every(i => selected.has(i.id))
                const isCollapsed    = collapsed.has(sc)

                return (
                  <div key={sc} className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-x-auto">
                    {/* 그룹 헤더 */}
                    <div
                      className="flex items-center gap-3 px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                      onClick={() => toggleGroup(sc)}
                    >
                      {needInGroup.length > 0 && (
                        <input
                          type="checkbox"
                          checked={allGrpSelected}
                          onClick={e => e.stopPropagation()}
                          onChange={() => toggleGroupSelect(sc, groupItems)}
                          className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                        />
                      )}
                      <SupplierBadge code={sc} />
                      <span className="font-medium text-gray-700 dark:text-gray-200 text-sm flex-1">
                        {sc}
                        <span className="ml-2 font-normal text-gray-500 dark:text-gray-400 text-xs">
                          {groupItems.length}{t.common.cases}
                          {needInGroup.length > 0 && ` · ${t.backorders.unordered} ${needInGroup.length}${t.common.cases}`}
                        </span>
                      </span>
                      {isCollapsed ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronUp className="w-4 h-4 text-gray-400" />}
                    </div>

                    {/* 그룹 품목 */}
                    {!isCollapsed && (
                      <table className="w-full text-sm min-w-[640px]">
                        <thead>
                          <tr className="border-b border-gray-100 dark:border-gray-700">
                            <th className="w-8 px-4 py-2" />
                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs">{t.backorders.colOrderNo}</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs">{t.backorders.colOrderDate}</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs">{t.backorders.colCustomer}</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs">{t.backorders.colProduct}</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs w-32">{t.backorders.colMemo}</th>
                            <th className="text-center px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs w-14">{t.backorders.colQty}</th>
                            <th className="text-right px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs w-28">{t.common.cost}</th>
                            <th className="text-center px-3 py-2 font-semibold text-gray-600 dark:text-gray-300 text-xs w-28">{t.common.status}</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                          {groupItems.map(item => {
                            const cfg      = PROCURE_STYLE[item.procureStatus as keyof typeof PROCURE_STYLE] ?? PROCURE_STYLE.needed
                            const procureLabel = { needed: t.backorders.needed, ordered: t.backorders.ordered, received: t.backorders.received }[item.procureStatus] ?? item.procureStatus
                            const isNeed   = item.procureStatus === 'needed'
                            const checked  = selected.has(item.id)
                            const orderAge = Math.floor((Date.now() - new Date(item.order.orderDate).getTime()) / 86400000)
                            const hasDelay = item.order.delayNotifyDate && new Date(item.order.delayNotifyDate) <= new Date()

                            return (
                              <tr
                                key={item.id}
                                className={`transition-colors cursor-pointer ${
                                  checked ? 'bg-blue-50/60 dark:bg-blue-900/20' :
                                  item.procureStatus === 'received' ? 'bg-green-50/30 dark:bg-green-900/10 opacity-60' :
                                  'hover:bg-gray-50/60 dark:hover:bg-gray-700/30'
                                }`}
                                onClick={() => isNeed && toggle(item.id)}
                              >
                                <td className="px-4 py-3 text-center">
                                  {isNeed && (
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggle(item.id)}
                                      onClick={e => e.stopPropagation()}
                                      className="w-4 h-4 rounded accent-blue-600 cursor-pointer"
                                    />
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <Link
                                    href={`/orders?q=${item.order.orderNo}`}
                                    onClick={e => e.stopPropagation()}
                                    className="font-medium text-blue-600 hover:underline text-xs"
                                  >
                                    {item.order.orderNo}
                                  </Link>
                                  {hasDelay && (
                                    <p className="text-orange-500 text-xs flex items-center gap-0.5 mt-0.5">
                                      <AlertCircle className="w-3 h-3" />{t.backorders.contactNeeded}
                                    </p>
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <p className="text-gray-700 dark:text-gray-200 text-xs font-medium tabular-nums">
                                    {new Date(item.order.orderDate).toLocaleDateString('ja-JP')}
                                  </p>
                                  <p className="text-gray-400 text-xs">{orderAge}{t.backorders.daysAgo}</p>
                                </td>
                                <td className="px-3 py-3">
                                  <p className="font-medium text-gray-800 dark:text-gray-200 text-sm leading-tight">
                                    {item.order.customer.name}
                                  </p>
                                  {item.order.customer.company && (
                                    <p className="text-gray-500 dark:text-gray-400 text-xs">{item.order.customer.company}</p>
                                  )}
                                </td>
                                <td className="px-3 py-3">
                                  <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight line-clamp-2">
                                    {item.product.name}
                                  </p>
                                  <p className="text-gray-500 dark:text-gray-400 text-xs mt-0.5">{item.product.productCode}</p>
                                </td>
                                {/* 비고 */}
                                <td className="px-3 py-3">
                                  {item.optionMemo ? (
                                    <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium border border-amber-200 dark:border-amber-700/50 whitespace-pre-wrap">
                                      {item.optionMemo}
                                    </span>
                                  ) : (
                                    <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-3 text-center font-medium text-gray-700 dark:text-gray-200">{item.quantity}</td>
                                <td className="px-3 py-3 text-right font-medium text-gray-600 dark:text-gray-300 tabular-nums text-sm">
                                  {formatJpy(item.costPriceJpy * item.quantity)}
                                </td>
                                <td className="px-3 py-3 text-center">
                                  <div className="flex flex-col items-center gap-1">
                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${cfg.color}`}>
                                      {cfg.icon}{procureLabel}
                                    </span>
                                    {item.purchaseOrder && (
                                      <Link
                                        href={`/purchase-orders/${item.purchaseOrder.id}`}
                                        onClick={e => e.stopPropagation()}
                                        className="text-xs text-blue-500 hover:underline"
                                      >
                                        {item.purchaseOrder.poNo}
                                      </Link>
                                    )}
                                    {item.purchaseOrder?.expectedDate && (
                                      <p className="text-xs text-gray-500 dark:text-gray-400">
                                        {t.backorders.expectedLabel}: {new Date(item.purchaseOrder.expectedDate).toLocaleDateString('ja-JP')}
                                      </p>
                                    )}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 오른쪽: 발주 생성 패널 */}
        <div className="w-64 shrink-0">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 sticky top-6 space-y-4">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Truck className="w-4 h-4 text-gray-400" />
              {t.backorders.createPO}
            </h2>

            {selected.size === 0 ? (
              <div className="text-center py-6 text-gray-400">
                <ClipboardList className="w-8 h-8 mx-auto mb-2" />
                <p className="text-xs">{t.backorders.selectPrompt}</p>
              </div>
            ) : (
              <>
                {/* 선택 요약 */}
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">{t.backorders.selectedItems}</p>
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{t.purchaseOrders.newItemCount}</span>
                    <span className="font-medium text-gray-900 dark:text-gray-100">{selected.size}{t.common.cases}</span>
                  </div>
                  {/* 선택 항목 비고 미리보기 */}
                  {selectedItems.some(i => i.optionMemo) && (
                    <div className="mt-1 space-y-0.5">
                      {selectedItems.filter(i => i.optionMemo).map(i => (
                        <p key={i.id} className="text-xs text-amber-700 dark:text-amber-300 truncate">
                          · {i.product.name.slice(0, 18)}… <span className="font-medium">{i.optionMemo}</span>
                        </p>
                      ))}
                    </div>
                  )}
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-300 font-medium">{t.backorders.totalCost}</span>
                    <span className="font-bold text-gray-900 dark:text-gray-100 tabular-nums">{formatJpy(selectedCost)}</span>
                  </div>
                </div>

                {/* 공급사별 분류 */}
                {selectedSuppliers.length > 1 && (
                  <div className="bg-orange-50 dark:bg-orange-900/20 rounded-lg p-3">
                    <p className="text-xs text-orange-600 dark:text-orange-400 font-medium mb-1.5">{t.backorders.supplierWarning}</p>
                    <div className="space-y-1">
                      {selectedSuppliers.map(sc => {
                        const cnt = selectedItems.filter(i => i.product.supplierCode === sc).length
                        return (
                          <div key={sc} className="flex items-center gap-2">
                            <SupplierBadge code={sc} />
                            <span className="text-xs text-orange-700 dark:text-orange-400">{cnt}{t.common.cases} → PO 1{t.common.cases}</span>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}
                {selectedSuppliers.length === 1 && (
                  <div className="flex items-center gap-2">
                    <SupplierBadge code={selectedSuppliers[0]} />
                    <span className="text-xs text-gray-500 dark:text-gray-400">{t.backorders.createBtn} 1{t.common.cases}</span>
                  </div>
                )}
              </>
            )}

            {/* 공통 입력 */}
            <div className="space-y-3 pt-2 border-t border-gray-100 dark:border-gray-700">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 block">{t.backorders.expectedDate}</label>
                <DateInput
                  value={expectedDate}
                  onChange={setExpectedDate}
                  className="mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 block">{t.common.memo}</label>
                <textarea
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={2}
                  placeholder={t.backorders.memoPlaceholder}
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                />
              </div>
            </div>

            <button
              onClick={createPO}
              disabled={selected.size === 0 || creating}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <Truck className="w-4 h-4" />
              {creating
                ? t.backorders.creating
                : selectedSuppliers.length > 1
                  ? `${t.backorders.createBtn} ${selectedSuppliers.length}${t.common.cases}`
                  : t.backorders.createBtn}
            </button>

            {/* 도움말 */}
            <div className="text-xs text-gray-400 dark:text-gray-500 space-y-1 pt-1 border-t border-gray-100 dark:border-gray-700">
              <p>• {t.backorders.helpText1}</p>
              <p>• {t.backorders.helpText2} (<Link href="/purchase-orders" className="text-blue-500 hover:underline">{t.purchaseOrders.title}</Link>)</p>
              <p>• {t.backorders.helpText3}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
