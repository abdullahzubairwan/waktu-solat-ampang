// Waktu Solat - script.js (ultra-robust monthly CSV parsing + clear diagnostics)

document.addEventListener("DOMContentLoaded", () => {
  const ZONE = "SGR01";         // keep in sync with your CSV file name
  const PERIOD = "month";       // monthly CSVs
  const DAY_MS = ["Ahad","Isnin","Selasa","Rabu","Khamis","Jumaat","Sabtu"];

  // ---- small helpers ----
  const $ = (id) => document.getElementById(id);
  const setText = (id, val) => { const el = $(id); if (el) el.textContent = val ?? "-"; };
  const setStatus = (msg) => setText("status", msg);

  // MYT "today"
  function todayMYT() {
    const d = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kuala_Lumpur" }));
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const gregMY = d.toLocaleDateString("ms-MY", {
      day: "2-digit", month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur"
    });
    return { d, yyyy, mm, dd, gregMY };
  }
  function monthCsvPath(yyyy, mm) {
    return `data/waktusolat_${ZONE}_${PERIOD}_${yyyy}-${mm}.csv`;
  }
  async function fetchText(url) {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return res.text();
  }

  // ---- CSV parsing (handles , or ;) ----
  function detectDelimiter(headerLine) {
    const comma = headerLine.split(",").length;
    const semi  = headerLine.split(";").length;
    return semi > comma ? ";" : ",";
  }
  function parseCSV(csvText) {
    const raw = csvText.replace(/\r/g, "").trim();
    if (!raw) return { headers: [], rows: [] };
    const lines = raw.split("\n");
    const delim = detectDelimiter(lines[0]);
    const headersRaw = lines.shift().split(delim);
    const headers = headersRaw.map(h => h.replace(/^\uFEFF/, "").trim());
    const rows = lines.filter(Boolean).map(line => {
      const cols = line.split(delim).map(c => c.trim());
      const obj = {};
      headers.forEach((h, i) => obj[h] = cols[i] ?? "");
      return obj;
    });
    return { headers, rows, delim };
  }
  function findHeaderIndex(headers, wantedNames) {
    const norm = headers.map(h => h.trim().toLowerCase());
    for (const name of wantedNames) {
      const i = norm.indexOf(name.toLowerCase());
      if (i !== -1) return i;
    }
    return -1;
  }

  // ---- date normalization ----
  // Return ISO "YYYY-MM-DD" if we can parse; else ""
  function normalizeDate(raw) {
    if (!raw) return "";
    const s = String(raw).trim();

    // ISO-like: "2025-09-05" or "2025-09-05T..."
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);

    // "1-Sep-25" or "01-Sep-25"
    let m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2})$/);
    if (m) return isoFromDD_MMM_YY(m);

    // "01-Sep-2025"
    m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/);
    if (m) return isoFromDD_MMM_YYYY(m);

    // "05/09/2025" or "5/9/2025"
    m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
    if (m) {
      const d = m[1].padStart(2,"0");
      const mo = m[2].padStart(2,"0");
      const yr = m[3].length === 2 ? (2000 + parseInt(m[3],10)) : parseInt(m[3],10);
      return `${yr}-${mo}-${d}`;
    }

    // "Sep 5, 2025"
    m = s.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})$/);
    if (m) {
      const mo = monthFromTxt(m[1]);
      const d  = m[2].padStart(2,"0");
      const yr = m[3];
      if (mo) return `${yr}-${mo}-${d}`;
    }

    return "";
  }
  function monthFromTxt(txt) {
    const t = txt.toLowerCase();
    const map = {jan:"01",feb:"02",mar:"03",apr:"04",may:"05",jun:"06",jul:"07",aug:"08",sep:"09",oct:"10",nov:"11",dec:"12"};
    return map[t] || "";
  }
  function isoFromDD_MMM_YY(m) {
    const d = m[1].padStart(2,"0");
    const mo = monthFromTxt(m[2]);
    const yr = 2000 + parseInt(m[3],10);
    return mo ? `${yr}-${mo}-${d}` : "";
    }
  function isoFromDD_MMM_YYYY(m) {
    const d = m[1].padStart(2,"0");
    const mo = monthFromTxt(m[2]);
    const yr = parseInt(m[3],10);
    return mo ? `${yr}-${mo}-${d}` : "";
  }

  // ---- map row to UI ----
  function fillFromRow(row, headers) {
    const get = (names) => {
      const idx = findHeaderIndex(headers, names);
      return idx === -1 ? "" : (row[headers[idx]] || "");
    };
    setText("date-hijri", get(["hijri"]) ? `Hijri: ${get(["hijri"])}` : "");
    setText("imsak",   get(["imsak"]));
    setText("fajr",    get(["fajr","subuh"]));
    setText("syuruk",  get(["syuruk","syuruq"]));
    setText("dhuhr",   get(["dhuhr","zuhur","zohor"]));
    setText("asr",     get(["asr","asar"]));
    setText("maghrib", get(["maghrib"]));
    setText("isha",    get(["isha","isya","isya'"]));
  }

  (async function run() {
    try {
      setStatus("Memuat data…");

      // Day & Gregorian date (MYT)
      const { d, yyyy, mm, dd, gregMY } = todayMYT();
      setText("day-name", DAY_MS[d.getDay()]);
      setText("date-greg", gregMY);

      // Load CSV
      const csvPath = monthCsvPath(yyyy, mm);
      const csvText = await fetchText(csvPath);
      const { headers, rows } = parseCSV(csvText);
      if (!rows.length) { setStatus("CSV kosong."); return; }

      // Find date column
      const dateIdx = findHeaderIndex(headers, ["date","tarikh"]);
      if (dateIdx === -1) { setStatus("Lajur 'date' tidak ditemui."); return; }

      // Build today ISO & find row
      const todayISO = `${yyyy}-${mm}-${dd}`;
      let rowToday = null;
      for (const r of rows) {
        const iso = normalizeDate(r[headers[dateIdx]]);
        if (iso === todayISO) { rowToday = r; break; }
      }

      if (!rowToday) {
        // show helpful diagnostics
        const all = rows
          .map(r => normalizeDate(r[headers[dateIdx]]) || (r[headers[dateIdx]] || "").trim())
          .filter(Boolean);
        const isoOnly = all.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)).sort();
        const first = isoOnly[0] || all[0] || "?";
        const last  = isoOnly[isoOnly.length-1] || all[all.length-1] || "?";
        setStatus(
          `Tiada entri untuk ${todayISO}. Fail: ${csvPath}\n` +
          `Contoh tarikh ditemui: ${all.slice(0,8).join(" | ")}\n` +
          `Julat ISO (jika ada): ${first} → ${last}`
        );
        // Render first row so you can SEE data
        fillFromRow(rows[0], headers);
        return;
      }

      // Render today's row
      fillFromRow(rowToday, headers);
      setStatus(`Dikemas kini daripada CSV ✓ (${csvPath})`);
    } catch (e) {
      console.error(e);
      setStatus("Gagal memuat/parse CSV. Semak nama fail & format tarikh.");
    }
  })();
});
