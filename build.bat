@echo off
echo ========================================
echo Remote FM - APK Builder
echo ========================================
echo.

REM Set JAVA_HOME to Java 17
set "JAVA_HOME=C:\Program Files\Eclipse Adoptium\jdk-17.0.18.8-hotspot"
echo Using Java: %JAVA_HOME%
"%JAVA_HOME%\bin\java.exe" -version
echo.

cd android

REM Stop any running Gradle daemons
echo Stopping Gradle daemons...
call gradlew.bat --stop

echo.
echo Building APK...
call gradlew.bat -Dorg.gradle.java.home="%JAVA_HOME%" clean assembleDebug

if %errorlevel% equ 0 (
    echo.
    echo ========================================
    echo SUCCESS! APK created:
    echo app\build\outputs\apk\debug\app-debug.apk
    echo ========================================
    start app\build\outputs\apk\debug
) else (
    echo.
    echo ERROR: Build failed!
    echo.
)

pause
