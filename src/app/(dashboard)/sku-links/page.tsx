'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Link2, Search, RefreshCw, CheckCircle2, X, ChevronDown, ChevronUp } from 'lucide-react'
import { formatNumber, SUPPLIER_COLORS } from '@/lib/utils'
import { optionMatchScore } from '@/lib/option-guess'
import { useT } from '@/lib/i18n'

// SKU 3단 연결 화면 — 카탈로그(상품군) → 스마레지(SKU) → 공급사(변형).
// 후보는 카탈로그의 공급사 매칭 그룹 변형에서 자동 제시하되, 확정은 반드시 사람이 누른다
// (자동매칭을 폐기했던 이유 — 좌우(RH/LH) 오매칭 — 를 되풀이하지 않기 위한 원칙).

type SkuRow = {
  id: number; productCode: string; name: string; size: string; color: string
  price: number; stock: number; sold: number
  catalogId: number | null; supplierProductId: number | null
  catalog: { id: number; name: string; priceJpy: number; supplierProductId: number | null
    groupSupplier: { id: number; name: string; supplierCode: string } | null } | null
  supplierProduct: { id: number; name: string; supplierCode: string; productCode: string
    optionSize: string; optionColor: string; costJpy: number } | null
}
type Variant = { id: number; name: string; productCode: string; supplierCode: string
  optionSize: string; optionColor: string; optionLabel?: string; options?: Record<string, string> }

// 스마레지(일본어) ↔ 공급사 변형(영어 약어)의 옵션 대조 — 토큰 변환을 거친다
function guessScore(row: SkuRow, v: Variant): number {
  const variantText = [v.optionSize, v.optionColor, v.optionLabel, ...(v.options ? Object.values(v.options) : [])]
    .filter(Boolean).join(' ')
  return optionMatchScore(`${row.name} ${row.size} ${row.color}`, variantText)
}

