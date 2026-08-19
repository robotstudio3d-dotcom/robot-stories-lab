# Robot Stories Lab V2

Seconda versione del laboratorio A/B.

## Correzioni rispetto a V1
- Fase separata `RS Plan`: gli artefatti pre-prosa vengono generati e conservati.
- L'Arbitro riceve sia piano sia prosa e non pretende più che A1-A19 compaiano nel racconto.
- Checkpoint dopo ogni fase.
- Esperimenti `PARTIAL` conservati.
- `RETRY FAILED` ripete solo la fase fallita.
- `RESUME` riparte dal primo step mancante.
- Export JSON disponibile anche per test incompleti.
- Retry automatici con backoff su 429/5xx/sovraccarico.
- Supporto opzionale Gemini, Groq e OpenRouter.
- Fallback automatico tra provider configurati.
- Robot Stories Engine NON è più dentro `public/` o nel pacchetto web. Si carica localmente da `.md` e viene conservato nel localStorage del browser.

## Secret Cloudflare
Obbligatorio almeno uno:
- `GEMINI_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`

Opzionale:
- `LAB_ACCESS_KEY`

Variabili modello predefinite in `wrangler.toml`:
- Gemini: `gemini-3.6-flash`
- Groq: `openai/gpt-oss-120b`
- OpenRouter: `openrouter/free`

## Aggiornamento da V1
Sostituisci nel repository i file:
- `src/index.js`
- `public/index.html`
- `public/app.js`
- `public/styles.css`
- `package.json`
- `wrangler.toml`
- `README.md`

ELIMINA dal repository:
- `public/robot_stories_engine_default.md`

Dopo il deploy, apri l'app e carica `robot_stories_engine_v10_8_clean.md` una sola volta. Il browser lo ricorderà localmente.

## Nota di sicurezza
Per il laboratorio personale questa soluzione evita di pubblicare il motore come asset web.
Per un futuro prodotto pubblico che usa Robot Stories internamente, il motore dovrà essere custodito lato server in storage privato e non inviato al browser.
