import Sidebar from '@/components/Sidebar'
import { I18nProvider } from '@/lib/i18n'
import { SessionProvider } from 'next-auth/react'
import { auth } from '@/auth'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  return (
    <SessionProvider session={session}>
      <I18nProvider>
        <div className="flex h-full">
          <Sidebar />
          <main className="flex-1 overflow-auto">{children}</main>
        </div>
      </I18nProvider>
    </SessionProvider>
  )
}
