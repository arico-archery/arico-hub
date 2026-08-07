'use client'

import { useState } from 'react'
import { Pencil, Check, X } from 'lucide-react'

// 備考(비고) 인라인 편집 — 주문/발주서의 memo 를 문서 화면에서 바로 기입·수정한다.
// 주문 등록의 메모와 같은 필드라 여기서 고치면 주문에도 반영된다. 편집 UI는 인쇄에서 숨김.
export default function NotesSection({
  endpoint, initial, title, lang,
}: { endpoint: string; initial: string; title: string; lang: string }) {
  const [text, setText] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const addLabel = lang === 'ja' ? '備考を記入' : lang === 'ko' ? '비고 기입' : 'Add notes'

  const cancel = () => { setEditing(false); setDraft(text) }
  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(endpoint, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memo: draft.trim() }),
      })
      if (!res.ok) throw new Error()
      setText(draft.trim()); setEditing(false)
    } catch { alert('저장에 실패했습니다 / 保存に失敗しました') }
    setSaving(false)
  }

  if (editing) {
    return (
      <div className="text-[12px] mt-3 print:hidden">
        <p className="font-semibold mb-0.5">{title}</p>
        <textarea
          autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          rows={Math.max(3, draft.split('\n').length + 1)}
          className="w-full border border-blue-300 rounded px-2 py-1.5 text-[12px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex items-center gap-2 mt-1 text-[11px]">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">
            <Check className="w-3.5 h-3.5" />{lang === 'ja' ? '保存' : '저장'}
          </button>
          <button onClick={cancel} className="flex items-center gap-1 px-2 py-1 rounded text-gray-500 hover:bg-gray-100">
            <X className="w-3.5 h-3.5" />{lang === 'ja' ? 'キャンセル' : '취소'}
          </button>
        </div>
      </div>
    )
  }

  if (!text) {
    return (
      <button onClick={() => setEditing(true)}
        className="mt-3 print:hidden flex items-center gap-1 px-2 py-1 rounded border border-dashed border-gray-300 text-[11px] text-gray-400 hover:text-blue-600 hover:border-blue-400">
        <Pencil className="w-3 h-3" />{addLabel}
      </button>
    )
  }

  return (
    <div className="text-[12px] mt-3">
      <p className="font-semibold mb-0.5 flex items-center gap-1">
        {title}
        <button onClick={() => setEditing(true)} title={addLabel}
          className="p-0.5 text-gray-300 hover:text-blue-600 print:hidden">
          <Pencil className="w-3 h-3" />
        </button>
      </p>
      <p className="whitespace-pre-wrap text-gray-700">{text}</p>
    </div>
  )
}
