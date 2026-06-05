'use client'

/**
 * DateInput — 브라우저 로케일에 관계없이 年/月/日 또는 년/월/일로 표시
 *
 * Props:
 *   value      - 제어 컴포넌트 "YYYY-MM-DD" 또는 ""
 *   onChange   - (v: string) => void  ("YYYY-MM-DD" 또는 "" 전달)
 *   size       - 'sm' | 'md' (기본 md)
 *   className  - 래퍼에 추가할 클래스
 *   disabled   - 비활성화
 */

import { useState, useEffect, useRef } from 'react'
import { useT } from '@/lib/i18n'

type Props = {
  value: string
  onChange: (v: string) => void
  size?: 'sm' | 'md'
  className?: string
  disabled?: boolean
}

function parseDate(s: string): { y: string; m: string; d: string } {
  const v = s.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    const [yr, mo, dy] = v.split('-')
    return { y: yr, m: String(Number(mo)), d: String(Number(dy)) }
  }
  return { y: '', m: '', d: '' }
}

export default function DateInput({ value, onChange, size = 'md', className = '', disabled }: Props) {
  const t = useT()
  const [y, setY] = useState('')
  const [m, setM] = useState('')
  const [d, setD] = useState('')
  const mRef = useRef<HTMLInputElement>(null)
  const dRef = useRef<HTMLInputElement>(null)
  const prevValue = useRef('')

  // value 변경 시 내부 상태 동기화 (외부에서 value 변경 시)
  useEffect(() => {
    if (value !== prevValue.current) {
      prevValue.current = value
      const p = parseDate(value)
      setY(p.y); setM(p.m); setD(p.d)
    }
  }, [value])

  const emit = (ny: string, nm: string, nd: string) => {
    if (ny.length === 4 && nm && nd) {
      const result = `${ny}-${nm.padStart(2, '0')}-${nd.padStart(2, '0')}`
      prevValue.current = result
      onChange(result)
    } else if (!ny && !nm && !nd) {
      prevValue.current = ''
      onChange('')
    }
  }

  const sm = size === 'sm'

  // 인풋 스타일
  const base = [
    'text-center border rounded focus:outline-none focus:ring-1 focus:ring-blue-500',
    'text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700',
    'border-gray-200 dark:border-gray-600',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    sm ? 'px-0.5 py-0.5 text-xs rounded' : 'px-1 py-1.5 text-sm rounded-lg',
  ].join(' ')

  const lbl = sm
    ? 'text-[10px] text-gray-400 dark:text-gray-500 select-none'
    : 'text-sm text-gray-400 dark:text-gray-500 select-none'

  return (
    <div className={`flex items-center gap-0.5 ${className}`}>
      {/* 年 */}
      <input
        type="number"
        inputMode="numeric"
        min={2020}
        max={2099}
        className={`${sm ? 'w-[3.2rem]' : 'w-[4rem]'} ${base}`}
        placeholder="2026"
        value={y}
        disabled={disabled}
        onChange={e => {
          const v = e.target.value
          setY(v)
          if (v.length === 4) mRef.current?.focus()
          emit(v, m, d)
        }}
      />
      <span className={lbl}>{t.common.yearLabel}</span>

      {/* 月 */}
      <input
        ref={mRef}
        type="number"
        inputMode="numeric"
        min={1}
        max={12}
        className={`${sm ? 'w-8' : 'w-10'} ${base}`}
        placeholder="1"
        value={m}
        disabled={disabled}
        onChange={e => {
          const v = e.target.value
          setM(v)
          if (Number(v) > 1 || v.length >= 2) dRef.current?.focus()
          emit(y, v, d)
        }}
      />
      <span className={lbl}>{t.common.monthLabel}</span>

      {/* 日 */}
      <input
        ref={dRef}
        type="number"
        inputMode="numeric"
        min={1}
        max={31}
        className={`${sm ? 'w-8' : 'w-10'} ${base}`}
        placeholder="1"
        value={d}
        disabled={disabled}
        onChange={e => {
          const v = e.target.value
          setD(v)
          emit(y, m, v)
        }}
      />
      <span className={lbl}>{t.common.dayLabel}</span>
    </div>
  )
}
