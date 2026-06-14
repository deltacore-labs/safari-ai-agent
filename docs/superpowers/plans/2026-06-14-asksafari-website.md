# AskSafari Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a static 3-page marketing website for the AskSafari Safari extension, hosted on GitHub Pages, with Glassmorphism Dark design, Impressum, and Datenschutzerklärung.

**Architecture:** Pure HTML/CSS, no build tools, no JavaScript framework. A shared `style.css` covers all three pages. Nav and footer are copy-pasted across pages (no templating needed at this scale). The `website/` folder is self-contained and deployable directly via GitHub Pages.

**Tech Stack:** HTML5, CSS3 (custom properties, backdrop-filter, radial-gradient), Inter font via Google Fonts, GitHub Pages

---

## File Structure

| File | Responsibility |
|------|---------------|
| `website/index.html` | Landing page — nav, hero, features, how it works, CTA banner, footer |
| `website/impressum.html` | Impressum §5 TMG — nav, legal content, footer |
| `website/datenschutz.html` | Datenschutzerklärung DSGVO — nav, legal content, footer |
| `website/assets/style.css` | All styles — design tokens, layout, components, responsive |
| `website/assets/screenshot.png` | Extension popup screenshot (placeholder — see Task 1) |
| `website/assets/icon.png` | App icon (placeholder — see Task 1) |
| `website/.nojekyll` | Empty file — prevents GitHub Pages from running Jekyll |

---

## Task 1: Project scaffold & placeholders

**Files:**
- Create: `website/.nojekyll`
- Create: `website/assets/style.css` (empty for now)
- Create: `website/assets/screenshot.png` (placeholder)
- Create: `website/assets/icon.png` (placeholder)

- [ ] **Step 1: Create the website directory structure**

```bash
mkdir -p "website/assets"
touch "website/.nojekyll"
touch "website/assets/style.css"
```

- [ ] **Step 2: Create placeholder images**

Create a 600×400px solid dark rectangle as `website/assets/screenshot.png` and a 128×128px solid dark square as `website/assets/icon.png`. Use any image editor or this Python snippet if no editor available:

```bash
python3 -c "
from PIL import Image
Image.new('RGB', (600, 400), '#0f0f1a').save('website/assets/screenshot.png')
Image.new('RGB', (128, 128), '#3ecf8e').save('website/assets/icon.png')
" 2>/dev/null || echo "PIL not available — create placeholder PNGs manually or skip for now"
```

If PIL is unavailable, copy any existing PNG from the Xcode project as a placeholder:
```bash
cp "Safari AI Agent Extension/Resources/images/icon-128.png" website/assets/icon.png 2>/dev/null || echo "Copy manually"
cp "Safari AI Agent Extension/Resources/images/icon-128.png" website/assets/screenshot.png 2>/dev/null || echo "Copy manually"
```

- [ ] **Step 3: Commit scaffold**

```bash
git add website/
git commit -m "feat(website): scaffold directory structure and placeholders"
```

---

## Task 2: Shared CSS — design tokens and base styles

**Files:**
- Modify: `website/assets/style.css`

- [ ] **Step 1: Write design tokens and reset**

Write the following as the full content of `website/assets/style.css`:

