import Sidebar from '@/components/Sidebar'
import { I18nProvider } from '@/lib/i18n'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <I18nProvider>
      <div className="flex h-full">
        <Sidebar />
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </I18nProvider>
  )
}
