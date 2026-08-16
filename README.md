[![EN](https://img.shields.io/badge/lang-English-blue.svg)](README.md) [![TR](https://img.shields.io/badge/dil-T%C3%BCrk%C3%A7e-red.svg)](README.tr.md)

# bi{Varyasyon} Continuous Image Generator

Automates the ChatGPT web UI to batch-generate images (100-200 at a time)
from variations of a base prompt, saving each one into a folder under the
name you provide. When it hits a rate limit it waits and resumes where it
left off.

## Purpose

Cutting the image cost for content creators. When every scene of a video or
every post of a blog series needs an image, APIs and paid image tools charge
per unit — 200 images is a real bill.

This project **does not use the OpenAI API**: it generates through browser
automation (Playwright) using the ChatGPT subscription you already pay for.
No per-image cost; it runs through the night and the folder is full in the
morning.

> Note: the web interface is currently Turkish-only.

## Setup

Requires Node 20+ and yarn.

```bash
git clone https://github.com/firatcihan/chatgpt-continuous-image-generator.git
cd chatgpt-continuous-image-generator
yarn install
yarn playwright install chromium
yarn start
```

The terminal prints an address carrying a single-use token and opens it in
your browser:

```
  ChatGPT Görsel Üretici çalışıyor:
  http://127.0.0.1:53124/?t=…
```

The server binds only to `127.0.0.1` and every request requires the token;
do not share the address.

### Prompt to hand an AI agent

If you don't want to set it up yourself, give the following to an AI agent
(Claude Code, Cursor, Codex…):

```
Clone the https://github.com/firatcihan/chatgpt-continuous-image-generator
repo into my home directory and run it:

1. git clone https://github.com/firatcihan/chatgpt-continuous-image-generator.git
2. Enter the project folder.
3. Check that Node 20+ and yarn are installed; if not, tell me how to
   install them on this machine and stop.
4. yarn install
5. yarn playwright install chromium
6. yarn start  (this command keeps the server running; run it in the background)
7. Give me the http://127.0.0.1:PORT/?t=... address printed in the terminal.

Do not change anything in the code. If a step fails, print the error
verbatim and stop.
```

## Usage

1. **`1 · Tarayıcıyı aç`** (Open the browser) — Chromium opens and navigates
   to chatgpt.com. Log in to ChatGPT manually the first time; the cookies are
   written to a persistent profile and never asked for again.
2. Create a project with **+** in the left panel (a name is all it takes).
3. Write the **base prompt**; the `{VARYASYON}` placeholder is replaced with
   each row's text.
4. **Rows**: `text` + `file name`. Fill them via the table, by pasting CSV,
   or by pasting a time-stamped (`(0:12)`) script.
5. **`2 · Başlat`** (Start) — new chat → prompt → wait for the image →
   download → next row. Changes save automatically.

Only one job runs at a time. When the program needs you (session dropped,
wrong model) a card appears in the right column.

A row counts as "done" when its output PNG exists on disk — so whenever you
stop, it resumes where it left off, and two projects can never share one
output folder.

## Settings

Opened from the gear next to the project name; every project is independent.

| Field | Description |
|---|---|
| `Çıktı klasörü` (Output folder) | Folder the images are saved into. |
| `Satır arası bekleme` (Between-rows wait) | Random wait between two images, `[min, max]` sec. |
| `Beklenen model adı` (Expected model name) | E.g. `GPT-5`. The job pauses when the active model doesn't contain it. |
| `Üretim zaman aşımı` (Generation timeout) | Maximum wait per image (sec). |
| `Tekrar deneme sayısı` (Retry count) | Attempts per row on error/timeout. |
| `Limit varsayılan bekleme` (Default limit wait) | Minutes to wait when the limit message has no duration. |
| `Eş zamanlı sekme` (Concurrent tabs) | 1-4. The gain depends on the bottleneck: with latency it's ~N×, with the ChatGPT quota there's none. Default `1`; try 2 and check `calisma.log`. |

## Where the data lives

The folder and file names below are the on-disk contract of existing
installs, so they stay Turkish.

| Path | Contents |
|---|---|
| `~/.chatgpt-gorsel-uretici/projeler/` | One JSON per project. |
| `~/.chatgpt-gorsel-uretici/chrome_profil/` | ChatGPT login cookies. |
| `~/.chatgpt-gorsel-uretici/calisma.log` | Run log. |
| `~/ChatGPT-Gorseller/<slug>/` | Output: `<file_name>.png` + `basarisizlar.csv` (failed rows). |

The roots can be moved with `GORSEL_VERI_KOKU`, `GORSEL_CIKTI_KOKU` and `PORT`.

## Troubleshooting

- **Image/button not found:** the ChatGPT UI changed. All DOM selectors live
  in one file, `src/selectors.ts`.
- **Limit/refusal message not caught:** the patterns live in
  `src/rateLimit.ts` and `src/browser.ts`; add the new wording as a regex.
- **The UI says 401:** the `?t=…` in the address expired. Use the current
  address from the terminal.
- **Failed rows:** paste `basarisizlar.csv` into CSV mode and restart the
  job; already-generated images are skipped.

## Development

```bash
yarn test        # vitest
yarn typecheck
```

The only module touching Playwright is `src/browser.ts`; the browser is
injected from `src/start.ts` and the rest of the logic is unit-tested. The
UI under `web/` is plain local ES modules with no build step.