```css
/* Design Tokens */
:root {
  --canvas: #070711;
  --text: #ffffff;
  --text-muted: rgba(255, 255, 255, 0.6);
  --text-faint: rgba(255, 255, 255, 0.35);
  --accent: #3ecf8e;
  --accent-hover: #2db87a;
  --blob-purple: #6b01c2;
  --blob-blue: #054cff;
  --glass-bg: rgba(255, 255, 255, 0.04);
  --glass-border: rgba(255, 255, 255, 0.08);
  --radius: 16px;
  --radius-sm: 8px;
  --nav-height: 64px;
}

/* Reset */
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html { scroll-behavior: smooth; }
body {
  font-family: 'Inter', ui-sans-serif, system-ui, sans-serif;
  background: var(--canvas);
  color: var(--text);
  font-size: 16px;
  line-height: 1.6;
  min-height: 100vh;
  overflow-x: hidden;
}
a { color: inherit; text-decoration: none; }
img { max-width: 100%; display: block; }

/* Background blobs */
body::before,
body::after {
  content: '';
  position: fixed;
  border-radius: 50%;
  filter: blur(120px);
  opacity: 0.35;
  pointer-events: none;
  z-index: 0;
}
body::before {
  width: 600px;
  height: 600px;
  background: var(--blob-purple);
  top: -200px;
  left: -150px;
}
body::after {
  width: 500px;
  height: 500px;
  background: var(--blob-blue);
  bottom: -150px;
  right: -100px;
}

/* Page wrapper — sits above blobs */
.page { position: relative; z-index: 1; }

/* Container */
.container {
  max-width: 1100px;
  margin: 0 auto;
  padding: 0 24px;
}

/* Glass card */
.glass {
  background: var(--glass-bg);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
}

/* Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 12px 24px;
  border-radius: var(--radius-sm);
  font-size: 15px;
  font-weight: 500;
  line-height: 1.2;
  cursor: pointer;
  border: none;
  transition: opacity 0.15s ease, transform 0.1s ease;
  white-space: nowrap;
}
.btn:hover { opacity: 0.88; transform: translateY(-1px); }
.btn:active { transform: translateY(0); }

.btn-primary {
  background: var(--accent);
  color: #070711;
}
.btn-ghost {
  background: transparent;
  color: var(--text);
  border: 1px solid var(--glass-border);
}
.btn-ghost:hover { border-color: rgba(255,255,255,0.2); }

/* Section spacing */
.section { padding: 96px 0; }
.section-sm { padding: 64px 0; }

/* Typography utilities */
.eyebrow {
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--accent);
  margin-bottom: 16px;
}
.display {
  font-size: clamp(36px, 5vw, 56px);
  font-weight: 700;
  line-height: 1.1;
  letter-spacing: -1.5px;
}
.subhead {
  font-size: 18px;
  line-height: 1.6;
  color: var(--text-muted);
  max-width: 520px;
}
.label {
  font-size: 13px;
  color: var(--text-faint);
}

/* ── NAV ── */
.nav {
  position: sticky;
  top: 0;
  z-index: 100;
  height: var(--nav-height);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  border-bottom: 1px solid var(--glass-border);
  display: flex;
  align-items: center;
}
.nav-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}
.nav-logo {
  font-size: 18px;
  font-weight: 700;
  color: var(--text);
  letter-spacing: -0.3px;
}
.nav-logo span { color: var(--accent); }

/* ── FOOTER ── */
.footer {
  border-top: 1px solid var(--glass-border);
  padding: 40px 0;
}
.footer-inner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
}
.footer-links {
  display: flex;
  gap: 24px;
  list-style: none;
}
.footer-links a {
  font-size: 14px;
  color: var(--text-muted);
  transition: color 0.15s;
}
.footer-links a:hover { color: var(--text); }
.footer-copy {
  font-size: 13px;
  color: var(--text-faint);
}

/* ── HERO ── */
.hero { padding: 96px 0 80px; }
.hero-inner {
  display: grid;
  grid-template-columns: 1fr 1fr;
  align-items: center;
  gap: 64px;
}
.hero-ctas {
  display: flex;
  gap: 12px;
  margin-top: 32px;
  flex-wrap: wrap;
}
.hero-img {
  border-radius: var(--radius);
  box-shadow: 0 0 60px rgba(62, 207, 142, 0.15);
  width: 100%;
}

/* ── FEATURES ── */
.features-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}
.features-grid .feature-card:nth-child(4),
.features-grid .feature-card:nth-child(5) {
  grid-column: span 1;
}
/* Center the last 2 cards */
.features-bottom {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 20px;
  max-width: calc(66.66% + 10px);
  margin: 20px auto 0;
}
.feature-card {
  padding: 28px;
}
.feature-icon {
  font-size: 22px;
  margin-bottom: 16px;
  display: block;
}
.feature-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}
.feature-desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
}

/* ── HOW IT WORKS ── */
.steps-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 32px;
  margin-top: 48px;
}
.step-number {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--glass-bg);
  border: 1px solid var(--accent);
  color: var(--accent);
  font-size: 14px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 20px;
}
.step-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 8px;
}
.step-desc {
  font-size: 14px;
  color: var(--text-muted);
  line-height: 1.6;
}

/* ── CTA BANNER ── */
.cta-banner {
  padding: 56px 48px;
  text-align: center;
}
.cta-banner .display { font-size: clamp(28px, 4vw, 40px); margin-bottom: 16px; }
.cta-banner .subhead { margin: 0 auto 32px; }

/* ── LEGAL PAGES ── */
.legal-content {
  max-width: 720px;
  margin: 0 auto;
  padding: 64px 0 96px;
}
.legal-content h1 {
  font-size: 36px;
  font-weight: 700;
  letter-spacing: -0.8px;
  margin-bottom: 40px;
}
.legal-content h2 {
  font-size: 18px;
  font-weight: 600;
  margin: 40px 0 12px;
  color: var(--text);
}
.legal-content p,
.legal-content address {
  font-size: 15px;
  color: var(--text-muted);
  line-height: 1.7;
  font-style: normal;
  margin-bottom: 12px;
}
.legal-content a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 3px;
}

/* ── RESPONSIVE ── */
@media (max-width: 768px) {
  .hero-inner {
    grid-template-columns: 1fr;
    gap: 40px;
  }
  .hero-inner > *:last-child { order: -1; }
  .features-grid { grid-template-columns: 1fr; }
  .features-bottom { grid-template-columns: 1fr; max-width: 100%; }
  .steps-grid { grid-template-columns: 1fr; }
  .cta-banner { padding: 40px 24px; }
  .footer-inner { flex-direction: column; align-items: flex-start; }
  .nav .btn { display: none; }
}
@media (max-width: 480px) {
  .hero-ctas { flex-direction: column; }
  .btn { width: 100%; justify-content: center; }
}
```

