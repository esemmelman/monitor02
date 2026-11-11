# Monitor01

Requires Node.js 22+. Double-click **Start Monitor.cmd**, open http://127.0.0.1:8787, enter your recipient and SMTP settings, save, send a test email, then enable monitoring. Gmail requires a Google app password. Keep the service running and computer awake; closing the browser is fine. For unattended use, run `node server.mjs` at login through Windows Task Scheduler with this folder as working directory.

Defaults: Huntington Beach 92647, Fahrenheit, Los Angeles timezone, Lakers game November 11, 2026. Personal settings, SMTP password, readings and outbox remain in ignored private/ files. The password is stored as plaintext locally. Restrict folder access; this folder is inside Dropbox, so consider excluding private/ from syncing.

Weather uses Open-Meteo current model estimates, checked every minute. A change of at least 1 degree from the last alert baseline queues one message with all readings recorded today. Jumps produce one alert. Midnight resets history and baseline. Short changes between checks cannot be detected; history begins when monitoring starts.

ESPN scoreboard and summary feeds are polled every 15 seconds. Quarter and overtime emails include cumulative scores and game-to-date points, rebounds and assists leaders for both teams, including ties. Missed quarters produce catch-up messages with current leaders explicitly labeled; historical quarter-end leaders cannot be reconstructed. ESPN's public feed is undocumented and may change. Feed latency can delay alerts.

Outbox and delivery records persist across restarts. SMTP failures retry. Provider acceptance is recorded as sent, not guaranteed inbox delivery. A crash between SMTP acceptance and saving can duplicate a message. The service binds to loopback only and requires a session token for changes; do not expose it publicly.

GitHub Pages is only an HTML preview and cannot run the local monitoring/email service. Always-on monitoring requires an awake computer or additional server hosting. Alerts remain paused until configured.
