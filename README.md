# قائمة السكربتات - نسخة سلسة كاملة

## التشغيل
1. افتح المجلد في VS Code
2. انسخ `.env.example` وغير اسمه إلى `.env`
3. عبّي البيانات:
   - OWNER_DISCORD_ID
   - DISCORD_CLIENT_ID
   - DISCORD_CLIENT_SECRET
   - BOT_TOKEN
   - GUILD_ID
4. في Discord Developer Portal > OAuth2 > Redirects حط:
   http://localhost:3000/callback
5. شغل:
   npm install
   npm start
6. افتح:
   http://localhost:3000

## لوحة التحكم
بعد تسجيل الدخول بحساب صاحب المتجر افتح:
http://localhost:3000/admin

## مهم
لا ترسل BOT_TOKEN أو CLIENT_SECRET لأي أحد.
