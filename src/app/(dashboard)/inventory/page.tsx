'use client'

import { useState, useEffect, useCallback } from 'react'
import { Warehouse, RefreshCw, Search, X, AlertTriangle, PackageCheck } from 'lucide-react'
import ConfirmDialog from '@/components/ConfirmDialog'
import { useT } from '@/lib/i18n'
import { formatJpy } from '@/lib/utils'

type Row = {
  id: number; productId: string; productCode: string; name: string; category: string
  size: string; color: string; price: number; stock: number; stockTokyo: number; stockAichi: number
}
type Resp = {
  rows: Row[]; total: number; page: number; limit: number
  lastSync: string | null; totalProducts: number; totalStock: number
}

export default function InventoryPage() {
  const t = useT()
  const [data, setData] = useState<Resp | null>(null)
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  // 재고 필터: 전체 / 재고 있음(>0) / 재고 없음(≤0). 토글 두 개면 둘 다 켜는 모순이 생겨 3택으로 둔다.
  const [stockFilter, setStockFilter] = useState<'all' | 'in' | 'low'>('all')
  const [page, setPage] = useState(1)
  const [confirm, setConfirm] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const p = new URLSearchParams({ page: String(page), limit: '50' })
    if (q) p.set('q', q)
    if (stockFilter !== 'all') p.set('stock', stockFilter)
    const res = await fetch(`/api/smaregi/inventory?${p}`)
    setData(await res.json())
    setLoading(false)
  }, [q, stockFilter, page])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [q, stockFilter])

  // 스마레지 동기화 — 커서 따라 반복 호출
  const runSync = async () => {
    setConfirm(false)
    setSyncing(true)
    setSyncMsg(t.inventory.syncing)
    let cursor: { phase: string; page: number } | null = null
    let totP = 0, totS = 0, guard = 0
    try {
      while (guard++ < 60) {
        const res = await fetch('/api/smaregi/sync-inventory', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(cursor ?? {}),
        })
        const txt = await res.text()
        let d: { ok?: boolean; done?: boolean; products?: number; stock?: number; next?: { phase: string; page: number }; error?: string }
        try { d = JSON.parse(txt) } catch { throw new Error('서버 응답 오류(타임아웃 가능) — 다시 시도해주세요') }
        if (!d.ok) throw new Error(d.error || '동기화 실패')
        totP += d.products ?? 0; totS += d.stock ?? 0
        setSyncMsg(`${t.inventory.syncing} (${totP} / ${totS})`)
        if (d.done) break
        cursor = d.next ?? null
      }
      setSyncMsg(`✅ ${t.inventory.syncDone}`)
      await load()
    } catch (e) {
      setSyncMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setSyncing(false)
    }
  }

  const fmtSync = (s: string | null) => s ? new Date(s).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : t.inventory.neverSynced
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1

  return (
    <div className="p-6">
      <div className="flex items-start justify-between mb-1 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Warehouse className="w-6 h-6 text-emerald-600" />{t.inventory.title}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">{t.inventory.subtitle}</p>
        </div>
        <button
          onClick={() => setConfirm(true)} disabled={syncing}
          className="flex items-center gap-2 bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />{t.inventory.sync}
        </button>
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 my-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t.inventory.totalProducts}</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{(data?.totalProducts ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t.inventory.totalStock}</p>
          <p className="text-xl font-bold text-gray-900 dark:text-white">{(data?.totalStock ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4">
          <p className="text-xs text-gray-500 dark:text-gray-400">{t.inventory.lastSync}</p>
          <p className="text-sm font-medium text-gray-900 dark:text-white mt-1">{fmtSync(data?.lastSync ?? null)}</p>
        </div>
      </div>

      {syncMsg && (
        <div className="mb-4 px-4 py-2.5 rounded-lg bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/50 text-emerald-800 dark:text-emerald-200 text-sm flex items-center justify-between">
          <span>{syncMsg}</span>
          {!syncing && <button onClick={() => setSyncMsg(null)}><X className="w-4 h-4" /></button>}
        </div>
      )}

      {/* 검색 · 필터 */}
      <div className="flex gap-3 items-center flex-wrap mb-4">
        <div className="relative min-w-56 flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-9 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
            placeholder={t.inventory.searchPlaceholder} value={q} onChange={e => setQ(e.target.value)}
          />
          {q && <button onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600"><X className="w-3.5 h-3.5" /></button>}
        </div>
        {/* 재고 필터 — 전체 / 재고 있음 / 재고 없음 */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">{t.inventory.stockFilter}</span>
          <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
            {([
              ['all', t.common.all, ''],
              ['in', t.inventory.inStockOnly, 'bg-emerald-600'],
              ['low', t.inventory.lowOnly, 'bg-red-600'],
            ] as const).map(([v, label, active]) => (
              <button
                key={v}
                onClick={() => setStockFilter(v)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors border-r last:border-r-0 border-gray-200 dark:border-gray-600 ${
                  stockFilter === v
                    ? `${active || 'bg-slate-700'} text-white`
                    : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                {v === 'low' && <AlertTriangle className="w-3.5 h-3.5" />}
                {v === 'in' && <PackageCheck className="w-3.5 h-3.5" />}
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 테이블 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-600">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colCategory}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colName}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colOption}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colCode}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colPrice}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colTotal}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colTokyo}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.inventory.colAichi}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {loading ? (
              <tr><td colSpan={8} className="text-center py-16 text-gray-400">{t.common.loading}</td></tr>
            ) : !data?.rows.length ? (
              <tr><td colSpan={8} className="text-center py-16 text-gray-400">
                <Warehouse className="w-8 h-8 mx-auto mb-2 opacity-30" /><p>{t.inventory.empty}</p>
              </td></tr>
            ) : data.rows.map(r => (
              <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.category || '-'}</td>
                <td className="px-4 py-3 font-medium text-gray-900 dark:text-gray-100">{r.name}</td>
                <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{[r.size, r.color].filter(Boolean).join(' / ') || '-'}</td>
                <td className="px-4 py-3 text-xs text-gray-400 font-mono">{r.productCode}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700 dark:text-gray-300">{formatJpy(r.price)}</td>
                <td className={`px-4 py-3 text-right tabular-nums font-bold ${r.stock <= 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>{r.stock.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.stockTokyo.toLocaleString()}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-600 dark:text-gray-300">{r.stockAichi.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {data && data.total > data.limit && (
        <div className="flex items-center justify-center gap-3 mt-4 text-sm">
          <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40">‹</button>
          <span className="text-gray-600 dark:text-gray-300">{page} / {totalPages}</span>
          <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40">›</button>
        </div>
      )}

      <ConfirmDialog open={confirm} title={t.inventory.sync} message={t.inventory.syncConfirm} confirmText={t.common.confirm} cancelText={t.common.cancel} onConfirm={runSync} onCancel={() => setConfirm(false)} />
    </div>
  )
}
