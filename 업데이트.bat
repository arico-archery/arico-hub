@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo ============================================
echo    ARICO Hub - 변경사항 올리기 (자동 배포)
echo ============================================
node scripts\auto-push.mjs %*
echo.
pause
