'use client'

import { useState, useMemo } from 'react'
import { useApiCache } from '@/lib/useApiCache'
import { CreditCard, CheckCircle, ChevronDown, ChevronUp, Package, Truck, Banknote } from 'lucide-react'
import { formatJpy, calcProfitRate } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import { useT } from '@/lib/i18n'

type OrderItem = {
  id: number; quantity: number; salePriceJpy: number; costPriceJpy: number
  procureStatus: string; optionMemo: string
  product: { name: string; supplierCode: string }
}

type Order = {
  id: number; orderNo: string; orderDate: string; paymentStatus: string
  status: string; dueDate?: string; shippingDate?: string; trackingNo: string; memo: string
  totalAmountJpy: number; totalCostJpy: number; paidAmountJpy: number
  customer: { name: string; company: string }
  items: OrderItem[]
}

const STATUS_COLORS: Record<string, string> = {
  pending: '', confirmed: '', shipped: '', delivered: '', cancelled: '',
}
const PROCURE_COLORS: Record<string, string> = {
  needed:   'bg-red-100 text-red-600',
  ordered:  'bg-blue-100 text-blue-700',
  received: 'bg-green-100 text-green-700',
}

const DAY_MS = 86400000

type PurchasePO = {
  id: number; poNo: string; supplierCode: string; status: string; paymentStatus: string
  orderDate: string; confirmedDate?: string; paidDate?: string
  totalCostJpy: number; confirmedTotalJpy: number; confirmedForeign: number; confirmedCurrency: string
  supplierInvoiceNo: string; paidAmountJpy: number
  supplier: { name: string; currency: string }
}