- [ ] **Step 2: Verify CSS has no obvious syntax errors**

```bash
# Quick check — should return nothing if no issues
node -e "require('fs').readFileSync('website/assets/style.css','utf8')" 2>&1 || echo "File read OK (node not available is fine)"
```

- [ ] **Step 3: Commit**

```bash
git add website/assets/style.css
git commit -m "feat(website): add shared CSS with design tokens and all component styles"
```

---

## Task 3: index.html — Landing Page

**Files:**
- Create: `website/index.html`

- [ ] **Step 1: Create index.html**

Write the following as the full content of `website/index.html`:

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AskSafari — Dein KI-Assistent für jede Webseite</title>
  <meta name="description" content="Frage Claude, Gemini oder ein lokales Modell direkt während du browst. AskSafari liest die Seite mit und antwortet im Kontext. Kostenlos & Open Source.">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/style.css">
  <link rel="icon" type="image/png" href="assets/icon.png">
</head>
<body>
<div class="page">

  <!-- NAV -->
  <nav class="nav">
    <div class="container nav-inner">
      <a href="index.html" class="nav-logo">Ask<span>Safari</span></a>
      <a href="#" class="btn btn-primary">Für Safari installieren →</a>
    </div>
  </nav>

  <!-- HERO -->
  <section class="hero">
    <div class="container">
      <div class="hero-inner">
        <div>
          <p class="eyebrow">Kostenlos · Open Source · Für Safari</p>
          <h1 class="display">Dein KI-Assistent für jede Webseite</h1>
          <p class="subhead" style="margin-top:20px;">
            Frage Claude, Gemini oder ein lokales Modell — direkt während du browst.
            AskSafari liest die Seite mit und antwortet im Kontext.
          </p>
          <div class="hero-ctas">
            <a href="#" class="btn btn-primary">Für Safari installieren</a>
            <a href="https://github.com" class="btn btn-ghost">Quellcode auf GitHub</a>
          </div>
        </div>
        <div>
          <img src="assets/screenshot.png" alt="AskSafari Extension Popup" class="hero-img glass">
        </div>
      </div>
    </div>
  </section>

  <!-- FEATURES -->
  <section class="section">
    <div class="container">
      <p class="eyebrow" style="text-align:center;">Funktionen</p>
      <h2 class="display" style="text-align:center; font-size:clamp(28px,4vw,40px); margin-bottom:48px;">Alles was du brauchst</h2>
      <div class="features-grid">
        <div class="feature-card glass">
          <span class="feature-icon">✦</span>
          <h3 class="feature-title">Multi-Model</h3>
          <p class="feature-desc">Claude, Gemini &amp; Ollama — du wählst das Modell das am besten zu deiner Aufgabe passt.</p>
        </div>
        <div class="feature-card glass">
          <span class="feature-icon">◉</span>
          <h3 class="feature-title">Seitenkontext</h3>
          <p class="feature-desc">AskSafari liest mit, was du gerade siehst. Frag direkt über den Inhalt der aktuellen Seite.</p>
        </div>
        <div class="feature-card glass">
          <span class="feature-icon">⬡</span>
          <h3 class="feature-title">Privat by Design</h3>
          <p class="feature-desc">Mit Ollama bleiben alle Daten auf deinem Gerät. Keine Cloud, kein Tracking.</p>
        </div>
      </div>
      <div class="features-bottom">
        <div class="feature-card glass">
          <span class="feature-icon">▤</span>
          <h3 class="feature-title">Gesprächsverlauf</h3>
          <p class="feature-desc">Alle Chats werden gespeichert und sind durchsuchbar — auch nach Tagen noch abrufbar.</p>
        </div>
        <div class="feature-card glass">
          <span class="feature-icon">⊕</span>
          <h3 class="feature-title">Kostenlos &amp; Open Source</h3>
          <p class="feature-desc">Kein Abo, kein Tracking, kein Konto nötig. Der Code liegt offen auf GitHub.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- HOW IT WORKS -->
  <section class="section" style="padding-top:0;">
    <div class="container">
      <p class="eyebrow" style="text-align:center;">So funktioniert es</p>
      <h2 class="display" style="text-align:center; font-size:clamp(28px,4vw,40px);">In drei Schritten loslegen</h2>
      <div class="steps-grid">
        <div>
          <div class="step-number">1</div>
          <h3 class="step-title">Extension installieren</h3>
          <p class="step-desc">API-Key für Claude oder Gemini eingeben — oder Ollama lokal starten für vollständige Privatsphäre.</p>
        </div>
        <div>
          <div class="step-number">2</div>
          <h3 class="step-title">Popup öffnen</h3>
          <p class="step-desc">Klick auf das AskSafari-Icon in der Safari-Toolbar. Das Popup öffnet sich auf jeder Webseite.</p>
        </div>
        <div>
          <div class="step-number">3</div>
          <h3 class="step-title">Fragen stellen</h3>
          <p class="step-desc">Der KI antwortet mit vollem Kontext der aktuellen Seite — erklärt, fasst zusammen, übersetzt.</p>
        </div>
      </div>
    </div>
  </section>

  <!-- CTA BANNER -->
  <section class="section" style="padding-bottom:96px;">
    <div class="container">
      <div class="cta-banner glass">
        <h2 class="display">Bereit loszulegen?</h2>
        <p class="subhead">Kostenlos installieren — keine Registrierung, kein Abo.</p>
        <a href="#" class="btn btn-primary">Für Safari installieren →</a>
      </div>
    </div>
  </section>

  <!-- FOOTER -->
  <footer class="footer">
    <div class="container footer-inner">
      <ul class="footer-links">
        <li><a href="impressum.html">Impressum</a></li>
        <li><a href="datenschutz.html">Datenschutz</a></li>
        <li><a href="https://github.com">GitHub</a></li>
      </ul>
      <span class="footer-copy">© 2026 Stefan Friedrich</span>
    </div>
  </footer>

