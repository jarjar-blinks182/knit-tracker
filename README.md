# Knit Tracker

A small knitting and crochet row counter. It installs as an app on iPhone, iPad
and Android (PWA) and also works in any browser. Projects are saved on the
device first, so it works offline; with sync turned on they follow you between
devices.

## Features

- Multiple projects, each with a row count, optional target rows (progress bar)
  and optional rows-per-repeat ("3 / 8 into repeat 2")
- Big tap area to add a row, −1 to undo, reset
- Optional second counter per project (stitches or repeats within a row), with its
  own name; it can clear itself each time you add a row
- **Pattern library** (Patterns, on the project list): every pattern you paste
  or set up is saved there, and a new project can start from one. Rename,
  delete, copy a pattern's JSON to share it, paste JSON straight into the
  library, or add the patterns from your existing projects. Synced like
  projects (`users/{uid}/patterns`), so it's private to your account.
- **Make again**: start a fresh copy of a project (same pattern and size, count at 0, yarn blank, needle size from the pattern), handy for remaking with different yarn
- Optional pattern setup: sections (e.g. increases, middle, decreases), each a
  block of rows repeated N times with stitch increases/decreases on given rows.
  The counter then shows the section, repeat, row in the repeat, RS or WS, the
  stitches on the needle and what this row changes. Sizes like `14 (21)` work;
  pick the size you're making on the setup page.
- Optional per-row instructions: the counter shows what to do on the current
  row, with increases (M1R, kfb, yo…) in green and decreases (k2tog, ssk…) in red.
- Knitting in the round (rounds, no RS/WS) and "knit until 11 cm" sections:
  the counter keeps counting and you tap "Reached it" to move to the next
  section. Undoing back past that point reopens the section.
- Garments made in pieces, like a sweater: a section can start a new piece
  with its own stitch count (picked up, cast on or joined) and its own first
  side (RS or WS), mix flat and in-the-round parts, and have a repeat length
  that differs by size ("decrease every 14th (12th) round").
- Paste a pattern as JSON instead of typing it in (see below), with a check
  against the stitch counts the pattern states. When creating a project, the
  needle size fills in from the JSON; yarn is typed in on the same screen.
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
| `library.js` | Pattern library, stored and synced the same way as projects |
| `pattern.js` | Pattern sections: position, stitch counts, checks |
| `sync.js` | Firebase sync and sign in |
| `vendor/firebase/` | Firebase JS SDK 12.19.0, served with the app |
| `config.js` | Firebase web config (null = this device only) |
| `sw.js`, `manifest.webmanifest`, `icons/` | Offline support and install-to-home-screen |
| `firestore.rules` | Security rules: each person sees only their own projects and patterns |

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
  "needle": "4 mm (US 6) circular, 40 cm",
  "sizes": ["S", "M"],
  "firstRowSide": "RS",
  "inTheRound": false,
  "castOn": [87, 99],
  "sections": [
    { "name": "Increases", "rowsPerRepeat": 8, "repeats": [14, 21],
      "stitchChanges": { "1": 1, "3": 1, "5": 1 },
      "expectedEnd": [51, 72], "note": "",
      "instructions": { "1": "k to marker, M1R, pm, k", "2": "p to end" } },
    { "name": "Body", "rowsPerRepeat": 1, "untilLength": "11 cm (4.5 in)",
      "estimate": 35, "instructions": { "*": "Knit every round." } }
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
- firstRowSide is whether row 1 of the first section is RS or WS. Set
  "inTheRound": true for patterns knit in rounds (no RS/WS).
- When a section says "repeat until it measures X", use "untilLength" with the
  length as written (one string, or one per size) instead of "repeats". If the
  pattern gives a row gauge, put an approximate row count in "estimate".
- Stitch changes that differ by size go in an array too, e.g. "1": [3, 1] for
  "3 (1) increases". castOn can be a number or one per size.
- "instructions" maps a row number within one repeat to what the pattern says
  to do on that row, copied as written (expand "work as row 1" into the actual
  text). Use "*" for the instruction that applies to every other row of the
  section. Text that differs by size is an array, one entry per size.
- "needle" is the needle or hook size the pattern recommends, as one short
  line (size, US size if given, and cable length or type). Leave it out if the
  pattern doesn't say.
- Put short reminders (like "then cast off") in "note".
- For a pattern made in pieces (back, shoulders, sleeves, neck), list every
  piece's sections in the order you knit them, repeating a section for
  "work the other sleeve the same". When a piece starts with stitches picked
  up, cast on or joined (like "pick up 64 sts" or "join front and back: 172
  sts"), put the stitch count it starts with in "startStitches" on its first
  section, counting every stitch on the needle at that point. Give that
  section "firstRowSide" too when the piece is worked flat, and
  "inTheRound": true or false on any section that differs from the rest.
- rowsPerRepeat can differ by size too, e.g. [14, 12] for "every 14th (12th)
  round". Use "last" as the row number for "on the last row of the repeat",
  in stitchChanges and instructions.
- "repeats" can be 0 for a part some sizes skip ("another 0 (1) times").
- Check your numbers: castOn plus all the changes should match each
  expectedEnd. If they don't, re-read the pattern.
```

The setup page shows a check table; a highlighted row means the stitch math
doesn't match the count the pattern states, so look at that section.
