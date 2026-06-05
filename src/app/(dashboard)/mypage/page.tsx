'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { UserCircle, Mail, ShieldCheck, Clock, LogOut, CheckCircle2 } from 'lucide-react'

type Me = {
  email: string; name: string; role: string; status: string
  lastLogin: string | null; createdAt: string
}

export default function MyPage() {
  const { lang } = useI18n()
  const isKo = lang === 'ko'
  const [me, setMe] = useState<Me | null>(null)

  useEffect(() => {
    fetch('/api/me').then(r => r.json()).then(d => { if (!d.error) setMe(d) }).catch(() => {})
  }, [])

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  const roleLabel = (r: string) =>
    r === 'super_admin' ? (isKo ? '슈퍼 관리자' : 'スーパー管理者') : (isKo ? '관리자' : '管理者')
  const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(isKo ? 'ko-KR' : 'ja-JP') : '—')

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-6 flex items-center gap-2">
        <UserCircle className="w-6 h-6 text-blue-500" />
        {isKo ? '마이페이지' : 'マイページ'}
      </h1>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-hidden">
        {/* 헤더 */}
        <div className="bg-slate-900 px-6 py-5 flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-blue-500 flex items-center justify-center text-white text-xl font-bold shrink-0">
            {(me?.name || me?.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-white font-bold text-lg truncate">{me?.name || (isKo ? '(이름 없음)' : '(名前なし)')}</p>
            <p className="text-slate-400 text-sm truncate">{me?.email ?? '—'}</p>
          </div>
          {me && (
            <span className={`ml-auto shrink-0 px-2.5 py-1 rounded-lg text-xs font-semibold ${me.role === 'super_admin' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'}`}>
              {roleLabel(me.role)}
            </span>
          )}
        </div>

        {/* 상세 */}
        <div className="p-6 space-y-4">
          <Row icon={Mail} label={isKo ? '이메일' : 'メール'} value={me?.email ?? '—'} />
          <Row icon={ShieldCheck} label={isKo ? '권한' : '権限'} value={me ? roleLabel(me.role) : '—'} />
          <Row icon={CheckCircle2} label={isKo ? '상태' : 'ステータス'}
            value={me ? (me.status === 'active' ? (isKo ? '활성' : '有効') : (isKo ? '비활성' : '無効')) : '—'} />
          <Row icon={Clock} label={isKo ? '최근 로그인' : '最終ログイン'} value={fmt(me?.lastLogin ?? null)} />
          <Row icon={Clock} label={isKo ? '가입일' : '登録日'} value={fmt(me?.createdAt ?? null)} />
        </div>

        {/* 로그아웃 */}
        <div className="px-6 pb-6">
          <button
            onClick={logout}
            className="w-full flex items-center justify-center gap-2 bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 py-2.5 rounded-lg text-sm font-medium hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            {isKo ? '로그아웃' : 'ログアウト'}
          </button>
        </div>
      </div>

      <p className="text-xs text-gray-400 dark:text-gray-500 mt-4 text-center">
        {isKo ? 'MS365 @arico.group 계정으로 로그인됨' : 'MS365 @arico.group アカウントでログイン中'}
      </p>
    </div>
  )
}

function Row({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3">
      <Icon className="w-4 h-4 text-gray-400 shrink-0" />
      <span className="text-sm text-gray-500 dark:text-gray-400 w-28 shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{value}</span>
    </div>
  )
}
