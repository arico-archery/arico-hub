'use client'

import { useEffect } from 'react'

// 앱 디자인에 맞춘 확인 모달 (브라우저 기본 window.confirm 대체)
export default function ConfirmDialog({
  open, title, message, confirmText, cancelText, onConfirm, onCancel, danger = false,
}: {
  open: boolean
  title?: string
  message: string
  confirmText: string
  cancelText: string
  onConfirm: () => void
  onCancel: () => void
  danger?: boolean
}) {
  // ESC 로 닫기
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onCancel])

  if (!open) return null
  const confirmCls = danger
    ? 'bg-red-600 hover:bg-red-700'
    : 'bg-blue-600 hover:bg-blue-700'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-xl shadow-xl border border-gray-100 dark:border-gray-700 p-5"
        onClick={e => e.stopPropagation()}
      >
        {title && <h3 className="font-semibold text-gray-900 dark:text-white mb-1.5">{title}</h3>}
        <p className="text-sm text-gray-600 dark:text-gray-300 whitespace-pre-line">{message}</p>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            autoFocus
            className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${confirmCls}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}
