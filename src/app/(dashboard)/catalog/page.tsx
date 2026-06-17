'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, RefreshCw, ChevronLeft, ChevronRight, Link2, Link2Off, X, Check, Wand2 } from 'lucide-react'
import { formatNumber, SUPPLIER_COLORS } from '@/lib/utils'
import Image from 'next/image'
import { useT } from '@/lib/i18n'

type MatchedProduct = {
  id: number; name: string; brand: string; productCode: string
  supplierCode: string; costPrice: number; salePriceJpy: number
  supplier: { currency: string }
}

type CatalogItem = {
  id: number; productCode: string; brand: string; name: string
  priceJpy: number; priceJpyNotax: number; msrpJpy: number
  imageUrl1: string; imageUrl2: string; url: string
  supplierProductId: number | null
  matchedProduct: MatchedProduct | null
}

type SupplierProduct = {
  id: number; name: string; brand: string; productCode: string
  supplierCode: string; costPrice: number; salePriceJpy: number
  supplier: { currency: string }
}

type CatalogStats = {
  total: number; matched: number; unmatched: number
  bySupplier: Record<string, number>
}

const PAGE_SIZE = 96

// ── 매칭 모달 ─────────────────────────────────────────
function MatchModal({
  item,
  onClose,
  onMatch,
}: {
  item: CatalogItem
  onClose: () => void
  onMatch: (catalogId: number, product: SupplierProduct | null) => void
}) {
  const tr = useT()
  const [q, setQ] = useState(item.brand ? item.brand.split(' ')[0] : '')
  const [results, setResults] = useState<SupplierProduct[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const search = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    const res = await fetch(`/api/products?q=${encodeURIComponent(query)}&limit=30`)
    const data = await res.json()
    setResults(data.products ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    const t = setTimeout(() => search(q), 300)
    return () => clearTimeout(t)
  }, [q, search])

  const handleSelect = async (product: SupplierProduct | null) => {
    setSaving(true)
    await fetch('/api/arico-catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, supplierProductId: product?.id ?? null }),
    })
    onMatch(item.id, product)
    setSaving(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-start justify-between">
          <div>
            <p className="text-xs text-gray-600 dark:text-gray-400 font-medium mb-0.5">{tr.catalog.modalTitle}</p>
            <p className="font-semibold text-gray-900 dark:text-gray-100 line-clamp-1">{item.name}</p>
            {item.matchedProduct && (
              <div className="mt-1 flex items-center gap-2">
                <span className="text-xs text-green-600 font-medium">{tr.catalog.currentMatch}</span>
                <span className="text-xs text-gray-600 dark:text-gray-400">{item.matchedProduct.name}</span>
                <button
                  onClick={() => handleSelect(null)}
                  disabled={saving}
                  className="text-xs text-red-500 hover:text-red-700 flex items-center gap-0.5"
                >
                  <Link2Off className="w-3 h-3" /> {tr.catalog.unlinkMatch}
                </button>
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded"><X className="w-4 h-4" /></button>
        </div>

        {/* 검색 */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={tr.catalog.searchPlaceholder}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        {/* 결과 */}
        <div className="overflow-y-auto flex-1">
          {loading && <div className="text-center py-8 text-gray-400 text-sm">{tr.catalog.searching}</div>}
          {!loading && results.length === 0 && q && (
            <div className="text-center py-8 text-gray-400 text-sm">{tr.catalog.noResults}</div>
          )}
          {!loading && results.length === 0 && !q && (
            <div className="text-center py-8 text-gray-400 text-sm">{tr.catalog.enterSearch}</div>
          )}
          {results.map(p => {
            const isSelected = item.supplierProductId === p.id
            const color = SUPPLIER_COLORS[p.supplierCode] ?? '#6b7280'
            return (
              <button
                key={p.id}
                onClick={() => handleSelect(p)}
                disabled={saving}
                className={`w-full flex items-center gap-4 px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left border-b border-gray-50 dark:border-gray-700 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
              >
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold text-white flex-shrink-0 w-14 justify-center"
                  style={{ backgroundColor: color }}
                >{p.supplierCode}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{p.brand} · {p.productCode}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-700 dark:text-gray-200">
                    {p.supplier.currency} {formatNumber(p.costPrice)}
                  </p>
                  {p.salePriceJpy > 0 && (
                    <p className="text-xs text-blue-600">¥{formatNumber(p.salePriceJpy)}</p>
                  )}
                </div>
                {isSelected && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

type PreviewItem = {
  catName: string; translated?: string; prodName: string; supplier: string; score: number
}
type AutoMatchResult = {
  matched: number; saved: number; priceApplied: number; lowScore: number; noSupplier: number
  total: number; bySup: Record<string, number>; dryRun: boolean
  preview?: PreviewItem[]
} | null

// ── 메인 페이지 ──────────────────────────────────────
export default function CatalogPage() {
  const t = useT()
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<'all' | 'matched' | 'unmatched'>('all')
  const [items, setItems] = useState<CatalogItem[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [modalItem, setModalItem] = useState<CatalogItem | null>(null)
  const [krwPerJpy] = useState(9.5)
  const [autoMatching, setAutoMatching] = useState(false)
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchResult>(null)
  const [stats, setStats] = useState<CatalogStats | null>(null)

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch('/api/arico-catalog?stats=1')
      const data = await res.json()
      setStats(data)
    } catch { /* 무시 */ }
  }, [])

  useEffect(() => { fetchStats() }, [fetchStats])

  const fetchItems = useCallback(async (currentPage = 1) => {
    setLoading(true)
    const params = new URLSearchParams({
      q,
      limit: String(PAGE_SIZE),
      offset: String((currentPage - 1) * PAGE_SIZE),
      ...(filter === 'matched' ? { matchedOnly: '1' } : filter === 'unmatched' ? { unmatchedOnly: '1' } : {}),
    })
    const res = await fetch(`/api/arico-catalog?${params}`)
    const data = await res.json()
    setItems(data.rows)
    setTotal(data.total)
    setLoading(false)
  }, [q, filter])

  useEffect(() => {
    setPage(1)
    const t = setTimeout(() => fetchItems(1), 300)
    return () => clearTimeout(t)
  }, [fetchItems])

  useEffect(() => { fetchItems(page) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleMatch = (catalogId: number, product: SupplierProduct | null) => {
    setItems(prev => prev.map(item =>
      item.id === catalogId
        ? { ...item, supplierProductId: product?.id ?? null, matchedProduct: product ?? null }
        : item
    ))
    fetchStats()
  }

  const handleAutoMatch = async (dryRun = false) => {
    setAutoMatching(true)
    setAutoMatchResult(null)
    try {
      const res = await fetch('/api/auto-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, threshold: 0.45 }),
      })
      const data = await res.json()
      setAutoMatchResult(data)
      if (!dryRun && data.saved > 0) {
        // 결과 반영
        fetchItems(page)
        fetchStats()
      }
    } catch (e) {
      console.error(e)
    }
    setAutoMatching(false)
  }

  return (
    <div className="p-4">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.catalog.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 font-medium text-sm mt-1">arico-archery.com · {t.common.total} {formatNumber(total)}{t.common.items}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-600 dark:text-gray-400 font-medium">
            {t.catalog.jpyRate} <span className="font-semibold text-gray-900 dark:text-gray-100">¥1 ≈ ₩{krwPerJpy}</span>
          </div>
          <button
            onClick={() => handleAutoMatch(true)}
            disabled={autoMatching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
            title={t.catalog.previewTooltip}
          >
            <Wand2 className="w-3.5 h-3.5" />
            {t.catalog.preview}
          </button>
          <button
            onClick={() => handleAutoMatch(false)}
            disabled={autoMatching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            title={t.catalog.autoMatchTooltip}
          >
            {autoMatching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {t.catalog.autoMatch}
          </button>
        </div>
      </div>

      {/* 매칭율 요약 */}
      {stats && (() => {
        const pct = stats.total > 0 ? (stats.matched / stats.total) * 100 : 0
        const sorted = Object.entries(stats.bySupplier).sort((a, b) => b[1] - a[1])
        return (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700 p-5 mb-3">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mb-1">{t.catalog.matchRate}</p>
                <div className="flex items-baseline gap-1">
                  <span className="text-4xl font-semibold text-gray-900 dark:text-white tabular-nums leading-none">{pct.toFixed(1)}</span>
                  <span className="text-lg text-gray-500 dark:text-gray-400">%</span>
                </div>
              </div>
              <div className="text-right text-sm text-gray-500 dark:text-gray-400 tabular-nums">
                <p>
                  <span className="font-semibold text-gray-900 dark:text-gray-100">{formatNumber(stats.matched)}</span> {t.catalog.matchedCount}
                  {' · '}
                  <span className="font-medium">{formatNumber(stats.unmatched)}</span> {t.catalog.unmatchedCount}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t.common.total} {formatNumber(stats.total)}{t.common.items}</p>
              </div>
            </div>
            {/* 누적 구성 바 — 공급사별 비율 + 미매칭(회색) */}
            <div className="mt-4 h-2 w-full rounded-full overflow-hidden flex bg-gray-100 dark:bg-gray-700">
              {sorted.map(([code, n]) => (
                <div key={code} style={{ width: `${(n / stats.total) * 100}%`, backgroundColor: SUPPLIER_COLORS[code] ?? '#6b7280' }} title={`${code} ${n}`} />
              ))}
            </div>
            {/* 레전드 */}
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-x-4 gap-y-1.5">
              {sorted.map(([code, n]) => (
                <span key={code} className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <span className="w-2 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: SUPPLIER_COLORS[code] ?? '#6b7280' }} />
                  {code}
                  <b className="ml-auto font-medium text-gray-900 dark:text-gray-100 tabular-nums">{formatNumber(n)}</b>
                </span>
              ))}
            </div>
          </div>
        )
      })()}

      {/* 자동 매칭 결과 */}
      {autoMatchResult && (
        <div className={`mb-3 p-3 rounded-xl text-sm flex items-start justify-between gap-4 ${autoMatchResult.dryRun ? 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200' : 'bg-green-50 dark:bg-green-900/20 border border-green-200'}`}>
          <div>
            <p className="font-semibold text-gray-800 dark:text-gray-100">
              {autoMatchResult.dryRun ? t.catalog.previewResultLabel : t.catalog.autoMatchDoneLabel}
              {' — '}
              {autoMatchResult.dryRun
                ? `${t.catalog.matchablePrefix} ${autoMatchResult.matched}${t.common.items} (${t.catalog.unsaved})`
                : `${autoMatchResult.saved}${t.common.items} ${t.common.saved}${autoMatchResult.priceApplied > 0 ? ` · ${autoMatchResult.priceApplied}${t.common.items} ${t.catalog.priceAutoApplied}` : ''}`}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {t.catalog.targetLabel} {autoMatchResult.total}{t.common.items} | {t.catalog.lowScoreLabel} {autoMatchResult.lowScore}{t.common.items} | {t.catalog.noSupplierLabel} {autoMatchResult.noSupplier}{t.common.items}
            </p>
            {Object.keys(autoMatchResult.bySup).length > 0 && (
              <p className="text-xs text-gray-600 dark:text-gray-300 mt-1">
                {Object.entries(autoMatchResult.bySup).sort((a, b) => b[1] - a[1]).map(([s, n]) => `${s}: ${n}`).join(' · ')}
              </p>
            )}
            {/* JVD 카타카나 변환 미리보기 */}
            {autoMatchResult.preview && autoMatchResult.preview.some(p => p.translated) && (
              <div className="mt-2 space-y-0.5">
                <p className="text-[10px] font-semibold text-gray-500 dark:text-gray-400">{t.catalog.jvdKatakanaSample}</p>
                {autoMatchResult.preview.filter(p => p.translated).slice(0, 5).map((p, i) => (
                  <div key={i} className="text-[10px] text-gray-500 dark:text-gray-400 flex gap-1 flex-wrap">
                    <span className="text-gray-700 dark:text-gray-200">{p.catName}</span>
                    <span>→</span>
                    <span className="text-blue-600 dark:text-blue-400 font-medium">{p.translated}</span>
                    <span className="text-gray-400">≈</span>
                    <span className="text-green-600 dark:text-green-400">{p.prodName}</span>
                    <span className="text-gray-400">({(p.score * 100).toFixed(0)}%)</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={() => setAutoMatchResult(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 검색 + 필터 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-3 mb-3 flex gap-2 items-center">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t.catalog.productSearchPlaceholder}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          {(['all', 'matched', 'unmatched'] as const).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${filter === f ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}
            >
              {f === 'all' ? t.catalog.filterAll : f === 'matched' ? t.catalog.filterMatched : t.catalog.filterUnmatched}
            </button>
          ))}
        </div>
        <button onClick={() => fetchItems(page)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 상품 그리드 — 화면 크기별 자동 컬럼 조정 */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
        {items.map(item => {
          const priceKrw = Math.round(item.priceJpyNotax * krwPerJpy)
          const img = item.imageUrl2 || item.imageUrl1
          const matched = item.matchedProduct
          return (
            <div key={item.id} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col group">
              {/* 이미지 (축소) */}
              {img ? (
                <div className="aspect-[1/1] bg-gray-50 dark:bg-gray-700 relative overflow-hidden">
                  <Image src={img} alt={item.name} fill className="object-contain p-1" unoptimized />
                </div>
              ) : (
                <div className="aspect-[1/1] bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-300 text-2xl">□</div>
              )}

              {/* 정보 (컴팩트) */}
              <div className="p-1.5 flex flex-col flex-1">
                {item.brand && (
                  <p className="text-[10px] font-bold text-blue-600 dark:text-blue-400 leading-none mb-0.5 truncate">{item.brand}</p>
                )}
                <p className="text-[11px] font-medium text-gray-800 dark:text-gray-100 leading-tight line-clamp-2 mb-1 flex-1">{item.name}</p>

                {/* 가격 + 링크 */}
                <div className="flex items-baseline justify-between mb-1">
                  <div>
                    <span className="text-xs font-bold text-gray-900 dark:text-gray-100">¥{formatNumber(item.priceJpy)}</span>
                    <span className="text-[10px] text-gray-400 dark:text-gray-500 ml-1">₩{formatNumber(priceKrw)}</span>
                  </div>
                  {item.url && (
                    <a href={item.url} target="_blank" rel="noopener noreferrer"
                       className="text-[10px] text-blue-500 hover:underline flex-shrink-0"
                       onClick={e => e.stopPropagation()}>{t.common.view}</a>
                  )}
                </div>

                {/* 매칭 버튼 (컴팩트) */}
                <button
                  onClick={() => setModalItem(item)}
                  className={`w-full flex items-center gap-1 px-1.5 py-1 rounded text-[10px] font-medium transition-colors ${
                    matched
                      ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/30 border border-green-200 dark:border-green-800/50'
                      : 'bg-gray-50 dark:bg-gray-700/50 text-gray-400 dark:text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 border border-gray-200 dark:border-gray-600'
                  }`}
                >
                  {matched ? (
                    <>
                      <Link2 className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate">
                        <span
                          className="inline-block px-0.5 rounded text-white text-[9px] font-bold mr-0.5"
                          style={{ backgroundColor: SUPPLIER_COLORS[matched.supplierCode] ?? '#6b7280' }}
                        >{matched.supplierCode}</span>
                        {matched.name}
                      </span>
                    </>
                  ) : (
                    <>
                      <Link2Off className="w-2.5 h-2.5 flex-shrink-0" />
                      <span>{t.catalog.matchButton}</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )
        })}
        {!loading && items.length === 0 && (
          <div className="col-span-full text-center py-16 text-gray-400">{t.catalog.noProducts}</div>
        )}
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-600 dark:text-gray-300 font-medium">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {formatNumber(total)}개
          </p>
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-xl shadow-sm px-3 py-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30">
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
              let p: number
              if (totalPages <= 7) p = i + 1
              else if (page <= 4) p = i + 1
              else if (page >= totalPages - 3) p = totalPages - 6 + i
              else p = page - 3 + i
              return (
                <button key={p} onClick={() => setPage(p)}
                  className={`px-2.5 py-1 rounded text-xs font-medium ${page === p ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                >{p}</button>
              )
            })}
            <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
              className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 매칭 모달 */}
      {modalItem && (
        <MatchModal
          item={modalItem}
          onClose={() => setModalItem(null)}
          onMatch={handleMatch}
        />
      )}
    </div>
  )
}
