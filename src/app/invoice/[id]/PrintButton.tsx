'use client'

import { Printer } from 'lucide-react'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="flex items-center gap-2 bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-800 transition-colors ml-auto"
    >
      <Printer className="w-4 h-4" />
      인쇄 / PDF 저장
    </button>
  )
}
