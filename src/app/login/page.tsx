'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { AricoMark } from '@/components/Logo'

function LoginInner() {
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
        setError('이메일 또는 비밀번호가 올바르지 않습니다.')
      } else if (res.status === 403) {
        const d = await res.json().catch(() => ({}))
        setError(d.error === 'unverified'
          ? '이메일 인증이 완료되지 않았습니다. 가입 시 받은 인증 메일의 링크를 클릭해 주세요.'
          : '비활성화된 계정입니다. 관리자에게 문의하세요.')
      } else {
        setError('로그인 중 오류가 발생했습니다.')
      }
    } catch {
      setError('연결 오류')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <div className="flex flex-col items-center mb-6">
          <AricoMark size={48} />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">ARICO Distribution Hub</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">로그인</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="email" autoFocus required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="이메일 (@arico.group)"
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password" required value={password} onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호"
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit" disabled={loading || !email || !password}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
          계정이 없으신가요?{' '}
          <Link href="/signup" className="text-blue-600 hover:underline font-medium">회원가입</Link>
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 text-center">
          <span className="font-semibold">@arico.group</span> 이메일만 가입할 수 있습니다.
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
