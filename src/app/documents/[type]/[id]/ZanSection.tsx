'use client'

import { useState } from 'react'
import { Pencil, Check, X, ListPlus } from 'lucide-react'

type AutoRow = { ref: string; name: string; opt: string; qty: number }

// 注残(백오더 잔량) 섹션 — 수기 텍스트(Order.zanText, 한 줄=한 품목)를 문서에 찍는다.
// 연필로 인라인 편집, [현재 백오더 불러오기]로 앱의 백오더 데이터를 초안으로 채울 수 있다.
// 툴바 [注残] 토글(showAuto)을 켜면 자동 목록도 함께 표시된다. 편집 UI는 인쇄에서 숨김.
export default function ZanSection({
  orderId, initial, autoRows, showAuto, lang,
}: { orderId: number; initial: string; autoRows: AutoRow[]; showAuto: boolean; lang: string }) {
  const [text, setText] = useState(initial)
  const [draft, setDraft] = useState(initial)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)

  const title = lang === 'ja' ? '以下注残' : lang === 'ko' ? '이하 미출하(백오더) 잔량' : 'Backorder (pending)'
  const addLabel = lang === 'ja' ? '注残を記入' : lang === 'ko' ? '注残 수기 입력' : 'Add backorder note'
  const prefillLabel = lang === 'ja' ? '現在の注残を読み込む' : lang === 'ko' ? '현재 백오더 불러오기' : 'Load current backorders'

  const cancel = () => { setEditing(false); setDraft(text) }
  const save = async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zanText: draft }),
      })
      if (!res.ok) throw new Error()
      setText(draft); setEditing(false)
    } catch { alert('저장에 실패했습니다 / 保存に失敗しました') }
    setSaving(false)
  }
  const prefill = () => {
    const lines = autoRows.map(r => `${r.ref}　${r.name}${r.opt ? ` ${r.opt}` : ''} ×${r.qty}`)
    setDraft(d => [d.trim(), ...lines].filter(Boolean).join('\n'))
  }

  const manualLines = text.split('\n').map(s => s.trim()).filter(Boolean)
  const hasContent = manualLines.length > 0 || (showAuto && autoRows.length > 0)

  if (editing) {
    return (
      <div className="mt-2 text-[11px] print:hidden">
        <p className="font-semibold text-gray-800 mb-1">{title}</p>
        <textarea
          autoFocus value={draft} onChange={e => setDraft(e.target.value)}
          rows={Math.max(4, draft.split('\n').length + 1)}
          placeholder={lang === 'ja' ? '1行に1品目（例: 9576 FIVICS AUTOMATIC ボウスタンド ×4）' : '한 줄에 한 품목 (예: 9576 FIVICS AUTOMATIC ボウスタンド ×4)'}
          className="w-full border border-blue-300 rounded px-2 py-1.5 text-[12px] leading-relaxed focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        <div className="flex items-center gap-2 mt-1">
          <button onClick={prefill} disabled={autoRows.length === 0}
            className="flex items-center gap-1 px-2 py-1 rounded border border-gray-300 text-gray-600 hover:bg-gray-50 disabled:opacity-40">
            <ListPlus className="w-3.5 h-3.5" />{prefillLabel}{autoRows.length ? ` (${autoRows.length})` : ''}
          </button>
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

  if (!hasContent) {
    // 내용 없음 — 인쇄엔 아무것도 안 찍히고, 화면에만 작은 입력 버튼
    return (
      <button onClick={() => setEditing(true)}
        className="mt-2 print:hidden flex items-center gap-1 px-2 py-1 rounded border border-dashed border-gray-300 text-[11px] text-gray-400 hover:text-blue-600 hover:border-blue-400">
        <Pencil className="w-3 h-3" />{addLabel}
      </button>
    )
  }

  return (
    <div className="mt-2 text-[11px] leading-snug">
      <p className="font-semibold text-gray-800 mb-0.5 flex items-center gap-1">
        {title}
        <button onClick={() => setEditing(true)} title={addLabel}
          className="p-0.5 text-gray-300 hover:text-blue-600 print:hidden">
          <Pencil className="w-3 h-3" />
        </button>
      </p>
      {showAuto && autoRows.map((r, i) => (
        <p key={`a${i}`} className="text-gray-600">{r.ref}　{r.name}{r.opt ? ` ${r.opt}` : ''} ×{r.qty}</p>
      ))}
      {manualLines.map((l, i) => <p key={`m${i}`} className="text-gray-600">{l}</p>)}
    </div>
  )
}