export default function PaymentsPage() {
  const t = useT()
  const [tab, setTab] = useState<'sales' | 'purchase'>('sales')
  // 클라 캐시: 미입금 주문(원시 응답 캐시) → dueDate 정렬은 파생
  const { data: ordersRaw, isLoading: loading, refresh: loadOrders } = useApiCache<{ orders: Order[] }>('/api/orders?paymentStatus=unpaid,partial&limit=200')
  const orders = useMemo(() => {
    const list = [...(ordersRaw?.orders ?? [])]
    list.sort((a, b) => {
      if (!a.dueDate && !b.dueDate) return 0
      if (!a.dueDate) return 1
      if (!b.dueDate) return -1
      return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()
    })
    return list
  }, [ordersRaw])
  const [paying, setPaying]     = useState<number | null>(null)
  const [payAmounts, setPayAmounts] = useState<Record<number, string>>({})
  const [expanded, setExpanded] = useState<number | null>(null)
  // 매입(제조사 지급)
  const [payingPo, setPayingPo] = useState<number | null>(null)
  // 클라 캐시: 매입(발주) 원시 응답 → 지급대상 상태만 파생
  const { data: posRaw, isLoading: posLoading, refresh: loadPOs } = useApiCache<{ orders: PurchasePO[] }>('/api/purchase-orders?limit=200')
  const pos = useMemo(
    () => (posRaw?.orders ?? []).filter((p) => ['confirmed', 'paid', 'partial', 'received'].includes(p.status)),
    [posRaw],
  )

  const payPO = async (po: PurchasePO) => {
    setPayingPo(po.id)
    const amount = po.confirmedTotalJpy || po.totalCostJpy
    await fetch(`/api/purchase-orders/${po.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pay: { paidAmountJpy: amount, paidDate: null } }),
    })
    setPayingPo(null)
    loadPOs()
  }

  // 로드/새로고침은 useApiCache가 처리 (loadOrders/loadPOs = refresh)

  const handlePay = async (order: Order) => {
    const amount = Number(payAmounts[order.id] ?? order.totalAmountJpy - order.paidAmountJpy)
    if (!amount || amount <= 0) return
    await fetch(`/api/orders/${order.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        paidAmountJpy: order.paidAmountJpy + amount,
        paymentStatus: order.paidAmountJpy + amount >= order.totalAmountJpy ? 'paid' : 'partial',
        paymentDate: new Date().toISOString(),
      }),
    })
    setPaying(null)
    loadOrders()
  }

  const now = new Date().getTime()
  const overdue  = orders.filter(o => o.dueDate && new Date(o.dueDate).getTime() < now)
  const upcoming = orders.filter(o => !o.dueDate || new Date(o.dueDate).getTime() >= now)
  const totalUnpaid = orders.reduce((a, o) => a + (o.totalAmountJpy - o.paidAmountJpy), 0)

  // 매입(제조사 지급): 지급 대기 / 지급 완료
  const posPayable = pos.filter(p => p.paymentStatus !== 'paid')
  const posPaid    = pos.filter(p => p.paymentStatus === 'paid')
  const totalPayable = posPayable.reduce((a, p) => a + (p.confirmedTotalJpy || p.totalCostJpy), 0)

  return (
    <div className="p-6">
      <div className="mb-4">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.payments.title}</h1>
        <p className="text-gray-600 dark:text-gray-400 font-medium text-sm mt-1">
          {tab === 'sales'
            ? `${t.payments.tabSales} · ${formatJpy(totalUnpaid)} · ${orders.length}${t.common.cases}`
            : `${t.payments.tabPurchase} · ${formatJpy(totalPayable)} · ${posPayable.length}${t.common.cases}`}
        </p>
      </div>

      {/* 매출/매입 탭 */}
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden mb-6">
        <button
          onClick={() => setTab('sales')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'sales' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >{t.payments.tabSales}{orders.length > 0 && ` (${orders.length})`}</button>
        <button
          onClick={() => setTab('purchase')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${tab === 'purchase' ? 'bg-purple-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >{t.payments.tabPurchase}{posPayable.length > 0 && ` (${posPayable.length})`}</button>
      </div>

      {/* ── 매입(제조사 지급) ── */}
      {tab === 'purchase' && (
        <div>
          {posLoading ? (
            <div className="text-center py-16 text-gray-400">{t.common.loading}</div>
          ) : pos.length === 0 ? (
            <div className="text-center py-20">
              <Banknote className="w-12 h-12 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-400">{t.payments.noPurchase}</p>
            </div>
          ) : (
            <>
              {posPayable.length > 0 && (
                <div className="mb-6">
                  <h2 className="text-sm font-semibold text-purple-600 mb-3 flex items-center gap-2">
                    <span className="w-2 h-2 bg-purple-500 rounded-full inline-block" />
                    {t.payments.payableSection} ({posPayable.length}{t.common.cases})
                  </h2>
                  <div className="space-y-2">
                    {posPayable.map(po => (
                      <PurchaseCard key={po.id} po={po} paying={payingPo === po.id} onPay={() => payPO(po)} />
                    ))}
                  </div>
                </div>
              )}
              {posPaid.length > 0 && (
                <div>
                  <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">
                    {t.payments.paidSection} ({posPaid.length}{t.common.cases})
                  </h2>
                  <div className="space-y-2">
                    {posPaid.map(po => (
                      <PurchaseCard key={po.id} po={po} paying={false} onPay={() => {}} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── 매출(고객 입금) ── */}
      {tab === 'sales' && (<>
      {overdue.length > 0 && (
        <div className="mb-6">
          <h2 className="text-sm font-semibold text-red-600 mb-3 flex items-center gap-2">
            <span className="w-2 h-2 bg-red-500 rounded-full inline-block" />
            {t.payments.overdueSection} ({overdue.length}{t.common.cases})
          </h2>
          <div className="space-y-2">
            {overdue.map(order => (
              <OrderCard
                key={order.id} order={order} isOverdue
                daysOverdue={Math.floor((now - new Date(order.dueDate!).getTime()) / DAY_MS)}
                expanded={expanded === order.id}
                onToggle={() => setExpanded(expanded === order.id ? null : order.id)}
                paying={paying === order.id}
                onPayToggle={() => setPaying(paying === order.id ? null : order.id)}
                payAmount={payAmounts[order.id] ?? ''}
                onPayAmountChange={v => setPayAmounts(p => ({ ...p, [order.id]: v }))}
                onPay={() => handlePay(order)}
                onPayCancel={() => setPaying(null)}
              />
            ))}
          </div>
        </div>
      )}

      {upcoming.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-600 dark:text-gray-400 mb-3">
            {t.payments.upcomingSection} ({upcoming.length}{t.common.cases})
          </h2>
          <div className="space-y-2">
            {upcoming.map(order => (
              <OrderCard
                key={order.id} order={order} isOverdue={false}
                expanded={expanded === order.id}
                onToggle={() => setExpanded(expanded === order.id ? null : order.id)}
                paying={paying === order.id}
                onPayToggle={() => setPaying(paying === order.id ? null : order.id)}
                payAmount={payAmounts[order.id] ?? ''}
                onPayAmountChange={v => setPayAmounts(p => ({ ...p, [order.id]: v }))}
                onPay={() => handlePay(order)}
                onPayCancel={() => setPaying(null)}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && orders.length === 0 && (
        <div className="text-center py-20">
          <CreditCard className="w-12 h-12 mx-auto mb-3 text-gray-400" />
          <p className="text-gray-400">{t.payments.noOrders}</p>
        </div>
      )}
      </>)}
    </div>
  )
}

// 매입(제조사 지급) 카드
function PurchaseCard({ po, paying, onPay }: { po: PurchasePO; paying: boolean; onPay: () => void }) {
  const t = useT()
  const amount = po.confirmedTotalJpy || po.totalCostJpy
  const isPaid = po.paymentStatus === 'paid'
  return (
    <div className={`rounded-xl border shadow-sm p-4 flex items-center gap-4 ${isPaid ? 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700' : 'bg-purple-50/40 dark:bg-purple-900/10 border-purple-100 dark:border-purple-800/50'}`}>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <SupplierBadge code={po.supplierCode} />
          <a href={`/purchase-orders/${po.id}`} className="font-semibold text-blue-600 hover:underline">{po.poNo}</a>
          {po.supplierInvoiceNo && <span className="text-xs text-gray-500 dark:text-gray-400">INV: {po.supplierInvoiceNo}</span>}
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-gray-500 dark:text-gray-400 font-medium">
          {po.confirmedDate && <span>{t.payments.confirmedOn} {new Date(po.confirmedDate).toLocaleDateString('ja-JP')}</span>}
          {po.confirmedForeign > 0 && <><span>·</span><span>{po.confirmedCurrency} {po.confirmedForeign.toLocaleString()}</span></>}
          {isPaid && po.paidDate && <><span>·</span><span className="text-purple-600 dark:text-purple-400">{t.payments.paidOn} {new Date(po.paidDate).toLocaleDateString('ja-JP')}</span></>}
        </div>
      </div>
      <div className="text-right shrink-0">
        <p className="font-bold text-lg text-gray-800 dark:text-gray-200 tabular-nums">{formatJpy(amount)}</p>
      </div>
      {isPaid ? (
        <span className="shrink-0 flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
          <CheckCircle className="w-4 h-4" />{t.purchaseOrders.paidLabel}
        </span>
      ) : (
        <button
          onClick={onPay} disabled={paying}
          className="shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50 transition-colors"
        >
          <Banknote className="w-4 h-4" />{paying ? t.common.processing : t.payments.payBtn}
        </button>
      )}
    </div>
  )
}

type OrderCardProps = {
  order: Order; isOverdue: boolean; daysOverdue?: number
  expanded: boolean; onToggle: () => void
  paying: boolean; onPayToggle: () => void
  payAmount: string; onPayAmountChange: (v: string) => void
  onPay: () => void; onPayCancel: () => void
}

function OrderCard({ order, isOverdue, daysOverdue, expanded, onToggle, paying, onPayToggle, payAmount, onPayAmountChange, onPay, onPayCancel }: OrderCardProps) {
  const t = useT()
  const remain  = order.totalAmountJpy - order.paidAmountJpy
  const { margin } = calcProfitRate(order.totalAmountJpy, order.totalCostJpy)
  const paidPct = order.totalAmountJpy > 0 ? Math.min(100, (order.paidAmountJpy / order.totalAmountJpy) * 100) : 0

  const statusLabel = (s: string) => ({
    pending: t.payments.statusPending, confirmed: t.payments.statusConfirmed,
    shipped: t.payments.statusShipped, delivered: t.payments.statusDelivered,
    cancelled: t.payments.statusCancelled,
  } as Record<string,string>)[s] ?? s

  const procureInfo = (s: string) => ({
    needed:   { label: t.payments.procureNeeded,   color: PROCURE_COLORS.needed },
    ordered:  { label: t.payments.procureOrdered,  color: PROCURE_COLORS.ordered },
    received: { label: t.payments.procureReceived, color: PROCURE_COLORS.received },
  } as Record<string,{label:string;color:string}>)[s] ?? { label: s, color: 'bg-gray-100 text-gray-500' }

  return (
    <div className={`rounded-xl border shadow-sm overflow-hidden ${isOverdue ? 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/50' : 'bg-white dark:bg-gray-800 border-gray-100 dark:border-gray-700'}`}>
      <div className="p-4 flex items-center gap-4 cursor-pointer hover:bg-black/[0.02] transition-colors select-none" onClick={onToggle}>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-gray-900 dark:text-gray-100">{order.customer.name}</p>
            {order.customer.company && <p className="text-gray-500 dark:text-gray-400 text-xs">{order.customer.company}</p>}
            {isOverdue && daysOverdue !== undefined && (
              <span className="bg-red-100 text-red-700 text-xs font-medium px-2 py-0.5 rounded">+{daysOverdue}{t.payments.overdue}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 text-gray-600 dark:text-gray-400 font-medium text-xs">
            <span>{order.orderNo}</span>
            <span>·</span>
            <span>{new Date(order.orderDate).toLocaleDateString('ja-JP')}</span>
            {order.dueDate && (
              <><span>·</span><span>{t.payments.dueDate} {new Date(order.dueDate).toLocaleDateString('ja-JP')}</span></>
            )}
            <span className="px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">{statusLabel(order.status)}</span>
          </div>
          {order.paidAmountJpy > 0 && (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div className="h-full bg-green-400 rounded-full" style={{ width: `${paidPct}%` }} />
              </div>
              <span className="text-xs text-green-600 font-medium shrink-0">{paidPct.toFixed(0)}%</span>
            </div>
          )}
        </div>

        <div className="text-right shrink-0">
          <p className={`font-bold text-lg ${isOverdue ? 'text-red-600' : 'text-gray-800 dark:text-gray-200'}`}>{formatJpy(remain)}</p>
          {order.paidAmountJpy > 0 && <p className="text-gray-500 dark:text-gray-400 text-xs">{t.payments.paidAmount} {formatJpy(order.paidAmountJpy)}</p>}
        </div>

        <div className="relative shrink-0" onClick={e => e.stopPropagation()}>
          <button
            onClick={onPayToggle}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors text-white ${isOverdue ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'}`}
          >
            {t.payments.btnPay}
          </button>
          {paying && (
            <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 shadow-xl rounded-xl p-4 border border-gray-200 dark:border-gray-600 w-64">
              <p className="text-sm font-medium text-gray-700 dark:text-gray-200 mb-2">{t.payments.payAmountLabel}</p>
              <input
                type="number"
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm mb-3 text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={String(remain)}
                value={payAmount}
                onChange={e => onPayAmountChange(e.target.value)}
                autoFocus
              />
              <div className="flex gap-2">
                <button onClick={onPay} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center justify-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />{t.common.complete}
                </button>
                <button onClick={onPayCancel} className="flex-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600">{t.common.cancel}</button>
              </div>
            </div>
          )}
        </div>

        <div className="text-gray-400 shrink-0">
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-700/30 px-5 py-4">
          <div className="flex gap-6">
            <div className="flex-1">
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                <Package className="w-3.5 h-3.5" /> {t.payments.orderItems} ({order.items.length}{t.common.items})
              </p>
              <div className="space-y-1.5">
                {order.items.map(item => {
                  const pi = procureInfo(item.procureStatus)
                  return (
                    <div key={item.id} className="flex items-center gap-2 text-sm">
                      <SupplierBadge code={item.product.supplierCode} />
                      <span className="flex-1 text-gray-700 dark:text-gray-300 truncate">{item.product.name}</span>
                      {item.optionMemo && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium border border-amber-200 dark:border-amber-700/50 shrink-0">
                          {item.optionMemo}
                        </span>
                      )}
                      <span className="text-gray-400 shrink-0">×{item.quantity}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${pi.color}`}>{pi.label}</span>
                      <span className="font-medium text-gray-900 dark:text-gray-100 shrink-0 tabular-nums">{formatJpy(item.salePriceJpy * item.quantity)}</span>
                    </div>
                  )
                })}
              </div>
            </div>

            <div className="w-44 shrink-0 space-y-2 text-sm">
              <div className="bg-white dark:bg-gray-800 rounded-lg p-3 border border-gray-100 dark:border-gray-600 space-y-1.5">
                <div className="flex justify-between text-xs">
                  <span className="text-gray-700 dark:text-gray-400">{t.payments.orderAmount}</span>
                  <span className="font-medium dark:text-gray-200">{formatJpy(order.totalAmountJpy)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-700 dark:text-gray-400">{t.payments.paidAmount}</span>
                  <span className="font-medium text-green-600">{formatJpy(order.paidAmountJpy)}</span>
                </div>
                <div className="flex justify-between text-xs border-t border-gray-100 dark:border-gray-600 pt-1.5">
                  <span className="text-gray-700 dark:text-gray-400">{t.payments.balance}</span>
                  <span className={`font-bold ${remain > 0 ? 'text-red-600' : 'text-green-600'}`}>{formatJpy(remain)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-gray-700 dark:text-gray-400">{t.payments.colMargin}</span>
                  <span className={`font-semibold ${margin >= 40 ? 'text-green-600' : margin >= 25 ? 'text-yellow-600' : 'text-red-600'}`}>{margin.toFixed(1)}%</span>
                </div>
              </div>

              {order.shippingDate && (
                <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                  <Truck className="w-3.5 h-3.5" />
                  {t.payments.shippedOn} {new Date(order.shippingDate).toLocaleDateString('ja-JP')}
                  {order.trackingNo && <span className="text-gray-500">({order.trackingNo})</span>}
                </div>
              )}

              {order.memo && (
                <p className="text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 rounded-lg p-2 border border-gray-100 dark:border-gray-600">
                  <Banknote className="w-3 h-3 inline mr-1 text-gray-400" />{order.memo}
                </p>
              )}

              <a
                href={`/orders?q=${encodeURIComponent(order.orderNo)}`}
                className="flex items-center justify-center gap-1 w-full text-xs text-blue-500 hover:text-blue-700 py-1.5 rounded-lg border border-blue-100 hover:bg-blue-50 dark:border-blue-900/50 dark:hover:bg-blue-900/20 transition-colors"
                onClick={e => e.stopPropagation()}
              >
                {t.payments.linkOrders}
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
