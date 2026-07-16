'use client'

import { useI18n } from '@/lib/i18n'

// 로그인·회원가입 화면용 한/일 전환. 사이드바가 없는 화면이라 카드 안에 둔다.
export default function AuthLangToggle() {
  const { lang, setLang } = useI18n()

  return (
    <div className="flex justify-end mb-2">
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-600 overflow-hidden">
        {(['ko', 'ja'] as const).map(l => (
          <button
            key={l}
            type="button"
            onClick={() => setLang(l)}
            title={l === 'ko' ? '한국어로 전환 (Alt+L)' : '日本語に切り替え (Alt+L)'}
            className={`px-2.5 py-1 text-xs font-medium transition-colors ${
              l === lang
                ? 'bg-slate-900 text-white'
                : 'bg-white dark:bg-gray-700 text-gray-500 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600'
            }`}
          >
            {l === 'ko' ? '한국어' : '日本語'}
          </button>
        ))}
      </div>
    </div>
  )
}
