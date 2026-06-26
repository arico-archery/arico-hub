import { getCachedDashboard } from '@/lib/dashboard'
import DashboardClient, { type DashboardData } from './DashboardClient'

// 서버 컴포넌트: 첫 진입 데이터를 서버에서 미리 가져와(60초 캐시) 클라이언트에 전달.
// 기존 "정적 셸 → JS → fetch" 워터폴 제거. 사용자 인터랙션(기간 변경 등)은 DashboardClient가 처리.
export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const data = await getCachedDashboard('month')
  // 클라이언트가 기대하는 JSON 직렬화 형태(날짜=문자열)로 맞춰 전달 → 기존 동작과 동일
  const initialData = JSON.parse(JSON.stringify(data)) as DashboardData
  return <DashboardClient initialData={initialData} />
}
