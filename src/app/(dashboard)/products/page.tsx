'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Package, RefreshCw, Save, CheckCircle, ChevronLeft, ChevronRight, Tag, Tags, Download, Percent, Plus, Pencil, Trash2, X, AlertTriangle } from 'lucide-react'
import SupplierBadge from '@/components/SupplierBadge'
import ProfitBar from '@/components/ProfitBar'
import { formatJpy, formatNumber, calcProfitRate, calcCostJpy, SUPPLIER_COLORS, SUPPLIER_LIST } from '@/lib/utils'
import { useT } from '@/lib/i18n'

type Supplier = { id: number; code: string; name: string; currency: string; taxRate: number; discount: number }
type Product = {
  id: number; productCode: string; name: string; brand: string; category: string
  costPrice: number; msrp: number; salePriceJpy: number; unit: string; availability: string
  imageUrl1: string; url: string; supplierCode: string; supplier: Supplier
  optionSize: string; optionColor: string; shopProductId: string
}
type ExchangeRate = { currency: string; rateToJpy: number }

const SUPPLIERS = ['', ...SUPPLIER_LIST]
const SUPPLIER_NAMES: Record<string, string> = {
  JVD: 'JVD', MK: 'MK Korea', FIVICS: 'FIVICS', SIBUYA: 'Shibuya', KOREA: 'Korea Archery', ANGEL: 'Angel', WJ: 'WJ Sports', ETC: '기타'
}
const PAGE_SIZE = 50
const MAX_CATEGORY_BUTTONS = 8

function msrpToJpy(product: Product, rates: ExchangeRate[]): number {
  const rate = rates.find(r => r.currency === product.supplier.currency)?.rateToJpy ?? 1
  return product.msrp * rate
}

