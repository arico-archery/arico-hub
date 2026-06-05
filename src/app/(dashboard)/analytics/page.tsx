'use client'

import { useState, useEffect } from 'react'
import { formatJpy, calcProfitRate } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import ProfitBar from '@/components/ProfitBar'
import { BarChart3, Users, TrendingUp, DollarSign, ShoppingCart, RefreshCw, Tag, AlertTriangle } from 'lucide-react'
import { useT } from '@/lib/i18n'

// ── 타입 ─────────────────────────────────────────────
type MonthData = { label: string; month: number; year: number; sales: number; cost: number; count: number }
type SupplierStat = { sales: number; cost: number }
type TopItem = {
  productId: number; count: number; sales: number; cost: number
  product: { name: string; supplierCode: string } | null
}
type TopCustomer = {
  customerId: number; count: number; sales: number; cost: number; paid: number
  customer: { name: string; company: string } | null
}
type BrandStat = { brand: string; sales: number; cost: number; qty: number }
type Receivable = {
  customerId: number; name: string; company: string
  orderCount: number; balance: number; overdue: number
}
type AnalyticsData = {
  monthlyData: MonthData[]
  allTime: { sales: number; cost: number; count: number }
  topItems: TopItem[]
  supplierStats: Record<string, SupplierStat>
  brandStats: BrandStat[]
  receivables: Receivable[]
  totalReceivable: number
  totalOverdue: number
  topCustomers: TopCustomer[]
}

const RANGE_KEYS = ['6m', '12m', 'ytd', 'all'] as const
type Range = typeof RANGE_KEYS[number]