export default function SkuLinksPage() {
  const t = useT()
  const [filter, setFilter] = useState<'sold' | 'sold-unlinked' | 'linked' | 'all'>('sold-unlinked')
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<SkuRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState<number | null>(null)           // 펼친 행
  const [variants, setVariants] = useState<Record<number, Variant[] | 'none'>>({})  // 행별 후보
  const LIMIT = 50

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch(`/api/smaregi/links?filter=${filter}&q=${encodeURIComponent(q)}&limit=${LIMIT}&offset=${page * LIMIT}`)
      const d = await r.json()
      setRows(d.rows ?? []); setTotal(d.total ?? 0)
    } finally { setLoading(false) }
  }, [filter, q, page])
  useEffect(() => { load() }, [load])

  const loadVariants = async (row: SkuRow) => {
    if (variants[row.id]) return
    const pid = row.catalog?.supplierProductId
    if (!pid) { setVariants(prev => ({ ...prev, [row.id]: 'none' })); return }
    try {
      const d = await fetch(`/api/products/variants?productId=${pid}`).then(r => r.json())
      const list: Variant[] = Array.isArray(d.variants) && d.variants.length ? d.variants : []
      // 변형이 없는 단품이면 카탈로그의 매칭 상품 자체를 유일 후보로
      if (!list.length && row.catalog?.groupSupplier) {
        const g = row.catalog.groupSupplier
        setVariants(prev => ({ ...prev, [row.id]: [{ id: g.id, name: g.name, productCode: '', supplierCode: g.supplierCode, optionSize: '', optionColor: '' }] }))
        return
      }
      setVariants(prev => ({ ...prev, [row.id]: list.length ? list : 'none' }))
    } catch { setVariants(prev => ({ ...prev, [row.id]: 'none' })) }
  }

  const confirm = async (row: SkuRow, supplierProductId: number | null) => {
    const r = await fetch('/api/smaregi/links', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id, supplierProductId }),
    })
    if (r.ok) {
      setOpen(null)
      load()
    }
  }

  const chips: { v: typeof filter; label: string }[] = [
    { v: 'sold-unlinked', label: t.skuLinks.fSoldUnlinked },
    { v: 'sold', label: t.skuLinks.fSold },
    { v: 'linked', label: t.skuLinks.fLinked },
    { v: 'all', label: t.skuLinks.fAll },
  ]

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Link2 className="w-6 h-6" /> {t.skuLinks.title}
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">{t.skuLinks.subtitle}</p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {chips.map(c => (
          <button key={c.v} onClick={() => { setFilter(c.v); setPage(0) }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${filter === c.v ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
            {c.label}
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={e => { setQ(e.target.value); setPage(0) }} placeholder={t.skuLinks.searchPh}
            className="pl-8 pr-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-900 dark:text-gray-100 w-56" />
        </div>
        <button onClick={load} className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700 text-left">
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200">{t.skuLinks.colSku}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 w-16 text-center">{t.skuLinks.colSold}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200 w-16 text-center">{t.skuLinks.colStock}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200">{t.skuLinks.colCatalog}</th>
              <th className="px-3 py-2.5 font-semibold text-gray-700 dark:text-gray-200">{t.skuLinks.colSupplier}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {rows.map(row => {
              const vd = variants[row.id]
              const isOpen = open === row.id
              return (
                <React.Fragment key={row.id}>
                  <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/40">
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900 dark:text-gray-100 leading-tight">{row.name}</p>
                      <p className="text-xs text-gray-400">
                        {row.productCode}{(row.size || row.color) && ` · ${[row.size, row.color].filter(Boolean).join(' / ')}`}
                      </p>
                    </td>
                    <td className="px-3 py-2 text-center tabular-nums text-gray-600 dark:text-gray-300">{row.sold || '—'}</td>
                    <td className="px-3 py-2 text-center tabular-nums text-gray-600 dark:text-gray-300">{row.stock}</td>
                    <td className="px-3 py-2">
                      {row.catalog ? (
                        <p className="text-xs text-gray-700 dark:text-gray-200 line-clamp-2">{row.catalog.name}</p>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">{t.skuLinks.noCatalog}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {row.supplierProduct ? (
                        <div className="flex items-start gap-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded font-semibold text-white shrink-0 mt-0.5" style={{ backgroundColor: SUPPLIER_COLORS[row.supplierProduct.supplierCode] ?? '#64748b' }}>
                            {row.supplierProduct.supplierCode}
                          </span>
                          <div className="min-w-0">
                            <p className="text-xs text-gray-700 dark:text-gray-200 line-clamp-1">{row.supplierProduct.name}</p>
                            <p className="text-[11px] text-gray-400 tabular-nums">¥{formatNumber(row.supplierProduct.costJpy)}
                              <button onClick={() => confirm(row, null)} className="ml-2 text-red-400 hover:text-red-600" title={t.skuLinks.unlink}><X className="w-3 h-3 inline" /></button>
                            </p>
                          </div>
                        </div>
                      ) : row.catalog?.supplierProductId ? (
                        <button onClick={() => { setOpen(isOpen ? null : row.id); if (!isOpen) loadVariants(row) }}
                          className="text-xs text-blue-600 hover:underline flex items-center gap-1">
                          {isOpen ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          {t.skuLinks.pickBtn}
                        </button>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">{t.skuLinks.noGroup}</span>
                      )}
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={5} className="px-4 pb-3 bg-blue-50/40 dark:bg-blue-900/10">
                        {!vd ? (
                          <p className="text-xs text-gray-400 py-2">{t.common.loading}</p>
                        ) : vd === 'none' ? (
                          <p className="text-xs text-gray-400 py-2">{t.skuLinks.noVariants}</p>
                        ) : (
                          <div className="flex flex-wrap gap-1.5 pt-2">
                            {(() => {
                            // 가장 구체적으로 맞는 후보만 추천 (OPAQUE PINK 가 있으면 PINK 는 뺀다)
                            const best = Math.max(0, ...vd.map(v => guessScore(row, v)))
                            return [...vd].sort((a, b) => guessScore(row, b) - guessScore(row, a)).slice(0, 40).map(v => {
                              const guess = best > 0 && guessScore(row, v) === best
                              const opt = v.optionLabel || [v.optionSize, v.optionColor].filter(Boolean).join(' / ')
                              return (
                                <button key={v.id} onClick={() => confirm(row, v.id)}
                                  title={v.name}
                                  className={`px-2.5 py-1.5 rounded-lg text-xs border text-left transition-colors ${
                                    guess ? 'border-blue-500 bg-blue-100/60 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 font-semibold'
                                          : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-blue-400'
                                  }`}>
                                  {guess && <CheckCircle2 className="w-3 h-3 inline mr-1 -mt-0.5" />}
                                  {opt || v.name.slice(0, 30)}
                                </button>
                              )
                            })
                            })()}
                          </div>
                        )}
                        <p className="text-[11px] text-gray-400 mt-2">{t.skuLinks.pickHint}</p>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
            {!rows.length && !loading && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-gray-400">{t.skuLinks.empty}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
        <span>{t.common.total} {formatNumber(total)}</span>
        <div className="flex gap-2">
          <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
            className="px-3 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40">←</button>
          <span className="py-1">{page + 1} / {Math.max(1, Math.ceil(total / LIMIT))}</span>
          <button disabled={(page + 1) * LIMIT >= total} onClick={() => setPage(p => p + 1)}
            className="px-3 py-1 rounded border border-gray-200 dark:border-gray-600 disabled:opacity-40">→</button>
        </div>
      </div>
    </div>
  )
}
