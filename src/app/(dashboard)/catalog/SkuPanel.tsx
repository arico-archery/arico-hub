'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { CheckCircle2, X, Plus, Package } from 'lucide-react'
import { formatNumber, SUPPLIER_COLORS } from '@/lib/utils'
import { optionMatchScore } from '@/lib/option-guess'
import { useT } from '@/lib/i18n'

// 카탈로그 행을 펼쳤을 때 나오는 SKU 패널 — 3단 연결(카탈로그 → 스마레지 SKU → 공급사 변형)을
// 카탈로그 관점에서 관리한다. 공급사 변형 확정은 반드시 사람이 누른다(자동 확정 없음).

type Sku = {
  id: number; productCode: string; name: string; size: string; color: string
  price: number; stock: number; sold: number; supplierProductId: number | null
  supplierProduct: { id: number; name: string; supplierCode: string; optionSize: string; optionColor: string; costJpy: number } | null
}
type Variant = { id: number; name: string; optionSize: string; optionColor: string; optionLabel?: string; options?: Record<string, string> }

// 스마레지(일본어) ↔ 공급사 변형(영어 약어)의 옵션 대조는 토큰 변환을 거친다
function guessScore(sku: Sku, v: Variant): number {
  const variantText = [v.optionSize, v.optionColor, v.optionLabel, ...(v.options ? Object.values(v.options) : [])]
    .filter(Boolean).join(' ')
  return optionMatchScore(`${sku.name} ${sku.size} ${sku.color}`, variantText)
}

