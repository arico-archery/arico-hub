// 한 번에 업데이트: git pull → add → commit → push (→ Vercel 자동 배포)
// 사용:  npm run push            (자동 메시지)
//        npm run push "메시지"    (직접 메시지)
//        또는 루트의 "업데이트.bat" 더블클릭
import { execSync } from 'child_process'

const run = (c) => execSync(c, { stdio: 'inherit' })
const get = (c) => { try { return execSync(c, { encoding: 'utf8' }).trim() } catch { return '' } }

console.log('\n=== ARICO Hub 업데이트 ===\n')

// git 사용자 미설정 시 기본값
if (!get('git config user.email')) {
  run('git config user.name "ARICO"')
  run('git config user.email "sbs@arico.group"')
}

try {
  console.log('① 최신 변경 받아오는 중 (pull)...')
  run('git pull --no-edit')

  run('git add -A')
  const changed = get('git status --porcelain')
  if (!changed) {
    console.log('\n변경사항이 없습니다. (올릴 내용 없음)')
    process.exit(0)
  }

  const msg = process.argv.slice(2).join(' ') ||
    ('update ' + new Date().toLocaleString('sv').slice(0, 16)) // YYYY-MM-DD HH:MM

  console.log('\n② 기록(commit) + 올리기(push)...')
  run(`git commit -m "${msg.replace(/"/g, "'")}"`)
  run('git push')

  console.log('\n✅ 완료! 몇 분 뒤 https://arico-hub.vercel.app 에 자동 반영됩니다.')
  console.log('   배포 상태: https://vercel.com/arico/arico-hub/deployments\n')
} catch {
  console.error('\n⚠️ 문제가 발생했습니다. 충돌(conflict)이 있으면 해결 후 다시 시도하거나, 화면을 캡처해 문의해 주세요.\n')
  process.exit(1)
}
