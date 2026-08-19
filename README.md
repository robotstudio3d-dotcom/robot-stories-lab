# Robot Stories Lab MVP

Laboratorio web A/B per confrontare una baseline narrativa contro Robot Stories in chiamate AI isolate.

## Cosa fa
1. Genera una baseline usando solo innesco + lunghezza.
2. Genera Robot Stories usando lo stesso innesco + motore Markdown.
3. Verifica il testo RS con un Arbitro di conformità.
4. Mescola casualmente A/B e avvia un Editor cieco.
5. Avvia un Reader cieco.
6. Produce una diagnosi del singolo test senza modificare automaticamente il motore.
7. Salva fino a 30 esperimenti nel `localStorage` del browser.
8. Esporta ogni esperimento in JSON.

## Perché le chiamate sono isolate
Ogni operazione invia a Gemini un singolo `contents` con un solo messaggio utente.
Non viene passata cronologia di chat, memoria personale o output delle altre fasi, salvo quando quella fase necessita esplicitamente del testo da valutare.

## Requisiti
- account Cloudflare
- Node.js
- una Gemini API key
- facoltativo: una password privata `LAB_ACCESS_KEY`

## Installazione
```bash
npm install
```

Imposta i secret:
```bash
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put LAB_ACCESS_KEY
```
`LAB_ACCESS_KEY` è opzionale. Se non la imposti, chiunque conosca l'URL può eseguire test usando la tua API key.

## Avvio locale
```bash
npm run dev
```

## Deploy
```bash
npm run deploy
```

Cloudflare assegnerà un URL `*.workers.dev`. Puoi poi collegare un dominio personalizzato dal pannello Cloudflare.

## Motore
`public/robot_stories_engine_default.md` contiene il motore predefinito incluso nel pacchetto.
Dalla UI puoi anche caricare un altro `.md` senza modificare il codice.

## Costi
L'app non contiene abbonamenti o servizi a pagamento obbligatori nel codice. Cloudflare Workers ha un piano Free con limiti. Le eventuali quote/costi del modello Gemini dipendono dal tuo account Google e dal modello scelto.

## Nota sperimentale
Non usare il punteggio di un singolo esperimento per aggiungere nuove regole a Robot Stories.
Il laboratorio salva dati per cercare ricorrenze su più test.