export default function SkuPanel({ catalogId, catalogSupplierProductId }: { catalogId: number; catalogSupplierProductId: number | null }) {
  const t = useT()
  const [skus, setSkus] = useState<Sku[]>([])
  const [cands, setCands] = useState<Sku[]>([])
  const [loading, setLoading] = useState(true)
  const [showCands, setShowCands] = useState(false)
  const [variants, setVariants] = useState<Variant[] | 'none' | null>(null)
  const [pickFor, setPickFor] = useState<number | null>(null)   // 변형 고르는 중인 SKU

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const d = await fetch(`/api/arico-catalog/skus?catalogId=${catalogId}`).then(r => r.json())
      setSkus(d.skus ?? []); setCands(d.candidates ?? [])
    } finally { setLoading(false) }
  }, [catalogId])
  useEffect(() => { load() }, [load])

  const loadVariants = async () => {
    if (variants) return
    if (!catalogSupplierProductId) { setVariants('none'); return }
    try {
      const d = await fetch(`/api/products/variants?productId=${catalogSupplierProductId}`).then(r => r.json())
      setVariants(Array.isArray(d.variants) && d.variants.length ? d.variants : 'none')
    } catch { setVariants('none') }
  }

  const patch = async (id: number, body: Record<string, number | null>) => {
    await fetch('/api/smaregi/links', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    })
    setPickFor(null)
    load()
  }

  if (loading) return <p className="text-xs text-gray-400 py-3">{t.common.loading}</p>

  return (
    <div className="py-2 space-y-2">
      {/* 연결된 SKU */}
      {skus.length === 0 ? (
        <p className="text-xs text-gray-400">{t.catalog.skuNone}</p>
      ) : (
        <div className="space-y-1">
          {skus.map(s => (
            <React.Fragment key={s.id}>
            <div className="flex items-start gap-2 text-xs bg-white dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700 px-2.5 py-1.5">
              <Package className="w-3.5 h-3.5 text-gray-300 dark:text-gray-600 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-gray-800 dark:text-gray-100 leading-tight truncate">{s.name}</p>
                <p className="text-[11px] text-gray-400 tabular-nums">
                  {s.productCode}
                  {(s.size || s.color) && ` · ${[s.size, s.color].filter(Boolean).join(' / ')}`}
                  {` · ${t.catalog.skuStock} ${s.stock}`}
                  {s.sold > 0 && ` · ${t.catalog.skuSold} ${s.sold}`}
                </p>
              </div>
              {/* 공급사 변형 — 확정됐으면 표시, 아니면 고르기 */}
              <div className="shrink-0 w-56">
                {s.supplierProduct ? (
                  <div className="flex items-start gap-1">
                    <span className="text-[9px] px-1 py-0.5 rounded font-bold text-white shrink-0 mt-0.5"
                      style={{ backgroundColor: SUPPLIER_COLORS[s.supplierProduct.supplierCode] ?? '#64748b' }}>
                      {s.supplierProduct.supplierCode}
                    </span>
                    <div className="min-w-0">
                      <p className="text-[11px] text-gray-700 dark:text-gray-200 truncate">
                        {[s.supplierProduct.optionSize, s.supplierProduct.optionColor].filter(Boolean).join(' / ') || s.supplierProduct.name}
                      </p>
                      <p className="text-[10px] text-gray-400 tabular-nums">¥{formatNumber(s.supplierProduct.costJpy)}</p>
                    </div>
                    <button onClick={() => patch(s.id, { supplierProductId: null })} title={t.catalog.skuUnlinkSup}
                      className="text-red-400 hover:text-red-600 shrink-0"><X className="w-3 h-3" /></button>
                  </div>
                ) : catalogSupplierProductId ? (
                  <button onClick={() => { setPickFor(pickFor === s.id ? null : s.id); loadVariants() }}
                    className="text-[11px] text-blue-600 hover:underline">{t.catalog.skuPick}</button>
                ) : (
                  <span className="text-[11px] text-gray-300 dark:text-gray-600">{t.catalog.skuNoGroup}</span>
                )}
              </div>
              <button onClick={() => patch(s.id, { catalogId: null })} title={t.catalog.skuDetach}
                className="text-gray-300 hover:text-red-500 shrink-0"><X className="w-3.5 h-3.5" /></button>
            </div>

            {/* 변형 선택 — 누른 SKU 바로 아래에 펼친다 (목록이 길어도 눈이 이동하지 않도록) */}
            {pickFor === s.id && (
              <div className="bg-blue-50/60 dark:bg-blue-900/20 rounded-lg px-2.5 py-2 ml-6">
                {!variants ? (
                  <p className="text-xs text-gray-400">{t.common.loading}</p>
                ) : variants === 'none' ? (
                  <p className="text-xs text-gray-400">{t.catalog.skuNoVariants}</p>
                ) : (
                  <>
                    <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1.5">{t.catalog.skuPickHint}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {(() => {
                        // 가장 구체적으로 맞는 후보만 추천 표시 (OPAQUE PINK 가 있으면 PINK 는 뺀다)
                        const best = Math.max(0, ...variants.map(v => guessScore(s, v)))
                        return [...variants]
                          .sort((a, b) => guessScore(s, b) - guessScore(s, a))
                          .slice(0, 40)
                          .map(v => {
                          const guess = best > 0 && guessScore(s, v) === best
                          const label = v.optionLabel || [v.optionSize, v.optionColor].filter(Boolean).join(' / ') || v.name.slice(0, 28)
                          return (
                            <button key={v.id} onClick={() => patch(s.id, { supplierProductId: v.id })} title={v.name}
                              className={`px-2 py-1 rounded text-[11px] border transition-colors ${
                                guess ? 'border-blue-500 bg-blue-100/70 dark:bg-blue-900/50 text-blue-800 dark:text-blue-200 font-semibold'
                                      : 'border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:border-blue-400'}`}>
                              {guess && <CheckCircle2 className="w-3 h-3 inline mr-0.5 -mt-0.5" />}{label}
                            </button>
                          )
                        })
                      })()}
                    </div>
                  </>
                )}
              </div>
            )}
            </React.Fragment>
          ))}
        </div>
      )}

      {/* 후보 붙이기 */}
      {cands.length > 0 && (
        <div>
          <button onClick={() => setShowCands(v => !v)} className="text-[11px] text-gray-500 dark:text-gray-400 hover:text-blue-600 flex items-center gap-1">
            <Plus className="w-3 h-3" />{t.catalog.skuCandidates} ({cands.length})
          </button>
          {showCands && (
            <div className="mt-1.5 space-y-1">
              {cands.map(c => (
                <div key={c.id} className="flex items-center gap-2 text-xs bg-gray-50 dark:bg-gray-700/40 rounded px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-700 dark:text-gray-200 truncate">{c.name}</p>
                    <p className="text-[11px] text-gray-400">{c.productCode}{(c.size || c.color) && ` · ${[c.size, c.color].filter(Boolean).join(' / ')}`}</p>
                  </div>
                  <button onClick={() => patch(c.id, { catalogId })}
                    className="shrink-0 px-2 py-1 rounded bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                    {t.catalog.skuAttach}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
