/* ==========================================================================
   Pemilihan GENESIS STEI-K '26 — helper bersama
   Kripto (HMAC/tanda tangan cookie), baca-tulis cookie, akses D1,
   dan format angka/waktu. Tidak ada dependensi luar.
   ========================================================================== */

/** Urutan kandidat mengikuti migration dan urutan kartu di pilih.html. */
export const KANDIDAT = ['cheryl-viby', 'muchsin-edo'];

/** Kapasitas kotak suara. Batas kewarasan untuk mencegah pengisian massal. */
export const BATAS_SUARA = 2000;

/** Nama cookie. Diberi prefiks agar tidak bentrok kalau domain dipakai bersama. */
export const COOKIE_SESI = 'pemiltang_sesi';
export const COOKIE_PANITIA = 'pemiltang_adm';

/**
 * Masa berlaku pembukaan PIN, dalam detik. Cukup untuk berjalan dari meja
 * petugas ke kartu suara dan menekan "Saya yakin" — tidak lebih. Karena satu
 * pembukaan hanya boleh menghasilkan satu suara, jendela ini tidak perlu
 * panjang.
 */
export const UMUR_SESI = 10 * 60;

export const UMUR_PANITIA = 8 * 3600;

/** Tiga status pemilihan. Hasil di rekap.html hanya tampil saat 'tutup'. */
export const STATUS = { BELUM: 'belum', BUKA: 'buka', TUTUP: 'tutup' };

const encoder = new TextEncoder();

/* ---------------------------- Kripto ------------------------------------- */

export function randomHex(bytes = 16) {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return toHex(buf);
}

function toHex(bytes) {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

let kunciHMAC = null;
let kunciHMACUntuk = '';

async function hmacKey(secret) {
  if (kunciHMAC && kunciHMACUntuk === secret) return kunciHMAC;
  kunciHMAC = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  kunciHMACUntuk = secret;
  return kunciHMAC;
}

export async function hmacHex(secret, pesan) {
  const key = await hmacKey(secret);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(pesan));
  return toHex(new Uint8Array(sig));
}

/** Perbandingan waktu-konstan untuk string hex. */
export function samaAman(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length || !a) return false;
  let beda = 0;
  for (let i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beda === 0;
}

/**
 * Hash PIN. Sengaja HMAC-SHA256 sekali jalan, bukan PBKDF2: PIN hanya 6 digit
 * sehingga kekuatan hash tidak menyelamatkan apa pun dari penebakan luring,
 * sementara Workerd dibatasi CPU-time per request. Pertahanan sebenarnya ada
 * di pembatasan percobaan (lihat catatPercobaan) dan di fakta bahwa D1 tidak
 * dapat dibaca publik. SESSION_SECRET berperan sebagai pepper, jadi dump
 * database tanpa secret itu pun tidak bisa ditebak.
 */
export async function hashPin(secret, pin) {
  return hmacHex(secret, `pin:${pin}`);
}

/** Nilai bertanda tangan: "<nilai>.<hmac>". */
export async function tandatangani(secret, nilai) {
  return `${nilai}.${await hmacHex(secret, nilai)}`;
}

export async function bukaTanda(secret, bertanda) {
  if (typeof bertanda !== 'string') return null;
  const pisah = bertanda.lastIndexOf('.');
  if (pisah < 1) return null;
  const nilai = bertanda.slice(0, pisah);
  const tanda = bertanda.slice(pisah + 1);
  const diharap = await hmacHex(secret, nilai);
  return samaAman(tanda, diharap) ? nilai : null;
}

/* ---------------------------- Cookie ------------------------------------ */

export function bacaCookie(request, nama) {
  const header = request.headers.get('Cookie') || '';
  for (const bagian of header.split(';')) {
    const pisah = bagian.indexOf('=');
    if (pisah < 1) continue;
    if (bagian.slice(0, pisah).trim() === nama) {
      return decodeURIComponent(bagian.slice(pisah + 1).trim());
    }
  }
  return null;
}

export function tulisCookie(nama, nilai, { maxAge, sameSite = 'Lax' } = {}) {
  let out = `${nama}=${encodeURIComponent(nilai)}; Path=/; HttpOnly; SameSite=${sameSite}; Secure`;
  if (maxAge != null) out += `; Max-Age=${maxAge}`;
  return out;
}

export function hapusCookie(nama) {
  return `${nama}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`;
}

/* ---------------------------- D1 ---------------------------------------- */

export async function ambilSetelan(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

export async function simpanSetelan(env, key, value) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  )
    .bind(key, value)
    .run();
}

export async function statusPemilihan(env) {
  return (await ambilSetelan(env, 'state')) || STATUS.BELUM;
}

/**
 * Menyiapkan baris yang seharusnya ada. Idempoten dan hanya berjalan sekali
 * per isolate, jadi tidak menambah query di setiap request.
 */
let sudahSiap = false;
export async function siapkan(env) {
  if (sudahSiap) return;
  await env.DB.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('state', ?)")
    .bind(STATUS.BELUM)
    .run();
  if (!(await ambilSetelan(env, 'pin_hash')) && env.VOTING_PIN) {
    await simpanSetelan(env, 'pin_hash', await hashPin(env.SESSION_SECRET, env.VOTING_PIN));
    await simpanSetelan(env, 'pin_diubah', String(Math.floor(Date.now() / 1000)));
  }
  if ((await ambilSetelan(env, 'pin_terbuka')) === null) {
    await simpanSetelan(env, 'pin_terbuka', '0');
  }
  sudahSiap = true;
}

