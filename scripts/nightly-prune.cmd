@echo off
rem Re-tests the off-air stations and, if any still don't play, removes them and redeploys the live site.
rem Scheduled with Windows Task Scheduler (task "Apna Radio nightly check"). Output goes to logs\prune.log.
cd /d C:\Users\anujb\ApnaRadio
if not exist logs mkdir logs
"C:\Program Files\nodejs\node.exe" scripts\prune-offair.js >> logs\prune.log 2>&1
if errorlevel 3 goto done
if errorlevel 1 goto failed
echo Deploying... >> logs\prune.log
call "C:\Program Files\nodejs\npx.cmd" --yes vercel@latest deploy --prod --yes >> logs\prune.log 2>&1
echo Deploy finished with code %errorlevel% >> logs\prune.log
goto done
:failed
echo Re-check failed; nothing changed. >> logs\prune.log
:done
