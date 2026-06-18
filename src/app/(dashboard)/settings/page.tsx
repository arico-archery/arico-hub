'use client'

import { useState, useEffect, useRef } from 'react'
import { Upload, CheckCircle, AlertCircle, Database, RefreshCw, Building2, Save, FileDown, FileSpreadsheet } from 'lucide-react'
import { SUPPLIER_COLORS, formatNumber } from '@/lib/utils'
import { useT } from '@/lib/i18n'

type BankSettings = {
  bank_name: string
  bank_branch: string
  bank_account_type: string
  bank_account_no: string
  bank_account_holder: string
  bank_note: string
}

type CompanySettings = {
  company_name: string
  company_regno: string
  company_address: string
  company_tel: string
  company_email: string
  company_web: string
}

// ── 공급사별 CSV 템플릿 정의 ─────────────────────────────────
type SupplierTemplate = {
  code: string
  name: string
  currency: string
  descKey: 'descJvd' | 'descMk' | 'descFivics' | 'descSibuya' | 'descKorea' | 'descAngel'
  fileHint: string
  templateHeaders: string
  templateExample: string
}

const SUPPLIERS: SupplierTemplate[] = [
  {
    code: 'JVD', name: 'JVD Archery', currency: 'EUR',
    descKey: 'descJvd', fileHint: 'CSV',
    templateHeaders: 'product_code,name,brand,category,price_usd,msrp_usd,url,image_url_1',
    templateExample: 'JVD-001,Elite Carbon Riser,JVD,Riser,850.00,1200.00,https://jvd.../product/001,',
  },
  {
    code: 'MK', name: 'MK Korea', currency: 'USD',
    descKey: 'descMk', fileHint: 'CSV',
    templateHeaders: 'product_code,name,brand,category,price_usd,msrp_usd',
    templateExample: 'MK-ZX25,MK ZX Riser 25",MK,Riser,598.00,0',
  },
  {
    code: 'FIVICS', name: 'FIVICS', currency: 'USD',
    descKey: 'descFivics', fileHint: 'CSV / Excel(.xlsx)',
    templateHeaders: 'product_code,name,brand,category,PREMIUM,MSRP',
    templateExample: 'FV-SKADI-TX-P,SKADI-TX 25" Painted,FIVICS,Riser,525.00,1100.00',
  },
  {
    code: 'SIBUYA', name: 'Shibuya', currency: 'JPY',
    descKey: 'descSibuya', fileHint: 'CSV',
    templateHeaders: 'product_code,name,brand,category,price_jpy,url,image_url_1',
    templateExample: 'SB-001,SIBUYA NOVA Sight,SIBUYA,Sight,68000,https://sibuya.../,',
  },
  {
    code: 'KOREA', name: 'Korea Archery', currency: 'JPY',
    descKey: 'descKorea', fileHint: 'CSV',
    templateHeaders: 'product_code,name,brand,category,price_jpy,unit',
    templateExample: 'KA-JET6-175-R,JET6 Vane 1.75" R 1PK,KOREA ARCHERY,Vane,2475,50pcs',
  },
  {
    code: 'ANGEL', name: 'Angel Archery', currency: 'JPY',
    descKey: 'descAngel', fileHint: 'CSV',
    templateHeaders: 'product_code,name,brand,category,price_jpy',
    templateExample: 'AN-TQ-DXSP,Tournament Quiver DX-SP,ANGEL,Quiver,40000',
  },
]

