'use client'

import { useEffect, useState } from 'react'
import { useI18n } from '@/lib/i18n'
import { ShieldCheck, ShieldAlert } from 'lucide-react'

type U = {
  id: number; email: string; name: string; role: string; status: string
  lastLogin: string | null; createdAt: string
}
const SUPER = ['sms@arico.group', 'sbs@arico.group']

export default function UsersAdminPage() {
  const { lang } = useI18n()
  const isKo = lang === 'ko'
  const [role, setRole] = useState<string | null>(null) // null=로딩
  const [users, setUsers] = useState<U[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<number | null>(null)

  const isSuper = role === 'super_admin'

  const load = () => {
    setLoading(true)
    fetch('/api/admin/users').then(r => r.json()).then(d => { setUsers(d.users ?? []); setLoading(false) }).catch(() => setLoading(false))
  }
  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => setRole(d?.role ?? '')).catch(() => setRole(''))
  }, [])
  useEffect(() => { if (isSuper) load() }, [isSuper])

  const patch = async (id: number, body: { role?: string; status?: string }) => {
    setSavingId(id)
    const res = await fetch('/api/admin/users', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
    setSavingId(null)
    if (res.ok) load()
    else { const d = await res.json().catch(() => ({})); if (d.error === 'protected_super_admin') alert(isKo ? '고정 슈퍼 관리자(sms/sbs)는 변경할 수 없습니다.' : '固定スーパー管理者は変更できません。') }
  }

  if (role === null) return <div className="p-6 text-gray-400">…</div>
  if (!isSuper) {
    return (
      <div className="p-6 max-w-lg mx-auto text-center py-20">
        <ShieldAlert className="w-10 h-10 mx-auto text-red-400 mb-3" />
        <p className="text-gray-600 dark:text-gray-300">{isKo ? '슈퍼 관리자만 접근할 수 있습니다.' : 'スーパー管理者のみアクセスできます。'}</p>
      </div>
    )
  }

  const roleLabel = (r: string) => r === 'super_admin' ? (isKo ? '슈퍼 관리자' : 'スーパー管理者') : (isKo ? '관리자' : '管理者')
  const fmt = (s: string | null) => s ? new Date(s).toLocaleDateString(isKo ? 'ko-KR' : 'ja-JP') : '—'

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-1 flex items-center gap-2">
        <ShieldCheck className="w-6 h-6 text-purple-500" />
        {isKo ? '사용자 관리' : 'ユーザー管理'}
      </h1>
      <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
        {isKo ? `@arico.group 관리자 ${users.length}명 · 역할·접속 권한 관리` : `@arico.group 管理者 ${users.length}名`}
      </p>

      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm overflow-x-auto">
        <table className="w-full text-sm min-w-[680px]">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-700">
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300">{isKo ? '사용자' : 'ユーザー'}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-40">{isKo ? '권한' : '権限'}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-32">{isKo ? '상태' : 'ステータス'}</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 dark:text-gray-300 w-28">{isKo ? '최근 로그인' : '最終ログイン'}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700">
            {loading ? (
              <tr><td colSpan={4} className="text-center py-12 text-gray-400">…</td></tr>
            ) : users.map(u => {
              const fixed = SUPER.includes(u.email.toLowerCase())
              return (
                <tr key={u.id} className={savingId === u.id ? 'opacity-50' : ''}>
                  <td className="px-4 py-3">
                    <p className="font-medium text-gray-900 dark:text-gray-100">{u.name || '—'}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    {fixed ? (
                      <span className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
                        <ShieldCheck className="w-3 h-3" />{roleLabel(u.role)}
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        onChange={e => patch(u.id, { role: e.target.value })}
                        className="border border-gray-200 dark:border-gray-600 rounded px-2 py-1 text-xs text-gray-900 dark:text-gray-100 bg-white dark:bg-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="admin">{isKo ? '관리자' : '管理者'}</option>
                        <option value="super_admin">{isKo ? '슈퍼 관리자' : 'スーパー管理者'}</option>
                      </select>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {fixed ? (
                      <span className="text-xs text-green-600 dark:text-green-400 font-medium">{isKo ? '활성' : '有効'}</span>
                    ) : (
                      <button
                        onClick={() => patch(u.id, { status: u.status === 'active' ? 'disabled' : 'active' })}
                        className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${u.status === 'active' ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 hover:bg-green-200' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 hover:bg-gray-200'}`}
                      >
                        {u.status === 'active' ? (isKo ? '활성' : '有効') : (isKo ? '비활성' : '無効')}
                      </button>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 dark:text-gray-400">{fmt(u.lastLogin)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-400 dark:text-gray-500 mt-3">
        {isKo ? '※ 고정 슈퍼 관리자(sms·sbs)는 변경할 수 없습니다. @arico.group 계정은 첫 로그인 시 자동으로 관리자로 등록됩니다.' : '※ 固定スーパー管理者(sms·sbs)は変更不可。@arico.group は初回ログインで自動登録。'}
      </p>
    </div>
  )
}
