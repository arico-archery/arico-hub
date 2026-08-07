'use client'

import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'

// 문서(청구서·견적서) 품명 인라인 편집 — 이 주문 품목의 표기명(shopProductName)만 바꾼다.
// 상품 마스터·다른 주문에는 영향 없음. 인쇄 시 연필 아이콘은 숨김(print:hidden).
export default function EditableName({ itemId, initial }: { itemId: number; initial: string }) {
  const [name, setName] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const cancel = () => { setEditing(false); setDraft(name) }
  const save = async () => {
    const v = draft.trim()
    if (!v || v === name) { cancel(); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/order-items/${itemId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shopProductName: v }),
      })
      if (!res.ok) throw new Error()
      setName(v); setEditing(false)
    } catch { alert('저장에 실패했습니다 / 保存に失敗しました') }
    setSaving(false)
  }

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <input
          autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel() }}
          className="flex-1 min-w-[220px] border border-blue-300 rounded px-1.5 py-0.5 text-[12px] font-medium focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <button onClick={save} disabled={saving} title="저장" className="p-0.5 text-green-600 hover:text-green-700 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={cancel} title="취소" className="p-0.5 text-gray-400 hover:text-gray-600">
          <X className="w-3.5 h-3.5" />
        </button>
      </span>
    )
  }
  return (
    <span className="group/nm inline-flex items-center gap-1">
      <span className="font-medium">{name}</span>
      <button
        onClick={() => setEditing(true)} title="품명 수정 / 品名を編集"
        className="p-0.5 text-gray-300 hover:text-blue-600 opacity-0 group-hover/nm:opacity-100 transition-opacity print:hidden"
      >
        <Pencil className="w-3 h-3" />
      </button>
    </span>
  )
}
