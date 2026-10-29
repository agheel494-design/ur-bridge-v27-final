@echo off
setlocal

rem UR IDE launcher - fixes a real, externally-reported bug: this must
rem NEVER close silently on failure. Every failure path below prints a
rem clear message AND pauses, so a user who double-clicked this from
rem Explorer can actually read what went wrong before the window
rem disappears.

set "SCRIPT_DIR=%~dp0"
set "SERVER_JS=%SCRIPT_DIR%..\dist\src\ide\server.js"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo ============================================================
  echo  ERROR: Node.js was not found on this system.
  echo.
  echo  UR-Bridge requires Node.js 18 or later to run the IDE.
  echo  Download it from: https://nodejs.org/
  echo  After installing Node.js, run this file again.
  echo ============================================================
  echo.
  pause
  exit /b 1
)

if not exist "%SERVER_JS%" (
  echo.
  echo ============================================================
  echo  ERROR: UR IDE files were not found at:
  echo    %SERVER_JS%
  echo.
  echo  This usually means the installation is incomplete or
  echo  corrupted. Try reinstalling UR-Bridge.
  echo ============================================================
  echo.
  pause
  exit /b 1
)

echo Starting UR IDE...
echo Once it says "UR IDE running at http://localhost:4173", open that
echo address in your web browser.
echo.
echo (Keep this window open while using the IDE. Press Ctrl+C to stop.)
echo.

node "%SERVER_JS%"
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo ============================================================
  echo  The UR IDE stopped unexpectedly (exit code %EXIT_CODE%).
  echo  See any error message above for details.
  echo ============================================================
  echo.
  pause
)

endlocal