export default function AnalyticsPage() {
  const t = useT()
  const [range, setRange] = useState<Range>('6m')
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/analytics?range=${range}`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [range])

  if (loading || !data) {
    return (
      <div className="p-6 flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-gray-400">
          <RefreshCw className="w-4 h-4 animate-spin" />
          <span>{t.common.loading}</span>
        </div>
      </div>
    )
  }

  const { monthlyData, allTime, topItems, supplierStats, brandStats, receivables, totalReceivable, totalOverdue, topCustomers } = data
  const maxSales = Math.max(...monthlyData.map(m => m.sales), 1)
  const maxBrandSales = Math.max(...brandStats.map(b => b.sales), 1)

  const totalProfit = allTime.sales - allTime.cost
  const { margin: totalMargin } = calcProfitRate(allTime.sales, allTime.cost)

  const recentSales = monthlyData[monthlyData.length - 1]?.sales ?? 0
  const prevSales = monthlyData[monthlyData.length - 2]?.sales ?? 0
  const momChange = prevSales > 0 ? ((recentSales - prevSales) / prevSales) * 100 : 0

  const RANGE_LABELS: Record<Range, string> = {
    '6m':  t.analytics.range6m,
    '12m': t.analytics.range12m,
    'ytd': t.analytics.rangeYtd,
    'all': t.analytics.rangeAll,
  }
  const rangeLabel = RANGE_LABELS[range] ?? ''

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.analytics.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 font-medium text-sm mt-1">{rangeLabel} {t.analytics.sales} · {t.analytics.profit}</p>
        </div>
        {/* 기간 필터 */}
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          {RANGE_KEYS.map(key => (
            <button
              key={key}
              onClick={() => setRange(key)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                range === key
                  ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
              }`}
            >
              {RANGE_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-blue-500">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t.analytics.cumulativeSales}</p>
              <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{formatJpy(allTime.sales)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t.analytics.totalOrders} {allTime.count}{t.common.cases}</p>
            </div>
            <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded-lg"><DollarSign className="w-5 h-5 text-gray-400" /></div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-green-500">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t.analytics.cumulativeProfit}</p>
              <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{formatJpy(totalProfit)}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t.analytics.margin} {totalMargin.toFixed(1)}%</p>
            </div>
            <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded-lg"><TrendingUp className="w-5 h-5 text-gray-400" /></div>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 border-l-4 border-indigo-500">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">{t.analytics.thisMonth}</p>
              <p className="mt-1 text-xl font-bold text-gray-900 dark:text-white">{formatJpy(recentSales)}</p>
              <p className={`text-xs mt-1 font-medium ${momChange >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                {momChange >= 0 ? '▲' : '▼'} {t.analytics.momChange} {Math.abs(momChange).toFixed(1)}%
              </p>
            </div>
            <div className="p-2 bg-gray-50 dark:bg-gray-700 rounded-lg"><ShoppingCart className="w-5 h-5 text-gray-400" /></div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6 mb-6">
        {/* 월별 추이 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-blue-500" />
            {t.analytics.monthlyTrend}
          </h2>
          <div className="space-y-3">
            {monthlyData.map(m => {
              const profit = m.sales - m.cost
              const { margin } = calcProfitRate(m.sales, m.cost)
              const barW = m.sales > 0 ? (m.sales / maxSales) * 100 : 0
              const monthLabel = `${m.month}${t.analytics.monthUnit}`
              return (
                <div key={m.label}>
                  <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-300 mb-1">
                    <span className="font-medium text-gray-700 dark:text-gray-200">
                      {monthLabel}
                      <span className="text-gray-400 dark:text-gray-500 font-normal ml-1">({m.count}{t.common.cases})</span>
                    </span>
                    <span>
                      {formatJpy(m.sales)}
                      {profit > 0 && <span className="text-green-600 font-medium ml-1">(+{formatJpy(profit)})</span>}
                    </span>
                  </div>
                  <div className="h-5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full transition-all" style={{ width: `${barW}%` }} />
                  </div>
                  {m.sales > 0 && (
                    <div className="text-right text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {t.analytics.margin} {margin.toFixed(1)}%
                    </div>
                  )}
                </div>
              )
            })}
            {monthlyData.every(m => m.sales === 0) && (
              <p className="text-gray-400 text-sm text-center py-8">{t.common.noData}</p>
            )}
          </div>
        </div>

        {/* 공급사별 매출 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4">{t.analytics.bySupplier}</h2>
          {Object.keys(supplierStats).length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">{t.common.noData}</p>
          ) : (
            <div className="space-y-3">
              {Object.entries(supplierStats)
                .sort((a, b) => b[1].sales - a[1].sales)
                .map(([code, stat]) => {
                  const { margin } = calcProfitRate(stat.sales, stat.cost)
                  return (
                    <div key={code} className="flex items-center gap-3">
                      <SupplierBadge code={code} />
                      <div className="flex-1">
                        <ProfitBar margin={margin} showLabel={false} />
                      </div>
                      <div className="text-right text-sm">
                        <p className="font-medium text-gray-900 dark:text-gray-100">{formatJpy(stat.sales)}</p>
                        <p className="text-gray-500 dark:text-gray-400 text-xs">{t.analytics.margin} {margin.toFixed(1)}%</p>
                      </div>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>

      {/* 브랜드별 매출 + 거래처 미수금 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* 브랜드별 매출 TOP 10 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Tag className="w-4 h-4 text-purple-500" />
            {t.analytics.byBrand}
          </h2>
          {brandStats.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">{t.common.noData}</p>
          ) : (
            <div className="space-y-2.5">
              {brandStats.map(b => {
                const { margin } = calcProfitRate(b.sales, b.cost)
                const pct = (b.sales / maxBrandSales) * 100
                return (
                  <div key={b.brand} className="text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-gray-900 dark:text-gray-100 truncate">{b.brand}</span>
                      <span className="text-gray-700 dark:text-gray-300 font-semibold whitespace-nowrap ml-2">{formatJpy(b.sales)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
                        <div className="h-full rounded-full bg-purple-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap w-24 text-right">
                        {t.analytics.margin} {margin.toFixed(1)}% · {b.qty}{t.common.items}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* 거래처별 미수금 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-500" />
              {t.analytics.receivables}
            </h2>
            <div className="text-right text-xs">
              <p className="font-bold text-red-600 dark:text-red-400">{formatJpy(totalReceivable)}</p>
              {totalOverdue > 0 && <p className="text-red-500">{t.analytics.overdueAmount} {formatJpy(totalOverdue)}</p>}
            </div>
          </div>
          {receivables.length === 0 ? (
            <p className="text-gray-400 text-sm text-center py-8">{t.analytics.noReceivables}</p>
          ) : (
            <div className="space-y-2">
              {receivables.map(r => (
                <div key={r.customerId} className="flex items-center gap-3 p-2.5 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{r.name}</p>
                    {r.company && <p className="text-gray-500 dark:text-gray-400 text-xs truncate">{r.company}</p>}
                  </div>
                  <span className="text-gray-500 dark:text-gray-400 text-xs whitespace-nowrap">{r.orderCount}{t.common.cases}</span>
                  <div className="text-right whitespace-nowrap">
                    <p className="font-semibold text-red-600 dark:text-red-400">{formatJpy(r.balance)}</p>
                    {r.overdue > 0 && <p className="text-red-500 text-xs">{t.analytics.overdueLabel} {formatJpy(r.overdue)}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 거래처별 TOP 8 */}
      {topCustomers.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5 mb-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Users className="w-4 h-4 text-blue-500" />
            {t.analytics.topCustomers}
          </h2>
          <div className="space-y-2">
            {topCustomers.map((item, idx) => {
              if (!item.customer) return null
              const unpaid = item.sales - item.paid
              return (
                <div key={item.customerId} className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
                  <span className="text-gray-600 dark:text-gray-300 font-bold text-sm w-5 text-center">{idx + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-gray-900 dark:text-gray-100 truncate">{item.customer.name}</p>
                    {item.customer.company && <p className="text-gray-500 dark:text-gray-400 text-xs truncate">{item.customer.company}</p>}
                  </div>
                  <span className="text-gray-600 dark:text-gray-300 font-medium text-xs">{item.count}{t.common.cases}</span>
                  <div className="text-right">
                    <p className="font-semibold text-gray-900 dark:text-gray-100">{formatJpy(item.sales)}</p>
                    {unpaid > 0 && <p className="text-red-500 text-xs">{t.analytics.unpaid} {formatJpy(unpaid)}</p>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 매출 TOP 10 상품 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4">{t.analytics.topProducts}</h2>
        {topItems.length === 0 ? (
          <p className="text-gray-400 text-sm text-center py-8">{t.common.noData}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50">
                <th className="text-left px-4 py-2 font-semibold text-gray-700 dark:text-gray-200 w-8">#</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-700 dark:text-gray-200">{t.common.supplier}</th>
                <th className="text-left px-4 py-2 font-semibold text-gray-700 dark:text-gray-200">{t.common.product}</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-700 dark:text-gray-200">{t.common.qty}</th>
                <th className="text-right px-4 py-2 font-semibold text-gray-700 dark:text-gray-200">{t.analytics.sales}</th>
                <th className="px-4 py-2 font-semibold text-gray-700 dark:text-gray-200 w-40">{t.analytics.margin}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {topItems.map((item, idx) => {
                if (!item.product) return null
                const { margin } = calcProfitRate(item.sales, item.cost)
                return (
                  <tr key={item.productId} className="hover:bg-gray-50 dark:hover:bg-gray-700/50">
                    <td className="px-4 py-3 text-center font-bold text-gray-600 dark:text-gray-300">{idx + 1}</td>
                    <td className="px-4 py-3"><SupplierBadge code={item.product.supplierCode} /></td>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{item.product.name}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{item.count}{t.common.items}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100">{formatJpy(item.sales)}</td>
                    <td className="px-4 py-3"><ProfitBar margin={margin} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
