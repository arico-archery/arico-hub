'use client'

import { Printer, FileSpreadsheet } from 'lucide-react'
import { DocType, DocLang, DOC_LANGS, DOC_LANG_LABEL } from '@/lib/documents'

const TYPE_LABEL: Record<DocType, Record<DocLang, string>> = {
  invoice: { ja: '請求書', ko: '청구서', en: 'Invoice' },
  quote:   { ja: '見積書', ko: '견적서', en: 'Quote' },
  po:      { ja: '発注書', ko: '발주서', en: 'PO' },
}

const ISSUER_LABEL: Record<DocLang, string> = { ja: '発行元', ko: '발행처', en: 'Issuer' }
const BANK_LABEL: Record<DocLang, string> = { ja: '口座', ko: '계좌', en: 'Bank' }

export default function DocToolbar({
  type, id, lang, backHref, issuers = [], issuerIdx = 0, banks = [], bankIdx = 0,
}: { type: DocType; id: string; lang: DocLang; backHref: string; issuers?: string[]; issuerIdx?: number; banks?: string[]; bankIdx?: number }) {
  // 청구서 ↔ 견적서는 같은 주문 데이터라 상호 전환 가능. 발주서는 단독.
  const orderTypes: DocType[] = ['invoice', 'quote']
  const showTypeSwitch = type !== 'po'

  const link = (t: DocType, l: DocLang) => `/documents/${t}/${id}?lang=${l}&issuer=${issuerIdx}&bank=${bankIdx}`
  const goProfile = (iss: number, bnk: number) => { window.location.href = `/documents/${type}/${id}?lang=${lang}&issuer=${iss}&bank=${bnk}` }

  return (
    <div className="max-w-3xl mx-auto mb-4 flex flex-wrap items-center gap-3 print:hidden">
      <a href={backHref} className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200">←</a>

      {/* 문서 종류 전환 (주문 기반 문서) */}
      {showTypeSwitch && (
        <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
          {orderTypes.map(tp => (
            <a
              key={tp}
              href={link(tp, lang)}
              className={`px-3 py-1.5 text-sm font-medium transition-colors ${
                tp === type
                  ? 'bg-slate-900 text-white'
                  : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
              }`}
            >
              {TYPE_LABEL[tp][lang]}
            </a>
          ))}
        </div>
      )}

      {/* 언어 전환 */}
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
        {DOC_LANGS.map(l => (
          <a
            key={l}
            href={link(type, l)}
            className={`px-3 py-1.5 text-sm font-medium transition-colors ${
              l === lang
                ? 'bg-blue-600 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
            }`}
          >
            {DOC_LANG_LABEL[l]}
          </a>
        ))}
      </div>

      {/* 발행처 프로필 선택 (여러 개일 때) */}
      {issuers.length > 1 && (
        <select value={issuerIdx} onChange={e => goProfile(Number(e.target.value), bankIdx)}
          className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
          {issuers.map((lbl, i) => <option key={i} value={i}>{ISSUER_LABEL[lang]}: {lbl}</option>)}
        </select>
      )}
      {/* 계좌 프로필 선택 (청구서, 여러 개일 때) */}
      {banks.length > 1 && (
        <select value={bankIdx} onChange={e => goProfile(issuerIdx, Number(e.target.value))}
          className="px-2 py-1.5 text-sm rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200">
          {banks.map((lbl, i) => <option key={i} value={i}>{BANK_LABEL[lang]}: {lbl}</option>)}
        </select>
      )}

      <div className="ml-auto flex items-center gap-2">
        {/* 발주서는 공급사 전달용 Excel(.xlsx) 다운로드 제공 */}
        {type === 'po' && (
          <a
            href={`/api/purchase-orders/${id}/excel?lang=${lang}&issuer=${issuerIdx}`}
            className="flex items-center gap-2 bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-800 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Excel
          </a>
        )}
        <button
          onClick={() => window.print()}
          className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors"
        >
          <Printer className="w-4 h-4" />
          PDF / Print
        </button>
      </div>
    </div>
  )
}
