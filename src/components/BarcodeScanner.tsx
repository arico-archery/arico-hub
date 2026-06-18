'use client'

import { useEffect, useRef, useState } from 'react'
import { X, Keyboard, Camera } from 'lucide-react'
import { useT } from '@/lib/i18n'

// 재사용 바코드 스캐너 — 후면 카메라 라이브 인식(zxing). 폰/태블릿 공용.
// 카메라 불가 시 수동 입력 폴백. onResult(코드) 호출 후 닫힘.
export default function BarcodeScanner({ onResult, onClose }: { onResult: (code: string) => void; onClose: () => void }) {
  const t = useT()
  const videoRef = useRef<HTMLVideoElement>(null)
  const [error, setError] = useState('')
  const [manual, setManual] = useState('')

  useEffect(() => {
    let active = true
    let controls: { stop: () => void } | undefined
    ;(async () => {
      try {
        const { BrowserMultiFormatReader } = await import('@zxing/browser')
        const reader = new BrowserMultiFormatReader()
        controls = await reader.decodeFromConstraints(
          { video: { facingMode: { ideal: 'environment' } } },
          videoRef.current!,
          (result, _err, ctrl) => {
            if (result && active) {
              try { navigator.vibrate?.(80) } catch { /* noop */ }
              ctrl.stop()
              onResult(result.getText())
            }
          },
        )
      } catch (e) {
        if (active) setError(String((e as Error)?.message || e))
      }
    })()
    return () => { active = false; try { controls?.stop() } catch { /* noop */ } }
  }, [onResult])

  return (
    <div className="fixed inset-0 z-[60] bg-black/80 flex items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-900 w-full h-full sm:h-auto sm:max-w-md sm:rounded-2xl overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2"><Camera className="w-4 h-4 text-blue-600" />{t.common.scanTitle}</h3>
          <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"><X className="w-5 h-5" /></button>
        </div>

        <div className="relative bg-black flex-1 min-h-[240px] flex items-center justify-center">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
          {!error && (
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="w-3/4 h-24 border-2 border-white/80 rounded-lg" />
            </div>
          )}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="text-white/80 text-sm">{t.common.cameraError}</p>
            </div>
          )}
        </div>

        {/* 수동 입력 폴백 */}
        <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700">
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-1.5 flex items-center gap-1"><Keyboard className="w-3 h-3" />{t.common.scanManualHint}</p>
          <div className="flex gap-2">
            <input
              value={manual}
              onChange={e => setManual(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && manual.trim()) onResult(manual.trim()) }}
              placeholder="JAN / barcode"
              className="flex-1 border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button onClick={() => manual.trim() && onResult(manual.trim())} disabled={!manual.trim()}
              className="px-4 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">{t.common.scanUse}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
