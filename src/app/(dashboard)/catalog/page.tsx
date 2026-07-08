'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useApiCache } from '@/lib/useApiCache'
import { Search, RefreshCw, ChevronLeft, ChevronRight, Link2, Link2Off, X, Check, Wand2, ImageOff, Barcode, Languages, ScanLine, Layers, List, LayoutGrid, Plus, Pencil, Trash2 } from 'lucide-react'
import BarcodeScanner from '@/components/BarcodeScanner'
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
  barcode: string
  point: number
  supplyCostJpy: number | null   // 공급가(엔화) — 미매칭은 null
  matchedProduct: MatchedProduct | null
}

type SupplierProduct = {
  id: number; name: string; brand: string; productCode: string
  supplierCode: string; costPrice: number; salePriceJpy: number
  supplier: { currency: string }
  group?: { base: string; count: number } | null   // 변형 그룹(JVD 코드접두부/SIBUYA 베이스명) — 있으면 그룹으로 표시
}

// 매칭 표시: 변형 그룹이면 특정 변형명 대신 그룹 베이스명(+변형수)으로 보여준다
function MatchedName({ m }: { m: SupplierProduct }) {
  if (m.group) {
    return <>{m.group.base}{m.group.count > 1 ? <span className="ml-1 opacity-70">({m.group.count}変)</span> : null}</>
  }
  return <>{m.name}</>
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
      group: { base: group.base, count: group.count },   // 낙관적 표시도 그룹으로
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
                <span className="text-xs text-gray-600 dark:text-gray-400"><MatchedName m={item.matchedProduct} /></span>
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
              className="w-full pl-9 pr-9 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-3.5 h-3.5" /></button>}
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
  const [page, setPage] = useState(1)
  const [modalItem, setModalItem] = useState<CatalogItem | null>(null)
  const [krwPerJpy] = useState(9.5)
  const [autoMatching, setAutoMatching] = useState(false)
  const [autoMatchResult, setAutoMatchResult] = useState<AutoMatchResult>(null)
  const [viewMode, setViewMode] = useState<'list' | 'card'>('list')
  // 수동(이벤트) 상품 추가/편집
  const [editForm, setEditForm] = useState<{ id?: number; name: string; brand: string; priceJpy: string; point: string; imageUrl1: string } | null>(null)
  const [savingForm, setSavingForm] = useState(false)
  const [deleteId, setDeleteId] = useState<number | null>(null)
  // 확인 모달 (시간 걸리는 작업 실수 방지)
  const [confirm, setConfirm] = useState<{ title: string; message: string; confirmLabel: string; onConfirm: () => void } | null>(null)
  const [busyMsg, setBusyMsg] = useState<string | null>(null)
  const [refreshingId, setRefreshingId] = useState<number | null>(null)
  // 상품 가져오기 모달 (전체/새상품 선택 → 확인 → 페이지별 배치 진행)
  const [importOpen, setImportOpen] = useState(false)
  const [importMode, setImportMode] = useState<'new' | 'all'>('new')
  const [importRunning, setImportRunning] = useState(false)
  const [importProg, setImportProg] = useState<{ page: number; added: number; updated: number; done: boolean } | null>(null)
  const importCancel = useRef(false)

  // 검색어 디바운스 (입력마다 fetch 방지)
  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q), 300); return () => clearTimeout(t) }, [q])
  // 필터/검색 변경 시 1페이지로
  useEffect(() => { setPage(1) }, [debouncedQ, filter])
  // 클라 캐시: URL(검색+필터+페이지)별 → 재방문/페이지 왕복 즉시표시 + 백그라운드 재검증
  const itemsUrl = useMemo(() => {
    const params = new URLSearchParams({
      q: debouncedQ, limit: String(PAGE_SIZE), offset: String((page - 1) * PAGE_SIZE),
      ...(filter === 'matched' ? { matchedOnly: '1' } : filter === 'unmatched' ? { unmatchedOnly: '1' } : {}),
    })
    return `/api/arico-catalog?${params}`
  }, [debouncedQ, filter, page])
  const { data: itemsData, isLoading: loading, refresh, mutate } = useApiCache<{ rows: CatalogItem[]; total: number }>(itemsUrl)
  const items = itemsData?.rows ?? []
  const total = itemsData?.total ?? 0
  // 기존 호출부 유지: fetchItems(page)/fetchItems() → 현재 URL 재검증
  const fetchItems = useCallback((_p?: number) => refresh(), [refresh])
  // 통계 캐시 (fetchStats = refresh)
  const { data: stats = null, refresh: fetchStats } = useApiCache<CatalogStats>('/api/arico-catalog?stats=1')

  // MakeShop 상품 동기화 (searchProduct → AricoCatalog upsert)
  const [msSyncing, setMsSyncing] = useState(false)
  const [msResult, setMsResult] = useState<string | null>(null)
  const syncMakeshop = async () => {
    setMsSyncing(true); setMsResult(null)
    try {
      const res = await fetch('/api/makeshop/sync-products', { method: 'POST' })
      const d = await res.json()
      if (!res.ok || !d.ok) {
        const detail = d.detail ? (typeof d.detail === 'string' ? d.detail : JSON.stringify(d.detail)) : ''
        setMsResult('⚠️ ' + (d.error === 'not_configured' ? (d.hint || 'API 미설정') : `${d.error}${detail ? ' — ' + detail.slice(0, 500) : ''}`))
      } else {
        setMsResult(`✅ ${d.fetched} ${t.catalog.msFetched} · ${t.catalog.msNew} ${d.created} · ${t.catalog.msUpdated} ${d.updated}${d.skipped ? ` · ${t.catalog.msSkipped} ${d.skipped}` : ''}`)
        fetchItems(page); fetchStats()
      }
    } catch (e) {
      setMsResult('⚠️ ' + String(e))
    } finally {
      setMsSyncing(false)
    }
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)

  const handleMatch = (catalogId: number, product: SupplierProduct | null, barcode?: string) => {
    mutate({
      rows: items.map(item =>
        item.id === catalogId
          ? { ...item, supplierProductId: product?.id ?? null, matchedProduct: product ?? null, ...(barcode !== undefined ? { barcode } : {}) }
          : item),
      total,
    })
    fetchStats()
  }

  const openCreate = () => setEditForm({ name: '', brand: '', priceJpy: '', point: '', imageUrl1: '' })
  const openEdit = (item: CatalogItem) => setEditForm({
    id: item.id, name: item.name, brand: item.brand,
    priceJpy: item.priceJpy ? String(item.priceJpy) : '', point: item.point ? String(item.point) : '', imageUrl1: item.imageUrl1 || '',
  })

  const submitForm = async () => {
    if (!editForm || !editForm.name.trim()) return
    setSavingForm(true)
    const payload = {
      name: editForm.name, brand: editForm.brand,
      priceJpy: Number(editForm.priceJpy) || 0, point: Number(editForm.point) || 0, imageUrl1: editForm.imageUrl1,
    }
    try {
      if (editForm.id) {
        await fetch('/api/arico-catalog', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: editForm.id, ...payload }) })
      } else {
        await fetch('/api/arico-catalog', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      }
      setEditForm(null)
      fetchItems(page); fetchStats()
    } finally { setSavingForm(false) }
  }

  const deleteItem = async (id: number) => {
    await fetch(`/api/arico-catalog/${id}`, { method: 'DELETE' })
    setDeleteId(null)
    fetchItems(page); fetchStats()
  }

  // A: 자사숍에서 가져오기 — 전체(all)/새상품(new). 페이지 단위로 끊어 반복(타임아웃 방지).
  const runImport = async (mode: 'new' | 'all') => {
    importCancel.current = false
    setImportRunning(true)
    setImportProg({ page: 0, added: 0, updated: 0, done: false })
    let pg = 1, added = 0, updated = 0
    for (;;) {
      if (importCancel.current) break
      let d
      try {
        d = await fetch('/api/arico-catalog/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode, page: pg }) }).then(r => r.json())
      } catch { break }
      if (!d?.ok) break
      added += d.added; updated += d.updated
      setImportProg({ page: pg, added, updated, done: false })
      if (!d.hasMore) break
      pg++
    }
    setImportProg({ page: pg, added, updated, done: true })
    setImportRunning(false)
    fetchItems(page); fetchStats()
  }

  // C: 개별 상품 자사숍에서 새로고침 (확인 후 실행)
  const runRefresh = async (id: number) => {
    setRefreshingId(id); setBusyMsg(null)
    try {
      const d = await fetch(`/api/arico-catalog/${id}/refresh`, { method: 'POST' }).then(r => r.json())
      if (d.ok) { setBusyMsg(`✅ ${d.name} · ¥${formatNumber(d.priceJpy)} · ${d.point}P`); fetchItems(page) }
      else setBusyMsg('⚠️ ' + (d.message ?? 'error'))
    } catch { setBusyMsg('⚠️ error') } finally { setRefreshingId(null) }
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
          <div className="text-sm text-gray-600 dark:text-gray-400 font-medium hidden sm:block">
            {t.catalog.jpyRate} <span className="font-semibold text-gray-900 dark:text-gray-100">¥1 ≈ ₩{krwPerJpy}</span>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 text-white rounded-lg text-xs font-medium hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />{t.catalog.addItem}
          </button>
          <button
            onClick={() => { setImportMode('new'); setImportProg(null); setImportOpen(true) }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs font-medium hover:bg-green-700 transition-colors"
            title={t.catalog.importTooltip}
          >
            <RefreshCw className="w-3.5 h-3.5" />{t.catalog.importBtn}
          </button>
          <button
            onClick={() => setConfirm({ title: t.catalog.msSyncTitle, message: t.catalog.msSyncMsg, confirmLabel: t.catalog.msSync, onConfirm: syncMakeshop })}
            disabled={msSyncing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
            title={t.catalog.msSyncTooltip}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${msSyncing ? 'animate-spin' : ''}`} />
            {t.catalog.msSync}
          </button>
          <button
            onClick={() => setConfirm({ title: t.catalog.previewConfirmTitle, message: t.catalog.previewConfirmMsg, confirmLabel: t.catalog.preview, onConfirm: () => handleAutoMatch(true) })}
            disabled={autoMatching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 rounded-lg text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 transition-colors"
            title={t.catalog.previewTooltip}
          >
            <Wand2 className="w-3.5 h-3.5" />
            {t.catalog.preview}
          </button>
          <button
            onClick={() => setConfirm({ title: t.catalog.autoMatchConfirmTitle, message: t.catalog.autoMatchConfirmMsg, confirmLabel: t.catalog.autoMatch, onConfirm: () => handleAutoMatch(false) })}
            disabled={autoMatching}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
            title={t.catalog.autoMatchTooltip}
          >
            {autoMatching ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Wand2 className="w-3.5 h-3.5" />}
            {t.catalog.autoMatch}
          </button>
        </div>
      </div>

      {busyMsg && (
        <div className="mb-3 text-xs px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200">{busyMsg}</div>
      )}

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
      {msResult && (
        <div className="mb-3 p-3 rounded-xl text-sm flex items-center justify-between gap-4 bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/50 text-indigo-800 dark:text-indigo-200">
          <span>{t.catalog.msSync}: {msResult}</span>
          <button onClick={() => setMsResult(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"><X className="w-4 h-4" /></button>
        </div>
      )}
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
            className="w-full pl-9 pr-9 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder={t.catalog.productSearchPlaceholder}
            value={q}
            onChange={e => setQ(e.target.value)}
          />
          {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-3.5 h-3.5" /></button>}
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
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
          <button onClick={() => setViewMode('list')} title={t.catalog.viewList}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'list' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <List className="w-3.5 h-3.5" />{t.catalog.viewList}
          </button>
          <button onClick={() => setViewMode('card')} title={t.catalog.viewCard}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === 'card' ? 'bg-white dark:bg-gray-600 text-gray-900 dark:text-gray-100 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'}`}>
            <LayoutGrid className="w-3.5 h-3.5" />{t.catalog.viewCard}
          </button>
        </div>
        <button onClick={() => fetchItems(page)} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* 리스트 뷰 — 판매가·공급가·마진·포인트 비교 */}
      {viewMode === 'list' && (
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-left">
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200">{t.catalog.colItem}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-right w-28">{t.catalog.colSalePrice}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-right w-28">{t.catalog.colSupplyPrice}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-right w-32">{t.catalog.colMargin}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 text-right w-20">{t.catalog.colPoint}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 w-48">{t.catalog.colMatch}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {items.map(item => {
              const matched = item.matchedProduct
              const img = item.imageUrl2 || item.imageUrl1
              const cost = item.supplyCostJpy
              const marginJpy = (cost != null && item.priceJpy > 0) ? item.priceJpy - cost : null
              const marginPct = (marginJpy != null && item.priceJpy > 0) ? (marginJpy / item.priceJpy) * 100 : null
              const mColor = marginPct == null ? '' : marginPct < 0 ? 'text-red-600 dark:text-red-400' : marginPct < 20 ? 'text-amber-600 dark:text-amber-400' : 'text-green-700 dark:text-green-400'
              return (
                <tr key={item.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2.5">
                      <div className="w-9 h-9 shrink-0"><CatalogImage src={img} alt={item.name} label="" /></div>
                      <div className="min-w-0">
                        <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight truncate flex items-center gap-1.5">
                          {item.name}
                          {item.productCode.startsWith('EVENT-') && <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 font-medium shrink-0">{t.catalog.manualBadge}</span>}
                        </p>
                        <p className="text-xs text-gray-400 flex items-center gap-1.5">
                          <span className="truncate">{item.brand}{item.barcode ? ` · ${item.barcode}` : ''}</span>
                          <button onClick={() => openEdit(item)} title={t.common.edit} className="shrink-0 p-0.5 text-gray-400 hover:text-blue-600"><Pencil className="w-3 h-3" /></button>
                          {deleteId === item.id ? (
                            <span className="inline-flex items-center gap-1 shrink-0">
                              <button onClick={() => deleteItem(item.id)} className="px-1 py-0.5 bg-red-600 text-white rounded text-[10px] font-semibold">{t.common.delete}</button>
                              <button onClick={() => setDeleteId(null)} className="px-1 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded text-[10px]">{t.common.cancel}</button>
                            </span>
                          ) : (
                            <button onClick={() => setDeleteId(item.id)} title={t.common.delete} className="shrink-0 p-0.5 text-gray-400 hover:text-red-600"><Trash2 className="w-3 h-3" /></button>
                          )}
                          {item.url && (
                            <button
                              onClick={() => setConfirm({ title: t.catalog.refreshConfirmTitle, message: t.catalog.refreshConfirmMsg, confirmLabel: t.catalog.refreshBtn, onConfirm: () => runRefresh(item.id) })}
                              title={t.catalog.refreshBtn}
                              className="shrink-0 p-0.5 text-gray-400 hover:text-green-600">
                              <RefreshCw className={`w-3 h-3 ${refreshingId === item.id ? 'animate-spin' : ''}`} />
                            </button>
                          )}
                        </p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-900 dark:text-gray-100">{item.priceJpy > 0 ? `¥${formatNumber(item.priceJpy)}` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{cost != null ? `¥${formatNumber(cost)}` : '—'}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {marginJpy != null
                      ? <span className={mColor}>¥{formatNumber(marginJpy)} <span className="text-[11px]">{marginPct!.toFixed(0)}%</span></span>
                      : <span className="text-gray-300 dark:text-gray-600">—</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-500 dark:text-gray-400">{item.point > 0 ? formatNumber(item.point) : '—'}</td>
                  <td className="px-3 py-2">
                    <button onClick={() => setModalItem(item)}
                      className={`w-full flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${matched ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 hover:bg-green-100 border border-green-200 dark:border-green-800/50' : 'bg-gray-50 dark:bg-gray-700/50 text-gray-400 hover:bg-gray-100 border border-gray-200 dark:border-gray-600'}`}>
                      {matched
                        ? <><Link2 className="w-3 h-3 shrink-0" /><span className="truncate"><span className="inline-block px-0.5 rounded text-white text-[9px] font-bold mr-0.5" style={{ backgroundColor: SUPPLIER_COLORS[matched.supplierCode] ?? '#6b7280' }}>{matched.supplierCode}</span><MatchedName m={matched} /></span></>
                        : <><Link2Off className="w-3 h-3 shrink-0" /><span>{t.catalog.matchButton}</span></>}
                    </button>
                  </td>
                </tr>
              )
            })}
            {!loading && items.length === 0 && (
              <tr><td colSpan={6} className="text-center py-16 text-gray-400">{t.catalog.noProducts}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      )}

      {/* 상품 그리드 — 화면 크기별 자동 컬럼 조정 */}
      {viewMode === 'card' && (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7 2xl:grid-cols-8 gap-2">
        {items.map(item => {
          const priceKrw = Math.round(item.priceJpyNotax * krwPerJpy)
          const img = item.imageUrl2 || item.imageUrl1
          const matched = item.matchedProduct
          return (
            <div key={item.id} className="relative bg-white dark:bg-gray-800 rounded-lg shadow-sm overflow-hidden hover:shadow-md transition-shadow flex flex-col group">
              {item.barcode && (
                <span className="absolute top-1 right-1 z-10 flex items-center justify-center w-5 h-5 rounded text-white" style={{ backgroundColor: '#2f7d55' }} title={`JAN ${item.barcode}`}>
                  <Barcode className="w-3 h-3" />
                </span>
              )}
              {/* 이미지 — 없거나 로딩 실패 시 "이미지 없음" placeholder */}
              <CatalogImage src={img} alt={item.name} label={t.catalog.noImage} />

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
                        <MatchedName m={matched} />
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
      )}

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

      {/* 수동(이벤트) 상품 추가/편집 모달 */}
      {editForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setEditForm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">{editForm.id ? t.catalog.editItem : t.catalog.addItem}</h2>
              <button onClick={() => setEditForm(null)} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.catalog.colItem} *</label>
                <input type="text" value={editForm.name} onChange={e => setEditForm(f => f && { ...f, name: e.target.value })}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldBrand}</label>
                <input type="text" value={editForm.brand} onChange={e => setEditForm(f => f && { ...f, brand: e.target.value })}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.catalog.colSalePrice} (¥)</label>
                  <input type="number" value={editForm.priceJpy} onChange={e => setEditForm(f => f && { ...f, priceJpy: e.target.value })} placeholder="0"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.catalog.colPoint}</label>
                  <input type="number" value={editForm.point} onChange={e => setEditForm(f => f && { ...f, point: e.target.value })} placeholder="0"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.catalog.imageUrl}</label>
                <input type="text" value={editForm.imageUrl1} onChange={e => setEditForm(f => f && { ...f, imageUrl1: e.target.value })} placeholder="https://..."
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t.catalog.manualHint}</p>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={submitForm} disabled={savingForm || !editForm.name.trim()}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{savingForm ? t.common.saving : t.common.save}</button>
              <button onClick={() => setEditForm(null)} className="px-4 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}

      {/* 상품 가져오기 모달 — 전체/새상품 선택 → 진행 */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => { if (!importRunning) setImportOpen(false) }}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">{t.catalog.importTitle}</h2>
              {!importRunning && <button onClick={() => setImportOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X className="w-5 h-5" /></button>}
            </div>
            <div className="p-5 space-y-3">
              {/* 선택지 */}
              {(['new', 'all'] as const).map(m => (
                <button key={m} onClick={() => !importRunning && setImportMode(m)} disabled={importRunning}
                  className={`w-full text-left p-3 rounded-lg border transition-colors ${importMode === m ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-600 hover:border-gray-300'} ${importRunning ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${importMode === m ? 'border-blue-600' : 'border-gray-300'}`}>
                      {importMode === m && <span className="w-2 h-2 rounded-full bg-blue-600" />}
                    </span>
                    <span className="font-medium text-sm text-gray-900 dark:text-gray-100">{m === 'new' ? t.catalog.importNew : t.catalog.importAll}</span>
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 ml-6">{m === 'new' ? t.catalog.importNewDesc : t.catalog.importAllDesc}</p>
                </button>
              ))}

              {/* 진행 상태 */}
              {importProg && (
                <div className={`text-xs px-3 py-2 rounded-lg ${importProg.done ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' : 'bg-gray-50 dark:bg-gray-700/50 text-gray-600 dark:text-gray-300'}`}>
                  {importProg.done
                    ? `✅ ${t.catalog.importResult.replace('{added}', String(importProg.added)).replace('{updated}', String(importProg.updated))}`
                    : `${t.catalog.importProgress.replace('{page}', String(importProg.page))} · +${importProg.added} · ⟳${importProg.updated}`}
                </div>
              )}
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              {importRunning ? (
                <button onClick={() => { importCancel.current = true }} className="flex-1 bg-red-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-red-700">{t.catalog.importStop}</button>
              ) : (
                <>
                  <button onClick={() => runImport(importMode)} className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700">{importProg?.done ? t.catalog.importAgain : t.catalog.importStart}</button>
                  <button onClick={() => setImportOpen(false)} className="px-4 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">{t.common.close}</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 확인 모달 — 시간 걸리는 작업 실수 방지 */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirm(null)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="px-5 py-4">
              <h2 className="font-semibold text-gray-900 dark:text-white mb-1.5">{confirm.title}</h2>
              <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{confirm.message}</p>
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={() => { const fn = confirm.onConfirm; setConfirm(null); fn() }}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700">{confirm.confirmLabel}</button>
              <button onClick={() => setConfirm(null)} className="px-4 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-200">{t.common.cancel}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
