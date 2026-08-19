
const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function assertAccess(request, env) {
  if (!env.LAB_ACCESS_KEY) return true;
  return request.headers.get("x-lab-access-key") === env.LAB_ACCESS_KEY;
}

async function callGemini(env, prompt, temperature = 0.7, maxOutputTokens = 8192) {
  if (!env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY non configurata.");
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  // IMPORTANT: stateless by design. One request = one isolated contents item.
  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      temperature,
      maxOutputTokens,
    }
  };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-goog-api-key": env.GEMINI_API_KEY,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    const msg = data?.error?.message || `Gemini API error ${response.status}`;
    throw new Error(msg);
  }
  const text = (data.candidates || [])
    .flatMap(c => c?.content?.parts || [])
    .map(p => p.text || "")
    .join("")
    .trim();

  if (!text) throw new Error("Gemini non ha restituito testo.");
  return text;
}

function storyPrompt(seed, words, language) {
  return `Scrivi un racconto completo in ${language}.
Target orientativo: ${words} parole.
Non fare domande. Non chiedere chiarimenti. Lavora autonomamente.
Non commentare il processo e non citare queste istruzioni.

INNESCO:
${seed}

Consegna soltanto il racconto completo.`;
}

function rsPrompt(engine, seed, words, language) {
  return `${engine}

=== MANDATO DI ESECUZIONE ===
ESEGUI il motore sopra sul seguente incarico.
Lingua della prosa: ${language}.
Target orientativo: ${words} parole.
NON chiedere chiarimenti.
NON confrontare il risultato con altri testi.
NON menzionare il laboratorio, la baseline o il fatto che esiste un esperimento.

INNESCO:
${seed}

CONSEGNA il racconto secondo le regole del motore.`;
}

function arbiterPrompt(engine, story) {
  return `SEI L'ARBITRO DI CONFORMITÀ DI ROBOT STORIES.
Non sei un autore e non sei un critico estetico.
Verifica se il testo ha realmente seguito il motore. Non fidarti di dichiarazioni.
Cita evidenze testuali brevi e concrete.
Distingui regola non eseguita da regola eseguita male.
Concentrati soprattutto sui gate materialmente verificabili nel racconto e sui fallimenti ad alta gravità.

MOTORE:
${engine}

RACCONTO DA VERIFICARE:
${story}

RESTITUISCI JSON VALIDO, senza markdown, con questa forma:
{
  "overall": "PASS|PARTIAL|FAIL",
  "summary": "max 120 parole",
  "gates": [
    {
      "gate": "nome gate o principio",
      "status": "PASS|FAIL|NOT_VERIFIABLE",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "evidence": "citazione o descrizione precisa",
      "reason": "max 70 parole"
    }
  ],
  "systemic_failures": ["..."],
  "execution_score": 0
}
execution_score deve essere intero 0-100.`;
}

function editorPrompt(a, b) {
  return `SEI UN EDITOR NARRATIVO PROFESSIONALE IN TEST CIECO.
Non sai come sono stati generati i due testi e non devi indovinarlo.
Valuta soltanto il risultato letterario.
Non premiare complessità, lunghezza o oscurità in quanto tali.
Usa gli stessi criteri per entrambi.

TESTO X:
${a}

TESTO Y:
${b}

RESTITUISCI JSON VALIDO, senza markdown:
{
  "winner": "X|Y|TIE",
  "confidence": 0,
  "scores": {
    "X": {
      "personaggi": 0,
      "causalita": 0,
      "naturalezza": 0,
      "originalita": 0,
      "dialoghi": 0,
      "sottotesto": 0,
      "ritmo": 0,
      "imprevedibilita": 0,
      "specificita": 0,
      "mondo": 0,
      "immagini": 0,
      "esposizione": 0,
      "finale": 0,
      "residuo": 0,
      "coinvolgimento": 0,
      "qualita_complessiva": 0
    },
    "Y": {
      "personaggi": 0,
      "causalita": 0,
      "naturalezza": 0,
      "originalita": 0,
      "dialoghi": 0,
      "sottotesto": 0,
      "ritmo": 0,
      "imprevedibilita": 0,
      "specificita": 0,
      "mondo": 0,
      "immagini": 0,
      "esposizione": 0,
      "finale": 0,
      "residuo": 0,
      "coinvolgimento": 0,
      "qualita_complessiva": 0
    }
  },
  "strengths_X": ["..."],
  "weaknesses_X": ["..."],
  "strengths_Y": ["..."],
  "weaknesses_Y": ["..."],
  "decision": "max 180 parole"
}
Tutti i punteggi sono interi 1-10; confidence è 0-100.`;
}