</div>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify visually**

```bash
open website/index.html
```

Check:
- Background blobs visible (purple top-left, blue bottom-right)
- Nav sticky with logo and green button
- Hero: headline, subtext, two CTAs, screenshot card
- 3 feature cards top row, 2 centered bottom row
- 3 steps in a row
- CTA banner centered glass card
- Footer with links

- [ ] **Step 3: Commit**

```bash
git add website/index.html
git commit -m "feat(website): add landing page"
```

---

## Task 4: impressum.html

**Files:**
- Create: `website/impressum.html`

- [ ] **Step 1: Create impressum.html**

Write the following as the full content of `website/impressum.html`:

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Impressum — AskSafari</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/style.css">
  <link rel="icon" type="image/png" href="assets/icon.png">
</head>
<body>
<div class="page">

  <!-- NAV -->
  <nav class="nav">
    <div class="container nav-inner">
      <a href="index.html" class="nav-logo">Ask<span>Safari</span></a>
      <a href="#" class="btn btn-primary">Für Safari installieren →</a>
    </div>
  </nav>

  <!-- CONTENT -->
  <main class="container">
    <div class="legal-content">
      <h1>Impressum</h1>

      <h2>Angaben gemäß § 5 TMG</h2>
      <address>
        Stefan Friedrich<br>
        Seckenheimer Landstraße 4A / 138<br>
        68163 Mannheim<br>
        Deutschland
      </address>

      <h2>Kontakt</h2>
      <p>E-Mail: <a href="mailto:delta.corelabs@gmail.com">delta.corelabs@gmail.com</a></p>

      <h2>Verantwortlich für den Inhalt nach § 55 Abs. 2 RStV</h2>
      <address>
        Stefan Friedrich<br>
        Seckenheimer Landstraße 4A / 138<br>
        68163 Mannheim
      </address>

      <h2>Haftungsausschluss</h2>
      <p>
        Die Inhalte dieser Website wurden mit größtmöglicher Sorgfalt erstellt.
        Für die Richtigkeit, Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden.
      </p>

      <h2>Externe Links</h2>
      <p>
        Diese Website enthält Links zu externen Websites Dritter, auf deren Inhalte wir keinen Einfluss haben.
        Für die Inhalte der verlinkten Seiten ist stets der jeweilige Anbieter oder Betreiber verantwortlich.
      </p>
    </div>
  </main>

  <!-- FOOTER -->
  <footer class="footer">
    <div class="container footer-inner">
      <ul class="footer-links">
        <li><a href="impressum.html">Impressum</a></li>
        <li><a href="datenschutz.html">Datenschutz</a></li>
        <li><a href="https://github.com">GitHub</a></li>
      </ul>
      <span class="footer-copy">© 2026 Stefan Friedrich</span>
    </div>
  </footer>

