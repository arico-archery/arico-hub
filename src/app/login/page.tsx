'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AricoMark } from '@/components/Logo'
import AuthLangToggle from '@/components/AuthLangToggle'
import { useT } from '@/lib/i18n'

// '{domain} 이메일만…' → @arico.group 만 강조해서 렌더
function domainNote(text: string) {
  const [pre, post] = text.split('{domain}')
  return <>{pre}<span className="font-semibold">@arico.group</span>{post}</>
}

function LoginInner() {
  const t = useT()
  const router = useRouter()
  const params = useSearchParams()
  const from = params.get('from') || '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      if (res.ok) {
        router.replace(from.startsWith('/') ? from : '/')
        router.refresh()
      } else if (res.status === 401) {
        setError(t.auth.errInvalid)
      } else if (res.status === 403) {
        const d = await res.json().catch(() => ({}))
        setError(d.error === 'unverified' ? t.auth.errUnverified : t.auth.errDisabled)
      } else {
        setError(t.auth.errLogin)
      }
    } catch {
      setError(t.auth.errConn)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <AuthLangToggle />
        <div className="flex flex-col items-center mb-6">
          <AricoMark size={48} />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">ARICO Distribution Hub</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{t.auth.login}</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" autoFocus required value={email} onChange={e => setEmail(e.target.value)}
            placeholder={t.auth.email}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password" required value={password} onChange={e => setPassword(e.target.value)}
            placeholder={t.auth.password}
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit" disabled={loading || !email || !password}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? t.auth.loggingIn : t.auth.login}
          </button>
        </form>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
          {t.auth.noAccount}{' '}
          <Link href="/signup" className="text-blue-600 hover:underline font-medium">{t.auth.signup}</Link>
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 text-center">
          {domainNote(t.auth.domainNoteLogin)}
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
