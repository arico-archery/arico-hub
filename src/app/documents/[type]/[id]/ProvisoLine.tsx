'use client'

import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'

// 영수증 但し書き(단서) 인라인 편집 — Order.receiptNote 에 저장. 비우면 기본값(お品代として) 표시.
export default function ProvisoLine({
  orderId, initial, label, fallback,
}: { orderId: number; initial: string; label: string; fallback: string }) {
  const [text, setText] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const cancel = () => { setEditing(false); setDraft(text) }
  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ receiptNote: draft.trim() }),
      })
      if (!res.ok) throw new Error()
      setText(draft.trim()); setEditing(false)
    } catch { alert('저장에 실패했습니다 / 保存に失敗しました') }
    setSaving(false)
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1">
        <span className="font-semibold shrink-0">{label}</span>
        <input
          autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          placeholder={fallback}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          className="min-w-[240px] border border-blue-300 rounded px-2 py-0.5 text-[13px] focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button onClick={save} disabled={saving} className="p-0.5 text-green-600 hover:text-green-700 disabled:opacity-50"><Check className="w-4 h-4" /></button>
        <button onClick={cancel} className="p-0.5 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
      </span>
    )
  }
  return (
    <span className="group/pv inline-flex items-center gap-1.5">
      <span className="font-semibold">{label}</span>
      <span className="border-b border-gray-400 min-w-[240px] inline-block px-1">{text || fallback}</span>
      <button onClick={() => setEditing(true)} title="但し書き 수정"
        className="p-0.5 text-gray-300 hover:text-blue-600 opacity-0 group-hover/pv:opacity-100 transition-opacity print:hidden">
        <Pencil className="w-3.5 h-3.5" />
      </button>
    </span>
  )
}
