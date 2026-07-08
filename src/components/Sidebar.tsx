'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Package, ShoppingCart, CreditCard,
  Users, BarChart3, Settings, RefreshCw, Globe, Truck, ClipboardList, BookOpen, LogOut, PackageCheck, Download,
  Sun, Moon
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import Logo, { AricoMark } from '@/components/Logo'
import { APP_VERSION, APP_BUILD_DATE } from '@/lib/version'
import { UserCircle, ShieldCheck } from 'lucide-react'

export default function Sidebar() {
  const pathname = usePathname()
  const { lang, toggle, t } = useI18n()
  const [role, setRole] = useState<string>('')
  const isSuper = role === 'super_admin'
  const [dark, setDark] = useState(false)

  useEffect(() => {
    fetch('/api/me').then(r => r.ok ? r.json() : null).then(d => { if (d?.role) setRole(d.role) }).catch(() => {})
    setDark(document.documentElement.classList.contains('dark'))
  }, [])

  const toggleTheme = () => {
    const next = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', next)
    try { localStorage.setItem('theme', next ? 'dark' : 'light') } catch { /* 무시 */ }
    setDark(next)
  }

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    window.location.href = '/login'
  }

  // 업무 흐름 + 빈도 기준 그룹 (운영 → 데이터 → 인사이트 → 설정 → 계정)
  const navGroups = [
    {
      label: t.nav.groupOps,
      items: [
        { href: '/',                 label: t.nav.dashboard,       icon: LayoutDashboard },
        { href: '/orders',           label: t.nav.orders,          icon: ShoppingCart },
        { href: '/payments',         label: t.nav.payments,        icon: CreditCard },
        { href: '/backorders',       label: t.nav.backorders,      icon: ClipboardList },
        { href: '/purchase-orders',  label: t.nav.purchaseOrders,  icon: Truck },
        { href: '/receiving',        label: t.nav.receiving,       icon: PackageCheck },
        { href: '/makeshop',         label: t.nav.makeshop,        icon: Download },
      ],
    },
    {
      label: t.nav.groupData,
      items: [
        { href: '/customers',        label: t.nav.customers,       icon: Users },
        { href: '/catalog',          label: t.nav.catalog,         icon: Globe },
        { href: '/products',         label: t.nav.products,        icon: Package },
        { href: '/analytics',        label: t.nav.analytics,       icon: BarChart3 },
      ],
    },
    {
      label: t.nav.groupConfig,
      items: [
        { href: '/exchange-rates',   label: t.nav.exchangeRates,   icon: RefreshCw },
        { href: '/settings',         label: t.nav.settings,        icon: Settings },
        ...(isSuper ? [{ href: '/admin/users', label: t.nav.userMgmt, icon: ShieldCheck }] : []),
      ],
    },
    {
      label: t.nav.groupAccount,
      items: [
        { href: '/manual',           label: t.nav.manual,          icon: BookOpen },
        { href: '/mypage',           label: t.nav.mypage,          icon: UserCircle },
      ],
    },
  ]

  return (
    <aside className="w-16 md:w-60 min-h-screen bg-white dark:bg-slate-900 border-r border-gray-200 dark:border-slate-800 flex flex-col flex-shrink-0">
      <div className="px-3 md:px-6 py-5 border-b border-gray-200 dark:border-slate-700">
        <div className="flex items-center gap-2 justify-center md:justify-start">
          {/* 모바일: 아이콘만 / 데스크톱: 풀 로고 */}
          <div className="md:hidden">
            <AricoMark size={32} />
          </div>
          <div className="hidden md:flex items-center justify-between w-full gap-2 min-w-0">
            <Logo size={22} className="min-w-0" />
            <span className="text-gray-400 dark:text-slate-500 text-[10px] font-medium flex-shrink-0">Hub</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4 px-2 md:px-3 overflow-y-auto">
        {navGroups.map((group, gi) => (
          <div key={group.label} className={gi > 0 ? 'mt-5' : ''}>
            {/* 데스크톱: 그룹 소제목 / 모바일: 구분선 */}
            <p className="hidden md:block px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400">{group.label}</p>
            {gi > 0 && <div className="md:hidden border-t border-gray-200 dark:border-slate-800 mx-2 mb-2" />}
            {group.items.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || (href !== '/' && pathname.startsWith(href))
              return (
                <Link
                  key={href}
                  href={href}
                  title={label}
                  className={cn(
                    'relative flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 text-sm transition-colors justify-center md:justify-start',
                    active
                      ? 'bg-blue-600/10 text-blue-700 dark:text-blue-300 font-semibold md:before:absolute md:before:left-0 md:before:top-1.5 md:before:bottom-1.5 md:before:w-1 md:before:rounded-full md:before:bg-blue-600'
                      : 'text-gray-600 dark:text-slate-400 font-medium hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800'
                  )}
                >
                  <Icon className={cn('w-4 h-4 flex-shrink-0', active ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400 dark:text-slate-500')} />
                  <span className="hidden md:inline">{label}</span>
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* 테마 전환 버튼 */}
      <div className="px-2 md:px-3 pb-2">
        <button
          onClick={toggleTheme}
          title={lang === 'ko' ? (dark ? '라이트 모드로' : '다크 모드로') : (dark ? 'ライトモードへ' : 'ダークモードへ')}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-500 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors justify-center md:justify-start"
        >
          {dark ? <Sun className="w-4 h-4 flex-shrink-0" /> : <Moon className="w-4 h-4 flex-shrink-0" />}
          <span className="hidden md:inline">
            {lang === 'ko' ? (dark ? '라이트 모드' : '다크 모드') : (dark ? 'ライトモード' : 'ダークモード')}
          </span>
        </button>
      </div>

      {/* 언어 전환 버튼 */}
      <div className="px-2 md:px-3 pb-3">
        <button
          onClick={toggle}
          title={lang === 'ko' ? '日本語に切り替え (Alt+L)' : '한국어로 전환 (Alt+L)'}
          className="w-full flex items-center justify-center md:justify-between px-2 md:px-4 py-2.5 rounded-lg bg-gray-100 dark:bg-slate-800 hover:bg-gray-200 dark:hover:bg-slate-700 transition-colors group"
        >
          <div className="flex items-center gap-2.5">
            <span className="text-lg">{lang === 'ko' ? '🇰🇷' : '🇯🇵'}</span>
            <div className="hidden md:block text-left">
              <p className="text-gray-900 dark:text-white text-xs font-semibold">
                {lang === 'ko' ? '한국어' : '日本語'}
              </p>
              <p className="text-gray-500 dark:text-slate-400 text-xs">
                {lang === 'ko' ? '→ 日本語' : '→ 한국어'}
              </p>
            </div>
          </div>
          <div className="hidden md:flex flex-col items-center gap-0.5 opacity-50 group-hover:opacity-80 transition-opacity">
            <span className="text-gray-400 dark:text-slate-300 text-xs font-mono leading-none">Alt</span>
            <span className="text-gray-400 dark:text-slate-300 text-xs font-mono leading-none">+L</span>
          </div>
        </button>
      </div>

      <div className="px-2 md:px-3 pb-2">
        <button
          onClick={handleLogout}
          title={t.nav.logout}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-gray-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors justify-center md:justify-start"
        >
          <LogOut className="w-4 h-4 flex-shrink-0" />
          <span className="hidden md:inline">{t.nav.logout}</span>
        </button>
      </div>

      <div className="px-4 py-3 border-t border-gray-200 dark:border-slate-700 hidden md:block">
        <p className="text-gray-400 dark:text-slate-400 text-xs text-center" title={`build ${APP_BUILD_DATE}`}>v{APP_VERSION}</p>
      </div>
    </aside>
  )
}
