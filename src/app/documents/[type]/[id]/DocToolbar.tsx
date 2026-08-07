'use client'

import { Printer, FileSpreadsheet } from 'lucide-react'
import { DocType, DocLang, DOC_LANGS, DOC_LANG_LABEL } from '@/lib/documents'

const TYPE_LABEL: Record<DocType, Record<DocLang, string>> = {
  invoice:  { ja: '請求書', ko: '청구서', en: 'Invoice' },
  quote:    { ja: '見積書', ko: '견적서', en: 'Quote' },
  po:       { ja: '発注書', ko: '발주서', en: 'PO' },
  delivery: { ja: '納品書', ko: '납품서', en: 'Delivery' },
  receipt:  { ja: '領収書', ko: '영수증', en: 'Receipt' },
}

const ISSUER_LABEL: Record<DocLang, string> = { ja: '発行元', ko: '발행처', en: 'Issuer' }
const BANK_LABEL: Record<DocLang, string> = { ja: '口座', ko: '계좌', en: 'Bank' }
const ZAN_LABEL: Record<DocLang, string> = { ja: '注残', ko: '백오더', en: 'Backorder' }
const PRICE_LABEL: Record<DocLang, string> = { ja: '金額表示', ko: '금액 표시', en: 'Prices' }

export default function DocToolbar({
  type, id, lang, backHref, issuers = [], issuerIdx = 0, banks = [], bankIdx = 0, zan = false, noPrice = false, ship = '',
}: {
  type: DocType; id: string; lang: DocLang; backHref: string
  issuers?: string[]; issuerIdx?: number; banks?: string[]; bankIdx?: number
  zan?: boolean; noPrice?: boolean; ship?: string
}) {
  // 주문 기반 문서(청구·견적·납품·영수)는 상호 전환 가능. 발주서는 단독.
  const orderTypes: DocType[] = ['invoice', 'quote', 'delivery', 'receipt']
  const showTypeSwitch = type !== 'po'
  // 注残 토글은 품목 표가 있는 고객 문서에만 (영수증 제외)
  const showZan = type === 'invoice' || type === 'quote' || type === 'delivery'

  const extras = `${zan ? '&zan=1' : ''}${noPrice ? '&np=1' : ''}${ship ? `&ship=${ship}` : ''}`
  const link = (t: DocType, l: DocLang) => `/documents/${t}/${id}?lang=${l}&issuer=${issuerIdx}&bank=${bankIdx}${extras}`
  const goProfile = (iss: number, bnk: number) => { window.location.href = `/documents/${type}/${id}?lang=${lang}&issuer=${iss}&bank=${bnk}${extras}` }

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

      {/* 注残(백오더 잔량) 표기 토글 — 청구 품목 아래에 미출하 잔량을 같이 찍어달라는 거래처용(安井 등) */}
      {showZan && (
        <a
          href={`/documents/${type}/${id}?lang=${lang}&issuer=${issuerIdx}&bank=${bankIdx}${zan ? '' : '&zan=1'}${noPrice ? '&np=1' : ''}${ship ? `&ship=${ship}` : ''}`}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            zan
              ? 'bg-amber-500 border-amber-500 text-white'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
          }`}
        >
          {ZAN_LABEL[lang]}{zan ? ' ✓' : ''}
        </a>
      )}

      {/* 납품서: 금액 표시 토글 (기본 표시 — 끄면 수량만 찍는 납품서) */}
      {type === 'delivery' && (
        <a
          href={`/documents/${type}/${id}?lang=${lang}&issuer=${issuerIdx}&bank=${bankIdx}${zan ? '&zan=1' : ''}${noPrice ? '' : '&np=1'}${ship ? `&ship=${ship}` : ''}`}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg border transition-colors ${
            !noPrice
              ? 'bg-green-700 border-green-700 text-white'
              : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500 hover:bg-gray-50 dark:hover:bg-gray-700 line-through'
          }`}
        >
          {PRICE_LABEL[lang]}{!noPrice ? ' ✓' : ''}
        </a>
      )}

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
