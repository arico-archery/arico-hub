'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Search, Plus, Trash2, ArrowLeft, Truck, Filter, X } from 'lucide-react'
import { formatJpy, calcCostJpy, SUPPLIER_COLORS, SUPPLIER_LIST } from '@/lib/utils'
import SupplierBadge from '@/components/SupplierBadge'
import DateInput from '@/components/DateInput'
import { useT } from '@/lib/i18n'

type Supplier = { code: string; currency: string; taxRate: number; discount: number }
type Product  = { id: number; name: string; brand: string; productCode: string; supplierCode: string; costPrice: number; supplier: Supplier; optionSize: string; optionColor: string; origin?: string }
type ExchangeRate = { currency: string; rateToJpy: number }
type VariantAxis = { label: string; values: string[] }
type VItem = Product & { options: Record<string, string>; optionLabel: string }
type POLine   = {
  product: Product; quantity: number; unitCostJpy: number
  variantAxes?: VariantAxis[]; variantList?: VItem[]; variantAxisSel?: Record<string, string>
}

export default function NewPurchaseOrderPage() {
  const router = useRouter()
  const t = useT()
  const [rates, setRates] = useState<ExchangeRate[]>([])
  const [supplierFilter, setSupplierFilter] = useState('')
  const [productSearch, setProductSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Product[]>([])
  const [lines, setLines] = useState<POLine[]>([])
  const [expectedDate, setExpectedDate] = useState('')
  const [memo, setMemo] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    fetch('/api/exchange-rates').then(r => r.json()).then(setRates)
  }, [])

  const searchProducts = useCallback(async (q: string, sc: string) => {
    if (!q && !sc) { setSearchResults([]); return }
    const params = new URLSearchParams({ limit: '15', hideVariantParent: '1' })
    if (q)  params.set('q',        q)
    if (sc) params.set('supplier', sc)
    if (!sc) params.set('balanced', '1')   // '全て'일 때 공급사 균형
    const res  = await fetch(`/api/products?${params}`)
    const data = await res.json()
    setSearchResults(data.products ?? [])
  }, [])

  useEffect(() => {
    const timer = setTimeout(() => searchProducts(productSearch, supplierFilter), 300)
    return () => clearTimeout(timer)
  }, [productSearch, supplierFilter, searchProducts])

  const addProduct = (p: Product) => {
    const cost = calcCostJpy(p, rates)
    const idx  = lines.findIndex(l => l.product.id === p.id)
    if (idx >= 0) {
      setLines(prev => prev.map((l, i) => i === idx ? { ...l, quantity: l.quantity + 1 } : l))
    } else {
      setLines(prev => [...prev, { product: p, quantity: 1, unitCostJpy: cost }])
    }
    setProductSearch('')
    setSearchResults([])
    loadVariantsFor(p.id)
  }

  // 같은 그룹의 옵션 변형(JVD 코드접두부 / SHIBUYA 베이스명)을 불러와 라인에 부착
  const loadVariantsFor = (productId: number) => {
    fetch(`/api/products/variants?productId=${productId}`)
      .then(r => r.json())
      .then(d => {
        if (!Array.isArray(d.variants) || d.variants.length < 2) return
        if (!Array.isArray(d.axes) || d.axes.length === 0) return
        const cur = (d.variants as VItem[]).find(v => v.id === productId)
        setLines(prev => prev.map(l =>
          l.product.id === productId && !l.variantAxes
            ? { ...l, variantAxes: d.axes, variantList: d.variants, variantAxisSel: cur ? { ...cur.options } : {} }
            : l))
      })
      .catch(() => {})
  }

  // 캐스케이드: 앞선 축 선택과 양립 가능한 변형 중 해당 축의 고를 수 있는 값
  const availableAxisValues = (variants: VItem[], axisLabel: string, sel: Record<string, string>): string[] => {
    const others = Object.keys(sel).filter(k => k !== axisLabel && sel[k])
    const out: string[] = []
    for (const v of variants) {
      if (!others.every(k => v.options[k] === sel[k])) continue
      const val = v.options[axisLabel]
      if (val && !out.includes(val)) out.push(val)
    }
    return out
  }

  // 옵션 축 선택 → 변형 해결. 전체 축 지정 시 그 변형으로 라인 교체(원본 중복 시 첫 변형).
  const changeVariantAxis = (idx: number, axisLabel: string, value: string) => {
    setLines(prev => prev.map((l, i) => {
      if (i !== idx || !l.variantList) return l
      const sel = { ...(l.variantAxisSel || {}) }
      if (value) sel[axisLabel] = value; else delete sel[axisLabel]
      for (const ax of l.variantAxes || []) {
        if (ax.label === axisLabel) continue
        if (sel[ax.label] && !availableAxisValues(l.variantList, ax.label, sel).includes(sel[ax.label])) delete sel[ax.label]
      }
      const keys = Object.keys(sel).filter(k => sel[k])
      const matches = l.variantList.filter(v => keys.every(k => v.options[k] === sel[k]))
      if (matches.length >= 1 && keys.length >= (l.variantAxes?.length || 0)) {
        const v = matches[0]
        return { ...l, variantAxisSel: sel, product: v, unitCostJpy: calcCostJpy(v, rates) }
      }
      return { ...l, variantAxisSel: sel }
    }))
  }

  const updateLine = (idx: number, field: 'quantity' | 'unitCostJpy', val: number) => {
    setLines(prev => prev.map((l, i) => i === idx ? { ...l, [field]: val } : l))
  }

  const suppliers = [...new Set(lines.map(l => l.product.supplierCode))]
  const origins   = [...new Set(lines.map(l => l.product.origin || '').filter(Boolean))]  // 원산지 종류(FIVICS 中国/韓国)
  const totalCost = lines.reduce((s, l) => s + l.unitCostJpy * l.quantity, 0)

  const handleSubmit = async () => {
    if (lines.length === 0 || suppliers.length === 0) return
    if (suppliers.length > 1) {
      alert(t.purchaseOrders.newSupplierWarning)
      return
    }
    setSubmitting(true)
    const res = await fetch('/api/purchase-orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        supplierCode: suppliers[0],
        expectedDate: expectedDate || null,
        memo,
        items: lines.map(l => ({
          productId:   l.product.id,
          quantity:    l.quantity,
          unitCostJpy: l.unitCostJpy,
        })),
      }),
    })
    setSubmitting(false)
    if (res.ok) router.push('/purchase-orders')
  }

  return (
    <div className="p-6">
      <div className="flex items-center gap-4 mb-6">
        <button onClick={() => router.back()} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.purchaseOrders.newTitle}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{t.purchaseOrders.newSubtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="col-span-2 space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-3">{t.purchaseOrders.newSelectProduct}</h2>
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              <Filter className="w-3.5 h-3.5 text-gray-400 shrink-0" />
              <button
                onClick={() => setSupplierFilter('')}
                className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${supplierFilter === '' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
              >{t.purchaseOrders.all}</button>
              {SUPPLIER_LIST.map(s => (
                <button
                  key={s}
                  onClick={() => setSupplierFilter(supplierFilter === s ? '' : s)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${supplierFilter === s ? 'text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}
                  style={supplierFilter === s ? { backgroundColor: SUPPLIER_COLORS[s] } : {}}
                >{s}</button>
              ))}
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                className="w-full pl-9 pr-9 py-2.5 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder={t.purchaseOrders.newSearchPlaceholder}
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
              />
              {productSearch && <button type="button" onClick={() => setProductSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 z-10"><X className="w-3.5 h-3.5" /></button>}
              {searchResults.length > 0 && (
                <div className="absolute top-full mt-1 w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-10 max-h-64 overflow-y-auto">
                  {searchResults.map(p => {
                    const cost = calcCostJpy(p, rates)
                    return (
                      <button
                        key={p.id}
                        onClick={() => addProduct(p)}
                        className="w-full text-left px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 flex items-center gap-3 border-b border-gray-50 dark:border-gray-700 last:border-0"
                      >
                        <SupplierBadge code={p.supplierCode} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{p.name}</p>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <p className="text-xs text-gray-400">{p.brand} · {p.productCode}</p>
                            {p.optionSize && <span className="text-xs px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium">{p.optionSize}</span>}
                            {p.optionColor && <span className="text-xs px-1 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 font-medium">{p.optionColor}</span>}
                          </div>
                        </div>
                        <span className="text-sm font-medium text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatJpy(cost)}</span>
                        <Plus className="w-4 h-4 text-blue-500 flex-shrink-0" />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            {suppliers.length > 1 && (
              <p className="mt-2 text-xs text-orange-500">
                ⚠ {t.purchaseOrders.newSupplierWarning} ({suppliers.join(', ')})
              </p>
            )}
          </div>

          {lines.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left px-4 py-3 font-medium text-gray-500 dark:text-gray-400">{t.purchaseOrders.newColProduct}</th>
                    <th className="text-center px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-20">{t.purchaseOrders.newColQty}</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-32">{t.purchaseOrders.newColUnitCost}</th>
                    <th className="text-right px-4 py-3 font-medium text-gray-500 dark:text-gray-400 w-32">{t.purchaseOrders.newColSubtotal}</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
                  {lines.map((line, idx) => (
                    <tr key={line.product.id}>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <SupplierBadge code={line.product.supplierCode} />
                          {line.product.origin && <span className="shrink-0 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300">{line.product.origin === 'CHINA' ? '中国' : line.product.origin === 'KOREA' ? '韓国' : line.product.origin}</span>}
                          <div className="min-w-0">
                            <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{line.product.name}</p>
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <p className="text-xs text-gray-400">{line.product.productCode}</p>
                              {line.product.optionSize && <span className="text-xs px-1 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 font-medium">{line.product.optionSize}</span>}
                              {line.product.optionColor && <span className="text-xs px-1 py-0.5 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300 font-medium">{line.product.optionColor}</span>}
                            </div>
                            {line.variantAxes && line.variantAxes.length > 0 && line.variantList && (
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {line.variantAxes.map(ax => {
                                  const vals = availableAxisValues(line.variantList!, ax.label, line.variantAxisSel || {})
                                  return (
                                    <select
                                      key={ax.label}
                                      value={line.variantAxisSel?.[ax.label] ?? ''}
                                      onChange={e => changeVariantAxis(idx, ax.label, e.target.value)}
                                      className="border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    >
                                      <option value="">{ax.label}</option>
                                      {vals.map(v => <option key={v} value={v}>{v}</option>)}
                                    </select>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="number" min="1"
                          className="w-16 text-center border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={line.quantity}
                          onChange={e => updateLine(idx, 'quantity', Number(e.target.value))}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="number"
                          className="w-28 text-right border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500 tabular-nums"
                          value={line.unitCostJpy}
                          onChange={e => updateLine(idx, 'unitCostJpy', Number(e.target.value))}
                        />
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-700 dark:text-gray-200 tabular-nums">
                        {formatJpy(line.unitCostJpy * line.quantity)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}
                          className="text-gray-300 hover:text-red-500 transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700">
                    <td colSpan={3} className="px-4 py-3 text-right text-sm text-gray-500 dark:text-gray-400">{t.purchaseOrders.newColTotal}</td>
                    <td className="px-4 py-3 text-right font-bold text-gray-900 dark:text-gray-100 tabular-nums">{formatJpy(totalCost)}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5 sticky top-6">
            <h2 className="font-semibold text-gray-900 dark:text-white mb-4">{t.purchaseOrders.newSummary}</h2>

            {suppliers.length > 0 ? (
              <div className="p-3 rounded-lg mb-4" style={{ backgroundColor: SUPPLIER_COLORS[suppliers[0]] + '18' }}>
                {suppliers.map(s => <SupplierBadge key={s} code={s} />)}
              </div>
            ) : (
              <div className="p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg mb-4 text-gray-400 text-sm text-center">{t.purchaseOrders.newSelectSupplier}</div>
            )}

            <div className="space-y-2 mb-4 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t.purchaseOrders.newItemCount}</span>
                <span className="font-medium dark:text-gray-100">{lines.length}{t.common.cases}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500 dark:text-gray-400">{t.purchaseOrders.newTotalCost}</span>
                <span className="font-bold text-gray-900 dark:text-gray-100">{formatJpy(totalCost)}</span>
              </div>
            </div>

            <div className="space-y-3 mb-5">
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t.purchaseOrders.newExpectedDate}</label>
                <DateInput
                  value={expectedDate}
                  onChange={setExpectedDate}
                  className="mt-0.5"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1 block">{t.common.memo}</label>
                <textarea
                  className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                  rows={3}
                  placeholder={t.purchaseOrders.newMemoPlaceholder}
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                />
              </div>
            </div>

            {origins.length > 1 && (
              <p className="mb-2 text-xs text-teal-700 dark:text-teal-300 bg-teal-50 dark:bg-teal-900/20 border border-teal-200 dark:border-teal-800/50 rounded-lg px-3 py-2">
                {t.purchaseOrders.originSplitHint} ({origins.map(o => o === 'CHINA' ? '中国' : o === 'KOREA' ? '韓国' : o).join(' / ')})
              </p>
            )}
            <button
              onClick={handleSubmit}
              disabled={lines.length === 0 || suppliers.length !== 1 || submitting}
              className="w-full bg-blue-600 text-white py-3 rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
            >
              <Truck className="w-4 h-4" />
              {submitting ? t.common.processing : t.purchaseOrders.newSubmit}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
