# Flat Ledger — Android Dev Setup

One-time setup for building and running Flat Ledger as a native Android app.

## 1. Install Android Studio

Download from https://developer.android.com/studio and install it. During
setup, let it install the Android SDK and an emulator image (any recent API
level, e.g. API 34) when prompted.

## 2. Install project dependencies

From the repo root:

```bash
npm install
```

## 3. Build the web bundle and sync it into the Android project

```bash
npm run sync
```

This runs esbuild to produce `www/dist/bundle.js`, then copies everything in
`www/` into the native Android project under `android/`.

Run this any time you change files in `src/`, `www/index.html`, or
`www/styles.css` — the Android project only picks up changes after a sync.

## 4. Open and run in Android Studio

```bash
npx cap open android
```

This opens the `android/` folder as an Android Studio project. From there:

- **Emulator:** use the device dropdown in the toolbar to create/select a
  virtual device, then press the green Run (▶) button.
- **Physical phone:** enable Developer Options (Settings → About phone → tap
  "Build number" 7 times), then enable USB debugging inside Developer
  Options. Connect the phone via USB, accept the debugging prompt on the
  phone, and it will appear in the device dropdown.

## Day-to-day loop

1. Edit files in `src/` (or `www/index.html` / `www/styles.css`).
2. `npm run sync`
3. Run again from Android Studio (or use its "Apply Changes" button for
   small JS-only changes, though a full re-run is more reliable).

## Notes

- The SQLite database lives inside the app's private storage — it survives
  app restarts and phone reboots, but is removed if you uninstall the app
  or clear its storage from Android Settings.
- There's no automated test suite for this project; verify changes by
  running through the app manually (add income, create an envelope, log an
  expense, delete an envelope, export CSV).
