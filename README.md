# GENESIS STEI-K '26 Voting Platform

A voting application for GENESIS STEI-K '26, built from the "Web-pemiltang" Figma design.
The pages stay as hand-written HTML + CSS (no framework, no build step); the story behind
the scenes lives in a single Cloudflare Worker backed by a D1 database.

## Pages

| Order | File | Contents |
| --- | --- | --- |
| 1 | `index.html` | Login with a 6-digit PIN from the officials, plus a "View Recap" button |
| 2 | `pilih.html` | "Choose your GENESIS!" + confirmation pop-up |
| 3 | `tercatat.html` | "Your vote has been recorded!" |
| 4 | `rekap.html` | Vote recapitulation — marked "–" until the election closes |
| — | `admin.html` | Officials' panel: open/close the election, change the PIN, empty the ballot box |

Those pages **do not change** while running. The Worker fetches them through the
`ASSETS` binding, then `src/views.js` only swaps out the parts that were previously
dead: the login form gets `name="pin"` and points to `POST /sesi`, the "I'm sure"
button becomes a `POST /vote` form, and the `.tally` numbers in `rekap.html` are
filled with actual results. Because of this, `python3 -m http.server` can still be
used to view the static look.

Visitor-side JavaScript: **none at all.** Vote submission uses plain form POSTs and
plain page redirects (post/redirect/get).

## Flow

Voting happens on-site, on several officials' laptops — like voting booths, but
digital. What enforces one-person-one-vote is the official in front of the screen,
not the system.

1. Officials open `/admin` and press **Open election**. Before that, the login
   page shows "The election has not opened yet".
2. The laptop rests on `index.html`. The official types the 6-digit PIN for the
   voter standing in front of them; `POST /sesi` verifies the PIN on the server.
3. The voter picks a card and presses "I'm sure" in the pop-up. `POST /vote`
   records a single row in the `ballots` table.
4. **One PIN entry = one vote.** Once the vote is in, the session cookie is
   discarded and the laptop returns to the PIN page for the next person.
5. Officials press **Close election**. From then on, `rekap.html` shows
   percentages and vote counts; before that it stays marked "–".

## Data model (and what is not stored)

| Table | Contents |
| --- | --- |
| `settings` | `state` (`belum`/`buka`/`tutup`), `pin_hash`, `pin_diubah`, `pin_terbuka` |
| `candidates` | slug + candidate name |
| `ballots` | `id`, `pilihan`, `created_at` — **no** voter identity |
| `sessions` | `nonce`, `dibuat`, `dipakai` — single-use PIN redemption |
| `attempts` | per-IP attempt counter (anti brute-force) |

There is no student ID (NIM), name, phone number, or device ID anywhere. `ballots`
is the only record of the election, and there is no second table that can be
joined with it to guess who voted for what. This is intentional: per the decision
made, one-person-one-vote validity is maintained by officials on-site.

`sessions` stands in for device locking. Every login writes one row, and `/vote`
claims that row via `UPDATE ... WHERE dipakai = 0`. If no row changed, that
redemption has already produced a vote — whether the button was pressed twice,
two tabs were opened at once, or the page was resubmitted via the back button.
The second vote is never recorded. Rows are discarded automatically after a day
and store nothing about who redeemed the PIN.

Because there is no device locking, **the PIN is the only key**. What limits
abuse: the PIN is only compared on the server, `pin_terbuka` in the panel counts
how many ballots have been opened by the currently active PIN (so you know when
to rotate it), there's a per-IP attempt limit, and there's `BATAS_SUARA` in
`src/lib.js` as a final fence.

## Running locally

```bash
npm install
cp .dev.vars.example .dev.vars     # fill in ADMIN_PASSWORD, SESSION_SECRET, VOTING_PIN
npm run db:migrate:local
npm run dev                        # http://localhost:8787
```

`npm run db:reset:local` empties the local database and re-runs migrations.

There is an end-to-end flow test suite (63 checks: login, one-redemption-one-vote
including resubmission and two tabs, withheld results, the officials' panel,
PIN change, emptying the ballot box):

```bash
npm run db:reset:local   # these tests mutate data, so start from a clean slate
npm test                 # requires `npm run dev` running in another terminal
```

## Deploying

```bash
npx wrangler login
npx wrangler d1 create pemiltang            # copy the database_id into wrangler.jsonc
npm run db:migrate                          # apply the schema to production D1
npx wrangler secret put ADMIN_PASSWORD      # officials' panel password
npx wrangler secret put SESSION_SECRET      # openssl rand -hex 32
npx wrangler secret put VOTING_PIN          # initial PIN; can be changed from the panel
npm run deploy
```

The result runs at `https://platform-pemiltang-steik26.<subdomain>.workers.dev`.

### Optional hardening for `/admin`

The officials' panel is already password-protected, but it can also be locked at
the Cloudflare layer so `/admin` cannot be reached from the internet at all:
Cloudflare Zero Trust → Access → Applications → Self-hosted, path
`platform-pemiltang-steik26.<subdomain>.workers.dev/admin*`, policy
"emails = list of officials' emails". Free for up to 50 users.

## Operational notes

- **Rotate the PIN every block.** This is the only thing that genuinely holds back
  off-site ballot stuffing, because the PIN is shared and there is no device
  locking. The panel shows how many ballots have been opened by the active PIN
  and suggests rotating after 25 — that number can be lowered by changing the
  threshold in `src/views.js` if the queue is busy.
- **One voter, one PIN entry.** Don't leave a laptop open for several people at
  once: the next voter's slot was actually already consumed by the previous
  person (one redemption = one vote), so whoever holds that laptop could use it.
- **Empty the ballot box** before the actual election to discard practice data.
  Two steps: `/admin/kosongkan` then type `KOSONG`. This deletes all `ballots`,
  closes all still-live `sessions`, and resets the PIN count. **Change the PIN
  afterwards too.**
- **Results are never displayed while the election is running**, except at
  `/admin`.
- **`SESSION_SECRET` is bound to `pin_hash`.** Replacing it invalidates the old
  PIN — afterwards, set a new PIN from the panel.
- `ballots` only has `created_at`. Anyone who can see the record of the order
  people arrived in (for example an official who remembers who voted when) can
  compare it against those timestamps. This is a consequence of the
  trusted-official model: what the system protects is *what* was chosen, not
  full anonymity of *when* someone voted.
- Pages are marked `noindex`.

## Structure

```
index.html pilih.html tercatat.html rekap.html admin.html    views (original source)
css/style.css                                                styles + panel additions
assets/ fonts/                                               local images and fonts
src/worker.js                                                router + business rules
src/views.js                                                 data injection into HTML
src/lib.js                                                   crypto, cookies, D1, formatting
tests/alur.mjs                                               end-to-end flow tests
migrations/0001_init.sql                                     initial schema
wrangler.jsonc package.json .assetsignore                    configuration
```

## Things that don't have destinations yet

The "Home" link in the header (`href="#"`), "Panitia", and the footer links
(Accessibility, Privacy, Need help?) are still plain text because the Figma
design doesn't have destinations for them yet. Fill them in once addresses exist.
