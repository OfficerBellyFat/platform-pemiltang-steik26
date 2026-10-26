-- Pemilihan GENESIS STEI-K '26 — skema awal.
-- Terapkan dengan: npx wrangler d1 migrations apply pemiltang --local|--remote

-- Pengaturan tunggal pemilihan: state, pin_hash, pin_diubah, pin_terbuka.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Kandidat. Dua baris awal dibuat di bawah; menambah kandidat berarti
-- menambah baris di sini DAN menambah kartu di pilih.html/rekap.html.
CREATE TABLE IF NOT EXISTS candidates (
  slug   TEXT PRIMARY KEY,
  nama   TEXT NOT NULL,
  urutan INTEGER NOT NULL
);

-- Kotak suara. Sengaja TIDAK menyimpan id perangkat, NIM, atau siapa pun.
-- Inilah satu-satunya catatan pemilihan: tidak ada tabel kedua yang bisa
-- di-join untuk menebak siapa memilih apa.
CREATE TABLE IF NOT EXISTS ballots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  pilihan    TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Satu baris per pembukaan PIN. `dipakai` menandai apakah pembukaan itu
-- sudah menghasilkan suara. Inilah pengganti penguncian perangkat: satu
-- ketikan PIN yang benar hanya boleh menghasilkan SATU suara, sama seperti
-- petugas menyerahkan satu kertas suara — bukan satu perangkat.
-- Tabel ini tidak menyimpan siapa pun; barisnya dibuang otomatis setelah
-- sehari (lihat src/lib.js, buatSesi).
CREATE TABLE IF NOT EXISTS sessions (
  nonce  TEXT PRIMARY KEY,
  dibuat INTEGER NOT NULL,
  dipakai INTEGER NOT NULL DEFAULT 0
);

-- Penghitung percobaan (anti brute-force PIN dan anti-flood kiriman cacat).
CREATE TABLE IF NOT EXISTS attempts (
  ip   TEXT NOT NULL,
  kind TEXT NOT NULL,
  ts   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempts ON attempts (ip, kind, ts);
CREATE INDEX IF NOT EXISTS idx_ballots_pilihan ON ballots (pilihan);

INSERT OR IGNORE INTO candidates (slug, nama, urutan) VALUES
  ('cheryl-viby', 'Cheryl Viby', 1),
  ('muchsin-edo', 'Muchsin Edo', 2);

-- 'belum' = belum dibuka, 'buka' = sedang berjalan, 'tutup' = selesai + hasil tampil.
INSERT OR IGNORE INTO settings (key, value) VALUES ('state', 'belum');