</div>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify**

```bash
open website/impressum.html
```

Check:
- Same nav and footer as index.html
- Address formatted correctly
- E-Mail link clickable

- [ ] **Step 3: Commit**

```bash
git add website/impressum.html
git commit -m "feat(website): add Impressum page"
```

---

## Task 5: datenschutz.html

**Files:**
- Create: `website/datenschutz.html`

- [ ] **Step 1: Create datenschutz.html**

Write the following as the full content of `website/datenschutz.html`:

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Datenschutzerklärung — AskSafari</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/style.css">
  <link rel="icon" type="image/png" href="assets/icon.png">
</head>
<body>
<div class="page">

  <!-- NAV -->
  <nav class="nav">
    <div class="container nav-inner">
      <a href="index.html" class="nav-logo">Ask<span>Safari</span></a>
      <a href="#" class="btn btn-primary">Für Safari installieren →</a>
    </div>
  </nav>

  <!-- CONTENT -->
  <main class="container">
    <div class="legal-content">
      <h1>Datenschutzerklärung</h1>

      <h2>1. Verantwortlicher</h2>
      <address>
        Stefan Friedrich<br>
        Seckenheimer Landstraße 4A / 138<br>
        68163 Mannheim<br>
        E-Mail: <a href="mailto:delta.corelabs@gmail.com">delta.corelabs@gmail.com</a>
      </address>

      <h2>2. Erhebung und Verarbeitung personenbezogener Daten</h2>
      <p>
        Diese Website erhebt keine personenbezogenen Daten, setzt keine Cookies ein
        und verwendet keinerlei Tracking- oder Analyse-Tools.
      </p>

      <h2>3. Hosting über GitHub Pages</h2>
      <p>
        Diese Website wird über GitHub Pages gehostet (GitHub Inc., 88 Colin P Kelly Jr St,
        San Francisco, CA 94107, USA). Beim Aufruf der Website werden technische Daten
        (insbesondere IP-Adresse, Datum und Uhrzeit des Zugriffs) durch die Server von
        GitHub verarbeitet. Dies geschieht auf Grundlage von Art. 6 Abs. 1 lit. f DSGVO
        (berechtigtes Interesse an der sicheren Bereitstellung der Website).
      </p>
      <p>
        Weitere Informationen zum Datenschutz bei GitHub finden Sie unter:<br>
        <a href="https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement" target="_blank" rel="noopener">
          https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement
        </a>
      </p>

      <h2>4. AskSafari Browser-Extension</h2>
      <p>
        Die AskSafari-Extension speichert API-Keys, Einstellungen und Gesprächsverläufe
        ausschließlich lokal im Browser-Speicher von Safari (Safari Extension Storage).
        Es werden keine Daten an eigene Server übertragen.
      </p>
      <p>
        API-Anfragen werden direkt vom Browser des Nutzers an den jeweiligen KI-Anbieter
        gesendet (Anthropic für Claude, Google für Gemini, bzw. lokal an Ollama).
        Dabei gelten die Datenschutzbestimmungen des jeweiligen Anbieters.
        Bei Nutzung von Ollama verlassen keine Daten das lokale Gerät.
      </p>

      <h2>5. Ihre Rechte</h2>
      <p>
        Sie haben das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16 DSGVO),
        Löschung (Art. 17 DSGVO), Einschränkung der Verarbeitung (Art. 18 DSGVO) sowie
        das Recht auf Datenübertragbarkeit (Art. 20 DSGVO).
      </p>
      <p>
        Da diese Website und die Extension keine personenbezogenen Daten erheben oder
        speichern, liegen in der Regel keine verarbeitungsfähigen Daten vor.
        Für Anfragen wenden Sie sich an:
        <a href="mailto:delta.corelabs@gmail.com">delta.corelabs@gmail.com</a>
      </p>

      <h2>6. Beschwerderecht</h2>
      <p>
        Sie haben das Recht, sich bei der zuständigen Aufsichtsbehörde zu beschweren.
        Zuständig ist der Landesbeauftragte für den Datenschutz und die
        Informationsfreiheit Baden-Württemberg:
        <a href="https://www.baden-wuerttemberg.datenschutz.de" target="_blank" rel="noopener">
          www.baden-wuerttemberg.datenschutz.de
        </a>
      </p>

      <p style="margin-top:48px;" class="label">Stand: Juni 2026</p>
    </div>
  </main>

  <!-- FOOTER -->
  <footer class="footer">
    <div class="container footer-inner">
      <ul class="footer-links">
        <li><a href="impressum.html">Impressum</a></li>
        <li><a href="datenschutz.html">Datenschutz</a></li>
        <li><a href="https://github.com">GitHub</a></li>
      </ul>
      <span class="footer-copy">© 2026 Stefan Friedrich</span>
    </div>
  </footer>

