const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const SUPER_ADMIN_EMAIL = process.env.SUPER_ADMIN_EMAIL || 'a.a.jabir.bght@gmail.com';
const SUPER_ADMIN_PASSWORD = process.env.SUPER_ADMIN_PASSWORD || 'Jabir@2024';

// ═══════════════ DATABASE SETUP ═══════════════
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false
});

// ═══════════════ MIDDLEWARE ═══════════════
// Base64 ছবি সাপোর্ট করার জন্য limit 10mb করা হলো
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'sundarbans-secret-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
  next();
};

// ═══════════════ DB INITIALIZATION ═══════════════
async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'EDITOR',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS categories (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      name_bn TEXT NOT NULL,
      name_en TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS articles (
      id SERIAL PRIMARY KEY,
      title_bn TEXT NOT NULL,
      title_en TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      excerpt_bn TEXT,
      excerpt_en TEXT,
      content_bn TEXT NOT NULL,
      content_en TEXT NOT NULL,
      image_base64 TEXT,
      category_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      status TEXT DEFAULT 'DRAFT',
      published_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const catCount = await pool.query('SELECT COUNT(*) FROM categories');
  if (parseInt(catCount.rows[0].count) === 0) {
    const cats = [
      ['politics', 'রাজনীতি', 'Politics'], ['sports', 'খেলাধুলা', 'Sports'],
      ['entertainment', 'বিনোদন', 'Entertainment'], ['technology', 'প্রযুক্তি', 'Technology'],
      ['business', 'ব্যবসা', 'Business'], ['international', 'আন্তর্জাতিক', 'International'],
      ['health', 'স্বাস্থ্য', 'Health'], ['education', 'শিক্ষা', 'Education']
    ];
    for (const c of cats) {
      await pool.query('INSERT INTO categories (slug, name_bn, name_en) VALUES ($1, $2, $3)', c);
    }
  }

  const adminCheck = await pool.query('SELECT id FROM users WHERE email = $1', [SUPER_ADMIN_EMAIL]);
  if (adminCheck.rows.length === 0) {
    await pool.query('INSERT INTO users (email, password, name, role) VALUES ($1, $2, $3, $4)', 
      [SUPER_ADMIN_EMAIL, bcrypt.hashSync(SUPER_ADMIN_PASSWORD, 10), 'A. A. Jabir', 'SUPER_ADMIN']);
    console.log('✅ Super Admin তৈরি হয়েছে');
  }
}

// ═══════════════ API ROUTES ═══════════════
app.get('/api/categories', async (req, res) => {
  const r = await pool.query('SELECT * FROM categories ORDER BY id');
  res.json(r.rows);
});

app.get('/api/articles', async (req, res) => {
  const { category, search, limit = 20, offset = 0 } = req.query;
  let sql = `SELECT a.id, a.slug, a.title_bn, a.title_en, a.excerpt_bn, a.excerpt_en, a.image_base64, a.published_at,
                    c.slug AS category_slug, c.name_bn AS category_name_bn, c.name_en AS category_name_en, u.name AS author_name
             FROM articles a JOIN categories c ON a.category_id = c.id JOIN users u ON a.author_id = u.id WHERE a.status = 'PUBLISHED'`;
  const args = [];
  
  if (category) { args.push(category); sql += ` AND c.slug = $${args.length}`; }
  if (search && search.trim()) {
    const q = `%${search.trim()}%`; args.push(q, q, q, q);
    sql += ` AND (a.title_bn ILIKE $${args.length-3} OR a.title_en ILIKE $${args.length-2} OR a.content_bn ILIKE $${args.length-1} OR a.content_en ILIKE $${args.length})`;
  }
  
  sql += ` ORDER BY a.published_at DESC LIMIT $${args.length + 1} OFFSET $${args.length + 2}`;
  args.push(parseInt(limit), parseInt(offset));
  
  const r = await pool.query(sql, args);
  res.json(r.rows);
});

app.get('/api/articles/:slug', async (req, res) => {
  const r = await pool.query(`SELECT a.*, c.name_bn AS category_name_bn, c.name_en AS category_name_en, u.name AS author_name FROM articles a JOIN categories c ON a.category_id = c.id JOIN users u ON a.author_id = u.id WHERE a.slug = $1 AND a.status = 'PUBLISHED'`, [req.params.slug]);
  if (!r.rows.length) return res.status(404).json({ error: 'Article not found' });
  res.json(r.rows[0]);
});

app.post('/api/login', async (req, res) => {
  const r = await pool.query('SELECT * FROM users WHERE email = $1', [req.body.email || '']);
  const user = r.rows[0];
  if (!user || !bcrypt.compareSync(req.body.password || '', user.password)) return res.status(401).json({ error: 'ভুল ইমেইল বা পাসওয়ার্ড' });
  req.session.user = { id: user.id, email: user.email, name: user.name, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ success: true })));