/** Naikkan penghitung di `settings` tanpa balapan baca-lalu-tulis. */
export async function naikkanSetelan(env, key) {
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, 1) ON CONFLICT (key) DO UPDATE SET value = CAST(value AS INTEGER) + 1',
  )
    .bind(key)
    .run();
}

/* ---------------------- Pembukaan PIN sekali pakai ----------------------- */
/*
 * Pengganti penguncian perangkat. Petugas mengetik PIN untuk satu pemilih,
 * dan pembukaan itu hanya boleh menghasilkan satu suara. Caranya: setiap
 * login menulis satu baris di `sessions`, dan /vote mengklaim baris itu
 * dengan UPDATE ... WHERE dipakai = 0. Kalau `meta.changes` nol, berarti
 * pembukaan itu sudah dipakai — entah karena pemilih menekan tombol dua
 * kali, membuka dua tab, atau menekan tombol back lalu mengirim ulang.
 * Tidak ada identitas perangkat di mana pun.
 */

export async function buatSesi(env) {
  const nonce = randomHex(16);
  const sekarang = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO sessions (nonce, dibuat, dipakai) VALUES (?, ?, 0)')
    .bind(nonce, sekarang)
    .run();
  // Bersihkan baris lama sesekali supaya tabel tidak tumbuh selamanya.
  // Hanya baris berumur >24 jam, jadi tidak mungkin membuang sesi hidup.
  if (Math.random() < 0.05) {
    await env.DB.prepare('DELETE FROM sessions WHERE dibuat < ?').bind(sekarang - 24 * 3600).run();
  }
  return nonce;
}

/**
 * Keadaan pembukaan: 'baru' (masih boleh memilih), 'terpakai' (sudah
 * menghasilkan suara), atau 'tidak_ada' (tidak dikenal — misalnya karena
 * kotak suara sudah dikosongkan). Bedanya penting: pemilih yang sudah
 * memilih layak diantar ke tercatat.html, yang tidak dikenal cukup diminta
 * memasukkan PIN lagi, bukan diberi tahu suaranya tercatat.
 */
export async function statusSesi(env, nonce) {
  if (!nonce) return 'tidak_ada';
  const row = await env.DB.prepare('SELECT dipakai FROM sessions WHERE nonce = ?')
    .bind(nonce)
    .first();
  if (!row) return 'tidak_ada';
  return Number(row.dipakai) ? 'terpakai' : 'baru';
}

/**
 * Klaim pembukaan untuk satu suara. true hanya untuk pemanggil pertama;
 * pemanggil berikutnya dengan nonce yang sama mendapat false.
 */
export async function pakaiSesi(env, nonce) {
  if (!nonce) return false;
  const hasil = await env.DB.prepare(
    'UPDATE sessions SET dipakai = 1 WHERE nonce = ? AND dipakai = 0',
  )
    .bind(nonce)
    .run();
  return Boolean(hasil.meta.changes);
}

/** Hapus SEMUA isi kotak suara. Hanya dipakai dari panel panitia. */
export async function kosongkanKotak(env) {
  await env.DB.prepare('DELETE FROM ballots').run();
  await env.DB.prepare('DELETE FROM sessions').run();
  await simpanSetelan(env, 'pin_terbuka', '0');
}

export async function penghitunganSuara(env) {
  const hasil = Object.fromEntries(KANDIDAT.map((slug) => [slug, 0]));
  const rows = await env.DB.prepare('SELECT pilihan, COUNT(*) AS n FROM ballots GROUP BY pilihan').all();
  for (const row of rows.results || []) {
    if (row.pilihan in hasil) hasil[row.pilihan] = Number(row.n) || 0;
  }
  return hasil;
}

export async function totalSuara(env) {
  const row = await env.DB.prepare('SELECT COUNT(*) AS n FROM ballots').first();
  return Number(row?.n) || 0;
}

/* ------------------------ Pembatasan percobaan --------------------------- */

export function ipPengunjung(request) {
  return request.headers.get('CF-Connecting-IP') || 'lokal';
}

export async function kenaBatas(env, ip, kind, batas, jendelaDetik) {
  const sejak = Math.floor(Date.now() / 1000) - jendelaDetik;
  const row = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM attempts WHERE ip = ? AND kind = ? AND ts > ?',
  )
    .bind(ip, kind, sejak)
    .first();
  return (Number(row?.n) || 0) >= batas;
}

export async function catatPercobaan(env, ip, kind) {
  const sekarang = Math.floor(Date.now() / 1000);
  await env.DB.prepare('INSERT INTO attempts (ip, kind, ts) VALUES (?, ?, ?)')
    .bind(ip, kind, sekarang)
    .run();
  // Bersihkan baris lama sesekali supaya tabel tidak tumbuh selamanya.
  if (Math.random() < 0.05) {
    await env.DB.prepare('DELETE FROM attempts WHERE ts < ?').bind(sekarang - 24 * 3600).run();
  }
}

/* ---------------------------- Format ------------------------------------ */

export function formatPersen(bagian, total) {
  if (!total) return '0.00%';
  return `${((bagian / total) * 100).toFixed(2)}%`;
}

export function formatWaktu(unix) {
  if (!unix) return '–';
  const d = new Date((unix + 7 * 3600) * 1000); // WIB, tanpa DST
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())} WIB`;
}

export function labelStatus(state) {
  if (state === STATUS.BUKA) return 'Sedang dibuka';
  if (state === STATUS.TUTUP) return 'Sudah ditutup';
  return 'Belum dibuka';
}

/** Escape teks yang disisipkan ke HTML (PIN baru, pesan, dst.). */
export function aman(teks) {
  return String(teks).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
