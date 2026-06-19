'use client'

import { useState, useEffect, useCallback, useRef, Fragment } from 'react'
import { Search, RefreshCw, ChevronLeft, ChevronRight, ChevronDown, Link2, Link2Off, X, Check, Wand2, ImageOff, Barcode, Languages, ScanLine, Layers, Plus, Trash2, CheckCircle } from 'lucide-react'
import BarcodeScanner from '@/components/BarcodeScanner'
import { formatNumber, SUPPLIER_COLORS } from '@/lib/utils'
import Image from 'next/image'
import { useT } from '@/lib/i18n'

type MatchedProduct = {
  id: number; name: string; brand: string; productCode: string
  supplierCode: string; costPrice: number; salePriceJpy: number; category?: string
  supplier: { currency: string }
}

type SkuRow = {
  id: number; barcode: string; name: string; optionLabel: string
  stockQty: number; source: string
}

type CatalogItem = {
  id: number; productCode: string; brand: string; name: string
  priceJpy: number; priceJpyNotax: number; msrpJpy: number
  imageUrl1: string; imageUrl2: string; url: string
  supplierProductId: number | null
  barcode: string
  matchedProduct: MatchedProduct | null
  variants: SkuRow[]
  stockTotal: number
}

type SupplierProduct = {
  id: number; name: string; brand: string; productCode: string
  supplierCode: string; costPrice: number; salePriceJpy: number
  supplier: { currency: string }
}
// 통합(그룹) 검색 결과 — JVD는 코드접두부로 묶임, 그 외는 1개씩
type GroupResult = {
  groupCode: string; base: string; brand: string; supplierCode: string
  count: number; repId: number; minSale: number; maxSale: number; pricedCount: number
}

type CatalogStats = {
  total: number; matched: number; unmatched: number
  bySupplier: Record<string, number>
}

const PAGE_SIZE = 96

// 카탈로그 상품 이미지 — URL이 없거나 로딩 실패 시 "이미지 없음" placeholder
function CatalogImage({ src, alt, label }: { src?: string; alt: string; label: string }) {
  const [err, setErr] = useState(false)
  if (!src || err) {
    return (
      <div className="aspect-[1/1] bg-gray-50 dark:bg-gray-700/40 flex flex-col items-center justify-center gap-1 text-gray-300 dark:text-gray-600">
        <ImageOff className="w-1/4 h-1/4" strokeWidth={1.5} />
        <span className="text-[10px] text-gray-400 dark:text-gray-500">{label}</span>
      </div>
    )
  }
  return (
    <div className="aspect-[1/1] bg-gray-50 dark:bg-gray-700 relative overflow-hidden">
      <Image src={src} alt={alt} fill className="object-contain p-1" unoptimized onError={() => setErr(true)} />
    </div>
  )
}