function readerPrompt(a, b) {
  return `SEI UN LETTORE CIECO. Non sai come sono stati prodotti i due racconti.
Non usare terminologia tecnica di Robot Stories.
Rispondi in termini di esperienza percepita.

TESTO X:
${a}

TESTO Y:
${b}

RESTITUISCI JSON VALIDO, senza markdown:
{
  "X": {
    "personaggio_ricordato": "",
    "momento_inatteso": "",
    "significato_non_spiegato": "",
    "comportamento_specifico": "",
    "mondo_oltre_trama": "",
    "punto_spiegato_troppo": "",
    "impressione": "max 90 parole"
  },
  "Y": {
    "personaggio_ricordato": "",
    "momento_inatteso": "",
    "significato_non_spiegato": "",
    "comportamento_specifico": "",
    "mondo_oltre_trama": "",
    "punto_spiegato_troppo": "",
    "impressione": "max 90 parole"
  },
  "preferred": "X|Y|TIE",
  "why": "max 100 parole"
}`;
}

function diagnosticPrompt(arbiter, editor, reader, baselineLabel, rsLabel) {
  return `SEI L'ANALISTA DEL ROBOT STORIES LAB.
Non riscrivere racconti. Non proporre nuove regole sulla base di un singolo test.
Produci soltanto diagnosi sperimentale.

MAPPATURA:
${baselineLabel} = BASELINE
${rsLabel} = ROBOT STORIES

ARBITRO RS:
${arbiter}

EDITOR CIECO:
${editor}

LETTORE CIECO:
${reader}

RESTITUISCI JSON VALIDO, senza markdown:
{
  "rs_result": "WIN|LOSS|TIE|UNCLEAR",
  "improved_dimensions": ["..."],
  "worsened_dimensions": ["..."],
  "execution_failures": ["..."],
  "possible_engine_issues": ["..."],
  "do_not_change_engine_yet": true,
  "single_test_conclusion": "max 160 parole"
}
Ricorda: un solo test produce osservazioni, non nuove leggi del motore.`;
}

async function handleApi(request, env) {
  if (!assertAccess(request, env)) return json({ error: "Accesso negato." }, 401);
  const body = await request.json();
  const action = body.action;

  if (action === "baseline") {
    return json({ text: await callGemini(env, storyPrompt(body.seed, body.words, body.language), 0.9, 8192) });
  }
  if (action === "robot_stories") {
    return json({ text: await callGemini(env, rsPrompt(body.engine, body.seed, body.words, body.language), 0.7, 8192) });
  }
  if (action === "arbiter") {
    return json({ text: await callGemini(env, arbiterPrompt(body.engine, body.story), 0.1, 8192) });
  }
  if (action === "editor") {
    return json({ text: await callGemini(env, editorPrompt(body.x, body.y), 0.2, 8192) });
  }
  if (action === "reader") {
    return json({ text: await callGemini(env, readerPrompt(body.x, body.y), 0.4, 8192) });
  }
  if (action === "diagnostic") {
    return json({ text: await callGemini(env, diagnosticPrompt(body.arbiter, body.editor, body.reader, body.baselineLabel, body.rsLabel), 0.2, 4096) });
  }
  return json({ error: "Azione sconosciuta." }, 400);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/run" && request.method === "POST") {
      try {
        return await handleApi(request, env);
      } catch (err) {
        return json({ error: err?.message || String(err) }, 500);
      }
    }
    if (url.pathname === "/api/status") {
      return json({
        ok: true,
        model: env.GEMINI_MODEL || "gemini-2.5-flash",
        apiConfigured: Boolean(env.GEMINI_API_KEY),
        accessProtected: Boolean(env.LAB_ACCESS_KEY)
      });
    }
    return env.ASSETS.fetch(request);
  }
};
