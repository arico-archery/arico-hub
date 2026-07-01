'use client'

import { useState, useRef } from 'react'
import { useCachedState } from '@/lib/useApiCache'
import Link from 'next/link'
import { Users, Plus, Phone, Mail, MapPin, Pencil, Check, X, Trash2, Search, ShoppingCart, Upload, FileDown, FileSpreadsheet, Camera } from 'lucide-react'
import { formatJpy } from '@/lib/utils'
import { useT } from '@/lib/i18n'

type Customer = {
  id: number; code: string; name: string; company: string
  email: string; phone: string; address: string; memo: string
  customerType: string; taxRegNo: string; legalName: string
  postalCode: string; billingAddress: string; contactPerson: string
  _count: { orders: number }
  orders: { totalAmountJpy: number; paidAmountJpy: number }[]
}

type FormState = {
  name: string; company: string; phone: string; email: string; address: string; memo: string
  customerType: string; taxRegNo: string; legalName: string
  postalCode: string; billingAddress: string; contactPerson: string
}
const EMPTY_FORM: FormState = {
  name: '', company: '', phone: '', email: '', address: '', memo: '',
  customerType: 'individual', taxRegNo: '', legalName: '', postalCode: '', billingAddress: '', contactPerson: '',
}

const CUSTOMER_TYPES: { v: string; key: 'typeIndividual' | 'typeInstitution' | 'typeCorporation' }[] = [
  { v: 'individual', key: 'typeIndividual' },
  { v: 'institution', key: 'typeInstitution' },
  { v: 'corporation', key: 'typeCorporation' },
]
// 구분 배지 색상 (개인=회색 / 기관=보라 / 기업=호박)
const TYPE_BADGE: Record<string, string> = {
  individual: 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400',
  institution: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300',
  corporation: 'bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300',
}

