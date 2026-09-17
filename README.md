# PartPay

**PartPay** is a simple, mobile-first helper for splitting a UPI payment into installments. Plan how many parts you want (or a max amount per part), then pay each part from your UPI app — with deep links, copyable links, and QR codes.

Everything runs in your browser. Nothing is sent to a server.

## Features

- Enter receiver name (optional), UPI ID/VPA, and total amount in INR
- Split by **number of parts** (default 3) or **max amount per part**
- Parts always sum exactly to the total (integer paise math)
- Each part: **Pay with UPI**, **Copy link**, **Show QR**
- Mark parts as paid — saved in localStorage on your device
- Progressive Web App (manifest + service worker) for Add to Home Screen

## Run locally

Any static file server works. Examples:

```bash
# Python
python3 -m http.server 8080 -d .

# Node (if you have npx)
npx --yes serve -l 8080 .
```

Then open http://localhost:8080

Or open `index.html` directly in a browser (some browsers restrict service workers on `file://`).

## Deploy on Render

This repo includes a `render.yaml` for a **Static Site**:

1. New → Static Site on Render
2. Connect this GitHub repo
3. Publish directory: `.` (repo root)
4. Build command: leave empty (pure static)

Or use Blueprint with the included `render.yaml`.

## Project layout

```
index.html      # App shell
css/styles.css  # Warm mobile-first UI
js/app.js       # Split logic, UPI links, localStorage, QR
manifest.json   # PWA manifest
sw.js           # Service worker
favicon.svg     # Icon
icons/          # PWA icons (192, 512)
render.yaml     # Render static site config
```

## Split math

Amounts are handled in **paise** (rupees × 100) so parts always add up exactly.

**Number of parts:** each part gets `floor(totalPaise / n)` paise; the first `(totalPaise % n)` parts get one extra paise.

**Max per part:** number of parts = `ceil(totalPaise / maxPaise)`, then the same even split (never exceeding the max).

Example: ₹1000 into 3 parts → ₹333.34 + ₹333.33 + ₹333.33 (in paise: 33334 + 33333 + 33333 = 100000).

## Privacy

No accounts, no analytics backend, no payment processing. UPI payments are handled by your installed UPI apps via standard `upi://` links.

## License

MIT