// ── 매칭 모달 ─────────────────────────────────────────
function MatchModal({
  item,
  onClose,
  onMatch,
}: {
  item: CatalogItem
  onClose: () => void
  onMatch: (catalogId: number, product: SupplierProduct | null, barcode?: string) => void
}) {
  const tr = useT()
  const [q, setQ] = useState(item.brand ? item.brand.split(' ')[0] : '')
  const [results, setResults] = useState<GroupResult[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [barcode, setBarcode] = useState(item.barcode ?? '')
  const [translating, setTranslating] = useState(false)
  const [showScanner, setShowScanner] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const translateSearch = async () => {
    if (!item.name) return
    setTranslating(true)
    try {
      const res = await fetch('/api/translate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: item.name, from: 'ja', to: 'en' }),
      })
      const d = await res.json()
      if (d.translated) setQ(d.translated)
    } catch { /* 무시 */ }
    setTranslating(false)
  }

  const saveBarcode = async () => {
    setSaving(true)
    await fetch('/api/arico-catalog', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, barcode }),
    })
    onMatch(item.id, item.matchedProduct, barcode)
    setSaving(false)
  }

  const search = useCallback(async (query: string) => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    // 통합(그룹) 검색 — JVD는 변형이 한 그룹으로 묶여서 나옴
    const res = await fetch(`/api/products/groups?q=${encodeURIComponent(query)}&page=1`)
    const data = await res.json()
    setResults(data.groups ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    inputRef.current?.focus()
    const t = setTimeout(() => search(q), 300)
    return () => clearTimeout(t)
  }, [q, search])

  // 그룹 선택 → 대표 변형(repId)으로 매칭. 주문 시 옵션(변형)을 선택한다.
  const handleSelect = async (group: GroupResult | null) => {
    setSaving(true)
    const pid = group?.repId ?? null
    await fetch('/api/arico-catalog', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, supplierProductId: pid, barcode }),
    })
    const synth: SupplierProduct | null = group ? {
      id: group.repId, name: group.base, brand: group.brand, productCode: group.groupCode,
      supplierCode: group.supplierCode, costPrice: 0, salePriceJpy: group.minSale, supplier: { currency: 'JPY' },
    } : null
    onMatch(item.id, synth, barcode)
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

        {/* 바코드(JAN) 바인딩 — 스캐너 입력 또는 수기 */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <Barcode className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            value={barcode}
            onChange={e => setBarcode(e.target.value)}
            placeholder={tr.catalog.barcodePlaceholder}
            className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button onClick={() => setShowScanner(true)} title={tr.common.scanTitle}
            className="px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 shrink-0">
            <ScanLine className="w-4 h-4" />
          </button>
          <button onClick={saveBarcode} disabled={saving}
            className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0">
            {tr.catalog.barcodeSave}
          </button>
        </div>
        {showScanner && (
          <BarcodeScanner onResult={code => { setBarcode(code); setShowScanner(false) }} onClose={() => setShowScanner(false)} />
        )}

        {/* 검색 (+ 일→영 번역 검색) */}
        <div className="px-6 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder={tr.catalog.searchPlaceholder}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button onClick={translateSearch} disabled={translating} title={tr.catalog.translateSearch}
            className="flex items-center gap-1 px-2.5 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 shrink-0">
            <Languages className={`w-3.5 h-3.5 ${translating ? 'animate-pulse' : ''}`} />
            {tr.catalog.translateSearch}
          </button>
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
          {results.map(g => {
            const isSelected = item.supplierProductId === g.repId
            const color = SUPPLIER_COLORS[g.supplierCode] ?? '#6b7280'
            return (
              <button
                key={g.groupCode}
                onClick={() => handleSelect(g)}
                disabled={saving}
                className={`w-full flex items-center gap-4 px-6 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors text-left border-b border-gray-50 dark:border-gray-700 ${isSelected ? 'bg-blue-50 dark:bg-blue-900/20' : ''}`}
              >
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold text-white flex-shrink-0 w-14 justify-center"
                  style={{ backgroundColor: color }}
                >{g.supplierCode}</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{g.base}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                    {g.brand ? `${g.brand} · ` : ''}{g.groupCode}
                    {g.count > 1 && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">
                        <Layers className="w-2.5 h-2.5" />{tr.catalog.variantsCount.replace('{n}', String(g.count))}
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  {g.pricedCount > 0 ? (
                    <p className="text-xs text-blue-600">
                      {g.minSale === g.maxSale ? `¥${formatNumber(g.minSale)}` : `¥${formatNumber(g.minSale)}~${formatNumber(g.maxSale)}`}
                    </p>
                  ) : <p className="text-xs text-gray-400">—</p>}
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
  // 변형(재고) 펼치기·편집
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [skuStock, setSkuStock] = useState<Record<number, string>>({})
  const [skuSaved, setSkuSaved] = useState<Set<number>>(new Set())
  const [addForm, setAddForm] = useState<{ catalogId: number; optionLabel: string; barcode: string; stockQty: string } | null>(null)
  const [skuScanOpen, setSkuScanOpen] = useState(false)

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
    const init: Record<number, string> = {}
    for (const it of (data.rows as CatalogItem[])) for (const v of it.variants) init[v.id] = String(v.stockQty)
    setSkuStock(prev => ({ ...prev, ...init }))
    setLoading(false)
  }, [q, filter])

  const toggleExpand = (id: number) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // 변형 재고 인라인 저장
  const saveSkuStock = async (catalogId: number, skuId: number) => {
    const val = Number(skuStock[skuId] ?? 0)
    const item = items.find(i => i.id === catalogId)
    const cur = item?.variants.find(v => v.id === skuId)?.stockQty ?? 0
    if (isNaN(val) || val === cur) return
    const res = await fetch(`/api/online-sku/${skuId}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stockQty: val }),
    })
    if (!res.ok) return
    setItems(prev => prev.map(i => i.id !== catalogId ? i : {
      ...i,
      variants: i.variants.map(v => v.id === skuId ? { ...v, stockQty: val } : v),
      stockTotal: i.stockTotal - cur + val,
    }))
    setSkuSaved(prev => new Set(prev).add(skuId))
    setTimeout(() => setSkuSaved(prev => { const s = new Set(prev); s.delete(skuId); return s }), 1800)
  }

  // 변형 추가 (해당 카탈로그 상품 아래)
  const submitAddVariant = async () => {
    if (!addForm) return
    const item = items.find(i => i.id === addForm.catalogId)
    await fetch('/api/online-sku', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        catalogId: addForm.catalogId,
        supplierProductId: item?.supplierProductId ?? null,
        name: item?.name ?? '',
        optionLabel: addForm.optionLabel,
        barcode: addForm.barcode,
        stockQty: Number(addForm.stockQty) || 0,
      }),
    })
    setAddForm(null)
    fetchItems(page)
  }

  const deleteVariant = async (skuId: number) => {
    await fetch(`/api/online-sku/${skuId}`, { method: 'DELETE' })
    fetchItems(page)
  }

  useEffect(() => {
    setPage(1)
    const t = setTimeout(() => fetchItems(1), 300)
    return () => clearTimeout(t)
  }, [fetchItems])

  useEffect(() => { fetchItems(page) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleMatch = (catalogId: number, product: SupplierProduct | null, barcode?: string) => {
    setItems(prev => prev.map(item =>
      item.id === catalogId
        ? { ...item, supplierProductId: product?.id ?? null, matchedProduct: product ?? null, ...(barcode !== undefined ? { barcode } : {}) }
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
        body: JSON.stringify({ dryRun, threshold: 0.65 }),
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
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-3 mb-3 flex gap-2 items-center">
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

      {/* 상품 + 변형(재고) 리스트 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-left">
              <th className="w-8 px-2 py-2.5" />
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200">{t.catalog.colItem}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200">{t.catalog.colCategory}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-center w-28">{t.catalog.colStockStatus}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-right w-28">{t.catalog.colPrice}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 w-56">{t.catalog.colMatch}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {items.map(item => {
              const img = item.imageUrl2 || item.imageUrl1
              const matched = item.matchedProduct
              const isOpen = expanded.has(item.id)
              const hasVar = item.variants.length > 0
              return (
                <Fragment key={item.id}>
                  <tr className={`transition-colors cursor-pointer ${isOpen ? 'bg-blue-50/40 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/40'}`} onClick={() => toggleExpand(item.id)}>
                    <td className="px-2 py-2 text-gray-400 text-center">{isOpen ? <ChevronDown className="w-4 h-4 inline" /> : <ChevronRight className="w-4 h-4 inline" />}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 shrink-0"><CatalogImage src={img} alt={item.name} label="" /></div>
                        <div className="min-w-0">
                          <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight truncate">{item.name}</p>
                          <p className="text-xs text-gray-400 flex items-center gap-1.5">
                            {item.brand && <span>{item.brand}</span>}
                            {item.barcode && <span className="inline-flex items-center gap-0.5"><Barcode className="w-3 h-3" />{item.barcode}</span>}
                            {hasVar && <span className="inline-flex items-center gap-0.5 text-blue-600 dark:text-blue-400"><Layers className="w-3 h-3" />{item.variants.length}</span>}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-gray-600 dark:text-gray-300 text-xs">{matched?.category || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {!hasVar
                        ? <span className="text-xs text-gray-400">{t.catalog.stockUnset}</span>
                        : item.stockTotal > 0
                          ? <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">{t.catalog.inStockShort} {item.stockTotal}</span>
                          : <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-300">{t.catalog.soldOut}</span>}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">{item.priceJpy > 0 ? `¥${formatNumber(item.priceJpy)}` : '—'}</td>
                    <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
                      <button onClick={() => setModalItem(item)}
                        className={`w-full flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
                          matched ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 border border-green-200 dark:border-green-800/50'
                                  : 'bg-gray-50 dark:bg-gray-700/50 text-gray-400 hover:bg-gray-100 border border-gray-200 dark:border-gray-600'}`}>
                        {matched ? (
                          <><Link2 className="w-3 h-3 shrink-0" /><span className="truncate"><span className="inline-block px-0.5 rounded text-white text-[9px] font-bold mr-0.5" style={{ backgroundColor: SUPPLIER_COLORS[matched.supplierCode] ?? '#6b7280' }}>{matched.supplierCode}</span>{matched.name}</span></>
                        ) : (<><Link2Off className="w-3 h-3 shrink-0" /><span>{t.catalog.matchButton}</span></>)}
                      </button>
                    </td>
                  </tr>
                  {isOpen && (
                    <>
                      {item.variants.map(v => (
                        <tr key={v.id} className="bg-gray-50/40 dark:bg-gray-900/20">
                          <td />
                          <td className="px-3 py-1.5 pl-12">
                            <span className="text-sm text-gray-700 dark:text-gray-200">{v.optionLabel || t.catalog.variantBase}</span>
                            {v.barcode && <span className="text-[10px] text-gray-400 font-mono ml-2">{v.barcode}</span>}
                          </td>
                          <td className="px-3 py-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded ${v.source === 'manual' ? 'bg-gray-100 dark:bg-gray-700 text-gray-500' : 'bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'}`}>{v.source === 'manual' ? t.inventory.sourceManual : v.source}</span>
                          </td>
                          <td className="px-3 py-1.5 text-center">
                            <span className="relative inline-flex items-center">
                              <input type="number"
                                className={`w-16 text-center border rounded px-2 py-1 text-sm tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-500 ${skuSaved.has(v.id) ? 'border-green-400 bg-green-50 dark:bg-green-900/20 text-gray-900 dark:text-gray-100' : (Number(skuStock[v.id] ?? 0) > 0 ? 'border-green-300 dark:border-green-700 bg-white dark:bg-gray-700 text-green-700 dark:text-green-300 font-medium' : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-400')}`}
                                value={skuStock[v.id] ?? ''}
                                onChange={e => setSkuStock(prev => ({ ...prev, [v.id]: e.target.value }))}
                                onBlur={() => saveSkuStock(item.id, v.id)}
                                onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                              {skuSaved.has(v.id) && <CheckCircle className="absolute -right-5 w-3.5 h-3.5 text-green-500" />}
                            </span>
                          </td>
                          <td />
                          <td className="px-3 py-1.5">
                            <button onClick={() => deleteVariant(v.id)} title={t.common.delete} className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-gray-50/40 dark:bg-gray-900/20">
                        <td />
                        <td colSpan={5} className="px-3 py-1.5 pl-12">
                          <button onClick={() => setAddForm({ catalogId: item.id, optionLabel: '', barcode: '', stockQty: '0' })}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline font-medium">
                            <Plus className="w-3.5 h-3.5" />{t.catalog.addVariant}
                          </button>
                        </td>
                      </tr>
                    </>
                  )}
                </Fragment>
              )
            })}
            {loading && items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-gray-400">{t.common.loading}</td></tr>
            )}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-gray-400">{t.catalog.noProducts}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 페이지네이션 */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <p className="text-xs text-gray-600 dark:text-gray-300 font-medium">
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {formatNumber(total)}개
          </p>
          <div className="flex items-center gap-1 bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 px-3 py-2">
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

      {/* 변형 추가 모달 */}
      {addForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setAddForm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">{t.catalog.addVariantTitle}</h2>
              <button onClick={() => setAddForm(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.inventory.fieldOption}</label>
                <input type="text" value={addForm.optionLabel} onChange={e => setAddForm(f => f && { ...f, optionLabel: e.target.value })} placeholder={t.inventory.fieldOptionPh}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.inventory.fieldBarcode}</label>
                  <div className="flex gap-1.5">
                    <input type="text" inputMode="numeric" value={addForm.barcode} onChange={e => setAddForm(f => f && { ...f, barcode: e.target.value })}
                      className="flex-1 min-w-0 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                    <button type="button" onClick={() => setSkuScanOpen(true)} className="shrink-0 px-2.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700"><ScanLine className="w-4 h-4" /></button>
                  </div>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.inventory.fieldStock}</label>
                  <input type="number" value={addForm.stockQty} onChange={e => setAddForm(f => f && { ...f, stockQty: e.target.value })}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={submitAddVariant} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700">{t.common.save}</button>
              <button onClick={() => setAddForm(null)} className="px-4 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}
      {skuScanOpen && (
        <BarcodeScanner onResult={code => { setAddForm(f => f && { ...f, barcode: code }); setSkuScanOpen(false) }} onClose={() => setSkuScanOpen(false)} />
      )}
    </div>
  )
}
