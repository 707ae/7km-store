require('dotenv').config();

const express = require('express');
const session = require('express-session');
const axios = require('axios');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

const DB_PATH = path.join(__dirname, 'data', 'db.json');
const UPLOAD_DIR = path.join(__dirname, 'uploads');

if (!fs.existsSync(path.dirname(DB_PATH))) fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function readDB(){
  if(!fs.existsSync(DB_PATH)){
    fs.writeFileSync(DB_PATH, JSON.stringify({settings:{},scripts:[],downloads:[]}, null, 2));
  }
  return JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
}

function writeDB(db){
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2));
}

function safeName(name){
  return String(name || 'file').replace(/[^\w\u0600-\u06FF.\- ]+/g, '').replace(/\s+/g, '_').slice(0, 120);
}

function isOwner(req){
  return req.session.user && req.session.user.id === process.env.OWNER_DISCORD_ID;
}

function requireLogin(req,res,next){
  if(!req.session.user) return res.redirect('/');
  next();
}

function requireOwner(req,res,next){
  if(!isOwner(req)) return res.status(403).render('error', {title:'ممنوع', message:'هذه الصفحة خاصة بصاحب المتجر فقط.'});
  next();
}

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use('/public', express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({extended:true}));

app.use(session({
  secret: process.env.SESSION_SECRET || 'change_me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 24 * 60 * 60 * 1000
  }
}));

app.use((req,res,next)=>{
  const db = readDB();
  res.locals.settings = db.settings || {};
  res.locals.user = req.session.user || null;
  res.locals.isOwner = isOwner(req);
  res.locals.appName = process.env.APP_NAME || db.settings.appName || 'قائمة السكربتات';
  next();
});

const storage = multer.diskStorage({
  destination: (req,file,cb)=> cb(null, UPLOAD_DIR),
  filename: (req,file,cb)=> cb(null, `${Date.now()}-${safeName(file.originalname)}`)
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 },
  fileFilter: (req,file,cb)=>{
    if(!file.originalname.toLowerCase().endsWith('.zip')) return cb(new Error('ZIP فقط'));
    cb(null, true);
  }
});

app.get('/', (req,res)=>{
  if(req.session.user) return res.redirect('/scripts');
  res.render('login');
});

app.get('/login', (req,res)=>{
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify'
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params.toString()}`);
});

const usedOAuthCodes = new Set();

app.get('/callback', async (req,res)=>{
  const code = req.query.code;

  if(!code) return res.redirect('/');

  if(usedOAuthCodes.has(code)){
    return res.redirect('/scripts');
  }

  usedOAuthCodes.add(code);

  try{
    const tokenRes = await axios.post('https://discord.com/api/oauth2/token', new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    }), {
      headers: {'Content-Type':'application/x-www-form-urlencoded'}
    });

    const userRes = await axios.get('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${tokenRes.data.access_token}` }
    });

    req.session.user = userRes.data;
    res.redirect('/scripts');

  }catch(err){
    console.error('OAuth Error:', err.response?.data || err.message);
    res.status(500).render('error', {
      title:'خطأ تسجيل الدخول',
      message:'انتظر دقيقة ثم جرّب تسجيل الدخول مرة واحدة فقط.'
    });
  }
});

app.get('/logout', (req,res)=>{
  req.session.destroy(()=>res.redirect('/'));
});

async function getMemberRoles(userId){
  const url = `https://discord.com/api/guilds/${process.env.GUILD_ID}/members/${userId}`;
  const r = await axios.get(url, {headers:{Authorization:`Bot ${process.env.BOT_TOKEN}`}});
  return r.data.roles || [];
}

app.get('/scripts', requireLogin, async (req,res)=>{
  const db = readDB();
  let roles = [];
  let discordOk = true;

  try{
    roles = await getMemberRoles(req.session.user.id);
  }catch(e){
    discordOk = false;
    console.error('Discord roles error:', e.response?.data || e.message);
  }

  const scripts = (db.scripts || []).filter(s => {
    if(isOwner(req)) return true;
    return s.roleId && roles.includes(s.roleId);
  }).map(s => ({
    ...s,
    downloaded: (db.downloads || []).some(d => d.userId === req.session.user.id && d.scriptId === s.id)
  }));

  res.render('scripts', {scripts, discordOk});
});

