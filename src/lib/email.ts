// 이메일 발송 + 인증 토큰 유틸.
// 발송은 Resend HTTP API 사용(패키지 불필요). 환경변수 미설정 시 발송 안 함(부트스트랩: 링크를 응답으로 전달).
//   RESEND_API_KEY : Resend API 키
//   MAIL_FROM      : 발신 주소 (예: "ARICO Hub <no-reply@arico.group>") — Resend에서 도메인 인증 필요
import crypto from 'node:crypto'

export function makeVerifyToken(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex')
  return { raw, hash: hashToken(raw) }
}
export function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export function mailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY && process.env.MAIL_FROM)
}

// 인증 메일 발송. 성공 시 true, 미설정/실패 시 false.
export async function sendVerificationEmail(to: string, url: string, name = ''): Promise<boolean> {
  if (!mailConfigured()) return false
  const hello = name ? `${name}님,` : '안녕하세요,'
  const html = `
  <div style="font-family:-apple-system,'Segoe UI',Roboto,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1f2937">
    <h2 style="color:#2f7d55;margin:0 0 8px">ARICO Distribution Hub</h2>
    <p style="font-size:15px">${hello}</p>
    <p style="font-size:15px">아래 버튼을 눌러 이메일 인증을 완료하시면 로그인할 수 있습니다.</p>
    <p style="margin:24px 0">
      <a href="${url}" style="background:#2f7d55;color:#fff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;font-size:15px">이메일 인증하기</a>
    </p>
    <p style="font-size:12px;color:#6b7280">버튼이 안 되면 이 주소를 브라우저에 붙여넣으세요:<br><span style="word-break:break-all">${url}</span></p>
    <p style="font-size:12px;color:#9ca3af;margin-top:24px">이 링크는 24시간 후 만료됩니다. 본인이 요청하지 않았다면 무시하세요.</p>
  </div>`
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: process.env.MAIL_FROM, to, subject: 'ARICO Hub 이메일 인증', html }),
      signal: AbortSignal.timeout(15000),
    })
    return res.ok
  } catch {
    return false
  }
}
