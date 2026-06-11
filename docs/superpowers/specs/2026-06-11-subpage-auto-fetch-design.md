# Subpage Auto-Fetch — Design Spec

**Date:** 2026-06-11
**Feature:** Automatisches Laden von Unterseiten wenn der User danach fragt

---

## Überblick

Wenn der User eine Frage stellt, die Inhalte von Unterseiten der aktuellen Seite benötigt (z.B. "hole den Artikel", "zeig mir die Details"), lädt die Extension automatisch die relevanten Unterseiten und gibt dem AI deren Inhalt als Kontext.

Das Feature erweitert den bestehenden Seiten-Kontext-Flow (`shouldIncludePageContext`) mit einer gestaffelten Auslöse-Logik.

---

## Abgrenzung zum bestehenden URL-Fetch-Feature

Das **bestehende** Feature (`fetchUrlContent` + `selectRelevantLinks`) greift wenn der User **eine URL explizit eintippt** (z.B. `https://mpg-umstadt.de was sind die News?`).

Das **neue** Feature greift wenn der User eine Frage über die **bereits geöffnete Seite** stellt und dabei Unterseiten-Inhalte braucht (z.B. "hole den Artikel" auf einer Nachrichtenübersicht).

---

## Auslöse-Logik (gestaffelt)

```
User-Nachricht
    │
    ├─► Seitenkontext-Modus === "off"? → Kein Laden
    │
    ├─► currentPageContext vorhanden (Seite bekannt)?
    │       Nein → Kein Laden (keine Links bekannt)
    │       Ja ↓
    │
    ├─► 1. Keyword-Check (schnell, kein API-Call)
    │       Trifft zu? → Laden
    │       Nein ↓
    │
    └─► 2. KI-Klassifizierung (wie shouldIncludePageContext)
            → "Braucht diese Frage Unterseiten?" → ja/nein
```

---

## Trigger-Keywords

```js
const SUBPAGE_KEYWORDS_RE = /\b(hole|hol\s|öffne|zeig|lies|lese|fetch|load|open|show|artikel|article|unterseite|subpage|inhalt|content|details|mehr dazu|vollständig|complete|was\s+steht\s+(im|in\s+dem|dort|da)\b)\b/i;
```

---

## Status-Meldungen

Wie der bestehende `renderContextModeNotice`:
```
🔗 Unterseiten werden geladen…
✅ 3 Unterseiten geladen
```

Bei Fehler: kein Hinweis, AI antwortet einfach ohne Unterseiten-Kontext.

---

## Datenfluss

```
1. shouldLoadSubpages(text) → true/false
   (Keyword-Check → KI-Klassifizierung)

2. currentPageContext.links aus dem letzten fetchPageContent()
   (bereits vorhanden — fetchPageContent liefert Links der aktuellen Seite)

3. selectRelevantLinks(currentPageContext, links, question) → max. 5 URLs
   (bereits vorhanden)

4. Promise.all(selectedUrls.map(fetchUrlContent)) → Unterseiten-Inhalte
   (bereits vorhanden)

5. Inhalte in currentPageContext.text einbauen (max. 3000 Zeichen pro Seite)

6. AI bekommt den erweiterten Kontext → antwortet
```

---

## Änderungen an bestehenden Funktionen

### `fetchPageContent()` (popup.js ~Zeile 896)

Muss zusätzlich **Links der Seite** speichern. Aktuell speichert sie nur `text`, `title`, `url` in `currentPageContext`. Erweiterung:

```js
currentPageContext = {
  text: ...,
  title: ...,
  url: ...,
  links: uniqueSameDomainLinks  // NEU
};
```

Die Links werden bereits in `fetchUrlContent` extrahiert — gleiche Logik muss in `fetchPageContent` via `browser.scripting.executeScript` ergänzt werden.

### `sendMessage()` (popup.js ~Zeile 1709)

Nach dem bestehenden URL-Fetch-Block wird ein neuer Block eingefügt, der greift wenn **kein** expliziter URL im Text und `currentPageContext` vorhanden ist:

```js
// Neuer Block: Subpage Auto-Fetch
if (!detectedUrl && currentPageContext?.links?.length > 0 && pageContextMode !== "off") {
  const shouldLoad = await shouldLoadSubpages(text);
  if (shouldLoad) {
    renderContextModeNotice("🔗 Unterseiten werden geladen…");
    const selectedUrls = await selectRelevantLinks(currentPageContext, currentPageContext.links, text);
    if (selectedUrls.length > 0) {
      const subpages = (await Promise.all(selectedUrls.map(fetchUrlContent))).filter(Boolean);
      if (subpages.length > 0) {
        const subText = subpages
          .map(p => `---\n${p.title}\n${p.url}\n${p.text.slice(0, 3000)}`)
          .join("\n\n");
        currentPageContext = { ...currentPageContext, text: currentPageContext.text + "\n\n" + subText };
        renderContextModeNotice(`✅ ${subpages.length} Unterseite${subpages.length > 1 ? "n" : ""} geladen`);
      }
    }
  }
}
```

### Neue Funktion: `shouldLoadSubpages(text)`

```js
async function shouldLoadSubpages(text) {
  // 1. Keyword-Check
  if (SUBPAGE_KEYWORDS_RE.test(text)) return true;

  // 2. KI-Klassifizierung (wie classifyWithAI)
  return await classifySubpageNeed(text);
}
```

### Neue Funktion: `classifySubpageNeed(text)`

Analog zu `classifyWithAI` — nutzt den gleichen Mini-AI-Call-Pattern. Prompt:
> "Bezieht sich diese Frage auf den Detailinhalt eines verlinkten Artikels oder einer Unterseite? Antworte nur 'ja' oder 'nein'."

---

## Limits & Sicherheit

- Max. 5 Unterseiten pro Anfrage (durch `selectRelevantLinks`)
- Max. 3000 Zeichen pro Unterseite (`.slice(0, 3000)`)
- Nur gleiche Domain (durch `fetchUrlContent`)
- Timeout 10s pro Seite (durch `fetchUrlContent`)
- Kein Laden wenn `pageContextMode === "off"`
- Kein Laden wenn kein `currentPageContext` (Seite noch nicht bekannt)

---

## Betroffene Dateien

| Datei | Änderung |
|-------|----------|
| `popup.js` | `fetchPageContent`: Links extrahieren und in `currentPageContext` speichern |
| `popup.js` | `sendMessage`: Neuer Subpage-Auto-Fetch-Block |
| `popup.js` | Neue Funktion `shouldLoadSubpages(text)` |
| `popup.js` | Neue Funktion `classifySubpageNeed(text)` |
| `popup.js` | Neue Konstante `SUBPAGE_KEYWORDS_RE` |
