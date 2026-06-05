'use client'

import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react'
import T, { type Lang } from './translations'

type I18nCtx = {
  lang: Lang
  setLang: (l: Lang) => void
  toggle: () => void
  t: typeof T['ko']
}

const I18nContext = createContext<I18nCtx>({
  lang: 'ko',
  setLang: () => {},
  toggle: () => {},
  t: T.ko,
})

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>('ko')

  useEffect(() => {
    const saved = localStorage.getItem('arico_lang') as Lang
    if (saved === 'ko' || saved === 'ja') setLangState(saved)
  }, [])

  const setLang = useCallback((l: Lang) => {
    setLangState(l)
    localStorage.setItem('arico_lang', l)
  }, [])

  const toggle = useCallback(() => {
    setLang(lang === 'ko' ? 'ja' : 'ko')
  }, [lang, setLang])

  // 키보드 단축키: Alt + L
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        toggle()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [toggle])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const t = (lang === 'ja' ? T.ja : T.ko) as any as typeof T['ko']

  return (
    <I18nContext.Provider value={{ lang, setLang, toggle, t }}>
      {children}
    </I18nContext.Provider>
  )
}

export const useI18n = () => useContext(I18nContext)
export const useLang = () => useContext(I18nContext).lang
export const useT = () => useContext(I18nContext).t