// 모듈 레벨 컴포넌트로 정의 (컴포넌트 내부에 두면 매 렌더마다 재생성되어
// input이 unmount/remount → 한 글자 입력 후 포커스(커서)를 잃는 버그 발생)
function InputField({ label, value, onChange, placeholder, className = '' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; className?: string
}) {
  return (
    <div className={className}>
      <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 block">{label}</label>
      <input
        className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

// 거래처 입력 필드 (등록·편집 공용). 구분 선택 + 기관/기업이면 인보이스 필드 노출.
function CustomerFormFields({ form, patch }: { form: FormState; patch: (p: Partial<FormState>) => void }) {
  const t = useT()
  const isOrg = form.customerType !== 'individual'
  return (
    <div className="space-y-3">
      {/* 구분 */}
      <div>
        <label className="text-xs font-semibold text-gray-700 dark:text-gray-200 mb-1 block">{t.customers.labelType}</label>
        <div className="flex gap-2">
          {CUSTOMER_TYPES.map(({ v, key }) => (
            <button key={v} type="button" onClick={() => patch({ customerType: v })}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${form.customerType === v ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
              {t.customers[key]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        <InputField label={t.customers.labelName} placeholder={t.customers.placeholderName} value={form.name} onChange={v => patch({ name: v })} />
        <InputField label={t.customers.labelCompany} placeholder={t.customers.placeholderCompany} value={form.company} onChange={v => patch({ company: v })} />
        <InputField label={t.customers.labelPhone} placeholder="090-0000-0000" value={form.phone} onChange={v => patch({ phone: v })} />
        <InputField label={t.customers.labelEmail} placeholder="email@example.com" value={form.email} onChange={v => patch({ email: v })} />
        <InputField label={t.customers.labelPostalCode} placeholder="〒000-0000" value={form.postalCode} onChange={v => patch({ postalCode: v })} />
        <InputField label={t.customers.labelAddress} value={form.address} onChange={v => patch({ address: v })} />
      </div>
      {/* 기관/기업: 청구서(적격청구서) 정보 */}
      {isOrg && (
        <div className="rounded-lg border border-gray-100 dark:border-gray-700 p-3">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">{t.customers.invoiceInfo}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <InputField label={t.customers.labelTaxRegNo} placeholder="T0000000000000" value={form.taxRegNo} onChange={v => patch({ taxRegNo: v })} />
            <InputField label={t.customers.labelLegalName} value={form.legalName} onChange={v => patch({ legalName: v })} />
            <InputField label={t.customers.labelContactPerson} value={form.contactPerson} onChange={v => patch({ contactPerson: v })} />
            <InputField label={t.customers.labelBillingAddress} value={form.billingAddress} onChange={v => patch({ billingAddress: v })} className="sm:col-span-2 lg:col-span-3" />
          </div>
        </div>
      )}
      <InputField label={t.customers.labelMemo} placeholder={t.common.memoPlaceholder} value={form.memo} onChange={v => patch({ memo: v })} />
    </div>
  )
}

export default function CustomersPage() {
  const t = useT()
  // 클라 캐시: 재방문 즉시표시 + 백그라운드 재검증. setCustomers(낙관적 업데이트)는 캐시에 write-through.
  const [customers, setCustomers, { isLoading: loading, refresh: loadCustomers }] = useCachedState<Customer[]>('/api/customers', [])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [searchQ, setSearchQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')   // all | individual | institution | corporation
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editForm, setEditForm] = useState<FormState>(EMPTY_FORM)
  const [deleteConfirm, setDeleteConfirm] = useState<number | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  // 엑셀 임포트
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState<string | null>(null)

  const downloadCustomerTemplate = () => {
    const headers = ['이름', '구분', '회사', '전화', '이메일', '우편번호', '주소', '등록번호', '담당자', '청구지', '메모']
    const sample = ['홍길동', '기업', '○○양궁장', '090-0000-0000', 'a@b.com', '150-0001', '東京都…', 'T0000000000000', '田中', '', '']
    const csv = '﻿' + headers.join(',') + '\n' + sample.join(',')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a'); a.href = url; a.download = 'customers_template.csv'; a.click(); URL.revokeObjectURL(url)
  }

  // 명함 스캔(OCR) → 인식 결과로 등록 폼 프리필 (사람 확인 후 저장)
  const cardInputRef = useRef<HTMLInputElement>(null)
  const [scanning, setScanning] = useState(false)

  const handleCardScan = async (file: File) => {
    setScanning(true); setErrorMsg('')
    try {
      const fd = new FormData(); fd.append('file', file)
      const res = await fetch('/api/customers/ocr', { method: 'POST', body: fd })
      const d = await res.json()
      if (res.status === 503 || d.error === 'no_api_key') { setErrorMsg(t.customers.scanNoKey); return }
      if (!res.ok || !d.fields) { setErrorMsg(t.customers.scanFailed); return }
      const f = d.fields
      setForm({
        name: f.name || '', company: f.company || '', phone: f.phone || '', email: f.email || '',
        address: f.address || '', memo: f.title || '', customerType: f.customerType || 'individual',
        taxRegNo: f.taxRegNo || '', legalName: '', postalCode: f.postalCode || '',
        billingAddress: '', contactPerson: f.contactPerson || '',
      })
      setShowForm(true); setEditingId(null); setImportOpen(false)
      setErrorMsg('')
    } catch (e) {
      setErrorMsg(String(e))
    } finally {
      setScanning(false)
    }
  }

  const handleImport = async () => {
    if (!importFile) return
    setImporting(true); setImportResult(null)
    try {
      const fd = new FormData(); fd.append('file', importFile)
      const res = await fetch('/api/customers/import', { method: 'POST', body: fd })
      const d = await res.json()
      if (!res.ok) { setImportResult('⚠️ ' + (d.error || res.status)); return }
      setImportResult(`✅ ${d.imported}건 등록 / ${d.skipped} 스킵${d.errors ? ` / ${d.errors} 오류` : ''}`)
      setImportFile(null)
      loadCustomers()
    } catch (e) {
      setImportResult('⚠️ ' + String(e))
    } finally {
      setImporting(false)
    }
  }

  // 목록 로드/새로고침은 useCachedState가 처리 (loadCustomers = refresh)

  const handleCreate = async () => {
    if (!form.name) return
    const res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(form),
    })
    const newCustomer = await res.json()
    setCustomers(prev => [...prev, { ...newCustomer, _count: { orders: 0 }, orders: [] }])
    setForm(EMPTY_FORM)
    setShowForm(false)
  }

  const startEdit = (c: Customer) => {
    setEditingId(c.id)
    setEditForm({
      name: c.name, company: c.company, phone: c.phone, email: c.email, address: c.address, memo: c.memo,
      customerType: c.customerType || 'individual', taxRegNo: c.taxRegNo || '', legalName: c.legalName || '',
      postalCode: c.postalCode || '', billingAddress: c.billingAddress || '', contactPerson: c.contactPerson || '',
    })
    setErrorMsg('')
  }

  const handleSave = async (id: number) => {
    if (!editForm.name) return
    const res = await fetch(`/api/customers/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(editForm),
    })
    if (!res.ok) { setErrorMsg('저장 실패'); return }
    const updated = await res.json()
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, ...updated } : c))
    setEditingId(null)
  }

  const handleDelete = async (id: number) => {
    const res = await fetch(`/api/customers/${id}`, { method: 'DELETE' })
    if (!res.ok) {
      const err = await res.json()
      setErrorMsg(err.error ?? '삭제 실패')
      setDeleteConfirm(null)
      return
    }
    setCustomers(prev => prev.filter(c => c.id !== id))
    setDeleteConfirm(null)
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t.customers.title}</h1>
          <p className="text-gray-600 font-medium text-sm mt-1">{t.common.total} {customers.length}{t.customers.subtitleCount}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              className="pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-600 rounded-lg text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-52"
              placeholder={t.customers.searchPlaceholder}
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
            />
          </div>
          <input ref={cardInputRef} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleCardScan(f); e.target.value = '' }} />
          <button
            onClick={() => cardInputRef.current?.click()}
            disabled={scanning}
            className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            <Camera className="w-4 h-4" />
            {scanning ? t.customers.scanProcessing : t.customers.cardScan}
          </button>
          <button
            onClick={() => { setImportOpen(o => !o); setImportResult(null) }}
            className="flex items-center gap-1.5 border border-gray-200 dark:border-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
          >
            <Upload className="w-4 h-4" />
            {t.customers.excelImport}
          </button>
          <button
            onClick={() => { setShowForm(true); setEditingId(null) }}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {t.customers.newCustomer}
          </button>
        </div>
      </div>

      {/* 구분 필터 (전체/개인/기관/기업) */}
      <div className="flex items-center gap-2 mb-4 flex-wrap">
        <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 mr-1">{t.customers.labelType}</span>
        {([{ v: 'all', label: t.common.all }, ...CUSTOMER_TYPES.map(({ v, key }) => ({ v, label: t.customers[key] }))]).map(({ v, label }) => {
          const count = v === 'all' ? customers.length : customers.filter(c => (c.customerType || 'individual') === v).length
          const active = typeFilter === v
          return (
            <button key={v} type="button" onClick={() => setTypeFilter(v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${active ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
              {label}
              <span className={`text-xs tabular-nums ${active ? 'text-white/70' : 'text-gray-400 dark:text-gray-500'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {importOpen && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5 mb-4 border-l-4 border-green-500">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><FileSpreadsheet className="w-4 h-4 text-green-600" />{t.customers.importTitle}</h3>
            <button onClick={downloadCustomerTemplate} className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 px-2 py-1 rounded border border-gray-200 dark:border-gray-600"><FileDown className="w-3 h-3" />{t.customers.importTemplate}</button>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">{t.customers.importHint}</p>
          <div className="flex items-center gap-2 flex-wrap">
            <input type="file" accept=".csv,.xlsx,.xls" onChange={e => { setImportFile(e.target.files?.[0] ?? null); setImportResult(null) }}
              className="text-sm text-gray-700 dark:text-gray-200 file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-gray-100 dark:file:bg-gray-700 file:text-gray-700 dark:file:text-gray-200" />
            <button onClick={handleImport} disabled={!importFile || importing}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
              {importing ? t.common.loading : t.customers.excelImport}
            </button>
            {importResult && <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{importResult}</span>}
          </div>
        </div>
      )}

      {errorMsg && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm px-4 py-3 rounded-lg mb-4 flex items-center justify-between">
          {errorMsg}
          <button onClick={() => setErrorMsg('')}><X className="w-4 h-4" /></button>
        </div>
      )}

      {showForm && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 p-5 mb-4 border-l-4 border-blue-500">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-4">{t.customers.newTitle}</h3>
          <div className="mb-4">
            <CustomerFormFields form={form} patch={p => setForm(f => ({ ...f, ...p }))} />
          </div>
          <div className="flex gap-2">
            <button onClick={handleCreate} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors">{t.customers.save}</button>
            <button onClick={() => { setShowForm(false); setForm(EMPTY_FORM) }} className="bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">{t.common.cancel}</button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="text-center py-16 text-gray-400">{t.common.loading}</div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700/60 overflow-x-auto">
          <table className="w-full text-sm md:min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
                <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">{t.customers.colName}</th>
                <th className="hidden md:table-cell text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-36">{t.customers.colPhone}</th>
                <th className="hidden md:table-cell text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-48">{t.customers.colEmail}</th>
                <th className="hidden lg:table-cell text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">{t.customers.colAddress}</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-24">{t.customers.colOrders}</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-28">{t.customers.colSales}</th>
                <th className="hidden sm:table-cell text-right px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-24">{t.customers.colUnpaid}</th>
                <th className="w-20 px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
              {(() => {
                const filtered = customers.filter(c => {
                  if (typeFilter !== 'all' && (c.customerType || 'individual') !== typeFilter) return false
                  if (!searchQ) return true
                  const q = searchQ.toLowerCase()
                  return c.name.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q) || c.code.toLowerCase().includes(q)
                })
                if (filtered.length === 0) return (
                  <tr><td colSpan={8} className="text-center py-16 text-gray-400">
                    <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    <p>{searchQ ? `"${searchQ}" ${t.common.noData}` : t.customers.noCustomers}</p>
                  </td></tr>
                )
                return filtered.map(c => {
                  const totalSales = c.orders.reduce((a, o) => a + o.totalAmountJpy, 0)
                  const totalPaid  = c.orders.reduce((a, o) => a + o.paidAmountJpy, 0)
                  const unpaid = totalSales - totalPaid
                  const isEditing  = editingId === c.id
                  const isDeleting = deleteConfirm === c.id

                  if (isEditing) return (
                    <tr key={c.id} className="bg-blue-50/40 dark:bg-blue-900/10">
                      <td colSpan={8} className="px-4 py-3">
                        <div className="mb-2">
                          <CustomerFormFields form={editForm} patch={p => setEditForm(f => ({ ...f, ...p }))} />
                        </div>
                        <div className="flex gap-2">
                          <button onClick={() => handleSave(c.id)} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-blue-700">
                            <Check className="w-3.5 h-3.5" /> {t.common.save}
                          </button>
                          <button onClick={() => setEditingId(null)} className="flex items-center gap-1 bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-600">
                            <X className="w-3.5 h-3.5" /> {t.common.cancel}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )

                  return (
                    <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-medium px-1.5 py-0.5 rounded shrink-0">{c.code}</span>
                          <div>
                            <div className="flex items-center gap-1.5">
                              <p className="font-semibold text-gray-900 dark:text-gray-100">{c.name}</p>
                              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0 ${TYPE_BADGE[c.customerType || 'individual'] || TYPE_BADGE.individual}`}>
                                {t.customers[(CUSTOMER_TYPES.find(x => x.v === (c.customerType || 'individual')) || CUSTOMER_TYPES[0]).key]}
                              </span>
                            </div>
                            {c.company && <p className="text-xs text-gray-500 dark:text-gray-400">{c.company}</p>}
                          </div>
                        </div>
                        {c.memo && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-48">{c.memo}</p>}
                        {/* 모바일: 전화/이메일을 이름칸에 노출 (컬럼 숨김 대체) */}
                        <div className="md:hidden mt-1 space-y-0.5">
                          {c.phone && <p className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-[11px]"><Phone className="w-2.5 h-2.5 shrink-0" />{c.phone}</p>}
                          {c.email && <p className="flex items-center gap-1 text-gray-500 dark:text-gray-400 text-[11px] truncate max-w-44"><Mail className="w-2.5 h-2.5 shrink-0" />{c.email}</p>}
                        </div>
                      </td>
                      <td className="hidden md:table-cell px-4 py-3">
                        {c.phone && <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 text-xs"><Phone className="w-3 h-3 shrink-0" />{c.phone}</div>}
                      </td>
                      <td className="hidden md:table-cell px-4 py-3">
                        {c.email && <div className="flex items-center gap-1.5 text-gray-600 dark:text-gray-400 text-xs"><Mail className="w-3 h-3 shrink-0" />{c.email}</div>}
                      </td>
                      <td className="hidden lg:table-cell px-4 py-3">
                        {c.address && <div className="flex items-center gap-1.5 text-gray-500 dark:text-gray-400 text-xs"><MapPin className="w-3 h-3 shrink-0" /><span className="truncate max-w-40">{c.address}</span></div>}
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-right">
                        <Link href={`/orders?q=${encodeURIComponent(c.name)}`} className="font-medium text-blue-600 hover:underline text-xs flex items-center gap-1 justify-end">
                          <ShoppingCart className="w-3 h-3" />{c._count.orders}{t.common.cases}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-xs font-medium text-gray-700 dark:text-gray-200 tabular-nums">{formatJpy(totalSales)}</span>
                      </td>
                      <td className="hidden sm:table-cell px-4 py-3 text-right">
                        {unpaid > 0 && <span className="text-xs font-semibold text-red-600 tabular-nums">{formatJpy(unpaid)}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center gap-1 justify-end">
                          <button onClick={() => startEdit(c)} className="p-1 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded transition-colors" title="편집">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          {isDeleting ? (
                            <div className="flex items-center gap-1">
                              <button onClick={() => handleDelete(c.id)} className="px-2 py-0.5 bg-red-600 text-white text-xs rounded hover:bg-red-700">{t.common.delete}</button>
                              <button onClick={() => setDeleteConfirm(null)} className="px-2 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 text-xs rounded hover:bg-gray-300 dark:hover:bg-gray-500">{t.common.cancel}</button>
                            </div>
                          ) : (
                            <button onClick={() => setDeleteConfirm(c.id)} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors" title={t.common.delete}>
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