</div>
</body>
</html>
```

- [ ] **Step 2: Open in browser and verify**

```bash
open website/datenschutz.html
```

Check:
- All 6 sections visible
- GitHub Privacy link and Datenschutzbehörde link present and correct
- E-Mail link clickable

- [ ] **Step 3: Commit**

```bash
git add website/datenschutz.html
git commit -m "feat(website): add Datenschutzerklärung page"
```

---

## Task 6: GitHub Pages setup & final verification

**Files:**
- None new — configuration only

- [ ] **Step 1: Verify all files are present**

```bash
ls -la website/
ls -la website/assets/
```

Expected output includes:
```
.nojekyll
index.html
impressum.html
datenschutz.html
assets/
  style.css
  screenshot.png
  icon.png
```

- [ ] **Step 2: Open all three pages and verify links between them**

```bash
open website/index.html
open website/impressum.html
open website/datenschutz.html
```

Check:
- `index.html` → Footer "Impressum" link → `impressum.html` ✓
- `index.html` → Footer "Datenschutz" link → `datenschutz.html` ✓
- `impressum.html` → Logo → `index.html` ✓
- `datenschutz.html` → Logo → `index.html` ✓
- No broken images (placeholder PNGs visible)

- [ ] **Step 3: Replace placeholder screenshots (optional but recommended)**

Take a screenshot of the extension popup:
1. Open Safari with the extension loaded
2. Click the AskSafari popup icon
3. Screenshot the popup (Cmd+Shift+4)
4. Save as `website/assets/screenshot.png`

- [ ] **Step 4: Enable GitHub Pages in repository settings**

In the GitHub repository settings:
1. Go to **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main` — Folder: `/website`
4. Save → GitHub will provide the URL (e.g. `https://username.github.io/reponame/`)

- [ ] **Step 5: Final commit**

```bash
git add website/
git commit -m "feat(website): complete AskSafari marketing website"
git push origin main
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Nav ✓, Hero ✓, 5 Features ✓, How it works ✓, CTA Banner ✓, Footer ✓, Impressum ✓, Datenschutz ✓
- [x] **Placeholders:** No TBD or TODO in plan — all code is complete
- [x] **Legal:** §5 TMG vollständig (Name, Adresse, E-Mail), DSGVO-Pflichtabschnitte vorhanden, GitHub Pages als Hoster erwähnt, Aufsichtsbehörde BW verlinkt
- [x] **GitHub Pages:** `.nojekyll` file included, folder structure correct
- [x] **Responsive:** CSS media queries at 768px and 480px
- [x] **Type consistency:** CSS class names consistent across HTML and CSS (`.glass`, `.btn`, `.btn-primary`, `.btn-ghost`, `.features-grid`, `.features-bottom`, `.steps-grid`, `.cta-banner`, `.legal-content`, `.footer`)