app.get('/api/me', (req, res) => res.json({ user: req.session.user || null }));

app.get('/api/admin/articles', requireAuth, async (req, res) => {
  const r = await pool.query(`SELECT a.*, c.name_bn AS category_name_bn, u.name AS author_name FROM articles a JOIN categories c ON a.category_id = c.id JOIN users u ON a.author_id = u.id ORDER BY a.created_at DESC`);
  res.json(r.rows);
});

app.post('/api/admin/articles', requireAuth, async (req, res) => {
  const { title_bn, title_en, excerpt_bn, excerpt_en, content_bn, content_en, category_id, status, image_base64 } = req.body;
  const slug = title_en.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
  const published_at = status === 'PUBLISHED' ? new Date() : null;
  
  const r = await pool.query(`INSERT INTO articles (title_bn, title_en, slug, excerpt_bn, excerpt_en, content_bn, content_en, image_base64, category_id, author_id, status, published_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`, 
    [title_bn, title_en, slug, excerpt_bn || '', excerpt_en || '', content_bn, content_en, image_base64 || null, parseInt(category_id), req.session.user.id, status || 'DRAFT', published_at]);
  res.json({ id: r.rows[0].id, slug });
});

app.put('/api/admin/articles/:id', requireAuth, async (req, res) => {
  const existing = await pool.query('SELECT * FROM articles WHERE id = $1', [req.params.id]);
  if (!existing.rows.length) return res.status(404).json({ error: 'পাওয়া যায়নি' });
  const old = existing.rows[0];
  const { title_bn, title_en, excerpt_bn, excerpt_en, content_bn, content_en, category_id, status, image_base64 } = req.body;
  
  let final_image = old.image_base64;
  if (image_base64) final_image = image_base64;
  
  const published_at = (status === 'PUBLISHED' && !old.published_at) ? new Date() : old.published_at;
  
  await pool.query(`UPDATE articles SET title_bn=$1, title_en=$2, excerpt_bn=$3, excerpt_en=$4, content_bn=$5, content_en=$6, image_base64=$7, category_id=$8, status=$9, published_at=$10 WHERE id=$11`,
    [title_bn, title_en, excerpt_bn || '', excerpt_en || '', content_bn, content_en, final_image, parseInt(category_id), status, published_at, req.params.id]);
  res.json({ success: true });
});

app.delete('/api/admin/articles/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM articles WHERE id = $1', [req.params.id]);
  res.json({ success: true });
});

