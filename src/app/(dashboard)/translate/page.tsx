'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { ArrowLeftRight, Copy, CheckCircle, X, Loader2, History, Trash2 } from 'lucide-react'

type LangCode = 'ja' | 'ko' | 'en'

const LANGS: { code: LangCode; label: string; flag: string }[] = [
  { code: 'ja', label: '日本語', flag: '🇯🇵' },
  { code: 'ko', label: '한국어', flag: '🇰🇷' },
  { code: 'en', label: 'English', flag: '🇺🇸' },
]

type HistoryItem = { from: LangCode; to: LangCode; src: string; result: string; ts: number }

const MAX_HISTORY = 20
const HISTORY_KEY = 'translate_history'

function loadHistory(): HistoryItem[] {
  try { return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]') } catch { return [] }
}
function saveHistory(h: HistoryItem[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(0, MAX_HISTORY)))
}

export default function TranslatePage() {
  const [from, setFrom] = useState<LangCode>('ja')
  const [to, setTo] = useState<LangCode>('ko')
  const [srcText, setSrcText] = useState('')
  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [provider, setProvider] = useState('')
  const [copiedSrc, setCopiedSrc] = useState(false)
  const [copiedDst, setCopiedDst] = useState(false)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => { setHistory(loadHistory()) }, [])

  const translate = useCallback(async (text: string, fromLang: LangCode, toLang: LangCode) => {
    if (!text.trim()) { setResult(''); setProvider(''); setError(''); return }
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: text.trim(), from: fromLang, to: toLang }),
        signal: abortRef.current.signal,
      })
      const data = await res.json()
      if (data.error) { setError(data.error); setResult('') }
      else {
        setResult(data.translated ?? '')
        setProvider(data.provider ?? '')
        if (text.trim() && data.translated) {
          const item: HistoryItem = { from: fromLang, to: toLang, src: text.trim(), result: data.translated, ts: Date.now() }
          setHistory(prev => {
            const next = [item, ...prev.filter(h => h.src !== text.trim())].slice(0, MAX_HISTORY)
            saveHistory(next)
            return next
          })
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError('번역 중 오류가 발생했습니다')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!srcText.trim()) { setResult(''); setProvider(''); setError(''); return }
    debounceRef.current = setTimeout(() => translate(srcText, from, to), 600)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [srcText, from, to, translate])

  const swap = () => {
    setFrom(to)
    setTo(from)
    setSrcText(result)
    setResult('')
  }

  const copy = async (text: string, which: 'src' | 'dst') => {
    await navigator.clipboard.writeText(text)
    if (which === 'src') { setCopiedSrc(true); setTimeout(() => setCopiedSrc(false), 1500) }
    else { setCopiedDst(true); setTimeout(() => setCopiedDst(false), 1500) }
  }

  const clearHistory = () => {
    setHistory([])
    localStorage.removeItem(HISTORY_KEY)
  }

  const fromLang = LANGS.find(l => l.code === from)!
  const toLang = LANGS.find(l => l.code === to)!
  const charCount = srcText.length

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">번역</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">일본어 ↔ 한국어 · 영어 상호 번역</p>
        </div>
        <button
          onClick={() => setShowHistory(v => !v)}
          className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            showHistory
              ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
              : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'
          }`}
        >
          <History className="w-4 h-4" />
          최근 번역 {history.length > 0 && `(${history.length})`}
        </button>
      </div>

      {/* 언어 선택 */}
      <div className="flex items-center gap-4 mb-4">
        {/* From */}
        <div className="flex gap-1 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-1 border border-gray-100 dark:border-gray-700">
          {LANGS.filter(l => l.code !== to).map(l => (
            <button
              key={l.code}
              onClick={() => setFrom(l.code)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                from === l.code ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span className="mr-1.5">{l.flag}</span>{l.label}
            </button>
          ))}
        </div>

        {/* Swap */}
        <button
          onClick={swap}
          className="p-2.5 bg-white dark:bg-gray-700 rounded-full shadow-sm border border-gray-100 dark:border-gray-600 text-gray-400 hover:text-blue-600 hover:border-blue-200 dark:hover:border-blue-500 transition-all hover:scale-110 active:scale-95"
          title="언어 전환"
        >
          <ArrowLeftRight className="w-4 h-4" />
        </button>

        {/* To */}
        <div className="flex gap-1 bg-white dark:bg-gray-800 rounded-xl shadow-sm p-1 border border-gray-100 dark:border-gray-700">
          {LANGS.filter(l => l.code !== from).map(l => (
            <button
              key={l.code}
              onClick={() => setTo(l.code)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                to === l.code ? 'bg-indigo-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              <span className="mr-1.5">{l.flag}</span>{l.label}
            </button>
          ))}
        </div>
      </div>

      {/* 번역 영역 */}
      <div className="grid grid-cols-2 gap-4 mb-4">
        {/* 입력 */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              {fromLang.flag} {fromLang.label}
            </span>
            <div className="flex items-center gap-1">
              {srcText && (
                <>
                  <button
                    onClick={() => copy(srcText, 'src')}
                    className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    title="복사"
                  >
                    {copiedSrc ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                  <button
                    onClick={() => { setSrcText(''); setResult(''); setError('') }}
                    className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                    title="지우기"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          </div>
          <textarea
            className="flex-1 w-full px-4 pb-3 text-base text-gray-900 dark:text-gray-100 bg-transparent resize-none focus:outline-none placeholder-gray-300 dark:placeholder-gray-600 min-h-[220px]"
            placeholder={`${fromLang.label}로 입력하세요...`}
            value={srcText}
            onChange={e => setSrcText(e.target.value)}
            autoFocus
          />
          <div className="px-4 py-2 border-t border-gray-50 dark:border-gray-700 flex items-center justify-between">
            <span className={`text-xs tabular-nums ${charCount > 4000 ? 'text-red-500' : 'text-gray-300 dark:text-gray-600'}`}>
              {charCount.toLocaleString()} / 5,000
            </span>
            <button
              onClick={() => translate(srcText, from, to)}
              disabled={!srcText.trim() || loading}
              className="px-4 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-medium hover:bg-blue-700 disabled:opacity-40 transition-colors"
            >
              번역
            </button>
          </div>
        </div>

        {/* 결과 */}
        <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border overflow-hidden flex flex-col transition-colors ${
          error
            ? 'border-red-200 dark:border-red-800/50'
            : result
              ? 'border-indigo-100 dark:border-indigo-800/50'
              : 'border-gray-100 dark:border-gray-700'
        }`}>
          <div className="flex items-center justify-between px-4 pt-3 pb-1">
            <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">
              {toLang.flag} {toLang.label}
            </span>
            <div className="flex items-center gap-2">
              {provider && !loading && (
                <span className="text-xs text-gray-300 dark:text-gray-600 bg-gray-50 dark:bg-gray-700/50 px-2 py-0.5 rounded-full">{provider}</span>
              )}
              {result && (
                <button
                  onClick={() => copy(result, 'dst')}
                  className="p-1.5 text-gray-300 dark:text-gray-600 hover:text-gray-600 dark:hover:text-gray-300 rounded transition-colors"
                  title="복사"
                >
                  {copiedDst ? <CheckCircle className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 px-4 pb-3 min-h-[220px] relative">
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-800/80">
                <div className="flex items-center gap-2 text-blue-500">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  <span className="text-sm">번역 중...</span>
                </div>
              </div>
            )}
            {error ? (
              <p className="text-red-500 text-sm mt-2">{error}</p>
            ) : result ? (
              <p className="text-base text-gray-900 dark:text-gray-100 leading-relaxed whitespace-pre-wrap">{result}</p>
            ) : (
              <p className="text-gray-300 dark:text-gray-600 text-base mt-2">번역 결과가 여기에 표시됩니다</p>
            )}
          </div>

          {result && (
            <div className="px-4 py-2 border-t border-gray-50 dark:border-gray-700">
              <span className="text-xs text-gray-300 dark:text-gray-600 tabular-nums">{result.length.toLocaleString()}자</span>
            </div>
          )}
        </div>
      </div>

      {/* 빠른 예시 */}
      {!srcText && (
        <div className="mb-4">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2 font-medium">자주 쓰는 표현</p>
          <div className="flex flex-wrap gap-2">
            {[
              { text: '在庫確認をお願いします', label: '재고 확인 요청' },
              { text: '納期はいつですか？', label: '납기 문의' },
              { text: '見積書を送ってください', label: '견적서 요청' },
              { text: '送料はいくらですか？', label: '배송비 문의' },
              { text: '品切れの場合、入荷予定はありますか？', label: '입고 예정 문의' },
              { text: '발주서를 보내드리겠습니다', label: '발주서 발송' },
            ].map(({ text, label }) => (
              <button
                key={text}
                onClick={() => { setSrcText(text); setFrom('ja'); setTo('ko') }}
                className="px-3 py-1.5 bg-white dark:bg-gray-800 border border-gray-100 dark:border-gray-700 rounded-full text-xs text-gray-500 dark:text-gray-400 hover:border-blue-200 dark:hover:border-blue-600 hover:text-blue-600 dark:hover:text-blue-400 transition-colors shadow-sm"
                title={text}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 번역 히스토리 */}
      {showHistory && (
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-200 flex items-center gap-2">
              <History className="w-4 h-4 text-gray-400 dark:text-gray-500" />
              최근 번역 내역
            </h3>
            {history.length > 0 && (
              <button onClick={clearHistory} className="flex items-center gap-1 text-xs text-gray-400 hover:text-red-500 transition-colors">
                <Trash2 className="w-4 h-4" /> 전체 삭제
              </button>
            )}
          </div>
          {history.length === 0 ? (
            <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-6">번역 내역이 없습니다</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {history.map((item, i) => {
                const fl = LANGS.find(l => l.code === item.from)!
                const tl = LANGS.find(l => l.code === item.to)!
                return (
                  <button
                    key={i}
                    onClick={() => { setFrom(item.from); setTo(item.to); setSrcText(item.src); setResult(item.result); setShowHistory(false) }}
                    className="w-full text-left p-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors group"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-gray-400 dark:text-gray-500">{fl.flag}{fl.label} → {tl.flag}{tl.label}</span>
                      <span className="text-xs text-gray-300 dark:text-gray-600 ml-auto">
                        {new Date(item.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <p className="text-sm text-gray-700 dark:text-gray-200 truncate">{item.src}</p>
                    <p className="text-sm text-indigo-600 dark:text-indigo-400 truncate">{item.result}</p>
                  </button>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* API 키 안내 */}
      <div className="mt-4 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-100 dark:border-gray-700">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          💡 현재 <strong>MyMemory</strong> (무료) 사용 중 · 더 정확한 번역을 원하시면 설정에서 <strong>DeepL</strong> 또는 <strong>Papago</strong> API 키를 등록하세요
        </p>
      </div>
    </div>
  )
}