app.get('/download/:id', requireLogin, async (req,res)=>{
  const db = readDB();
  const script = (db.scripts || []).find(s=>s.id === req.params.id);

  if(!script) return res.status(404).render('error', {title:'غير موجود', message:'الملف غير موجود.'});

  if(!isOwner(req)){
    const already = (db.downloads || []).some(d => d.userId === req.session.user.id && d.scriptId === script.id);

    if(already) return res.status(403).render('error', {
      title:'تم التحميل مسبقًا',
      message:'هذا السكربت مسموح تحميله مرة واحدة فقط.'
    });

    let roles = [];

    try{
      roles = await getMemberRoles(req.session.user.id);
    }catch(e){
      return res.status(503).render('error', {
        title:'الخدمة غير متاحة',
        message:'تعذر التحقق من رتبتك في الديسكورد.'
      });
    }

    if(!roles.includes(script.roleId)) return res.status(403).render('error', {
      title:'لا تملك الرتبة',
      message:'هذا السكربت غير متاح لحسابك.'
    });
  }

  const filePath = path.join(UPLOAD_DIR, script.file);

  if(!fs.existsSync(filePath)) {
    return res.status(404).render('error', {
      title:'الملف مفقود',
      message:'ملف السكربت غير موجود داخل uploads.'
    });
  }

  if(!isOwner(req)){
    db.downloads.push({
      userId:req.session.user.id,
      scriptId:script.id,
      at:new Date().toISOString()
    });
    writeDB(db);
  }

  res.download(filePath, script.originalName || script.file);
});

app.get('/admin', requireLogin, requireOwner, (req,res)=>{
  const db = readDB();
  res.render('admin', {
    scripts: db.scripts || [],
    downloads: db.downloads || []
  });
});

app.post('/admin/settings', requireLogin, requireOwner, (req,res)=>{
  const db = readDB();

  db.settings = {
    ...db.settings,
    appName: req.body.appName || db.settings.appName,
    brandText: req.body.brandText || db.settings.brandText,
    heroTitle: req.body.heroTitle || db.settings.heroTitle,
    heroText: req.body.heroText || db.settings.heroText,
    primary: req.body.primary || db.settings.primary,
    secondary: req.body.secondary || db.settings.secondary
  };

  writeDB(db);
  res.redirect('/admin');
});

app.post('/admin/scripts', requireLogin, requireOwner, upload.single('file'), (req,res)=>{
  const db = readDB();

  if(!req.file) return res.status(400).render('error', {
    title:'ملف ناقص',
    message:'ارفع ملف ZIP.'
  });

  const item = {
    id: Date.now().toString(36),
    name: req.body.name || 'سكربت بدون اسم',
    version: req.body.version || '1.0.0',
    description: req.body.description || '',
    roleId: req.body.roleId || '',
    file: req.file.filename,
    originalName: req.file.originalname,
    createdAt: new Date().toISOString()
  };

  db.scripts.unshift(item);
  writeDB(db);
  res.redirect('/admin');
});

app.post('/admin/scripts/:id/delete', requireLogin, requireOwner, (req,res)=>{
  const db = readDB();
  const item = (db.scripts || []).find(s=>s.id===req.params.id);

  if(item){
    const fp = path.join(UPLOAD_DIR, item.file);
    if(fs.existsSync(fp)) fs.unlinkSync(fp);
  }

  db.scripts = (db.scripts || []).filter(s=>s.id!==req.params.id);
  db.downloads = (db.downloads || []).filter(d=>d.scriptId!==req.params.id);

  writeDB(db);
  res.redirect('/admin');
});

app.listen(PORT, ()=>{
  console.log(`✅ ${process.env.APP_NAME || 'قائمة السكربتات'} يعمل`);
  console.log(`🌐 http://localhost:${PORT}`);
});