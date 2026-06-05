'use client'

import { Printer } from 'lucide-react'
import { DocType, DocLang, DOC_LANGS, DOC_LANG_LABEL } from '@/lib/documents'

const TYPE_LABEL: Record<DocType, Record<DocLang, string>> = {
  invoice: { ja: '請求書', ko: '청구서', en: 'Invoice' },
  quote:   { ja: '見積書', ko: '견적서', en: 'Quote' },
  po:      { ja: '発注書', ko: '발주서', en: 'PO' },
}

export default function DocToolbar({
  type, id, lang, backHref,
}: { type: DocType; id: string; lang: DocLang; backHref: string }) {
  // 청구서 ↔ 견적서는 같은 주문 데이터라 상호 전환 가능. 발주서는 단독.
  const orderTypes: DocType[] = ['invoice', 'quote']
  const showTypeSwitch = type !== 'po'

  const link = (t: DocType, l: DocLang) => `/documents/${t}/${id}?lang=${l}`

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

      <button
        onClick={() => window.print()}
        className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors ml-auto"
      >
        <Printer className="w-4 h-4" />
        PDF / Print
      </button>
    </div>
  )
}