function downloadTemplate(supplier: SupplierTemplate) {
  const content = [supplier.templateHeaders, supplier.templateExample].join('\n')
  const blob = new Blob(['﻿' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${supplier.code}_template.csv`
  a.click()
  URL.revokeObjectURL(url)
}

type ImportResult = { imported: number; skipped?: number; errors: number; total: number; errorDetails?: string[] } | null
type SupplierStats = { supplierCode: string; _count: number; latestScrapedAt?: string | null }
type SupplierRate = { code: string; discount: number; taxRate: number }

export default function SettingsPage() {
  const t = useT()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [selectedSupplier, setSelectedSupplier] = useState('JVD')
  const [file, setFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult>(null)
  const [error, setError] = useState('')
  const [dbStats, setDbStats] = useState<SupplierStats[]>([])
  const [statsLoading, setStatsLoading] = useState(false)
  const [supplierRates, setSupplierRates] = useState<SupplierRate[]>([])
  const [editingRate, setEditingRate] = useState<string | null>(null)
  const [rateInput, setRateInput] = useState('')
  const [rateSaving, setRateSaving] = useState(false)

  // 계좌 설정
  const [bank, setBank] = useState<BankSettings>({
    bank_name: '', bank_branch: '', bank_account_type: '普通',
    bank_account_no: '', bank_account_holder: '', bank_note: '',
  })
  const [bankSaving, setBankSaving] = useState(false)
  const [bankSaved, setBankSaved] = useState(false)

  // 발행처 정보 설정
  const [company, setCompany] = useState<CompanySettings>({
    company_name: '', company_regno: '', company_address: '',
    company_tel: '', company_email: '', company_web: '',
  })
  const [companySaving, setCompanySaving] = useState(false)
  const [companySaved, setCompanySaved] = useState(false)

  const loadStats = async () => {
    setStatsLoading(true)
    try {
      const stats: Record<string, { _count: number; latestScrapedAt?: string | null }> = {}
      await Promise.all(
        SUPPLIERS.map(async s => {
          const r = await fetch(`/api/products?supplier=${s.code}&statsOnly=1`)
          const d = await r.json()
          stats[s.code] = { _count: d.total ?? 0, latestScrapedAt: d.latestScrapedAt ?? null }
        })
      )
      setDbStats(Object.entries(stats).map(([supplierCode, s]) => ({ supplierCode, _count: s._count, latestScrapedAt: s.latestScrapedAt })))
    } catch { /* ignore */ }
    setStatsLoading(false)
  }

  const loadRates = () => {
    fetch('/api/suppliers').then(r => r.json()).then((data: SupplierRate[]) => {
      setSupplierRates(data)
    }).catch(() => {})
  }

  const saveRate = async (code: string) => {
    const val = parseFloat(rateInput)
    if (isNaN(val) || val < 0 || val > 1) return
    setRateSaving(true)
    await fetch('/api/suppliers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, discount: val }),
    })
    setRateSaving(false)
    setEditingRate(null)
    loadRates()
  }

  useEffect(() => {
    loadStats()
    loadRates()
    fetch('/api/settings').then(r => r.json()).then(data => {
      setBank(data)
      setCompany({
        company_name: data.company_name ?? '', company_regno: data.company_regno ?? '',
        company_address: data.company_address ?? '', company_tel: data.company_tel ?? '',
        company_email: data.company_email ?? '', company_web: data.company_web ?? '',
      })
    }).catch(() => {})
  }, [])

  const handleBankSave = async () => {
    setBankSaving(true)
    try {
      await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bank) })
      setBankSaved(true)
      setTimeout(() => setBankSaved(false), 2000)
    } catch { /* ignore */ }
    setBankSaving(false)
  }

  const handleCompanySave = async () => {
    setCompanySaving(true)
    try {
      await fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(company) })
      setCompanySaved(true)
      setTimeout(() => setCompanySaved(false), 2000)
    } catch { /* ignore */ }
    setCompanySaving(false)
  }

  const handleImport = async () => {
    if (!file || !selectedSupplier) return
    setImporting(true)
    setResult(null)
    setError('')

    const formData = new FormData()
    formData.append('file', file)
    formData.append('supplierCode', selectedSupplier)

    try {
      const res = await fetch('/api/import', { method: 'POST', body: formData })
      const data = await res.json()
      if (res.ok) {
        setResult(data)
        setFile(null)
        if (fileInputRef.current) fileInputRef.current.value = ''
        loadStats()
      } else {
        setError(data.error || '임포트 실패')
      }
    } catch (e) {
      setError(String(e))
    }
    setImporting(false)
  }

  const selected = SUPPLIERS.find(s => s.code === selectedSupplier)

  // MK 할인율 표시용 라벨
  function discountLabel(code: string): string {
    const rate = supplierRates.find(r => r.code === code)
    const d = rate?.discount ?? 0
    if (d <= 0) return '—'
    if (code === 'MK') return `${Math.round(d * 100)}% D/C`
    return `${Math.round(d * 100)}%`
  }

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.settings.title}</h1>
        <p className="text-gray-600 dark:text-gray-400 font-medium text-sm mt-1">{t.settings.subtitle}</p>
      </div>

      {/* 발행처 정보 (청구서/견적서/발주서) */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-6 mb-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-4 h-4 text-blue-500" />
            {t.settings.companyInfoTitle}
          </h2>
          <button
            onClick={handleCompanySave}
            disabled={companySaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {companySaved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {companySaved ? t.common.saved : companySaving ? t.common.saving : t.common.save}
          </button>
        </div>
        <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">{t.settings.companyInfoDesc}</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { key: 'company_name', label: t.settings.companyName, placeholder: 'ARICO' },
            { key: 'company_regno', label: t.settings.companyRegno, placeholder: 'T1234567890123' },
            { key: 'company_tel', label: 'TEL', placeholder: '+81-3-0000-0000' },
            { key: 'company_email', label: 'Email', placeholder: 'sbs@arico.co.jp' },
            { key: 'company_web', label: 'Web', placeholder: 'arico-archery.com' },
            { key: 'company_address', label: t.settings.companyAddress, placeholder: '東京都...' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 block">{label}</label>
              <input
                type="text"
                value={company[key as keyof CompanySettings]}
                onChange={e => setCompany(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-300"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 계좌 정보 */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-6 mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Building2 className="w-4 h-4 text-green-500" />
            {t.settings.bankInfoTitle}
          </h2>
          <button
            onClick={handleBankSave}
            disabled={bankSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {bankSaved ? <CheckCircle className="w-3.5 h-3.5" /> : <Save className="w-3.5 h-3.5" />}
            {bankSaved ? t.common.saved : bankSaving ? t.common.saving : t.common.save}
          </button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            { key: 'bank_name', label: '銀行名', placeholder: '例) 三菱UFJ銀行' },
            { key: 'bank_branch', label: '支店名', placeholder: '例) 渋谷支店' },
            { key: 'bank_account_type', label: '口座種別', placeholder: '普通 / 当座' },
            { key: 'bank_account_no', label: '口座番号', placeholder: '例) 1234567' },
            { key: 'bank_account_holder', label: '口座名義', placeholder: '例) カ）アリコ' },
            { key: 'bank_note', label: '備考', placeholder: '振込手数料はご負担ください' },
          ].map(({ key, label, placeholder }) => (
            <div key={key}>
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 block">{label}</label>
              <input
                type="text"
                value={bank[key as keyof BankSettings]}
                onChange={e => setBank(prev => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-green-300"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* CSV / Excel Import */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-6">
          <h2 className="font-semibold text-gray-900 dark:text-white mb-4 flex items-center gap-2">
            <Upload className="w-4 h-4 text-blue-500" />
            {t.settings.importTitle}
          </h2>

          {/* 공급사 선택 */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2 block">{t.settings.selectSupplier}</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {SUPPLIERS.map(s => (
                <button
                  key={s.code}
                  onClick={() => { setSelectedSupplier(s.code); setFile(null); setResult(null); setError('') }}
                  className={`p-2 rounded-lg border text-sm font-medium transition-colors ${
                    selectedSupplier === s.code
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 text-gray-900 dark:text-white'
                      : 'border-gray-200 dark:border-gray-600 hover:border-gray-300 dark:hover:border-gray-500 text-gray-700 dark:text-gray-200'
                  }`}
                  style={selectedSupplier === s.code ? { borderColor: SUPPLIER_COLORS[s.code] } : {}}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-full mr-1.5 align-middle"
                    style={{ backgroundColor: SUPPLIER_COLORS[s.code] }}
                  />
                  {s.code}
                </button>
              ))}
            </div>
          </div>

          {/* 선택된 공급사 안내 */}
          {selected && (
            <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1">
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-100">{selected.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{t.settings[selected.descKey]}</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400 mt-1 font-medium">{t.settings.allowedFormat}: {selected.fileHint}</p>
                </div>
                <button
                  onClick={() => downloadTemplate(selected)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-1 rounded border border-gray-200 dark:border-gray-600 hover:border-blue-400 transition-colors shrink-0"
                  title="CSV 템플릿 다운로드"
                >
                  <FileDown className="w-3 h-3" />
                  템플릿
                </button>
              </div>
            </div>
          )}

          {/* 파일 선택 — 커스텀 드롭존 */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-2 block">{t.settings.selectFile}</label>
            <input
              ref={fileInputRef}
              id="import-file-input"
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={e => { setFile(e.target.files?.[0] ?? null); setResult(null); setError('') }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault()
                const dropped = e.dataTransfer.files?.[0]
                if (dropped) { setFile(dropped); setResult(null); setError('') }
              }}
              className={`w-full border-2 border-dashed rounded-xl px-4 py-5 text-center transition-colors cursor-pointer
                ${file
                  ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
                }`}
            >
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileSpreadsheet className="w-5 h-5 text-blue-500 shrink-0" />
                  <div className="text-left min-w-0">
                    <p className="text-sm font-semibold text-blue-700 dark:text-blue-300 truncate">{file.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{(file.size / 1024).toFixed(1)} KB</p>
                  </div>
                </div>
              ) : (
                <div>
                  <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1.5" />
                  <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{t.settings.clickToSelect}</p>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{t.settings.dropHere} · CSV / .xlsx</p>
                </div>
              )}
            </button>
          </div>

          <button
            onClick={handleImport}
            disabled={!file || importing}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {importing ? t.settings.importing : t.settings.importStart}
          </button>

          {result && (
            <div className="mt-3 p-3 bg-green-50 dark:bg-green-900/20 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <CheckCircle className="w-4 h-4 text-green-600 flex-shrink-0" />
                <p className="text-sm text-green-700 dark:text-green-400">
                  {result.total}행 중 <strong>{result.imported}개 임포트 완료</strong>
                  {(result.skipped ?? 0) > 0 && <span className="text-gray-500"> ({result.skipped}행 스킵)</span>}
                  {result.errors > 0 && <span className="text-orange-500"> ({result.errors}개 오류)</span>}
                </p>
              </div>
              {result.errorDetails && result.errorDetails.length > 0 && (
                <div className="mt-1 text-xs text-gray-500 dark:text-gray-400 space-y-0.5">
                  {result.errorDetails.map((e, i) => <p key={i} className="truncate">{e}</p>)}
                </div>
              )}
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-lg flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-600 flex-shrink-0" />
              <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
            </div>
          )}
        </div>

        {/* 공급사 현황 & 할인율 설정 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <Database className="w-4 h-4 text-purple-500" />
              {t.settings.supplierSettings}
            </h2>
            <button
              onClick={loadStats}
              disabled={statsLoading}
              className="p-1.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 rounded transition-colors"
              title={t.settings.refreshCount}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${statsLoading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* 할인율 설명 */}
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-3">
            {t.settings.editRate} — ANGEL 掛率(0.6=60%), MK D/C(0.03=3%, 0.05=5%)
          </p>

          <div className="space-y-3">
            {SUPPLIERS.map(s => {
              const stat = dbStats.find(d => d.supplierCode === s.code)
              const rateObj = supplierRates.find(r => r.code === s.code)
              const d = rateObj?.discount ?? 0
              return (
                <div key={s.code} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                  <span
                    className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold text-white w-16 justify-center shrink-0"
                    style={{ backgroundColor: SUPPLIER_COLORS[s.code] }}
                  >
                    {s.code}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{s.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">{s.currency}</p>
                  </div>

                  {/* 할인율 편집 */}
                  <div className="shrink-0 flex items-center gap-1.5">
                    {editingRate === s.code ? (
                      <>
                        <input
                          type="number" step="0.01" min="0" max="1"
                          className="w-20 text-center border border-blue-400 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          value={rateInput}
                          onChange={e => setRateInput(e.target.value)}
                          placeholder="0.05"
                          autoFocus
                          onKeyDown={e => { if (e.key === 'Enter') saveRate(s.code); if (e.key === 'Escape') setEditingRate(null) }}
                        />
                        <button onClick={() => saveRate(s.code)} disabled={rateSaving}
                          className="p-1 text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20 rounded">
                          <CheckCircle className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingRate(null)}
                          className="p-1 text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600 rounded">
                          <RefreshCw className="w-3 h-3" />
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => {
                          setRateInput(d > 0 ? String(d) : '')
                          setEditingRate(s.code)
                        }}
                        className="flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-600 px-2 py-1 rounded border border-gray-200 dark:border-gray-500 hover:border-blue-400 transition-colors"
                        title="할인율 편집"
                      >
                        {discountLabel(s.code)}
                        <Save className="w-2.5 h-2.5 opacity-40" />
                      </button>
                    )}
                  </div>

                  {/* 상품 수 & 최근 업데이트 */}
                  {stat !== undefined && (
                    <div className="text-right shrink-0 min-w-[56px]">
                      <span className={`text-xs font-bold tabular-nums block ${stat._count > 0 ? 'text-blue-600' : 'text-gray-400'}`}>
                        {formatNumber(stat._count)}개
                      </span>
                      {stat.latestScrapedAt && (
                        <span className="text-xs text-gray-400 dark:text-gray-500 block">
                          {new Date(stat.latestScrapedAt).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* MK 할인 안내 */}
          <div className="mt-4 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg">
            <p className="text-xs text-purple-700 dark:text-purple-300 font-semibold mb-1">MK Volume Discount</p>
            <p className="text-xs text-purple-600 dark:text-purple-400 font-mono">
              Base: 0 &nbsp;|&nbsp; $20K+: 0.03 &nbsp;|&nbsp; $40K+: 0.05
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
