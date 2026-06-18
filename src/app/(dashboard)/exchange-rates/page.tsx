'use client'

import { useState, useEffect } from 'react'
import { RefreshCw, Save, TrendingUp, Download } from 'lucide-react'
import { useT } from '@/lib/i18n'

type Rate = { id: number; currency: string; rateToJpy: number; updatedAt: string }

const CURRENCY_FLAGS: Record<string, { flag: string; color: string }> = {
  USD: { flag: '🇺🇸', color: 'border-blue-500' },
  JPY: { flag: '🇯🇵', color: 'border-red-500' },
  EUR: { flag: '🇪🇺', color: 'border-yellow-500' },
}

const SUPPLIERS_BY_CURRENCY: Record<string, string[]> = {
  USD: ['JVD', 'MK Korea', 'FIVICS'],
  JPY: ['Shibuya', 'Korea Archery', 'Angel'],
  EUR: [],
}

export default function ExchangeRatesPage() {
  const t = useT()

  const CURRENCY_INFO: Record<string, { name: string; flag: string; color: string }> = {
    USD: { name: t.exchangeRates.currencyUSD, flag: '🇺🇸', color: 'border-blue-500' },
    KRW: { name: t.exchangeRates.currencyKRW, flag: '🇰🇷', color: 'border-purple-500' },
    EUR: { name: t.exchangeRates.currencyEUR, flag: '🇪🇺', color: 'border-yellow-500' },
  }
  // 표시 순서: 달러 → 원(엔=원) → 유로. JPY=JPY(1.0)는 무의미하여 제외.
  // KRW는 "1엔 = ? 원"(won per yen) 의미로, rateToJpy 필드를 원/엔 값으로 사용(원가계산엔 미사용).
  const DISPLAY_CURRENCIES = ['USD', 'KRW', 'EUR'] as const
  const KRW_DEFAULT = 9.5
  const [rates, setRates] = useState<Rate[]>([])
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [saved, setSaved] = useState<Record<string, boolean>>({})
  const [naverLoading, setNaverLoading] = useState(false)
  const [naverResult, setNaverResult] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/exchange-rates').then(r => r.json()).then(data => {
      setRates(data)
      const init: Record<string, string> = {}
      data.forEach((r: Rate) => { init[r.currency] = String(r.rateToJpy) })
      if (init.KRW === undefined) init.KRW = String(KRW_DEFAULT)
      setEditing(init)
    })
  }, [])

  const handleNaverUpdate = async () => {
    setNaverLoading(true)
    setNaverResult(null)
    try {
      const res = await fetch('/api/exchange-rates/naver', { method: 'POST' })
      const data = await res.json()
      if (data.success) {
        setNaverResult(`✅ USD: ¥${data.rates.USD}  EUR: ¥${data.rates.EUR}`)
        // 화면 새로 고침
        const fresh = await fetch('/api/exchange-rates').then(r => r.json())
        setRates(fresh)
        const init: Record<string, string> = {}
        fresh.forEach((r: Rate) => { init[r.currency] = String(r.rateToJpy) })
        if (init.KRW === undefined) init.KRW = String(KRW_DEFAULT)
        setEditing(init)
      } else {
        setNaverResult(`❌ ${data.error}`)
      }
    } catch {
      setNaverResult('❌ 네트워크 오류')
    }
    setNaverLoading(false)
  }

  const handleSave = async (currency: string) => {
    const rateToJpy = Number(editing[currency])
    if (!rateToJpy || rateToJpy <= 0) return
    setSaving(p => ({ ...p, [currency]: true }))
    await fetch('/api/exchange-rates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currency, rateToJpy }),
    })
    setSaving(p => ({ ...p, [currency]: false }))
    setSaved(p => ({ ...p, [currency]: true }))
    setTimeout(() => setSaved(p => ({ ...p, [currency]: false })), 2000)
    setRates(prev => prev.map(r => r.currency === currency ? { ...r, rateToJpy, updatedAt: new Date().toISOString() } : r))
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.exchangeRates.title}</h1>
          <p className="text-gray-600 dark:text-gray-400 font-medium text-sm mt-1">{t.exchangeRates.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          {naverResult && (
            <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{naverResult}</span>
          )}
          <button
            onClick={handleNaverUpdate}
            disabled={naverLoading}
            className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {naverLoading
              ? <RefreshCw className="w-4 h-4 animate-spin" />
              : <Download className="w-4 h-4" />
            }
            {naverLoading ? t.exchangeRates.fetchNaverLoading : t.exchangeRates.fetchNaver}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
        {DISPLAY_CURRENCIES.map(cur => {
          const info = CURRENCY_INFO[cur]
          const isKrw = cur === 'KRW'
          const rateRow = rates.find(r => r.currency === cur)
          const suppliers = SUPPLIERS_BY_CURRENCY[cur] ?? []
          return (
            <div key={cur} className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-6 border-l-4 ${info?.color}`}>
              <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">{info?.flag}</span>
                <div>
                  <p className="font-bold text-gray-900 dark:text-gray-100">{cur}</p>
                  <p className="text-gray-600 dark:text-gray-400 text-sm">{info?.name}</p>
                </div>
              </div>
              <div className="mb-4">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 block">
                  {isKrw ? '1 JPY = ? KRW' : `1 ${cur} = ? JPY`}
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-lg font-bold text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                    value={editing[cur] ?? ''}
                    onChange={e => setEditing(p => ({ ...p, [cur]: e.target.value }))}
                    onKeyDown={e => e.key === 'Enter' && handleSave(cur)}
                  />
                  <button
                    onClick={() => handleSave(cur)}
                    disabled={saving[cur]}
                    className={`px-3 py-2.5 rounded-lg font-medium text-sm transition-colors ${
                      saved[cur]
                        ? 'bg-green-500 text-white'
                        : 'bg-blue-600 text-white hover:bg-blue-700'
                    }`}
                  >
                    {saving[cur] ? <RefreshCw className="w-4 h-4 animate-spin" /> :
                     saved[cur] ? t.common.saved : <Save className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {isKrw ? (
                <p className="text-xs text-gray-500 dark:text-gray-400">{t.exchangeRates.krwNote}</p>
              ) : suppliers.length > 0 && (
                <div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 font-medium mb-1">{t.exchangeRates.appliedSuppliers}</p>
                  <div className="flex flex-wrap gap-1">
                    {suppliers.map(s => <span key={s} className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs px-2 py-0.5 rounded">{s}</span>)}
                  </div>
                </div>
              )}
              {rateRow && (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-3">
                  {t.exchangeRates.lastUpdated}: {new Date(rateRow.updatedAt).toLocaleString('ja-JP')}
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-6">
        <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-blue-500" />
          {t.exchangeRates.howApply}
        </h2>
        <div className="space-y-3 text-sm text-gray-600 dark:text-gray-300">
          <div className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <span className="font-medium text-gray-800 dark:text-gray-200 w-28 flex-shrink-0">JVD / MK / FIVICS</span>
            <span>{t.exchangeRates.applyDescJvdMkFivics}</span>
          </div>
          <div className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <span className="font-medium text-gray-800 dark:text-gray-200 w-28 flex-shrink-0">SIBUYA</span>
            <span>{t.exchangeRates.applyDescSibuya}</span>
          </div>
          <div className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <span className="font-medium text-gray-800 dark:text-gray-200 w-28 flex-shrink-0">Korea Archery</span>
            <span>{t.exchangeRates.applyDescKorea}</span>
          </div>
          <div className="flex gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
            <span className="font-medium text-gray-800 dark:text-gray-200 w-28 flex-shrink-0">Angel</span>
            <span>{t.exchangeRates.applyDescAngel}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
