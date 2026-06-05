'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { AricoMark } from '@/components/Logo'

export default function SignupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email.trim().toLowerCase().endsWith('@arico.group')) {
      setError('@arico.group 이메일만 가입할 수 있습니다.')
      return
    }
    if (password.length < 8) { setError('비밀번호는 8자 이상이어야 합니다.'); return }
    if (password !== password2) { setError('비밀번호가 일치하지 않습니다.'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      })
      if (res.ok) {
        router.replace('/')
        router.refresh()
      } else {
        const d = await res.json().catch(() => ({}))
        setError(
          d.error === 'domain' ? '@arico.group 이메일만 가입할 수 있습니다.'
            : d.error === 'exists' ? '이미 가입된 이메일입니다. 로그인해 주세요.'
            : d.error === 'weak_password' ? '비밀번호는 8자 이상이어야 합니다.'
            : '회원가입 중 오류가 발생했습니다.',
        )
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
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">회원가입</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">ARICO Distribution Hub</p>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <input
            type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="이름"
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="email" required value={email} onChange={e => setEmail(e.target.value)}
            placeholder="이메일 (@arico.group)"
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password" required value={password} onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호 (8자 이상)"
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="password" required value={password2} onChange={e => setPassword2(e.target.value)}
            placeholder="비밀번호 확인"
            className="w-full border border-gray-200 dark:border-gray-600 rounded-lg px-3 py-2.5 text-sm text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <button
            type="submit" disabled={loading}
            className="w-full bg-blue-600 text-white py-2.5 rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            {loading ? '가입 중…' : '회원가입'}
          </button>
        </form>

        <p className="text-xs text-gray-500 dark:text-gray-400 mt-4 text-center">
          이미 계정이 있으신가요?{' '}
          <Link href="/login" className="text-blue-600 hover:underline font-medium">로그인</Link>
        </p>
        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-2 text-center">
          ARICO의 <span className="font-semibold">@arico.group</span> 이메일만 가입할 수 있습니다.
        </p>
      </div>
    </div>
  )
}