// ═══════════════ FRONTEND (HTML/CSS/JS) ═══════════════
const INDEX_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>SUNDARBANS TIMES</title><link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/style.css"></head><body><header class="site-header"><div class="container"><div class="header-top"><a href="#/" class="brand"><h1>SUNDARBANS TIMES</h1><span class="tagline" data-i18n="tagline">আলোকিত আগামীর লক্ষে</span></a><div class="header-actions"><button class="lang-toggle" id="langToggle">English</button><a href="/admin.html" class="admin-link" data-i18n="admin">অ্যাডমিন</a></div></div><form class="search-wrap" id="searchForm"><input type="text" class="search-input" id="searchInput" placeholder="সংবাদ খুঁজুন..." data-i18n-placeholder="searchPlaceholder"><button type="submit" class="search-btn">🔍</button></form></div></header><nav class="cat-nav"><div class="container" id="categoryNav"><a href="#/" data-i18n="home">হোম</a></div></nav><main class="container"><div id="app" class="loading">লোড হচ্ছে...</div></main><footer class="site-footer"><div class="container"><div class="footer-grid"><div><h4>SUNDARBANS TIMES</h4><p style="font-size:14px" data-i18n="footerAbout">আলোকিত আগামীর লক্ষে সত্য ও নিরপেক্ষ সংবাদ পরিবেশনায় আমরা অঙ্গীকারবদ্ধ।</p></div><div><h4 data-i18n="categories">ক্যাটাগরি</h4><div id="footerCats"></div></div><div><h4 data-i18n="quickLinks">দ্রুত লিংক</h4><a href="#/" data-i18n="home">হোম</a><a href="/admin.html" data-i18n="adminPanel">অ্যাডমিন প্যানেল</a></div></div><div class="copyright">© <span id="year"></span> SUNDARBANS TIMES</div></div></footer><script src="/app.js"></script></body></html>`;
const ADMIN_HTML = `<!DOCTYPE html><html lang="bn"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Admin — SUNDARBANS TIMES</title><link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/style.css"></head><body class="admin-body"><div class="login-wrap" id="loginView"><form class="login-card" id="loginForm"><h2>🔐 Admin Login</h2><div class="form-group"><label>Email</label><input type="email" id="email" required></div><div class="form-group"><label>Password</label><input type="password" id="password" required></div><button type="submit" class="btn btn-primary btn-block">লগইন</button><p id="loginError" style="color:red;text-align:center"></p></form></div><div id="dashView" style="display:none"><header class="admin-header"><div class="container"><h1>📰 Admin Dashboard</h1><div class="user-info"><span id="userName"></span><button class="btn btn-sm btn-danger" id="logoutBtn">লগআউট</button></div></div></header><main class="admin-main container"><div class="admin-toolbar"><h2>আর্টিকেল ম্যানেজমেন্ট</h2><button class="btn btn-primary" id="newBtn">➕ নতুন আর্টিকেল</button></div><div style="overflow-x:auto"><table class="article-table"><thead><tr><th>ছবি</th><th>শিরোনাম</th><th>স্ট্যাটাস</th><th>অ্যাকশন</th></tr></thead><tbody id="articleList"></tbody></table></div></main></div><div class="modal" id="modal"><div class="modal-content"><h3 id="modalTitle">আর্টিকেল</h3><form id="articleForm"><input type="hidden" id="articleId"><div class="form-row"><div class="form-group"><label>শিরোনাম (বাংলা)</label><input type="text" id="title_bn" required></div><div class="form-group"><label>Title (English)</label><input type="text" id="title_en" required></div></div><div class="form-row"><div class="form-group"><label>সংক্ষিপ্ত (বাংলা)</label><input type="text" id="excerpt_bn"></div><div class="form-group"><label>Excerpt (English)</label><input type="text" id="excerpt_en"></div></div><div class="form-group"><label>বিস্তারিত (বাংলা)</label><textarea id="content_bn" rows="4" required></textarea></div><div class="form-group"><label>Content (English)</label><textarea id="content_en" rows="4" required></textarea></div><div class="form-group"><label>ছবি (Max 5MB - Auto Compress)</label><input type="file" id="image" accept="image/*"></div><div class="form-row"><div class="form-group"><label>ক্যাটাগরি</label><select id="category_id" required></select></div><div class="form-group"><label>স্ট্যাটাস</label><select id="status"><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option></select></div></div><div class="modal-actions"><button type="button" class="btn btn-secondary" id="cancelBtn">বাতিল</button><button type="submit" class="btn btn-primary">সেভ</button></div></form></div></div><script src="/admin.js"></script></body></html>`;
const CSS = `:root{--navy-900:#0f172a;--navy-800:#1e293b;--blue-800:#1e3a8a;--blue-600:#2563eb;--blue-500:#3b82f6;--gray-100:#f3f4f6;--gray-200:#e5e7eb;--gray-500:#6b7280;--white:#fff}*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Inter','Hind Siliguri',sans-serif;background:var(--gray-100);color:#111827;line-height:1.6}a{text-decoration:none;color:inherit}.container{max-width:1200px;margin:0 auto;padding:0 20px}.site-header{background:linear-gradient(135deg,var(--navy-900),var(--blue-800));color:#fff;padding:18px 0}.header-top{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:20px}.brand h1{font-size:28px;font-weight:800;background:linear-gradient(90deg,#fff,#dbeafe);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.tagline{font-size:13px;color:#dbeafe}.header-actions{display:flex;gap:10px}.lang-toggle,.admin-link{background:rgba(255,255,255,.1);color:#fff;padding:8px 16px;border-radius:8px;font-weight:600;font-size:14px;border:none;cursor:pointer}.admin-link{background:var(--blue-500)}.search-wrap{margin-top:18px;position:relative}.search-input{width:100%;padding:14px 50px 14px 20px;border-radius:12px;border:none;font-size:15px;outline:none}.search-btn{position:absolute;right:6px;top:6px;background:var(--blue-600);color:#fff;width:40px;height:40px;border-radius:8px;border:none;cursor:pointer}.cat-nav{background:var(--blue-800);position:sticky;top:0;z-index:50}.cat-nav .container{display:flex;gap:4px;overflow-x:auto}.cat-nav a{padding:14px 20px;color:#dbeafe;font-weight:600;font-size:14px;white-space:nowrap}.cat-nav a:hover{color:#fff}main{padding:30px 0;min-height:70vh}.section-title{font-size:24px;font-weight:800;color:var(--navy-900);margin-bottom:20px;border-left:5px solid var(--blue-600);padding-left:14px}.article-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px}.card{background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 6px rgba(0,0,0,.1);display:flex;flex-direction:column}.card-image{width:100%;height:200px;object-fit:cover}.card-body{padding:20px}.card-cat{background:#eff6ff;color:var(--blue-800);font-size:12px;font-weight:700;padding:4px 10px;border-radius:6px;text-transform:uppercase}.card-title{font-size:18px;font-weight:700;margin:10px 0 8px}.card-excerpt{font-size:14px;color:var(--gray-500);margin-bottom:14px}.card-meta{font-size:12px;color:var(--gray-500);display:flex;gap:14px}.article-full{background:#fff;border-radius:16px;padding:40px;box-shadow:0 4px 6px rgba(0,0,0,.1)}.article-full h1{font-size:34px;font-weight:800;margin-bottom:12px}.article-meta{color:var(--gray-500);font-size:14px;margin-bottom:24px;padding-bottom:20px;border-bottom:1px solid var(--gray-200)}.article-image{width:100%;max-height:520px;object-fit:cover;border-radius:12px;margin:24px 0}.article-content{font-size:17px;line-height:1.9;white-space:pre-wrap}.site-footer{background:var(--navy-900);color:#dbeafe;padding:40px 0;margin-top:40px}.footer-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:30px}footer h4{color:#fff;margin-bottom:12px}footer a{display:block;font-size:14px;padding:4px 0}.copyright{border-top:1px solid rgba(255,255,255,.1);padding-top:18px;text-align:center;font-size:13px;margin-top:24px}.empty,.loading{text-align:center;padding:60px 20px;color:var(--gray-500)}.login-wrap{min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(135deg,var(--navy-900),var(--blue-800))}.login-card{background:#fff;padding:40px;border-radius:16px;width:100%;max-width:420px}.form-group{margin-bottom:16px}.form-group label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}.form-group input,.form-group textarea,.form-group select{width:100%;padding:10px 14px;border:1.5px solid var(--gray-200);border-radius:8px;font-size:14px;outline:none}.btn{padding:10px 20px;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;border:none}.btn-primary{background:var(--blue-600);color:#fff}.btn-danger{background:#dc2626;color:#fff}.btn-secondary{background:var(--gray-100);color:#374151}.btn-sm{padding:6px 12px;font-size:13px}.btn-block{width:100%}.admin-header{background:var(--navy-900);color:#fff;padding:16px 0}.admin-header .container{display:flex;justify-content:space-between;align-items:center}.admin-main{padding:30px 0}.admin-toolbar{display:flex;justify-content:space-between;margin-bottom:20px}.article-table{width:100%;background:#fff;border-radius:12px;border-collapse:collapse;overflow:hidden}.article-table th{background:var(--blue-800);color:#fff;padding:12px;text-align:left;font-size:13px}.article-table td{padding:12px;border-bottom:1px solid var(--gray-200);font-size:14px}.table-thumb{width:60px;height:40px;object-fit:cover;border-radius:6px}.status-badge{padding:3px 10px;border-radius:6px;font-size:12px;font-weight:700}.status-PUBLISHED{background:#dcfce7;color:#166534}.status-DRAFT{background:#fef3c7;color:#92400e}.modal{display:none;position:fixed;inset:0;background:rgba(15,23,42,.6);z-index:1000;padding:20px;overflow-y:auto}.modal.active{display:flex;justify-content:center;padding-top:40px}.modal-content{background:#fff;border-radius:16px;padding:30px;width:100%;max-width:720px}.modal-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:20px}.form-row{display:grid;grid-template-columns:1fr 1fr;gap:16px}@media(max-width:640px){.form-row{grid-template-columns:1fr}.brand h1{font-size:22px}}`;
const APP_JS = `var i18n={bn:{tagline:'আলোকিত আগামীর লক্ষে',admin:'অ্যাডমিন',home:'হোম',searchPlaceholder:'সংবাদ খুঁজুন...',latest:'সর্বশেষ সংবাদ',searchResults:'সার্চ ফলাফল',noResults:'কোনো সংবাদ নেই',loading:'লোড হচ্ছে...'},en:{tagline:'Towards a Brighter Future',admin:'Admin',home:'Home',searchPlaceholder:'Search news...',latest:'Latest News',searchResults:'Search Results',noResults:'No news found',loading:'Loading...'}};var lang=localStorage.getItem('lang')||'bn';function t(k){return i18n[lang][k]||k;}function $(s){return document.querySelector(s);}function fmtDate(iso){return iso?new Date(iso).toLocaleDateString(lang==='bn'?'bn-BD':'en-US',{year:'numeric',month:'long',day:'numeric'}):'';}function applyLang(){document.documentElement.lang=lang;document.querySelectorAll('[data-i18n]').forEach(function(el){el.textContent=t(el.dataset.i18n);});$('#langToggle').textContent=lang==='bn'?'English':'বাংলা';}$('#langToggle').onclick=function(){lang=lang==='bn'?'en':'bn';localStorage.setItem('lang',lang);applyLang();render();};var categories=[];function loadCats(){return fetch('/api/categories').then(r=>r.json()).then(cats=>{categories=cats;$('#categoryNav').innerHTML='<a href="#/">'+t('home')+'</a>';cats.forEach(c=>{$('#categoryNav').insertAdjacentHTML('beforeend','<a href="#/category/'+c.slug+'">'+(lang==='bn'?c.name_bn:c.name_en)+'</a>');});});}function card(a){var img=a.image_base64?'<img class="card-image" src="'+a.image_base64+'">':'';return '<article class="card">'+img+'<div class="card-body"><span class="card-cat">'+(lang==='bn'?a.category_name_bn:a.category_name_en)+'</span><h3 class="card-title"><a href="#/article/'+a.slug+'">'+(lang==='bn'?a.title_bn:a.title_en)+'</a></h3><p class="card-excerpt">'+(lang==='bn'?a.excerpt_bn:a.excerpt_en)+'</p><div class="card-meta"><span>📅 '+fmtDate(a.published_at)+'</span></div></div></article>';}function render(){var hash=location.hash||'#/';var app=$('#app');if(hash==='#/'){app.innerHTML='<h2 class="section-title">'+t('latest')+'</h2><div class="article-grid" id="grid"></div>';fetch('/api/articles?limit=12').then(r=>r.json()).then(list=>{$('#grid').innerHTML=list.length?list.map(card).join(''):'<div class="empty">'+t('noResults')+'</div>';});}else if(hash.indexOf('#/category/')===0){var slug=hash.split('/')[2];app.innerHTML='<div class="article-grid" id="grid"></div>';fetch('/api/articles?category='+slug).then(r=>r.json()).then(list=>{$('#grid').innerHTML=list.length?list.map(card).join(''):'<div class="empty">'+t('noResults')+'</div>';});}else if(hash.indexOf('#/article/')===0){var slug=hash.split('/')[2];app.innerHTML=t('loading');fetch('/api/articles/'+slug).then(r=>r.json()).then(a=>{app.innerHTML='<article class="article-full"><span class="card-cat">'+(lang==='bn'?a.category_name_bn:a.category_name_en)+'</span><h1>'+(lang==='bn'?a.title_bn:a.title_en)+'</h1><div class="article-meta">লেখক: '+a.author_name+' · '+fmtDate(a.published_at)+'</div>'+(a.image_base64?'<img class="article-image" src="'+a.image_base64+'">':'')+'<div class="article-content">'+(lang==='bn'?a.content_bn:a.content_en)+'</div></article>';});}else if(hash.indexOf('#/search')===0){var q=decodeURIComponent(hash.split('q=')[1]||'');app.innerHTML='<h2 class="section-title">'+t('searchResults')+': "'+q+'"</h2><div class="article-grid" id="grid"></div>';fetch('/api/articles?search='+encodeURIComponent(q)).then(r=>r.json()).then(list=>{$('#grid').innerHTML=list.length?list.map(card).join(''):'<div class="empty">'+t('noResults')+'</div>';});}}$('#searchForm').onsubmit=function(e){e.preventDefault();var q=$('#searchInput').value.trim();if(q)location.hash='#/search?q='+encodeURIComponent(q);};applyLang();$('#year').textContent=new Date().getFullYear();loadCats().then(render);window.addEventListener('hashchange',()=>{render();window.scrollTo(0,0);});`;
const ADMIN_JS = `function $(s){return document.querySelector(s);}function api(url,opts){opts=opts||{};var cfg={method:opts.method||'GET',credentials:'include'};if(opts.json){cfg.headers={'Content-Type':'application/json'};cfg.body=JSON.stringify(opts.json);}return fetch(url,cfg).then(r=>{if(!r.ok)return r.json().then(e=>{throw new Error(e.error||'Error');});return r.json();});}var currentUser=null,categories=[],allArticles=[];api('/api/me').then(resp=>{if(resp.user){currentUser=resp.user;showDash();}}).catch(()=>{});$('#loginForm').onsubmit=function(e){e.preventDefault();api('/api/login',{method:'POST',json:{email:$('#email').value,password:$('#password').value}}).then(resp=>{currentUser=resp.user;showDash();}).catch(err=>{$('#loginError').textContent=err.message;});};$('#logoutBtn').addEventListener('click',()=>{api('/api/logout',{method:'POST'}).then(()=>location.reload());});function showDash(){$('#loginView').style.display='none';$('#dashView').style.display='block';$('#userName').textContent=currentUser.name;api('/api/categories').then(cats=>{categories=cats;loadArticles();});}function loadArticles(){api('/api/admin/articles').then(list=>{allArticles=list;var tbody=$('#articleList');if(!list.length){tbody.innerHTML='<tr><td colspan="4" style="text-align:center">কোনো আর্টিকেল নেই</td></tr>';return;}tbody.innerHTML=list.map(a=>'<tr><td>'+(a.image_base64?'<img class="table-thumb" src="'+a.image_base64+'">':'📄')+'</td><td><strong>'+a.title_bn+'</strong></td><td><span class="status-badge status-'+a.status+'">'+a.status+'</span></td><td><button class="btn btn-sm btn-secondary" onclick="editArticle('+a.id+')">এডিট</button> <button class="btn btn-sm btn-danger" onclick="deleteArticle('+a.id+')">ডিলিট</button></td></tr>').join('');});}var modal=$('#modal'),form=$('#articleForm'),pendingImageBase64=null;function openModal(article){modal.classList.add('active');$('#modalTitle').textContent=article?'এডিট':'নতুন আর্টিকেল';$('#articleId').value=article?article.id:'';$('#category_id').innerHTML=categories.map(c=>'<option value="'+c.id+'" '+(article&&article.category_id===c.id?'selected':'')+'>'+c.name_bn+'</option>').join('');$('#title_bn').value=article?article.title_bn:'';$('#title_en').value=article?article.title_en:'';$('#excerpt_bn').value=article?article.excerpt_bn:'';$('#excerpt_en').value=article?article.excerpt_en:'';$('#content_bn').value=article?article.content_bn:'';$('#content_en').value=article?article.content_en:'';$('#status').value=article?article.status:'DRAFT';$('#image').value='';pendingImageBase64=null;}function closeModal(){modal.classList.remove('active');form.reset();pendingImageBase64=null;}$('#newBtn').onclick=()=>openModal(null);$('#cancelBtn').onclick=closeModal;$('#image').onchange=function(e){var file=e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(ev){var img=new Image();img.onload=function(){var canvas=document.createElement('canvas');var ctx=canvas.getContext('2d');var maxW=800;var width=img.width,height=img.height;if(width>maxW){height=Math.round(height*maxW/width);width=maxW;}canvas.width=width;canvas.height=height;ctx.drawImage(img,0,0,width,height);pendingImageBase64=canvas.toDataURL('image/jpeg',0.7);};img.src=ev.target.result;};reader.readAsDataURL(file);};form.onsubmit=function(e){e.preventDefault();var id=$('#articleId').value;var payload={title_bn:$('#title_bn').value,title_en:$('#title_en').value,excerpt_bn:$('#excerpt_bn').value,excerpt_en:$('#excerpt_en').value,content_bn:$('#content_bn').value,content_en:$('#content_en').value,category_id:$('#category_id').value,status:$('#status').value};if(pendingImageBase64)payload.image_base64=pendingImageBase64;api(id?'/api/admin/articles/'+id:'/api/admin/articles',{method:id?'PUT':'POST',json:payload}).then(()=>{closeModal();loadArticles();}).catch(err=>alert(err.message));};window.editArticle=id=>{var a=allArticles.find(x=>x.id===id);if(a)openModal(a);};window.deleteArticle=id=>{if(confirm('ডিলিট করবেন?'))api('/api/admin/articles/'+id,{method:'DELETE'}).then(()=>loadArticles());};`;

app.get('/', (req, res) => res.type('html').send(INDEX_HTML));
app.get('/admin.html', (req, res) => res.type('html').send(ADMIN_HTML));
app.get('/style.css', (req, res) => res.type('css').send(CSS));
app.get('/app.js', (req, res) => res.type('js').send(APP_JS));
app.get('/admin.js', (req, res) => res.type('js').send(ADMIN_JS));

// ═══════════════ START SERVER ═══════════════
initDb().then(() => {
  app.listen(PORT, () => console.log('🚀 Server running on port ' + PORT));
}).catch(err => {
  console.error('❌ DB Error:', err);
  process.exit(1);
});
