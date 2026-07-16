'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AricoMark } from '@/components/Logo'
import AuthLangToggle from '@/components/AuthLangToggle'
import { useT } from '@/lib/i18n'

// 'ARICO의 {domain} 이메일만…' → @arico.group 만 강조해서 렌더
function domainNote(text: string) {
  const [pre, post] = text.split('{domain}')
  return <>{pre}<span className="font-semibold">@arico.group</span>{post}</>
}

export default function SignupPage() {
  const t = useT()
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)         // 인증 메일 발송 완료 화면
  const [devLink, setDevLink] = useState('')      // 이메일 미설정(부트스트랩) 시 인증 링크

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim().toLowerCase().endsWith('@arico.group')) {
      setError(t.auth.errDomain)
      return
    }
    if (password.length < 8) { setError(t.auth.errWeakPassword); return }
    if (password !== password2) { setError(t.auth.errPasswordMismatch); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      const d = await res.json().catch(() => ({}))
      if (res.ok) {
        setDevLink(d.devLink || '')
        setSent(true)
      } else {
        setError(
          d.error === 'domain' ? t.auth.errDomain
            : d.error === 'exists' ? t.auth.errExists
            : d.error === 'weak_password' ? t.auth.errWeakPassword
            : t.auth.errSignup,
        )
      }
    } catch {
      setError(t.auth.errConn)
    } finally {
      setLoading(false)
    }
  }

  // '{email} 로 보낸 메일의…' → 이메일 주소만 강조해서 렌더
  const [sentPre, sentPost] = t.auth.sentDesc.split('{email}')

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <AuthLangToggle />
        <div className="flex flex-col items-center mb-6">
          <AricoMark size={48} />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">{t.auth.signup}</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">ARICO Distribution Hub</p>
        </div>

        {sent && (
          <div className="text-center space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-green-50 dark:bg-green-900/30 flex items-center justify-center text-2xl">✉️</div>
            <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.auth.sentTitle}</p>
            <p className="text-xs text-gray-500 dark:text-gray-400">{sentPre}<span className="font-medium">{email}</span>{sentPost}</p>
            {devLink && (
              <div className="text-left bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-lg p-3">
                <p className="text-[11px] text-amber-700 dark:text-amber-300 mb-1">{t.auth.devLinkNote}</p>
                <a href={devLink} className="text-xs text-blue-600 break-all hover:underline">{devLink}</a>
              </div>
            )}
            <Link href="/login" className="inline-block text-blue-600 hover:underline text-sm font-medium">{t.auth.goLogin}</Link>
          </div>
        )}

        {!sent && <form onSubmit={submit} className="space-y-3">
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder={t.auth.name}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder={t.auth.email}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password" required value={password} onChange={e => setPassword(e.target.value)}
            placeholder={t.auth.passwordNew}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password" required value={password2} onChange={e => setPassword2(e.target.value)}
            placeholder={t.auth.passwordConfirm}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? t.auth.signingUp : t.auth.signup}
          </button>
        </form>}

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
          {t.auth.hasAccount}{' '}
          <Link href="/login" className="text-blue-600 hover:underline font-medium">{t.auth.login}</Link>
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 text-center">
          {domainNote(t.auth.domainNoteSignup)}
        </p>
      </div>
    </div>
  )
}
