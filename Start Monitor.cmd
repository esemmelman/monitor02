@echo off
cd /d "%~dp0"
if not exist node_modules call npm install
start "" http://127.0.0.1:8787
node server.mjs
pause
