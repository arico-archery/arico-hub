'use client'

import { Suspense } from 'react'
import { signIn } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { AricoMark } from '@/components/Logo'

function LoginInner() {
  const params = useSearchParams()
  const error = params.get('error')

  const msg = error
    ? error === 'AccessDenied'
      ? '@arico.group 계정만 접속할 수 있습니다. (또는 비활성화된 계정)\n@arico.group アカウントのみアクセスできます。'
      : '로그인 중 오류가 발생했습니다. 다시 시도해 주세요. / ログインエラー'
    : ''

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-slate-900 p-4">
      <div className="w-full max-w-sm bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
        <div className="flex flex-col items-center mb-6">
          <AricoMark size={48} />
          <h1 className="mt-3 text-xl font-bold text-gray-900 dark:text-white">ARICO Distribution Hub</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">관리자 로그인 / 管理者ログイン</p>
        </div>

        {msg && (
          <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2 mb-4 whitespace-pre-line text-center">
            {msg}
          </p>
        )}

        <button
          onClick={() => signIn('microsoft-entra-id', { callbackUrl: '/' })}
          className="w-full flex items-center justify-center gap-2.5 bg-[#2f2f2f] hover:bg-black text-white py-3 rounded-lg text-sm font-medium transition-colors"
        >
          {/* Microsoft 로고 */}
          <svg className="w-4 h-4" viewBox="0 0 21 21" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#f25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
            <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
            <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
          </svg>
          Microsoft 계정으로 로그인
        </button>

        <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-4 text-center leading-relaxed">
          MS365의 <span className="font-semibold">@arico.group</span> 계정만 허용됩니다.<br />
          @arico.group の MS365 アカウントのみ
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