export default function ProductsPage() {
  const t = useT()
  const [q, setQ] = useState('')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [brands, setBrands] = useState<string[]>([])
  const [brandFilter, setBrandFilter] = useState('')
  // 브랜드 관리 모달
  const [brandModal, setBrandModal] = useState(false)
  const [brandSel, setBrandSel] = useState('')
  const [brandRenameTo, setBrandRenameTo] = useState('')
  const [brandBusy, setBrandBusy] = useState(false)
  const [brandMsg, setBrandMsg] = useState<string | null>(null)
  const [brandDelConfirm, setBrandDelConfirm] = useState(false)
  const [noPriceOnly, setNoPriceOnly] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [rates, setRates] = useState<ExchangeRate[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const [salePrices, setSalePrices] = useState<Record<number, string>>({})
  const [dirty, setDirty] = useState<Set<number>>(new Set())
  const [saving, setSaving] = useState(false)
  const [savedOk, setSavedOk] = useState(false)
  const [savingIds, setSavingIds] = useState<Set<number>>(new Set())
  const [savedIds, setSavedIds] = useState<Set<number>>(new Set())
  const [saveError, setSaveError] = useState<string | null>(null)
  const [bulkMargin, setBulkMargin] = useState('')
  const [showBulk, setShowBulk] = useState(false)
  const [bulkApplying, setBulkApplying] = useState(false)
  const [bulkAllPages, setBulkAllPages] = useState(false)
  const [bulkResult, setBulkResult] = useState<string | null>(null)

  // 수동 상품 등록/편집
  const emptyForm = {
    supplierCode: 'ETC', brand: '', name: '', productCode: '', category: '',
    costPrice: '', salePriceJpy: '', optionSize: '', optionColor: '', unit: '1',
  }
  const [formOpen, setFormOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [formSaving, setFormSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [deleteId, setDeleteId] = useState<number | null>(null)

  useEffect(() => {
    fetch('/api/exchange-rates').then(r => r.json()).then(setRates)
  }, [])

  const openNew = () => {
    setEditId(null)
    setForm({ ...emptyForm, supplierCode: supplierFilter || 'ETC' })
    setFormError(null)
    setFormOpen(true)
  }
  const openEdit = (p: Product) => {
    setEditId(p.id)
    setForm({
      supplierCode: p.supplierCode, brand: p.brand, name: p.name, productCode: p.productCode,
      category: p.category, costPrice: String(p.costPrice || ''), salePriceJpy: String(p.salePriceJpy || ''),
      optionSize: p.optionSize, optionColor: p.optionColor, unit: p.unit || '1',
    })
    setFormError(null)
    setFormOpen(true)
  }
  const submitForm = async () => {
    if (!form.name.trim()) { setFormError(t.products.nameRequired); return }
    setFormSaving(true)
    setFormError(null)
    try {
      const payload = {
        supplierCode: form.supplierCode, brand: form.brand, name: form.name, productCode: form.productCode,
        category: form.category, costPrice: Number(form.costPrice) || 0, salePriceJpy: Number(form.salePriceJpy) || 0,
        optionSize: form.optionSize, optionColor: form.optionColor, unit: form.unit || '1',
      }
      const res = editId
        ? await fetch(`/api/products/${editId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        : await fetch('/api/products', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      if (!res.ok) throw new Error(`${res.status}`)
      setFormOpen(false)
      fetchProducts(page)
    } catch (e) {
      setFormError(String(e))
    } finally {
      setFormSaving(false)
    }
  }
  const deleteProduct = async (id: number) => {
    const res = await fetch(`/api/products/${id}`, { method: 'DELETE' })
    if (res.status === 409) { setFormError(t.products.deleteInUse); setDeleteId(null); return }
    setDeleteId(null)
    fetchProducts(page)
  }

  // 브랜드 일괄 작업 (이름변경/병합/삭제) — 현재 선택된 공급사 범위
  const runBrandOp = async (payload: { action: 'rename' | 'delete'; to?: string; mode?: 'clear' | 'products' }) => {
    if (!brandSel) return
    setBrandBusy(true); setBrandMsg(null)
    try {
      const res = await fetch('/api/products/brand', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ supplierCode: supplierFilter || undefined, brand: brandSel, ...payload }),
      })
      const d = await res.json()
      if (!res.ok) { setBrandMsg('⚠️ ' + (d.error || res.status)); return }
      if (payload.action === 'rename') setBrandMsg(`✅ ${d.updated}${t.common.items}`)
      else if (payload.mode === 'clear') setBrandMsg(`✅ ${d.cleared}${t.common.items}`)
      else setBrandMsg(`✅ ${d.deleted}${t.common.items} / skip ${d.skipped}`)
      setBrandSel(''); setBrandRenameTo(''); setBrandDelConfirm(false)
      loadBrands()
      setPage(1); fetchProducts(1)
    } catch (e) {
      setBrandMsg('⚠️ ' + String(e))
    } finally {
      setBrandBusy(false)
    }
  }

  const fetchProducts = useCallback(async (currentPage = 1) => {
    setLoading(true)
    const params = new URLSearchParams({ q, supplier: supplierFilter, category: categoryFilter, brand: brandFilter, limit: String(PAGE_SIZE), page: String(currentPage), ...(noPriceOnly ? { noPrice: '1' } : {}) })
    const res = await fetch(`/api/products?${params}`)
    const data = await res.json()
    setProducts(data.products)
    setTotal(data.total)
    // 저장된 판매가 초기값 로드
    const init: Record<number, string> = {}
    for (const p of data.products) {
      if (p.salePriceJpy > 0) init[p.id] = String(p.salePriceJpy)
    }
    setSalePrices(prev => ({ ...prev, ...init }))
    setDirty(new Set())
    setLoading(false)
  }, [q, supplierFilter, categoryFilter, brandFilter, noPriceOnly])

  const loadBrands = useCallback(() => {
    if (!supplierFilter) { setBrands([]); return }
    fetch(`/api/products?brandsOnly=1&supplier=${supplierFilter}`).then(r => r.json()).then(setBrands).catch(() => setBrands([]))
  }, [supplierFilter])

  // 공급사 변경 시 카테고리·브랜드 목록 로드
  useEffect(() => {
    setCategoryFilter('')
    setBrandFilter('')
    const params = new URLSearchParams({ categoriesOnly: '1', supplier: supplierFilter })
    fetch(`/api/products?${params}`).then(r => r.json()).then((cats: string[]) => setCategories(cats))
    loadBrands()
  }, [supplierFilter, loadBrands])

  // 검색어/필터 변경 시 1페이지로
  useEffect(() => {
    setPage(1)
    const timer = setTimeout(() => fetchProducts(1), 300)
    return () => clearTimeout(timer)
  }, [fetchProducts])

  // 페이지 변경 시
  useEffect(() => {
    fetchProducts(page)
  }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const handlePriceChange = (id: number, val: string) => {
    setSalePrices(prev => ({ ...prev, [id]: val }))
    setDirty(prev => new Set(prev).add(id))
    setSavedOk(false)
  }

  // 단일 상품 저장 (blur 시 자동호출)
  const saveOne = async (id: number) => {
    if (!dirty.has(id)) return
    const val = Number(salePrices[id] ?? 0)
    if (isNaN(val)) return
    setSavingIds(prev => new Set(prev).add(id))
    setSaveError(null)
    try {
      const res = await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates: [{ id, salePriceJpy: val }] }),
      })
      if (!res.ok) throw new Error(`저장 실패 (${res.status})`)
      setDirty(prev => { const s = new Set(prev); s.delete(id); return s })
      setSavedIds(prev => new Set(prev).add(id))
      setTimeout(() => setSavedIds(prev => { const s = new Set(prev); s.delete(id); return s }), 2500)
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSavingIds(prev => { const s = new Set(prev); s.delete(id); return s })
    }
  }

  // 전체 일괄 저장 (버튼)
  const handleSave = async () => {
    const updates = [...dirty]
      .map(id => ({ id, salePriceJpy: Number(salePrices[id] ?? 0) }))
      .filter(u => !isNaN(u.salePriceJpy))
    if (!updates.length) return
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/products', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      })
      if (!res.ok) throw new Error(`저장 실패 (${res.status})`)
      const ids = updates.map(u => u.id)
      setDirty(new Set())
      setSavedIds(prev => new Set([...prev, ...ids]))
      setSavedOk(true)
      setTimeout(() => {
        setSavedOk(false)
        setSavedIds(new Set())
      }, 3000)
    } catch (e) {
      setSaveError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // 현재 페이지 상품에 일괄 마진율 적용
  const applyBulkMargin = async () => {
    const margin = parseFloat(bulkMargin)
    if (isNaN(margin) || margin <= 0 || margin >= 100) return
    setBulkApplying(true)
    setBulkResult(null)

    if (bulkAllPages) {
      // 서버 사이드: 전체 필터 대상 일괄 적용
      const res = await fetch('/api/products/bulk-price', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          supplierCode: supplierFilter || undefined,
          category: categoryFilter || undefined,
          q: q || undefined,
          marginPct: margin,
          noPriceOnly: noPriceOnly || undefined,
        }),
      })
      const data = await res.json()
      setBulkResult(`✅ ${data.updated}${t.common.items} ${t.products.applyDone.replace(/\d+개 /, '')}`)
      // 페이지 새로고침
      fetchProducts(page)
    } else {
      // 클라이언트 사이드: 현재 페이지만
      const newPrices: Record<number, string> = {}
      const newDirty = new Set(dirty)
      for (const p of products) {
        const costJpy = calcCostJpy(p, rates)
        if (costJpy <= 0) continue
        const salePrice = Math.ceil(costJpy / (1 - margin / 100) / 10) * 10
        newPrices[p.id] = String(salePrice)
        newDirty.add(p.id)
      }
      setSalePrices(prev => ({ ...prev, ...newPrices }))
      setDirty(newDirty)
      setSavedOk(false)
    }
    setBulkApplying(false)
    if (bulkAllPages) setShowBulk(false)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const dirtyCount = dirty.size

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.products.title}</h1>
          <p className="text-gray-600 text-sm mt-1 font-medium">{t.common.total} {formatNumber(total)}{t.products.totalCount}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 px-4 py-2 bg-slate-700 text-white rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.products.addProduct}
          </button>
          {saveError && (
            <span className="flex items-center gap-1 text-red-600 text-sm font-medium bg-red-50 px-3 py-1.5 rounded-lg">
              ⚠️ {saveError}
            </span>
          )}
          {savedOk && (
            <span className="flex items-center gap-1 text-green-600 text-sm font-medium">
              <CheckCircle className="w-4 h-4" /> {t.common.saved}
            </span>
          )}
          {dirtyCount > 0 && (
            <button
              onClick={handleSave}
              disabled={saving}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? t.common.saving : `${t.products.saveAll} (${dirtyCount}${t.common.items})`}
            </button>
          )}
          <div className="relative">
            <button
              onClick={() => setShowBulk(v => !v)}
              className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
              title={t.products.bulkMarginTitle}
            >
              <Percent className="w-3.5 h-3.5" />
              {t.products.bulkMargin}
            </button>
            {showBulk && (
              <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-gray-800 shadow-xl rounded-xl border border-gray-200 dark:border-gray-700 p-4 w-64">
                <p className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1">{t.products.bulkMarginTitle}</p>
                <p className="text-xs text-gray-600 dark:text-gray-400 mb-2">{t.products.bulkMarginDesc}</p>
                <div className="flex gap-2 mb-3">
                  <input
                    type="number"
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="예: 40"
                    min="1"
                    max="99"
                    value={bulkMargin}
                    onChange={e => setBulkMargin(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && applyBulkMargin()}
                  />
                  <span className="text-gray-400 self-center text-sm">%</span>
                </div>
                {/* 범위 선택 */}
                <div className="flex gap-2 mb-3">
                  <button
                    onClick={() => setBulkAllPages(false)}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${!bulkAllPages ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                  >{t.products.currentPage}</button>
                  <button
                    onClick={() => setBulkAllPages(true)}
                    className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${bulkAllPages ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                  >{t.products.allPages} ({formatNumber(total)}{t.common.items})</button>
                </div>
                {bulkAllPages && (
                  <p className="text-xs text-orange-600 bg-orange-50 rounded px-2 py-1 mb-2">
                    {t.products.bulkWarning} {formatNumber(total)}{t.products.bulkWarning2}
                  </p>
                )}
                {bulkResult && <p className="text-xs text-green-600 mb-2">{bulkResult}</p>}
                <div className="flex gap-2">
                  <button
                    onClick={applyBulkMargin}
                    disabled={bulkApplying}
                    className="flex-1 bg-blue-600 text-white py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-50"
                  >{bulkApplying ? t.common.loading : t.common.apply}</button>
                  <button
                    onClick={() => { setShowBulk(false); setBulkResult(null) }}
                    className="flex-1 bg-gray-100 text-gray-600 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-200"
                  >{t.common.close}</button>
                </div>
              </div>
            )}
          </div>
          <a
            href={`/api/products?format=csv&supplier=${encodeURIComponent(supplierFilter)}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(categoryFilter)}${noPriceOnly ? '&noPrice=1' : ''}`}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 text-gray-600 rounded-lg text-sm font-medium hover:bg-gray-200 transition-colors"
            title="현재 필터 조건으로 CSV 내보내기"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </a>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-4 mb-4 space-y-3">
        <div className="flex gap-3 flex-wrap items-center">
          <div className="flex-1 relative min-w-60">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t.products.searchPlaceholder}
              value={q}
              onChange={e => setQ(e.target.value)}
            />
          </div>
          <div className="flex gap-2 flex-wrap">
            {SUPPLIERS.map(s => (
              <button
                key={s || 'all'}
                onClick={() => setSupplierFilter(s)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  supplierFilter === s
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={supplierFilter === s && s ? { backgroundColor: SUPPLIER_COLORS[s] } : {}}
              >
                {s ? SUPPLIER_NAMES[s] : t.common.all}
              </button>
            ))}
          </div>
          <button
            onClick={() => setNoPriceOnly(v => !v)}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5 ${noPriceOnly ? 'bg-orange-500 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            title={t.products.noPriceOnly}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${noPriceOnly ? 'bg-white' : 'bg-orange-400'}`} />
            {t.products.noPriceOnly}
          </button>
          <button onClick={() => fetchProducts(page)} className="p-2 text-gray-400 hover:text-gray-600">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {categories.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <button
              onClick={() => setCategoryFilter('')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${categoryFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >
              {t.common.all}
            </button>
            {categories.slice(0, MAX_CATEGORY_BUTTONS).map(cat => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat === categoryFilter ? '' : cat)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${categoryFilter === cat ? 'bg-indigo-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              >
                {cat}
              </button>
            ))}
            {categories.length > MAX_CATEGORY_BUTTONS && (
              <select
                value={categoryFilter}
                onChange={e => setCategoryFilter(e.target.value)}
                className="px-2 py-1 border border-gray-200 rounded text-xs text-gray-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="">{t.products.showMore}</option>
                {categories.slice(MAX_CATEGORY_BUTTONS).map(cat => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            )}
          </div>
        )}
        {supplierFilter && brands.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tags className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <button
              onClick={() => setBrandFilter('')}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${brandFilter === '' ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
            >{t.common.all}</button>
            {brands.slice(0, MAX_CATEGORY_BUTTONS).map(b => (
              <button key={b}
                onClick={() => setBrandFilter(b === brandFilter ? '' : b)}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${brandFilter === b ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              >{b}</button>
            ))}
            {brands.length > MAX_CATEGORY_BUTTONS && (
              <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
                className="px-2 py-1 border border-gray-200 dark:border-gray-600 rounded text-xs text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">{t.products.showMore}</option>
                {brands.slice(MAX_CATEGORY_BUTTONS).map(b => <option key={b} value={b}>{b}</option>)}
              </select>
            )}
            <button
              onClick={() => { setBrandModal(true); setBrandMsg(null); setBrandSel(brandFilter || ''); setBrandRenameTo(''); setBrandDelConfirm(false) }}
              className="ml-auto flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
            >
              <Pencil className="w-3 h-3" /> {t.products.manageBrands}
            </button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-12">#</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.products.colSupplier}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.products.colName}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.products.colCost}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.products.colSale}</th>
              <th className="px-4 py-3 font-semibold text-gray-700 dark:text-gray-200 w-44">{t.products.colMargin}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.products.colCostRate}</th>
              <th className="text-right px-4 py-3 font-semibold text-gray-700 dark:text-gray-200">{t.products.colProfit}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {loading && products.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-16 text-gray-400">{t.common.loading}</td></tr>
            ) : products.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-16 text-gray-400">
                <Package className="w-8 h-8 mx-auto mb-2 opacity-30" />
                <p>{t.products.noProducts}</p>
              </td></tr>
            ) : products.map((p, idx) => {
              const costJpy = calcCostJpy(p, rates)
              const salePriceJpy = Number(salePrices[p.id] ?? 0)
              const { wongarate, margin } = calcProfitRate(salePriceJpy, costJpy)
              const hasPrice = salePriceJpy > 0
              const isDirty = dirty.has(p.id)
              const profitKrw = hasPrice ? salePriceJpy - costJpy : 0

              return (
                <tr key={p.id} className={`transition-colors ${isDirty ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-gray-50 dark:hover:bg-gray-700/50'}`}>
                  <td className="px-4 py-3 text-gray-500 dark:text-gray-400 tabular-nums font-medium">{(page - 1) * PAGE_SIZE + idx + 1}</td>
                  <td className="px-4 py-3">
                    <SupplierBadge code={p.supplierCode} name={p.supplier.name} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-start gap-1">
                      <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{p.name}</p>
                      {p.url && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="shrink-0 text-gray-400 hover:text-blue-500 transition-colors mt-0.5" title="공급사 페이지 열기">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                        </a>
                      )}
                      {/* 편집·삭제 (전 상품). 크롤 상품은 경고 표시 */}
                      {(
                        <span className="shrink-0 flex items-center gap-0.5 ml-1">
                          {p.supplierCode !== 'ETC' && (
                            <span title={t.products.crawlEditWarn} className="flex items-center">
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                            </span>
                          )}
                          <button onClick={() => openEdit(p)} title={p.supplierCode !== 'ETC' ? t.products.crawlEditWarn : t.common.edit}
                            className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {deleteId === p.id ? (
                            <span className="inline-flex items-center gap-1">
                              <button onClick={() => deleteProduct(p.id)} className="px-1.5 py-0.5 bg-red-600 text-white rounded text-[10px] font-semibold hover:bg-red-700">{t.common.delete}</button>
                              <button onClick={() => setDeleteId(null)} className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 text-gray-500 rounded text-[10px] hover:bg-gray-200">{t.common.cancel}</button>
                            </span>
                          ) : (
                            <button onClick={() => setDeleteId(p.id)} title={t.common.delete}
                              className="p-1 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-gray-600 dark:text-gray-400 text-xs font-medium">{p.productCode} · {p.category || '—'}</p>
                      {p.optionSize && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium">{p.optionSize}</span>
                      )}
                      {p.optionColor && (
                        <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 font-medium">{p.optionColor}</span>
                      )}
                      {p.availability && p.availability !== 'in_stock' && (
                        <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                          p.availability === 'out_of_stock' ? 'bg-red-50 text-red-500' :
                          p.availability === 'limited' ? 'bg-yellow-50 text-yellow-600' :
                          'bg-gray-50 text-gray-400'
                        }`}>
                          {p.availability === 'out_of_stock' ? t.products.outOfStock : p.availability === 'limited' ? t.products.limited : p.availability}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-gray-100 tabular-nums">
                    {formatJpy(costJpy)}
                    <p className="text-gray-500 dark:text-gray-400 text-xs font-medium">
                      {p.supplier.currency === 'USD' ? '$' : p.supplier.currency === 'JPY' ? '¥' : '€'}
                      {formatNumber(p.costPrice)}
                    </p>
                    {p.msrp > 0 && (
                      <p className="text-indigo-500 text-xs font-medium" title="소매권장가(MSRP)">
                        MSRP {p.supplier.currency === 'USD' ? '$' : p.supplier.currency === 'JPY' ? '¥' : '€'}
                        {p.msrp.toFixed(2)} ≈ {formatJpy(Math.round(msrpToJpy(p, rates)))}
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2 w-36">
                    <div className="relative flex items-center gap-1">
                      <input
                        type="number"
                        className={`w-full text-right border rounded px-2 py-1.5 text-sm text-gray-900 focus:outline-none focus:ring-1 tabular-nums ${
                          savingIds.has(p.id) ? 'border-gray-300 bg-gray-50 dark:bg-gray-600 opacity-60' :
                          savedIds.has(p.id) ? 'border-green-400 bg-green-50 dark:bg-green-900/20 focus:ring-green-500' :
                          isDirty ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 focus:ring-blue-500' :
                          'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 focus:ring-blue-500 text-gray-900 dark:text-gray-100'
                        }`}
                        placeholder="0"
                        value={salePrices[p.id] ?? ''}
                        onChange={e => handlePriceChange(p.id, e.target.value)}
                        onBlur={() => saveOne(p.id)}
                        onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
                        disabled={savingIds.has(p.id)}
                      />
                      {savingIds.has(p.id) && (
                        <span className="absolute right-1.5 text-gray-400 text-xs animate-pulse">…</span>
                      )}
                      {savedIds.has(p.id) && !savingIds.has(p.id) && !isDirty && (
                        <CheckCircle className="absolute -right-4 w-3.5 h-3.5 text-green-500 shrink-0" />
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {hasPrice ? <ProfitBar margin={margin} /> : <span className="text-gray-500 text-xs">{t.products.needInput}</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {hasPrice ? (
                      <span className={`text-xs font-semibold ${wongarate <= 60 ? 'text-green-600' : wongarate <= 75 ? 'text-yellow-600' : 'text-red-600'}`}>
                        {wongarate.toFixed(1)}%
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums">
                    {hasPrice ? (
                      <span className={`text-xs font-medium ${profitKrw >= 0 ? 'text-green-600' : 'text-red-500'}`}>
                        {formatJpy(profitKrw)}
                      </span>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} / {formatNumber(total)}개
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page === 1}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              {/* 페이지 번호 버튼 */}
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p: number
                if (totalPages <= 7) p = i + 1
                else if (page <= 4) p = i + 1
                else if (page >= totalPages - 3) p = totalPages - 6 + i
                else p = page - 3 + i
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    className={`px-2.5 py-1 rounded text-xs font-medium ${
                      page === p ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
                    }`}
                  >
                    {p}
                  </button>
                )
              })}
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page === totalPages}
                className="p-1.5 rounded text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-30"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 수동 상품 등록/편집 모달 */}
      {formOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setFormOpen(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white">
                {editId ? t.products.editProduct : t.products.addProduct}
              </h2>
              <button onClick={() => setFormOpen(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.colSupplier}</label>
                  <select
                    value={form.supplierCode}
                    onChange={e => setForm(f => ({ ...f, supplierCode: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  >
                    {SUPPLIER_LIST.map(s => <option key={s} value={s}>{SUPPLIER_NAMES[s] ?? s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldBrand}</label>
                  <input type="text" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))}
                    placeholder={t.products.fieldBrandPh}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.colName} *</label>
                <input type="text" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder={t.products.fieldNamePh}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldCode}</label>
                  <input type="text" value={form.productCode} onChange={e => setForm(f => ({ ...f, productCode: e.target.value }))}
                    placeholder={t.products.fieldCodePh}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldCategory}</label>
                  <input type="text" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldCost} (¥)</label>
                  <input type="number" value={form.costPrice} onChange={e => setForm(f => ({ ...f, costPrice: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.colSale} (¥)</label>
                  <input type="number" value={form.salePriceJpy} onChange={e => setForm(f => ({ ...f, salePriceJpy: e.target.value }))}
                    placeholder="0"
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldSize}</label>
                  <input type="text" value={form.optionSize} onChange={e => setForm(f => ({ ...f, optionSize: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldColor}</label>
                  <input type="text" value={form.optionColor} onChange={e => setForm(f => ({ ...f, optionColor: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.fieldUnit}</label>
                  <input type="text" value={form.unit} onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                    className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              {form.supplierCode === 'ETC' && (
                <p className="text-xs text-gray-500 dark:text-gray-400">{t.products.etcHint}</p>
              )}
              {editId && form.supplierCode !== 'ETC' && (
                <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded px-2 py-1.5 flex items-start gap-1">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {t.products.crawlEditWarn}
                </p>
              )}
              {formError && <p className="text-xs text-red-600 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1.5">{formError}</p>}
            </div>
            <div className="flex gap-2 px-5 py-4 border-t border-gray-100 dark:border-gray-700">
              <button onClick={submitForm} disabled={formSaving}
                className="flex-1 bg-blue-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1.5">
                <Save className="w-4 h-4" />{formSaving ? t.common.saving : t.common.save}
              </button>
              <button onClick={() => setFormOpen(false)}
                className="px-4 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600">
                {t.common.cancel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 브랜드 관리 모달 */}
      {brandModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setBrandModal(false)}>
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 dark:border-gray-700">
              <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
                <Tags className="w-4 h-4 text-purple-500" /> {t.products.manageBrands}
                <span className="text-xs font-normal text-gray-400">{SUPPLIER_NAMES[supplierFilter] ?? supplierFilter}</span>
              </h2>
              <button onClick={() => setBrandModal(false)} className="p-1 text-gray-400 hover:text-gray-600 rounded"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.brandLabel}</label>
                <select value={brandSel} onChange={e => { setBrandSel(e.target.value); setBrandRenameTo(''); setBrandDelConfirm(false); setBrandMsg(null) }}
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">—</option>
                  {brands.map(b => <option key={b} value={b}>{b}</option>)}
                </select>
              </div>
              {brandSel && (
                <>
                  <div>
                    <label className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1 block">{t.products.brandRename}</label>
                    <div className="flex gap-2">
                      <input value={brandRenameTo} onChange={e => setBrandRenameTo(e.target.value)}
                        placeholder={t.products.brandRenameTo}
                        className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
                      <button onClick={() => runBrandOp({ action: 'rename', to: brandRenameTo })} disabled={brandBusy || !brandRenameTo.trim()}
                        className="px-3 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{t.common.save}</button>
                    </div>
                  </div>
                  <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                    {!brandDelConfirm ? (
                      <button onClick={() => setBrandDelConfirm(true)} disabled={brandBusy}
                        className="flex items-center gap-1.5 text-sm text-red-600 hover:text-red-700 font-medium">
                        <Trash2 className="w-4 h-4" /> {t.products.brandDelete}
                      </button>
                    ) : (
                      <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-lg p-3">
                        <p className="text-xs text-red-700 dark:text-red-400 font-medium mb-2">{t.products.brandDeleteConfirm}</p>
                        <div className="flex flex-col gap-2">
                          <button onClick={() => runBrandOp({ action: 'delete', mode: 'clear' })} disabled={brandBusy}
                            className="w-full py-1.5 rounded text-xs font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-200 dark:hover:bg-gray-600">{t.products.brandDeleteClear}</button>
                          <button onClick={() => runBrandOp({ action: 'delete', mode: 'products' })} disabled={brandBusy}
                            className="w-full py-1.5 rounded text-xs font-semibold bg-red-600 text-white hover:bg-red-700">{t.products.brandDeleteProducts}</button>
                          <button onClick={() => setBrandDelConfirm(false)} className="w-full py-1 text-xs text-gray-500 hover:text-gray-700">{t.common.cancel}</button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              {brandMsg && <p className="text-xs text-gray-600 dark:text-gray-300">{brandMsg}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
