/* ==========================================================================
   Pemilihan GENESIS STEI-K '26 — Worker
   Alur: index.html (PIN dari petugas) -> POST /sesi -> pilih.html
         -> POST /vote -> tercatat.html ; rekap.html + /admin (panitia)
   Semua halaman tetap berkas HTML/CSS asli di root repo; Worker mengambil
   isinya lewat binding ASSETS lalu menyisipkan data (lihat src/views.js).
   Tidak ada JavaScript di sisi pengunjung sama sekali — pengiriman suara
   memakai form POST biasa.
   ========================================================================== */

import {
  BATAS_SUARA,
  COOKIE_PANITIA,
  COOKIE_SESI,
  KANDIDAT,
  STATUS,
  UMUR_PANITIA,
  UMUR_SESI,
  ambilSetelan,
  bacaCookie,
  buatSesi,
  bukaTanda,
  catatPercobaan,
  hapusCookie,
  hashPin,
  ipPengunjung,
  kenaBatas,
  kosongkanKotak,
  naikkanSetelan,
  pakaiSesi,
  penghitunganSuara,
  samaAman,
  siapkan,
  simpanSetelan,
  statusPemilihan,
  statusSesi,
  tandatangani,
  totalSuara,
  tulisCookie,
} from './lib.js';
import {
  viewAdminKosongkan,
  viewAdminLogin,
  viewAdminPanel,
  viewLogin,
  viewPilih,
  viewRekap,
} from './views.js';

const PESAN_PIN = {
  pin: 'PIN salah. Minta petugas memasukkan PIN yang benar.',
  sesi: 'Pembukaan PIN sudah berakhir. Minta petugas memasukkan PIN lagi.',
  tutup: 'Pemilihan sedang tidak dibuka.',
  limit: 'Terlalu banyak percobaan dari jaringan ini. Tunggu beberapa menit.',
  himpit: 'Kotak suara penuh. Hubungi panitia.',
};

