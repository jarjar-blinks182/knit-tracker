# Knit Tracker

A small knitting and crochet row counter. It installs as an app on iPhone, iPad
and Android (PWA) and also works in any browser. Projects are saved on the
device first, so it works offline; with sync turned on they follow you between
devices.

## Features

- Multiple projects, each with a row count, optional target rows (progress bar)
  and optional rows-per-repeat ("3 / 8 into repeat 2")
- Big tap area to add a row, −1 to undo, reset
- Optional pattern setup: sections (e.g. increases, middle, decreases), each a
  block of rows repeated N times with stitch increases/decreases on given rows.
  The counter then shows the section, repeat, row in the repeat, RS or WS, the
  stitches on the needle and what this row changes. Sizes like `14 (21)` work.
- Paste a pattern as JSON instead of typing it in (see below), with a check
  against the stitch counts the pattern states
- Notes per project
- Keeps the screen awake while a counter is open (where the browser supports it)
- Works offline; download/restore a JSON backup
- Yarn (brand, yarn, color, weight), needle or hook size and pattern per project
- Mark projects finished; stats page with stitches worked, rows, and projects
  finished (all time and this year)
- Optional sync between devices via Firebase (free plan), email and password sign in

## Files

No build step: plain HTML, CSS and JavaScript modules.

| File | What it does |
| --- | --- |
| `index.html`, `style.css`, `app.js` | The app UI |
| `store.js` | Local storage of projects (localStorage), tracks unsynced changes |
| `pattern.js` | Pattern sections: position, stitch counts, checks |
| `sync.js` | Firebase sync and sign in |
| `vendor/firebase/` | Firebase JS SDK 12.19.0, served with the app |
| `config.js` | Firebase web config (null = this device only) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and install-to-home-screen |
| `firestore.rules` | Security rules: each person sees only their own projects |

## Run locally

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

## Turn on sync (Firebase, free Spark plan)

1. Go to console.firebase.google.com and **Add project** (for example
   "knit-tracker"). Google Analytics isn't needed.
2. **Build → Authentication → Get started → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (production mode, any
   location near you). On the **Rules** tab, paste `firestore.rules` and
   **Publish**.
4. **Project settings → General → Your apps → Web (</>)**, register an app
   (no hosting needed), and copy the `firebaseConfig` values into `config.js`.
5. **Authentication → Settings → Authorized domains**: add the site's domain,
   e.g. `jarjar-blinks182.github.io`.
6. Open the app, tap the dot in the top-right corner, and create an account.
   Sign in with the same email and password on your other devices.

Each person who signs in has their own separate set of projects. The free plan
doesn't pause and its limits are far above what a row counter uses.

## Hosting

Any static host works (GitHub Pages, Netlify, Cloudflare Pages). It must be
served over HTTPS for install and offline support. When you change app files,
bump `VERSION` in `sw.js` so installed copies pick up the update.

## How sync works

Every change is saved locally and marked unsynced. When signed in, the app
pulls newer changes when it opens or comes back to the foreground, then pushes
its own unsynced projects; it also pushes shortly after a change and when it
goes to the background. If the same project was changed on two devices, the
most recent change wins, and the rules refuse an older copy overwriting a newer
one.

## Stitch counts

With a pattern, each row counts the stitches on the needle after that row
(so increases and decreases are included). Projects without a pattern count
`rows × stitches per row` if you set stitches per row under Edit project.

## Turning a PDF pattern into JSON (free)

Open the project, tap **Set up pattern**, and either fill in the sections by
hand or paste JSON. To get the JSON, attach the PDF to any Claude chat (the
free plan works) with this prompt, then paste the reply into **Paste pattern
JSON**:

```text
Read the attached knitting/crochet pattern and turn its row structure into JSON
for my row counter. Reply with only the JSON, in this shape:

{
  "name": "Pattern name",
  "sizes": ["S", "M"],
  "firstRowSide": "RS",
  "castOn": 4,
  "sections": [
    { "name": "Increases", "rowsPerRepeat": 8, "repeats": [14, 21],
      "stitchChanges": { "1": 1, "3": 1, "5": 1 },
      "expectedEnd": [51, 72], "note": "" }
  ]
}

Rules:
- Sections are worked in order. A section is a block of rowsPerRepeat rows,
  worked "repeats" times in total. "Repeat a further 13 times" after working it
  once means 14 repeats.
- A part of the pattern that isn't a clean repeat (like a set-up section with
  increases on rows 3, 5, 9, 11, 13) is one section with repeats 1.
- stitchChanges maps a row number within one repeat to the stitches gained (+)
  or lost (-) on that row. Leave out rows with no change.
- Where the pattern gives values by size like "14 (21)", use an array with one
  entry per size, in the same order as "sizes". Leave "sizes" empty if there's
  only one size, and use plain numbers.
- expectedEnd is the stitch count the pattern says you should have at the end
  of the section, if it says. Leave it out otherwise.
- firstRowSide is whether row 1 of the first section is RS or WS.
- Put short reminders (like "then cast off") in "note".
- Check your numbers: castOn plus all the changes should match each
  expectedEnd. If they don't, re-read the pattern.
```

The setup page shows a check table; a highlighted row means the stitch math
doesn't match the count the pattern states, so look at that section.
