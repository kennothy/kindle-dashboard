// Builds the Kindle dashboard images. Run by GitHub Actions every hour.
// Output: out/bundle.tar (what the Kindle downloads) and out/index.html (a preview page).
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const adhan = require("adhan");
const sharp = require("sharp");
const C = require("./config");

const OUT = path.join(__dirname, "..", "out");
const KDIR = path.join(OUT, "k");
const TMP = path.join(OUT, "tmp");
const FONTS = path.join(__dirname, "fonts");
const W = C.width, H = C.height, FH = C.footerHeight;
const CHROME = process.env.CHROME || "google-chrome";

// ---------- time helpers ----------
function localParts(date) {
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-GB", {
    timeZone: C.timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "long", hour12: false,
  }).formatToParts(date)) p[x.type] = x.value;
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, weekday: p.weekday };
}
function fmtTime(epoch) {
  return new Intl.DateTimeFormat("en-US", { timeZone: C.timezone, hour: "numeric", minute: "2-digit", hour12: true })
    .format(new Date(epoch * 1000));
}
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const HIJRI = ["Muharram","Safar","Rabi al-Awwal","Rabi al-Thani","Jumada al-Ula","Jumada al-Akhirah","Rajab","Shaban","Ramadan","Shawwal","Dhu al-Qadah","Dhu al-Hijjah"];
function hijri(y, m, d) {
  const dt = new Date(Date.UTC(y, m - 1, d + C.hijriAdjust, 12));
  const p = {};
  for (const x of new Intl.DateTimeFormat("en-u-ca-islamic-umalqura-nu-latn", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" }).formatToParts(dt)) p[x.type] = x.value;
  return `${parseInt(p.day)} ${HIJRI[parseInt(p.month) - 1]} ${parseInt(p.year || p.relatedYear)}`;
}

// ---------- prayer times ----------
const KEYS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"];
function prayerTimes(y, m, d) {
  const p = adhan.CalculationMethod.Other();
  p.fajrAngle = 18.2; p.ishaAngle = 18.2; p.rounding = adhan.Rounding.None;
  const t = new adhan.PrayerTimes(new adhan.Coordinates(C.latitude, C.longitude), new Date(y, m - 1, d, 12), p);
  const out = {};
  for (const k of KEYS) {
    const tune = C.prayerTuning[k];
    out[k] = Math[tune.mode]((t[k].getTime() / 1000 + tune.offset) / 60) * 60;
  }
  return out;
}

// ---------- weather ----------
async function weather() {
  if (process.env.MOCK_WEATHER) return JSON.parse(fs.readFileSync(process.env.MOCK_WEATHER, "utf8"));
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${C.latitude}&longitude=${C.longitude}` +
    `&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=${encodeURIComponent(C.timezone)}&forecast_days=7`;
  for (let i = 0; i < 3; i++) {
    try { const r = await fetch(url); if (r.ok) return await r.json(); } catch (e) {}
    await new Promise(r => setTimeout(r, 5000));
  }
  return null;
}
function wxKind(code) {
  if (code <= 1) return "clear";
  if (code === 2) return "partly";
  if (code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if (code >= 95) return "storm";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  return "cloudy";
}
const WX_TEXT = { clear: "Clear", partly: "Partly cloudy", cloudy: "Cloudy", fog: "Fog", rain: "Rain", storm: "Thunderstorm" };

// ---------- icons ----------
function icon(kind, size, fg, bg, night = false) {
  const rays = (cx, cy, r1, r2, w) => [0, 45, 90, 135, 180, 225, 270, 315].map(a =>
    `<line x1="${cx}" y1="${cy - r1}" x2="${cx}" y2="${cy - r2}" stroke="${fg}" stroke-width="${w}" stroke-linecap="round" transform="rotate(${a} ${cx} ${cy})"/>`).join("");
  const cloud = (dy = 0) => `<path d="M30 ${80 + dy} Q18 ${80 + dy} 18 ${68 + dy} Q18 ${56 + dy} 32 ${56 + dy} Q36 ${42 + dy} 52 ${42 + dy} Q68 ${42 + dy} 72 ${56 + dy} Q86 ${56 + dy} 86 ${68 + dy} Q86 ${80 + dy} 74 ${80 + dy} Z" fill="${bg}" stroke="${fg}" stroke-width="6"/>`;
  const moon = (cx, cy, r) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fg}"/><circle cx="${cx + r * 0.47}" cy="${cy - r * 0.35}" r="${r * 0.88}" fill="${bg}"/>`;
  let g = "";
  if (kind === "clear") g = night ? moon(50, 50, 34) : `<circle cx="50" cy="50" r="20" fill="${fg}"/>` + rays(50, 50, 38, 26, 7);
  else if (kind === "partly") g = (night ? moon(38, 36, 18) : `<circle cx="38" cy="38" r="16" fill="${fg}"/>` + rays(38, 38, 30, 22, 6)) + cloud();
  else if (kind === "cloudy") g = cloud(-6);
  else if (kind === "fog") g = [34, 50, 66].map(y => `<line x1="18" y1="${y}" x2="82" y2="${y}" stroke="${fg}" stroke-width="7" stroke-linecap="round"/>`).join("");
  else if (kind === "rain") g = cloud(-14) + [34, 50, 66].map(x => `<line x1="${x}" y1="76" x2="${x - 6}" y2="92" stroke="${fg}" stroke-width="6" stroke-linecap="round"/>`).join("");
  else if (kind === "storm") g = cloud(-14) + `<path d="M54 68 L42 84 L52 84 L44 98" fill="none" stroke="${fg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 100">${g}</svg>`;
}

// ---------- HTML ----------
const T = C.theme === "dark"
  ? { bg: "#000", fg: "#fff", muted: "#aaa", soft: "#888", line: "#333" }
  : { bg: "#fff", fg: "#000", muted: "#555", soft: "#888", line: "#ddd" };
const fontCss = `
@font-face{font-family:Amiri;src:url(file://${FONTS}/amiri-700.woff2)}
@font-face{font-family:PF;src:url(file://${FONTS}/playfair-900.woff2);font-weight:900}
@font-face{font-family:PF;src:url(file://${FONTS}/playfair-400i.woff2);font-style:italic}
@font-face{font-family:SG;src:url(file://${FONTS}/grotesk-500.woff2)}
@font-face{font-family:SG;src:url(file://${FONTS}/grotesk-700.woff2);font-weight:700}
*{box-sizing:border-box}`;

function mainHtml(d, state) {
  const names = [["Fajr", "الفجر"], ["Sunrise", "الشروق"], ["Dhuhr", "الظهر"], ["Asr", "العصر"], ["Maghrib", "المغرب"], ["Isha", "العشاء"]];
  const hiRow = [0, 2, 3, 4, 5, 0][state];
  const times = KEYS.map(k => d.pt[k]);
  if (state === 5) times[0] = d.ptTomorrow.fajr;
  const nextLabel = state === 5 ? "Next prayer: Fajr, tomorrow" : `Next prayer: ${names[hiRow][0]}`;
  const rows = names.map(([en, ar], i) => {
    const hi = i === hiRow, mut = i === 1;
    const st = hi ? `background:${T.fg};color:${T.bg};border:none` : mut ? `color:${T.soft}` : "";
    return `<div class="row" style="${st}"><span class="en" style="font-weight:${hi ? 700 : 500}">${en}</span>` +
      `<span class="ar" style="color:${hi ? T.bg : T.soft}">${ar}</span><span style="font-weight:700">${fmtTime(times[i])}</span></div>`;
  }).join("");

  let wx = `<div style="font-size:34px;color:${T.muted}">Weather unavailable right now</div>`, days = "";
  if (d.wx) {
    const c = d.wx.current, k = wxKind(c.weather_code);
    const night = d.now < d.pt.sunrise || d.now >= d.pt.maghrib;
    const desc = k === "clear" && night ? "Clear night" : WX_TEXT[k];
    const dl = d.wx.daily;
    wx = `${icon(k, 140, T.fg, T.bg, night)}
      <div style="font-family:PF;font-weight:900;font-size:150px;line-height:1">${Math.round(c.temperature_2m)}<span style="font-family:SG;font-weight:500;font-size:90px;vertical-align:top">°</span></div>
      <div style="font-size:30px;line-height:1.55;margin-left:10px">${desc}<br><span style="color:${T.muted}">Feels ${Math.round(c.apparent_temperature)}° · Humidity ${Math.round(c.relative_humidity_2m)}%<br>Wind ${Math.round(c.wind_speed_10m)} km/h · H ${Math.round(dl.temperature_2m_max[0])}° L ${Math.round(dl.temperature_2m_min[0])}°</span></div>`;
    days = dl.time.slice(0, 7).map((t, i) => {
      const lbl = i === 0 ? "TODAY" : new Date(t + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }).toUpperCase();
      return `<div style="flex:1;text-align:center"><div style="font-size:24px;letter-spacing:4px;color:${T.muted}">${lbl}</div>` +
        `<div style="margin:10px 0">${icon(wxKind(dl.weather_code[i]), 72, T.fg, T.bg)}</div>` +
        `<div style="font-size:34px;font-weight:700">${Math.round(dl.temperature_2m_max[i])}°</div>` +
        `<div style="font-size:28px;color:${T.soft}">${Math.round(dl.temperature_2m_min[i])}°</div></div>`;
    }).join("");
  }

  return `<html><head><meta charset="utf-8"><style>${fontCss}
body{margin:0;width:${W}px;height:${H}px;background:${T.bg};color:${T.fg};font-family:SG;position:relative;overflow:hidden}
.lbl{font-size:24px;letter-spacing:6px;color:${T.muted}}
.row{display:flex;align-items:center;height:92px;padding:0 34px;border-bottom:2px solid ${T.line};font-size:46px}
.row .ar{font-family:Amiri;font-size:44px;margin-left:22px;flex:1}.row .en{width:250px}
</style></head><body>
<div style="position:absolute;left:70px;top:60px;right:70px;display:flex;justify-content:space-between;align-items:flex-start">
 <div><div style="font-family:PF;font-weight:900;font-size:120px;line-height:1">${d.weekday}</div>
 <div style="font-size:38px;margin-top:14px">${d.dateText}</div>
 <div style="font-family:PF;font-style:italic;font-size:32px;color:${T.muted};margin-top:6px">${d.hijri}</div></div>
 <div style="text-align:right;padding-top:18px"><div class="lbl">${C.city.toUpperCase()}</div><div style="font-family:Amiri;font-size:56px;line-height:1.2">${C.cityArabic}</div></div>
</div>
<div style="position:absolute;left:70px;right:70px;top:350px;height:3px;background:${T.fg}"></div>
<div style="position:absolute;left:70px;right:70px;top:380px;display:flex;justify-content:space-between;align-items:baseline">
 <span class="lbl">PRAYER TIMES</span><span style="font-family:PF;font-style:italic;font-size:30px;color:${T.muted}">${nextLabel}</span></div>
<div style="position:absolute;left:70px;right:70px;top:440px;border-top:2px solid ${T.line}">${rows}</div>
<div style="position:absolute;left:70px;right:70px;top:1040px;display:flex;align-items:center;gap:30px">${wx}</div>
<div style="position:absolute;left:70px;right:70px;top:1250px;height:2px;background:${T.line}"></div>
<div style="position:absolute;left:50px;right:50px;top:1285px;display:flex">${days}</div>
</body></html>`;
}

function footerHtml(battery, updated) {
  // Footer uses the opposite colours to the page, like the mockup.
  const bg = T.fg, fg = T.bg;
  const fill = Math.max(2, Math.round(34 * battery / 100));
  return `<html><head><meta charset="utf-8"><style>${fontCss}
body{margin:0;width:${W}px;height:${FH}px;background:${bg};color:${fg};font-family:SG;display:flex;align-items:center;justify-content:space-between;padding:0 70px;font-size:26px;letter-spacing:3px;overflow:hidden}
</style></head><body>
<span><svg width="46" height="22" viewBox="0 0 46 22" style="vertical-align:-3px;margin-right:12px"><rect x="1" y="1" width="40" height="20" rx="3" fill="none" stroke="${fg}" stroke-width="2"/><rect x="42" y="7" width="3" height="8" fill="${fg}"/><rect x="4" y="4" width="${fill}" height="14" fill="${fg}"/></svg>${battery}%</span>
<span>UPDATED ${updated.toUpperCase()}</span></body></html>`;
}

function shoot(html, file, w, h) {
  const src = path.join(TMP, path.basename(file) + ".html");
  fs.writeFileSync(src, html);
  execFileSync(CHROME, ["--headless", "--no-sandbox", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--window-size=${w},${h}`, "--allow-file-access-from-files", "--virtual-time-budget=3000",
    `--screenshot=${file}`, `file://${src}`], { stdio: "ignore" });
}
async function toGray(file) {
  const out = await sharp(file).toColourspace("b-w").png({ compressionLevel: 9 }).toBuffer();
  fs.writeFileSync(file, out);
}

(async () => {
  for (const d of [OUT, KDIR, TMP]) fs.mkdirSync(d, { recursive: true });
  const nowDate = process.env.FAKE_NOW ? new Date(process.env.FAKE_NOW) : new Date();
  const now = Math.floor(nowDate.getTime() / 1000);
  const L = localParts(nowDate);
  const tomorrow = localParts(new Date(Date.UTC(L.y, L.m - 1, L.d + 1, 12)));
  const data = {
    now,
    weekday: L.weekday,
    dateText: `${L.d} ${MONTHS[L.m - 1]} ${L.y}`,
    hijri: hijri(L.y, L.m, L.d),
    pt: prayerTimes(L.y, L.m, L.d),
    ptTomorrow: prayerTimes(tomorrow.y, tomorrow.m, tomorrow.d),
    wx: await weather(),
  };
  const updated = fmtTime(now);

  for (let s = 0; s <= 5; s++) {
    const f = path.join(KDIR, `main_${s}.png`);
    shoot(mainHtml(data, s), f, W, H - FH);
    await toGray(f);
  }
  for (let b = 0; b <= 100; b += 5) {
    const f = path.join(KDIR, `foot_${b}.png`);
    shoot(footerHtml(b, updated), f, W, FH);
    await toGray(f);
  }
  const p = data.pt;
  fs.writeFileSync(path.join(KDIR, "times.sh"),
    `PRAYERS="${p.fajr} ${p.dhuhr} ${p.asr} ${p.maghrib} ${p.isha}"\nGENERATED=${now}\nFOOTER_Y=${H - FH}\n`);

  execFileSync("tar", ["-cf", path.join(OUT, "bundle.tar"), "-C", KDIR, "."]);

  // Preview page you can open on your phone
  const state = [p.fajr, p.dhuhr, p.asr, p.maghrib, p.isha].filter(t => now >= t).length;
  await sharp(path.join(KDIR, `main_${state}.png`)).extend({ bottom: FH, background: "#000" })
    .composite([{ input: path.join(KDIR, "foot_80.png"), top: H - FH, left: 0 }]).png().toFile(path.join(OUT, "preview.png"));
  fs.writeFileSync(path.join(OUT, "index.html"),
    `<!doctype html><meta name="viewport" content="width=device-width"><title>Kindle dashboard</title>` +
    `<body style="margin:0;background:#222;text-align:center"><img src="preview.png?${now}" style="max-width:100%;max-height:100vh">`);
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log("Built dashboard for", data.dateText, "state", state, "weather", data.wx ? "ok" : "missing");
})();
