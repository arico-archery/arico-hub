'use client'

import { useEffect, useRef, useState } from 'react'
import { formatJpy, formatNumber, calcProfitRate, SUPPLIER_COLORS, SUPPLIER_LIST } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import Link from 'next/link'
import {
  TrendingUp, DollarSign, AlertCircle, Truck, Package, ShoppingCart,
  ClipboardList, Banknote, AlertTriangle, Tag, Percent
} from 'lucide-react'
import { useI18n } from '@/lib/i18n'

const SUPPLIER_NAMES: Record<string, Record<string, string>> = {
  ko: { ARICO: 'ARICO', JVD: 'JVD', MK: 'MK Korea', FIVICS: 'FIVICS', SIBUYA: 'Shibuya', KOREA: 'Korea Archery', ANGEL: 'Angel', WJ: 'WJ Sports', KOWA: 'KOWA', ETC: '기타' },
  ja: { ARICO: 'ARICO', JVD: 'JVD', MK: 'MK Korea', FIVICS: 'FIVICS', SIBUYA: 'Shibuya', KOREA: 'Korea Archery', ANGEL: 'Angel', WJ: 'WJ Sports', KOWA: 'KOWA', ETC: 'その他' },
}

export type DashboardData = {
  monthlySales: number
  monthlyProfit: number
  monthlyMargin: number
  monthlyOrderCount: number
  salesMoM: number | null
  profitMoM: number | null
  marginMoMPts: number | null
  procure: { needed: number; ordered: number; received: number }
  supplierPayable: { count: number; amount: number }
  overduePO: number
  totalUnpaid: number
  pendingShipment: number
  overdueCount: number
  unpaidOrders: {
    id: number; orderNo: string; totalAmountJpy: number; paidAmountJpy: number
    dueDate?: string; customer: { name: string }
  }[]
  recentOrders: {
    id: number; orderNo: string; orderDate: string
    totalAmountJpy: number; totalCostJpy: number
    customer: { name: string }
    items: { product: { supplierCode: string } }[]
  }[]
  supplierStats: { supplierCode: string; _count: number }[]
  totalProducts: number
  pricedProducts: number
  unpricedBySupplier: { supplierCode: string; _count: number }[]
}

type MonthPoint = { label: string; month: number; year: number; sales: number; cost: number; count: number }

