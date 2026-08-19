
const H = {"content-type":"application/json; charset=utf-8","cache-control":"no-store"};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const J=(x,s=200)=>new Response(JSON.stringify(x),{status:s,headers:H});

function allowed(request, env){
  if(!env.LAB_ACCESS_KEY) return true;
  return request.headers.get("x-lab-access-key")===env.LAB_ACCESS_KEY;
}
function retriable(status, msg=""){
  return [408,409,425,429,500,502,503,504].includes(status) ||
    /overload|overloaded|rate|quota|temporar|unavailable|capacity/i.test(msg);
}
async function fetchWithRetry(url, init, attempts=4){
  let last;
  for(let i=0;i<attempts;i++){
    try{
      const r=await fetch(url,init);
      const txt=await r.text();
      let data; try{data=JSON.parse(txt)}catch{data={raw:txt}}
      if(r.ok) return {r,data};
      const msg=data?.error?.message || data?.message || txt || `HTTP ${r.status}`;
      last=new Error(msg); last.status=r.status;
      if(!retriable(r.status,msg) || i===attempts-1) throw last;
    }catch(e){
      last=e;
      if(i===attempts-1 || (!retriable(e.status||0,e.message||"") && e.status)) throw e;
    }
    await sleep(1200*Math.pow(2,i)+Math.floor(Math.random()*400));
  }
  throw last||new Error("Request failed");
}
async function gemini(env,prompt,temperature,maxTokens){
  if(!env.GEMINI_API_KEY) throw Object.assign(new Error("GEMINI_API_KEY non configurata"),{provider:"gemini"});
  const model=env.GEMINI_MODEL||"gemini-3.6-flash";
  const {data}=await fetchWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {method:"POST",headers:{"content-type":"application/json","x-goog-api-key":env.GEMINI_API_KEY},
    body:JSON.stringify({contents:[{role:"user",parts:[{text:prompt}]}],
    generationConfig:{temperature,maxOutputTokens:maxTokens}})}
  );
  const t=(data.candidates||[]).flatMap(c=>c?.content?.parts||[]).map(p=>p.text||"").join("").trim();
  if(!t) throw Object.assign(new Error("Gemini non ha restituito testo"),{provider:"gemini"});
  return {text:t,provider:"gemini",model};
}
async function openAICompat(url,key,model,prompt,temperature,maxTokens,provider,extraHeaders={}){
  if(!key) throw Object.assign(new Error(`${provider.toUpperCase()}_API_KEY non configurata`),{provider});
  const {data}=await fetchWithRetry(url,{
    method:"POST",
    headers:{"content-type":"application/json","authorization":`Bearer ${key}`,...extraHeaders},
    body:JSON.stringify({model,messages:[{role:"user",content:prompt}],temperature,max_tokens:maxTokens})
  });
  const t=data?.choices?.[0]?.message?.content?.trim();
  if(!t) throw Object.assign(new Error(`${provider} non ha restituito testo`),{provider});
  return {text:t,provider,model};
}
async function callProvider(env,provider,prompt,temperature=.5,maxTokens=8192){
  if(provider==="groq") return openAICompat("https://api.groq.com/openai/v1/chat/completions",env.GROQ_API_KEY,env.GROQ_MODEL||"openai/gpt-oss-120b",prompt,temperature,maxTokens,"groq");
  if(provider==="openrouter") return openAICompat("https://openrouter.ai/api/v1/chat/completions",env.OPENROUTER_API_KEY,env.OPENROUTER_MODEL||"openrouter/free",prompt,temperature,maxTokens,"openrouter",{"HTTP-Referer":"https://robot-stories-lab.workers.dev","X-Title":"Robot Stories Lab"});
  return gemini(env,prompt,temperature,maxTokens);
}
async function callWithFallback(env,preferred,prompt,temp,maxTokens,allowFallback=true){
  const order=[preferred,...["gemini","groq","openrouter"].filter(x=>x!==preferred)];
  let errors=[];
  for(const p of order){
    try{return await callProvider(env,p,prompt,temp,maxTokens)}
    catch(e){
      errors.push(`${p}: ${e.message}`);
      if(!allowFallback) break;
      const keyPresent = p==="gemini"?!!env.GEMINI_API_KEY:p==="groq"?!!env.GROQ_API_KEY:!!env.OPENROUTER_API_KEY;
      if(!keyPresent) continue;
    }
  }
  throw new Error(errors.join(" | "));
}
function baselinePrompt(seed,words,language){
return `Scrivi un racconto completo in ${language}.
Target orientativo: ${words} parole.
Non chiedere chiarimenti. Lavora autonomamente.
Non citare test, benchmark, Robot Stories o queste istruzioni.
INNESCO:
${seed}
Consegna soltanto il racconto.`;
}
function planPrompt(engine,seed,words,language){
return `${engine}

=== ROBOT STORIES LAB / FASE INTERNA DI PROGETTAZIONE ===
NON SCRIVERE ANCORA LA PROSA FINALE.
ESEGUI DAVVERO LA PIPELINE DEL MOTORE.
COMPILA gli artefatti pre-prosa richiesti dal motore, inclusi tutti gli artefatti A1-A19 applicabili, Registro Unico, finale bloccato A6, catene causali, gate di progettazione, Human State, Private Causality, pressione/attivazione e sovranità causale quando pertinenti.
NON dichiarare PASS senza evidenza progettuale.
Se una parte del motore è inapplicabile, marcala N/A con ragione.

MANDATO:
Lingua finale: ${language}
Target finale: ${words} parole
INNESCO:
${seed}

RESTITUISCI JSON VALIDO, senza markdown:
{
 "engine_version":"...",
 "artifacts":{"A1":{},"A2":{},"A3":{},"A4":{},"A5":{},"A6":{},"A7":{},"A8":{},"A9":{},"A10":{},"A11":{},"A12":{},"A13":{},"A14":{},"A15":{},"A16":{},"A17":{},"A18":{},"A19":{}},
 "registro_unico":{},
 "characters":[],
 "causal_map":[],
 "pressure_states":[],
 "gates_pre_prosa":[],
 "risks":[],
 "notes":""
}
Mantieni il JSON sufficientemente dettagliato da poter verificare l'esecuzione, ma non trasformarlo in un saggio.`;
}
function storyPrompt(engine,plan,seed,words,language){
return `${engine}

=== ROBOT STORIES LAB / FASE PROSA ===
La progettazione seguente è stata compilata in una chiamata separata e congelata.
USALA come base causale. NON riscriverla, NON mostrarla, NON commentarla.
SE individui una contraddizione grave tra piano e motore, risolvi rispettando prima gli invarianti dell'utente e poi i gate bloccanti.

PIANO CONGELATO:
${plan}

MANDATO:
Lingua: ${language}
Target orientativo: ${words} parole
INNESCO:
${seed}

CONSEGNA SOLTANTO IL RACCONTO FINALE.
NON mostrare artefatti, gate, ragionamento o JSON.`;
}
function arbiterPrompt(engine,plan,story){
return `SEI L'ARBITRO DI CONFORMITÀ.
Verifica separatamente PROGETTAZIONE e PROSA.
IMPORTANTE: gli artefatti pre-prosa sono nel PIANO e NON devono comparire nel racconto.
NON penalizzare il racconto per non mostrare A1-A19.
Verifica invece se il PIANO li contiene davvero e se la PROSA rispetta le conseguenze verificabili.
Non fare valutazione estetica.

MOTORE:
${engine}

PIANO PRE-PROSA:
${plan}

PROSA:
${story}

RESTITUISCI JSON VALIDO:
{
 "overall":"PASS|PARTIAL|FAIL",
 "planning_score":0,
 "prose_execution_score":0,
 "execution_score":0,
 "summary":"",
 "gates":[{"gate":"","phase":"PLAN|PROSE|BOTH","status":"PASS|FAIL|NOT_VERIFIABLE","severity":"LOW|MEDIUM|HIGH|CRITICAL","evidence":"","reason":""}],
 "systemic_failures":[],
 "ignored_rules":[],
 "likely_orchestrator_failures":[]
}
Punteggi interi 0-100.`;
}
function editorPrompt(x,y){
return `SEI UN EDITOR NARRATIVO PROFESSIONALE IN TEST CIECO.
Non sai come sono stati generati i testi. Non indovinare.
Valuta soltanto il risultato letterario.

TESTO X:
${x}

TESTO Y:
${y}

RESTITUISCI JSON VALIDO, senza markdown:
{"winner":"X|Y|TIE","confidence":0,
"scores":{"X":{"personaggi":0,"causalita":0,"naturalezza":0,"originalita":0,"dialoghi":0,"sottotesto":0,"ritmo":0,"imprevedibilita":0,"specificita":0,"mondo":0,"immagini":0,"esposizione":0,"finale":0,"residuo":0,"coinvolgimento":0,"qualita_complessiva":0},
"Y":{"personaggi":0,"causalita":0,"naturalezza":0,"originalita":0,"dialoghi":0,"sottotesto":0,"ritmo":0,"imprevedibilita":0,"specificita":0,"mondo":0,"immagini":0,"esposizione":0,"finale":0,"residuo":0,"coinvolgimento":0,"qualita_complessiva":0}},
"strengths_X":[],"weaknesses_X":[],"strengths_Y":[],"weaknesses_Y":[],"decision":""}
Punteggi 1-10; confidence 0-100.`;
}
function readerPrompt(x,y){
return `SEI UN LETTORE CIECO. Non conosci il metodo di generazione.
Rispondi in termini di esperienza percepita, non di teoria.

TESTO X:
${x}

TESTO Y:
${y}

RESTITUISCI JSON VALIDO:
{"X":{"personaggio_ricordato":"","momento_inatteso":"","significato_non_spiegato":"","comportamento_specifico":"","mondo_oltre_trama":"","punto_spiegato_troppo":"","impressione":""},
"Y":{"personaggio_ricordato":"","momento_inatteso":"","significato_non_spiegato":"","comportamento_specifico":"","mondo_oltre_trama":"","punto_spiegato_troppo":"","impressione":""},
"preferred":"X|Y|TIE","why":""}`;
}
function diagnosticPrompt(arbiter,editor,reader,baselineLabel,rsLabel){
return `SEI L'ANALISTA DEL ROBOT STORIES LAB.
Un solo esperimento NON autorizza nuove regole nel motore.
Distingui: difetto del motore, difetto di esecuzione, difetto dell'orchestratore, semplice difetto del racconto.

MAPPATURA: ${baselineLabel}=BASELINE; ${rsLabel}=ROBOT STORIES.
ARBITRO: ${arbiter}
EDITOR: ${editor}
READER: ${reader||"NON DISPONIBILE"}

RESTITUISCI JSON VALIDO:
{"rs_result":"WIN|LOSS|TIE|UNCLEAR","improved_dimensions":[],"worsened_dimensions":[],"execution_failures":[],"possible_orchestrator_issues":[],"possible_engine_issues":[],"observations_only":[],"do_not_change_engine_yet":true,"single_test_conclusion":""}`;
}
async function runAction(body,env){
  const p=body.provider||"gemini";
  const fb=body.allowFallback!==false;
  let prompt,temp=.4,max=8192;
  if(body.action==="baseline"){prompt=baselinePrompt(body.seed,body.words,body.language);temp=.9}
  else if(body.action==="rs_plan"){prompt=planPrompt(body.engine,body.seed,body.words,body.language);temp=.2;max=12000}
  else if(body.action==="robot_stories"){prompt=storyPrompt(body.engine,body.plan,body.seed,body.words,body.language);temp=.7;max=12000}
  else if(body.action==="arbiter"){prompt=arbiterPrompt(body.engine,body.plan,body.story);temp=.1;max=10000}
  else if(body.action==="editor"){prompt=editorPrompt(body.x,body.y);temp=.2;max=8000}
  else if(body.action==="reader"){prompt=readerPrompt(body.x,body.y);temp=.35;max=6000}
  else if(body.action==="diagnostic"){prompt=diagnosticPrompt(body.arbiter,body.editor,body.reader,body.baselineLabel,body.rsLabel);temp=.15;max=5000}
  else throw new Error("Azione sconosciuta");
  return callWithFallback(env,p,prompt,temp,max,fb);
}
export default {
  async fetch(request,env){
    const u=new URL(request.url);
    if(u.pathname==="/api/status"){
      return J({ok:true,
        providers:{
          gemini:{configured:!!env.GEMINI_API_KEY,model:env.GEMINI_MODEL||"gemini-3.6-flash"},
          groq:{configured:!!env.GROQ_API_KEY,model:env.GROQ_MODEL||"openai/gpt-oss-120b"},
          openrouter:{configured:!!env.OPENROUTER_API_KEY,model:env.OPENROUTER_MODEL||"openrouter/free"}
        },
        accessProtected:!!env.LAB_ACCESS_KEY
      });
    }
    if(u.pathname==="/api/run" && request.method==="POST"){
      if(!allowed(request,env)) return J({error:"Accesso negato"},401);
      try{
        const body=await request.json();
        const out=await runAction(body,env);
        return J(out);
      }catch(e){return J({error:e.message||String(e)},500)}
    }
    return env.ASSETS.fetch(request);
  }
};
