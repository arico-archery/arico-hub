import Sidebar from '@/components/Sidebar'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  )
}