const PESAN_PANITIA = {
  buka: 'Pemilihan dibuka. Kartu suara siap dipakai.',
  tutup: 'Pemilihan ditutup. Halaman rekapitulasi sekarang menampilkan hasil.',
  pin: 'PIN petugas diperbarui.',
  kosong: 'Kotak suara dikosongkan dan hitungan PIN dikembalikan ke nol.',
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = rapikanPath(url.pathname);
    const method = request.method;

    try {
      if (path === '/admin' || path.startsWith('/admin/')) {
        return await jalurPanitia(request, env, url, path, method);
      }
      // admin.html adalah kerangka berisi penanda {{...}}; jangan disajikan apa adanya.
      if (path === '/admin.html') return redirect(url, '/admin');

      if (path === '/sesi' && method === 'POST') return await masuk(request, env, url);
      if (path === '/vote' && method === 'POST') return await kirimSuara(request, env, url);
      if (path === '/keluar') return redirect(url, '/');

      if (method !== 'GET' && method !== 'HEAD') {
        return new Response('Metode tidak didukung', { status: 405, headers: { Allow: 'GET' } });
      }

      await siapkan(env);

      if (path === '/' || path === '/index.html') return await halamanLogin(request, env, url);
      if (path === '/pilih.html') return await halamanPilih(request, env, url);
      if (path === '/tercatat.html') return await aset(request, env, '/tercatat.html');
      if (path === '/rekap.html') return await halamanRekap(request, env, url);

      return await aset(request, env, path);
    } catch (err) {
      return new Response(`Kesalahan server: ${err?.message ?? err}`, {
        status: 500,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  },
};

/* ---------------------------- Utilitas ---------------------------------- */

/** Buang garis miring di ujung: "/pilih.html/" -> "/pilih.html". */
function rapikanPath(pathname) {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.replace(/\/+$/, '') || '/';
  return pathname;
}

function redirect(url, tujuan, cookies = []) {
  const headers = new Headers({ Location: new URL(tujuan, url.origin).toString() });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(null, { status: 303, headers });
}

/** Ambil berkas statis lewat binding ASSETS, tanpa lewat Worker lagi. */
function aset(request, env, path) {
  return env.ASSETS.fetch(new URL(path, request.url));
}

async function htmlAset(env, request, path) {
  const res = await env.ASSETS.fetch(new URL(path, request.url));
  if (!res.ok) throw new Error(`Aset ${path} tidak ditemukan (${res.status})`);
  return res.text();
}

function kirimHtml(isi, cookies = []) {
  const headers = new Headers({
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return new Response(isi, { status: 200, headers });
}

/**
 * Baca pembukaan PIN dari cookie sesi. Cookie hanya berisi
 * "sesi:<nonce>:<kedaluwarsa>" yang ditandatangani — tanpa identitas pemilih
 * dan tanpa id perangkat. Mengembalikan {nonce} atau null.
 */
async function sesiDariRequest(request, env) {
  const bertanda = bacaCookie(request, COOKIE_SESI);
  if (!bertanda) return null;
  const nilai = await bukaTanda(env.SESSION_SECRET, bertanda);
  if (!nilai) return null;
  const bagian = nilai.split(':');
  if (bagian.length !== 3 || bagian[0] !== 'sesi') return null;
  const nonce = bagian[1];
  const kedaluwarsa = Number(bagian[2]);
  if (!nonce || !kedaluwarsa || kedaluwarsa < Date.now()) return null;
  return { nonce };
}

/* ------------------------------- Halaman -------------------------------- */

async function halamanLogin(request, env, url) {
  const state = await statusPemilihan(env);
  const html = await htmlAset(env, request, '/index.html');
  const error = state === STATUS.BUKA ? PESAN_PIN[url.searchParams.get('e')] : null;
  return kirimHtml(viewLogin(html, { state, error }));
}

async function halamanPilih(request, env, url) {
  const state = await statusPemilihan(env);
  if (state !== STATUS.BUKA) return redirect(url, '/?e=tutup');

  const sesi = await sesiDariRequest(request, env);
  if (!sesi) return redirect(url, '/?e=sesi');
  // Pembukaan yang sudah terpakai berarti pemilih ini sudah memberi suara;
  // pembukaan yang tidak dikenal cukup meminta PIN lagi.
  const keadaan = await statusSesi(env, sesi.nonce);
  if (keadaan === 'terpakai') return redirect(url, '/tercatat.html');
  if (keadaan !== 'baru') return redirect(url, '/?e=sesi');

  const html = await htmlAset(env, request, '/pilih.html');
  return kirimHtml(viewPilih(html));
}

async function halamanRekap(request, env, url) {
  const state = await statusPemilihan(env);
  const html = await htmlAset(env, request, '/rekap.html');
  // Hasil hanya muncul setelah panitia menutup pemilihan.
  const hasil = state === STATUS.TUTUP ? await penghitunganSuara(env) : null;
  return kirimHtml(viewRekap(html, hasil));
}

/* ------------------------------- Aksi ----------------------------------- */

async function masuk(request, env, url) {
  await siapkan(env);
  if ((await statusPemilihan(env)) !== STATUS.BUKA) return redirect(url, '/?e=tutup');

  const ip = ipPengunjung(request);
  if (await kenaBatas(env, ip, 'pin', 15, 600)) return redirect(url, '/?e=limit');

  const form = await request.formData();
  const pin = String(form.get('pin') || '');
  const hash = await ambilSetelan(env, 'pin_hash');
  const cocok =
    Boolean(hash) && /^\d{6}$/.test(pin) && samaAman(await hashPin(env.SESSION_SECRET, pin), hash);

  if (!cocok) {
    await catatPercobaan(env, ip, 'pin');
    return redirect(url, '/?e=pin');
  }

  // Satu ketikan PIN yang benar = satu pembukaan = paling banyak satu suara.
  const nonce = await buatSesi(env);
  await naikkanSetelan(env, 'pin_terbuka');
  const sesi = await tandatangani(
    env.SESSION_SECRET,
    `sesi:${nonce}:${Date.now() + UMUR_SESI * 1000}`,
  );

  return redirect(url, '/pilih.html', [tulisCookie(COOKIE_SESI, sesi, { maxAge: UMUR_SESI })]);
}

async function kirimSuara(request, env, url) {
  await siapkan(env);
  if ((await statusPemilihan(env)) !== STATUS.BUKA) return redirect(url, '/?e=tutup');

  const sesi = await sesiDariRequest(request, env);
  if (!sesi) return redirect(url, '/?e=sesi');

  const ip = ipPengunjung(request);
  if (await kenaBatas(env, ip, 'vote', 40, 600)) return redirect(url, '/?e=limit');

  const form = await request.formData();
  const pilihan = String(form.get('pilihan') || '');

  // Pilihan divalidasi SEBELUM pembukaan diklaim, supaya kiriman cacat tidak
  // menghanguskan jatah pemilih yang sedang berdiri di depan petugas.
  if (!KANDIDAT.includes(pilihan)) {
    await catatPercobaan(env, ip, 'vote');
    return redirect(url, '/pilih.html');
  }

  // Klaim atomik. Kalau gagal, pembukaan ini sudah menghasilkan suara: entah
  // tombol ditekan dua kali, dua tab dibuka bersamaan, atau halaman dikirim
  // ulang lewat tombol back. Tidak ada suara kedua yang dicatat.
  if (!(await pakaiSesi(env, sesi.nonce))) {
    const keadaan = await statusSesi(env, sesi.nonce);
    return redirect(url, keadaan === 'terpakai' ? '/tercatat.html' : '/?e=sesi');
  }

  if ((await totalSuara(env)) >= BATAS_SUARA) return redirect(url, '/?e=himpit');

  await env.DB.prepare('INSERT INTO ballots (pilihan, created_at) VALUES (?, ?)')
    .bind(pilihan, Math.floor(Date.now() / 1000))
    .run();

  // Cookie dibuang supaya layar kembali ke halaman PIN: pemilih berikutnya
  // harus dibuka petugas lagi, seperti menerima kertas suara baru.
  return redirect(url, '/tercatat.html', [hapusCookie(COOKIE_SESI)]);
}

/* ------------------------------ Panitia --------------------------------- */

async function jalurPanitia(request, env, url, path, method) {
  await siapkan(env);

  if (path === '/admin/masuk' && method === 'POST') return await panitiaMasuk(request, env, url);
  if (path === '/admin/keluar' && method === 'POST') {
    return redirect(url, '/admin', [hapusCookie(COOKIE_PANITIA)]);
  }

  if (!(await panitiaTerverifikasi(request, env))) {
    if (path !== '/admin') return redirect(url, '/admin');
    const html = await htmlAset(env, request, '/admin.html');
    const pesan = url.searchParams.get('e') === 'sandi' ? 'Kata sandi salah.' : null;
    return kirimHtml(sisipkan(html, { ISI: viewAdminLogin({ pesan }), REFRESH: '' }));
  }

  if (method === 'POST') {
    if (path === '/admin/status') return await panitiaStatus(request, env, url);
    if (path === '/admin/pin') return await panitiaGantiPin(request, env, url);
    if (path === '/admin/kosongkan') return await panitiaKosongkan(request, env, url);
    return new Response('Aksi tidak dikenal', { status: 404 });
  }

  const state = await statusPemilihan(env);
  const total = await totalSuara(env);
  const pinDiubah = Number(await ambilSetelan(env, 'pin_diubah')) || null;
  const pinTerbuka = Number(await ambilSetelan(env, 'pin_terbuka')) || 0;
  const pinBaru = url.searchParams.get('pin');
  const flash = url.searchParams.get('ok');
  const html = await htmlAset(env, request, '/admin.html');

  // Halaman konfirmasi sebelum kotak suara dikosongkan. Tanpa JavaScript,
  // jadi langkah keduanya adalah halaman terpisah.
  if (path === '/admin/kosongkan') {
    return kirimHtml(
      sisipkan(html, {
        ISI: viewAdminKosongkan({ total, pinTerbuka }),
        REFRESH: '',
      }),
    );
  }

  if (path !== '/admin') return redirect(url, '/admin');

  const isi = viewAdminPanel({
    state,
    hasil: await penghitunganSuara(env),
    total,
    pinDiubah,
    pinTerbuka,
    pesan: flash ? PESAN_PANITIA[flash] || null : null,
    pinBaru: /^\d{6}$/.test(pinBaru || '') ? pinBaru : null,
  });

  // Muat ulang otomatis dimatikan saat ada pesan sekali-tampil.
  const perluSegar = !flash && !pinBaru;
  return kirimHtml(
    sisipkan(html, {
      ISI: isi,
      REFRESH: perluSegar ? '<meta http-equiv="refresh" content="30">' : '',
    }),
  );
}

async function panitiaTerverifikasi(request, env) {
  const bertanda = bacaCookie(request, COOKIE_PANITIA);
  if (!bertanda) return false;
  const nilai = await bukaTanda(env.SESSION_SECRET, bertanda);
  if (!nilai) return false;
  const kedaluwarsa = Number(nilai.split(':')[1]);
  return Boolean(kedaluwarsa) && kedaluwarsa > Date.now();
}

async function panitiaMasuk(request, env, url) {
  const ip = ipPengunjung(request);
  if (await kenaBatas(env, ip, 'admin', 20, 900)) return redirect(url, '/admin');

  const form = await request.formData();
  const sandi = String(form.get('sandi') || '');
  const benar = Boolean(env.ADMIN_PASSWORD) && samaAman(sandi, env.ADMIN_PASSWORD);
  if (!benar) {
    await catatPercobaan(env, ip, 'admin');
    return redirect(url, '/admin?e=sandi');
  }

  const sesi = await tandatangani(env.SESSION_SECRET, `panitia:${Date.now() + UMUR_PANITIA * 1000}`);
  return redirect(url, '/admin', [tulisCookie(COOKIE_PANITIA, sesi, { maxAge: UMUR_PANITIA })]);
}

async function panitiaStatus(request, env, url) {
  const form = await request.formData();
  const diminta = String(form.get('state') || '');
  if (![STATUS.BELUM, STATUS.BUKA, STATUS.TUTUP].includes(diminta)) return redirect(url, '/admin');

  await simpanSetelan(env, 'state', diminta);
  return redirect(url, `/admin?ok=${diminta === STATUS.TUTUP ? 'tutup' : 'buka'}`);
}

async function panitiaGantiPin(request, env, url) {
  const form = await request.formData();
  const diminta = String(form.get('pin') || '').trim();
  const pin = /^\d{6}$/.test(diminta) ? diminta : String(Math.floor(100000 + Math.random() * 900000));

  await simpanSetelan(env, 'pin_hash', await hashPin(env.SESSION_SECRET, pin));
  await simpanSetelan(env, 'pin_diubah', String(Math.floor(Date.now() / 1000)));
  // PIN baru = hitungan paparan mulai dari nol lagi.
  await simpanSetelan(env, 'pin_terbuka', '0');
  // PIN dibawa lewat query sekali saja, untuk ditampilkan di layar panitia.
  return redirect(url, `/admin?pin=${pin}`);
}

/**
 * Kosongkan kotak suara. Dua langkah: GET menampilkan halaman konfirmasi,
 * POST menghapus. Server tetap memeriksa kata konfirmasi, jadi tidak bisa
 * terpicu oleh tautan nyasar.
 */
async function panitiaKosongkan(request, env, url) {
  const form = await request.formData();
  if (String(form.get('konfirmasi') || '').trim().toUpperCase() !== 'KOSONG') {
    return redirect(url, '/admin/kosongkan');
  }
  await kosongkanKotak(env);
  return redirect(url, '/admin?ok=kosong');
}

/** Tukar penanda {{NAMA}} di admin.html dengan isi yang sudah jadi. */
function sisipkan(html, nilai) {
  let out = html;
  for (const [kunci, isi] of Object.entries(nilai)) {
    const penanda = `{{${kunci}}}`;
    // Penanda yang muncul lebih dari sekali berarti ada salinan di komentar
    // atau tempat lain yang akan menggandakan isi — lebih baik gagal jelas.
    const jumlah = out.split(penanda).length - 1;
    if (kunci === 'ISI' && jumlah !== 1) {
      throw new Error(`Penanda ${penanda} muncul ${jumlah} kali di admin.html, harus tepat 1`);
    }
    out = out.replaceAll(penanda, isi);
  }
  return out;
}