// ── 스파크라인 (KPI 카드 미니 추세) ─────────────────────────
function Sparkline({ values, color, labels, fmt, caption }: {
  values: number[]; color: string; labels?: string[]; fmt?: (v: number) => string; caption?: string
}) {
  if (!values.length || values.every(v => v === 0)) {
    return <div className="h-10" />
  }
  const w = 100, h = 32
  const max = Math.max(...values), min = Math.min(...values)
  const range = max - min || 1
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1 || 1)) * w
    const y = h - ((v - min) / range) * (h - 4) - 2
    return [x, y] as [number, number]
  })
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`
  return (
    <div className="mt-2">
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="w-full h-8">
        <path d={area} fill={color} opacity={0.12} />
        <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        {/* 각 점에 마우스 올리면 월·값 툴팁 (투명 원으로 넓은 hover 영역) */}
        {pts.map((p, i) => (
          <circle key={i} cx={p[0]} cy={p[1]} r={8} fill="transparent">
            <title>{`${labels?.[i] ? labels[i] + ': ' : ''}${fmt ? fmt(values[i]) : values[i]}`}</title>
          </circle>
        ))}
      </svg>
      {/* 축 캡션: 시작월 · 최근6개월 · 이번달 */}
      <div className="flex items-center justify-between mt-1 text-[10px] text-gray-400 dark:text-gray-500 leading-none">
        <span>{labels?.[0] ?? ''}</span>
        {caption && <span className="font-medium">{caption}</span>}
        <span>{labels?.[labels.length - 1] ?? ''}</span>
      </div>
    </div>
  )
}

export default function DashboardClient({ initialData }: { initialData: DashboardData }) {
  const { t, lang } = useI18n()
  // 서버에서 받은 초기 데이터로 시작 → 첫 페인트부터 데이터 보유(클라 fetch 워터폴 제거)
  const [data, setData] = useState<DashboardData | null>(initialData)
  const [trend, setTrend] = useState<MonthPoint[]>([])
  const [now, setNow] = useState(new Date())
  const [range, setRange] = useState<'month' | '6m' | 'all'>('month')
  const firstRange = useRef(true)

  useEffect(() => {
    // 기본 기간(month)은 서버 초기데이터로 이미 채워졌으니 마운트 재요청 생략.
    // 사용자가 기간을 바꿀 때만 클라이언트에서 다시 가져온다.
    if (firstRange.current) {
      firstRange.current = false
      if (range === 'month') return
    }
    fetch(`/api/dashboard?range=${range}`).then(r => r.json()).then(setData)
  }, [range])

  useEffect(() => {
    fetch('/api/analytics?range=6m').then(r => r.json()).then(d => setTrend(d.monthlyData ?? [])).catch(() => {})
    setNow(new Date())
  }, [])

  if (!data) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <p className="text-gray-400">{t.common.loading}</p>
      </div>
    )
  }

  const { monthlySales, monthlyProfit, monthlyMargin, monthlyOrderCount, salesMoM, profitMoM,
    marginMoMPts, procure, supplierPayable, overduePO, totalUnpaid, pendingShipment, overdueCount,
    unpaidOrders, recentOrders, supplierStats, totalProducts, pricedProducts, unpricedBySupplier } = data
  const statsMap: Record<string, number> = {}
  for (const s of supplierStats) statsMap[s.supplierCode] = s._count
  const unpriced: Record<string, number> = {}
  for (const u of (unpricedBySupplier ?? [])) unpriced[u.supplierCode] = u._count
  const unpricedTotal = Math.max(0, totalProducts - pricedProducts)

  const momText = (v: number | null, unit = '%') =>
    v === null ? null : { up: v >= 0, label: `${v >= 0 ? '▲' : '▼'} ${Math.abs(v).toFixed(1)}${unit}` }

  // 스파크라인 시계열 (항상 최근 6개월) + 월 라벨/포맷
  const salesSeries  = trend.map(m => m.sales)
  const profitSeries = trend.map(m => m.sales - m.cost)
  const marginSeries = trend.map(m => (m.sales > 0 ? ((m.sales - m.cost) / m.sales) * 100 : 0))
  const trendLabels  = trend.map(m => `${m.month}${t.analytics.monthUnit}`)
  const fmtPct = (v: number) => `${v.toFixed(1)}%`

  const periodLabel = range === 'all' ? t.dashboard.periodAll : range === '6m' ? t.dashboard.period6m : t.dashboard.periodMonth

  const kpis = [
    { label: `${periodLabel} ${t.dashboard.salesShort}`, value: formatJpy(monthlySales), icon: DollarSign, mom: momText(salesMoM), sub: `${monthlyOrderCount}${t.common.cases}`, spark: salesSeries, sparkLabels: trendLabels, sparkFmt: formatJpy, color: '#2f7d55', href: '/analytics' },
    { label: `${periodLabel} ${t.dashboard.profitShort}`, value: formatJpy(monthlyProfit), icon: TrendingUp, mom: momText(profitMoM), sub: `${t.dashboard.marginRate} ${monthlyMargin.toFixed(1)}%`, spark: profitSeries, sparkLabels: trendLabels, sparkFmt: formatJpy, color: '#2f7d55', href: '/analytics' },
    { label: t.dashboard.marginRate, value: `${monthlyMargin.toFixed(1)}%`, icon: Percent, mom: momText(marginMoMPts, '%p'), sub: periodLabel, spark: marginSeries, sparkLabels: trendLabels, sparkFmt: fmtPct, color: '#2f7d55', href: '/analytics' },
    { label: t.dashboard.unpaidTotal, value: formatJpy(totalUnpaid), icon: AlertCircle, mom: null, sub: overdueCount > 0 ? `${t.dashboard.overdue} ${overdueCount}${t.common.cases}` : `${unpaidOrders.length}${t.dashboard.unpaidCount}`, spark: null, sparkLabels: [] as string[], sparkFmt: formatJpy, color: '#ef4444', href: '/payments' },
  ]

  // 운영 현황 / 할 일 타일
  const ops = [
    { label: t.dashboard.procureNeeded, value: procure.needed, icon: ClipboardList, cls: 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800/50 text-red-600 dark:text-red-400', href: '/backorders' },
    { label: t.dashboard.procureOrdered, value: procure.ordered, icon: Truck, cls: 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800/50 text-blue-600 dark:text-blue-400', href: '/backorders' },
    { label: t.dashboard.shippingPending, value: pendingShipment, icon: Package, cls: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-100 dark:border-yellow-800/50 text-yellow-600 dark:text-yellow-500', href: '/orders?status=confirmed' },
    { label: t.dashboard.supplierPayable, value: supplierPayable.count, icon: Banknote, cls: 'bg-purple-50 dark:bg-purple-900/20 border-purple-100 dark:border-purple-800/50 text-purple-600 dark:text-purple-400', href: '/purchase-orders?status=confirmed' },
    { label: t.dashboard.overduePO, value: overduePO, icon: AlertTriangle, cls: 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800/50 text-orange-600 dark:text-orange-400', href: '/purchase-orders' },
    { label: t.dashboard.priceUnset, value: unpricedTotal, icon: Tag, cls: 'bg-gray-50 dark:bg-gray-700/40 border-gray-100 dark:border-gray-600 text-gray-600 dark:text-gray-300', href: '/products?noPrice=1' },
  ]

  // 매출 추세 차트 스케일
  const maxTrend = Math.max(...trend.map(m => m.sales), 1)

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.dashboard.title}</h1>
        <p className="text-gray-600 dark:text-gray-400 text-sm mt-1 font-medium">
          {now.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })} {t.dashboard.subtitle}
        </p>
      </div>

      {/* 기간 선택 토글 */}
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider">{t.dashboard.performance}</span>
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {([['month', t.dashboard.periodMonth], ['6m', t.dashboard.period6m], ['all', t.dashboard.periodAll]] as const).map(([v, l]) => (
            <button key={v} onClick={() => setRange(v)}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${range === v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              {l}
            </button>
          ))}
        </div>
      </div>

      {/* A. 핵심 KPI 4 + 스파크라인 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map(({ label, value, icon: Icon, mom, sub, spark, sparkLabels, sparkFmt, color, href }) => (
          <Link key={label} href={href} className="bg-white dark:bg-gray-800 rounded-xl p-5 border border-gray-100 dark:border-gray-700/60 hover:border-gray-200 dark:hover:border-gray-600 transition-colors group block">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider truncate">{label}</p>
              <span className="flex items-center justify-center w-7 h-7 rounded-lg shrink-0" style={{ backgroundColor: `${color}1a`, color }}>
                <Icon className="w-4 h-4" />
              </span>
            </div>
            <div className="mt-2 flex items-baseline gap-1.5 flex-wrap">
              <p className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums">{value}</p>
              {mom && (
                <span className={`text-xs font-semibold ${mom.up ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>{mom.label}</span>
              )}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 font-medium">{sub}</p>
            {spark ? <Sparkline values={spark} color={color} labels={sparkLabels} fmt={sparkFmt} caption={t.dashboard.period6m} /> : <div className="h-10 mt-2" />}
          </Link>
        ))}
      </div>

      {/* C+D. 운영 현황 / 할 일 (액션 타일) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="w-4 h-4 text-gray-400" />
            {t.dashboard.operationStatus}
          </h2>
        </div>
        <div className="grid grid-cols-3 lg:grid-cols-6 gap-3">
          {ops.map(({ label, value, icon: Icon, cls, href }) => (
            <Link key={label} href={href} className={`rounded-lg p-3 border ${cls} hover:opacity-80 transition-opacity flex flex-col items-center text-center gap-1`}>
              <Icon className="w-4 h-4" />
              <p className="text-2xl font-bold tabular-nums leading-none">{formatNumber(value)}</p>
              <p className="text-[11px] font-medium leading-tight">{label}</p>
            </Link>
          ))}
        </div>
        {supplierPayable.amount > 0 && (
          <Link href="/purchase-orders?status=confirmed" className="mt-3 flex items-center justify-between px-3 py-2 rounded-lg bg-purple-50 dark:bg-purple-900/20 border border-purple-100 dark:border-purple-800/50 hover:opacity-80 transition-opacity">
            <span className="text-xs font-medium text-purple-700 dark:text-purple-300 flex items-center gap-1.5">
              <Banknote className="w-3.5 h-3.5" />{t.dashboard.supplierPayable}
            </span>
            <span className="text-sm font-bold text-purple-700 dark:text-purple-300 tabular-nums">{formatJpy(supplierPayable.amount)}</span>
          </Link>
        )}
      </div>

      {/* B. 매출 추세 차트 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-gray-400" />
            {t.dashboard.salesTrend}
          </h2>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#2f7d55' }} />{t.dashboard.profit}</span>
            <span className="flex items-center gap-1 text-gray-500 dark:text-gray-400"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300 dark:bg-gray-600 inline-block" />{t.common.cost}</span>
            <Link href="/analytics" className="text-blue-600 hover:underline font-medium">{t.common.detail}</Link>
          </div>
        </div>
        {trend.length === 0 || trend.every(m => m.sales === 0) ? (
          <p className="text-center text-sm text-gray-400 py-10">{t.common.noData}</p>
        ) : (
          <div className="flex items-end justify-between gap-2 h-48 pt-6">
            {trend.map(m => {
              const profit = m.sales - m.cost
              const margin = m.sales > 0 ? (profit / m.sales) * 100 : 0
              const hSales = (m.sales / maxTrend) * 100
              const hCost = (m.cost / maxTrend) * 100
              const hProfit = Math.max(0, hSales - hCost)
              const empty = m.sales === 0
              const compact = (v: number) => v >= 10000 ? `¥${Math.round(v / 10000).toLocaleString()}${t.dashboard.manUnit}` : formatJpy(v)
              return (
                <div key={`${m.year}-${m.month}`} className="flex-1 flex flex-col items-center justify-end h-full"
                  title={empty ? '' : `${m.month}${t.analytics.monthUnit} · ${t.dashboard.salesShort} ${formatJpy(m.sales)} · ${t.common.cost} ${formatJpy(m.cost)} · ${t.dashboard.profit} ${formatJpy(profit)} (${margin.toFixed(1)}%)`}>
                  {/* 매출 값(상시) */}
                  {!empty && <p className="text-[10px] font-bold text-gray-800 dark:text-gray-100 mb-1 whitespace-nowrap tabular-nums">{compact(m.sales)}</p>}
                  <div className="w-full max-w-[44px] flex flex-col justify-end" style={{ height: '100%' }}>
                    {empty ? (
                      <div className="w-full border-t border-dashed border-gray-200 dark:border-gray-600" />
                    ) : (
                      <>
                        <div className="w-full rounded-t" style={{ height: `${hProfit}%`, backgroundColor: '#2f7d55', minHeight: profit > 0 ? '3px' : '0' }} />
                        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-b" style={{ height: `${hCost}%` }} />
                      </>
                    )}
                  </div>
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-1.5 font-medium leading-none">{m.month}{t.analytics.monthUnit}</p>
                  {!empty && <p className="text-[10px] text-green-700 dark:text-green-400 font-medium leading-none mt-0.5">{margin.toFixed(0)}%</p>}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* E. 공급사별 상품 현황 (압축) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Package className="w-4 h-4 text-gray-400" />
            {t.dashboard.supplierStock}
          </h2>
          <div className="flex items-center gap-3 text-xs text-gray-600 dark:text-gray-300 font-medium">
            <span>{t.dashboard.totalProducts} <strong className="text-gray-900 dark:text-gray-100">{formatNumber(totalProducts)}</strong></span>
            <span>{t.dashboard.priceSet} <strong className="text-blue-600">{formatNumber(pricedProducts)}</strong></span>
            <Link href="/products" className="text-blue-600 hover:underline">{t.dashboard.manageProducts}</Link>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SUPPLIER_LIST.map(code => {
            const cnt = statsMap[code] ?? 0
            const unpricedCount = unpriced[code] ?? 0
            const color = SUPPLIER_COLORS[code] ?? '#6b7280'
            return (
              <Link key={code} href={`/products?supplier=${code}${unpricedCount > 0 ? '&noPrice=1' : ''}`}
                className="flex items-center gap-2 rounded-lg px-3 py-2 hover:opacity-80 transition-opacity"
                style={{ backgroundColor: `${color}14`, border: `1px solid ${color}33` }}>
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
                <span className="text-xs font-medium text-gray-700 dark:text-gray-200">{SUPPLIER_NAMES[lang][code] ?? code}</span>
                <span className="text-sm font-bold tabular-nums" style={{ color }}>{formatNumber(cnt)}</span>
                {unpricedCount > 0 && (
                  <span className="text-[10px] font-semibold text-orange-500 flex items-center gap-0.5">
                    <Tag className="w-2.5 h-2.5" />{formatNumber(unpricedCount)}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
      </div>

      {/* 미입금 알림 + 최근 주문 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            {t.dashboard.unpaidAlert}
          </h2>
          {unpaidOrders.length === 0 ? (
            <p className="text-gray-500 text-sm text-center py-8">{t.dashboard.noUnpaid}</p>
          ) : (
            <div className="space-y-2">
              {unpaidOrders.slice(0, 6).map(order => {
                const remain = order.totalAmountJpy - order.paidAmountJpy
                const overdue = order.dueDate && new Date(order.dueDate) < now
                const daysOverdue = overdue && order.dueDate
                  ? Math.floor((now.getTime() - new Date(order.dueDate).getTime()) / 86400000)
                  : 0
                return (
                  <div key={order.id} className={`flex items-center justify-between p-3 rounded-lg text-sm ${overdue ? 'bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50' : 'bg-gray-50 dark:bg-gray-700/50'}`}>
                    <div>
                      <p className="font-medium text-gray-900 dark:text-gray-100">{order.customer.name}</p>
                      <p className="text-gray-600 dark:text-gray-400 text-xs font-medium">{order.orderNo}</p>
                    </div>
                    <div className="text-right">
                      <p className={`font-semibold ${overdue ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}>{formatJpy(remain)}</p>
                      {overdue ? (
                        <p className="text-red-500 text-xs font-medium">{daysOverdue}{t.dashboard.overdue}</p>
                      ) : order.dueDate ? (
                        <p className="text-gray-500 dark:text-gray-400 text-xs font-medium">{new Date(order.dueDate).toLocaleDateString('ja-JP')} {t.dashboard.due}</p>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <ShoppingCart className="w-4 h-4 text-gray-400" />
              {t.dashboard.recentOrders}
            </h2>
            <Link href="/orders/new" className="text-xs text-blue-600 hover:underline font-medium">{t.dashboard.newOrder}</Link>
          </div>
          {recentOrders.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm mb-3">{t.dashboard.noOrders}</p>
              <Link href="/orders/new" className="inline-flex items-center gap-1 text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700">
                {t.dashboard.firstOrder}
              </Link>
            </div>
          ) : (
            <div className="space-y-2">
              {recentOrders.map(order => {
                const suppliers = [...new Set(order.items.map(i => i.product.supplierCode))]
                const { margin } = calcProfitRate(order.totalAmountJpy, order.totalCostJpy)
                return (
                  <div key={order.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{order.customer.name}</p>
                        <div className="flex gap-1">
                          {suppliers.slice(0, 2).map(s => <SupplierBadge key={s} code={s} />)}
                        </div>
                      </div>
                      <p className="text-gray-500 dark:text-gray-400 text-xs font-medium">{new Date(order.orderDate).toLocaleDateString('ja-JP')} · {order.orderNo}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{formatJpy(order.totalAmountJpy)}</p>
                      <p className={`text-xs ${margin >= 40 ? 'text-green-600' : margin >= 25 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {t.orders.margin} {margin.toFixed(1)}%
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
