@echo off
REM ========================================
REM  SagarSoft SMS Agent - APK Builder
REM ========================================
echo.
echo ========================================
echo  SagarSoft SMS Agent - APK Builder
echo ========================================
echo.

where java >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Java not found!
    echo Download JDK 17 from: https://adoptium.net/temurin/releases/?version=17
    echo Install it, then run this script again.
    pause
    exit /b 1
)

java -version 2>&1 | findstr /i "version" | findstr /i "17\|18\|19\|20\|21\|22" >nul
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: JDK 17-20 recommended. Current Java may not work.
    echo.
)

echo Building APK. This will download dependencies ~(1-2 min on fast internet)...
echo.

call gradlew.bat assembleDebug --no-daemon

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo  BUILD SUCCESSFUL!
    echo ========================================
    echo APK: app\build\outputs\apk\debug\
    echo.
) else (
    echo.
    echo ========================================
    echo  BUILD FAILED
    echo ========================================
    echo.
    echo Fixes:
    echo 1. Make sure JDK 17 is installed
    echo 2. Set JAVA_HOME to JDK 17 path
    echo 3. Remove .gradle/caches directory and retry
    echo.
)

pause
