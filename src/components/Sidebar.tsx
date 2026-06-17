'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard, Package, ShoppingCart, CreditCard,
  Users, BarChart3, Settings, RefreshCw, ChevronRight, Globe, Truck, ClipboardList, BookOpen, LogOut,
  Sun, Moon
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { useI18n } from '@/lib/i18n'
import Logo, { AricoMark } from '@/components/Logo'
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

  const navItems = [
    { href: '/',                 label: t.nav.dashboard,       icon: LayoutDashboard },
    { href: '/products',         label: t.nav.products,        icon: Package },
    { href: '/catalog',          label: t.nav.catalog,         icon: Globe },
    { href: '/orders',           label: t.nav.orders,          icon: ShoppingCart },
    { href: '/backorders',       label: t.nav.backorders,      icon: ClipboardList },
    { href: '/purchase-orders',  label: t.nav.purchaseOrders,  icon: Truck },
    { href: '/payments',         label: t.nav.payments,        icon: CreditCard },
    { href: '/customers',        label: t.nav.customers,       icon: Users },
    { href: '/analytics',        label: t.nav.analytics,       icon: BarChart3 },
    { href: '/exchange-rates',   label: t.nav.exchangeRates,   icon: RefreshCw },
    { href: '/settings',         label: t.nav.settings,        icon: Settings },
    { href: '/manual',           label: t.nav.manual,          icon: BookOpen },
    { href: '/mypage',           label: t.nav.mypage,          icon: UserCircle },
    ...(isSuper ? [{ href: '/admin/users', label: t.nav.userMgmt, icon: ShieldCheck }] : []),
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

      <nav className="flex-1 py-4 px-2 md:px-3">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg mb-1 text-sm transition-colors justify-center md:justify-start',
                active
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-600 dark:text-slate-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden md:inline">{label}</span>
              {active && <ChevronRight className="w-3 h-3 ml-auto hidden md:block" />}
            </Link>
          )
        })}
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
        <p className="text-gray-400 dark:text-slate-400 text-xs text-center">v1.0.0</p>
      </div>
    </aside>
  )
}
