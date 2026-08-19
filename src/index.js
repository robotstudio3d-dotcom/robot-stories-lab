
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

function textValue(v){
  if(v==null) return "";
  if(typeof v==="string") return v.trim();
  if(typeof v==="number"||typeof v==="boolean") return String(v);
  try{return JSON.stringify(v)}catch{return ""}
}
function wordCount(v){return textValue(v).split(/\s+/).filter(Boolean).length}
function validatePlan(plan,targetWords=500){
  const blocking=[], warnings=[], checks=[];
  const artifacts=plan?.artifacts;
  const reg=plan?.registro_unico;
  const add=(id,pass,detail,severity="BLOCKING")=>{checks.push({id,pass,detail,severity});if(!pass){(severity==="BLOCKING"?blocking:warnings).push(`${id}: ${detail}`)}};
  add("JSON",!!plan && typeof plan==="object" && !Array.isArray(plan),"Piano JSON valido");
  add("ARTIFACTS",!!artifacts && typeof artifacts==="object","Oggetto artifacts presente");
  const always=["A1","A3","A4","A5","A6","A8","A9","A11","A13","A15","A17"];
  for(const a of always) add(a,wordCount(artifacts?.[a])>=3,`${a} deve contenere evidenza testuale, non una dichiarazione vuota`);
  const a6=textValue(artifacts?.A6);
  const a6wc=wordCount(a6), minA6=Math.max(40,Math.ceil(Number(targetWords||500)*0.10)), maxA6=Math.max(minA6+20,Math.ceil(Number(targetWords||500)*0.18));
  const looksLikeSummary=/testo del finale|ultima scena|finale (bloccato|previsto)|scena in prosa|sar[aà]|dovr[aà]/i.test(a6) && a6wc<minA6;
  add("A6_INTEGRAL_PROSE",a6wc>=minA6 && !looksLikeSummary,`A6 deve essere l'ultima scena in prosa integrale: ${a6wc} parole; minimo operativo ${minA6}`);
  if(a6wc>maxA6) warnings.push(`A6_BAND: ${a6wc} parole, sopra la banda 10-18% (${minA6}-${maxA6})`);
  const regKeys=["regole_del_mondo","capacita_e_oggetti","informazioni","personaggi","onomastica","continuita","semine_e_payoff","catena_domande","codice_ritmico","mappa_ancoraggio","immagine_persistente","contratto_di_lettura","decisioni","scarti"];
  add("N8_REGISTRO",!!reg && typeof reg==="object","Registro Unico presente");
  if(reg && typeof reg==="object") for(const k of regKeys) add(`N8.${k}`,Object.prototype.hasOwnProperty.call(reg,k),`Campo obbligatorio ${k} presente`);
  const a15=textValue(artifacts?.A15);
  const evidenceRows=(a15.match(/(?:zero|PASS|FAIL|SUPERATO|FALLITO|direzionale|CR\d+|P\d+|RA\d+|A\d+)/gi)||[]).length;
  add("N10_A15_EVIDENCE",evidenceRows>=3,`A15 deve mostrare scansioni V2/V3 con righe/misure verificabili; indicatori trovati: ${evidenceRows}`);
  const gates=Array.isArray(plan?.gates_pre_prosa)?plan.gates_pre_prosa:[];
  add("PRE_GATES",gates.length>0,"gates_pre_prosa deve contenere verifiche con evidenza");
  const unsupported=gates.filter(g=>/pass|superat/i.test(textValue(g?.status||g?.esito)) && wordCount(g?.evidence||g?.evidenza||g?.reference||g?.riferimento)<1);
  add("GATE_EVIDENCE",unsupported.length===0,`${unsupported.length} gate dichiarati superati senza evidenza`);
  return {pass:blocking.length===0,status:blocking.length?"BLOCKED":"PASS",target_words:Number(targetWords),a6_words:a6wc,a6_expected_band:[minA6,maxA6],blocking_errors:blocking,warnings,checks,validated_at:new Date().toISOString()};
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
 "artifacts":{"A1":"evidenza completa o riferimento al registro_unico","A2":"testo/N-A motivato","A3":"testo con azioni e costi","A4":"progressione concreta","A5":"contratto terminale completo","A6":"ULTIMA SCENA IN PROSA INTEGRALE, non descrizione o sinossi","A7":"testo/N-A motivato","A8":"mappa completa","A9":"profilo con valori/bande","A10":"N-A se non previsto dal motore","A11":"mappa completa","A12":"testo/N-A motivato","A13":"contratto completo","A14":"testo/N-A motivato","A15":"righe V2 una per codice + misure V3 o 'direzionale, non conteggiato'","A16":"testo/N-A motivato","A17":"una voce per ogni scena prevista","A18":"testo/N-A motivato","A19":"PRE-PROSA: N-A, da produrre post-prosa se il motore lo colloca dopo la prosa"},
 "registro_unico":{},
 "characters":[],
 "causal_map":[],
 "pressure_states":[],
 "gates_pre_prosa":[],
 "risks":[],
 "notes":""
}
VINCOLI DI SERIALIZZAZIONE DEL LAB:
- A6 deve contenere davvero la scena finale integrale in prosa. Una frase che descrive cosa accadrà NON è A6.
- registro_unico deve mantenere TUTTI i campi richiesti da N8, anche quando un array è vuoto.
- A15 deve contenere evidenza esplicita delle verifiche V2/V3 secondo N10, non la frase "verificato".
- gates_pre_prosa: ogni PASS/SUPERATO deve avere un campo evidence/riferimento non vuoto.
- Se non riesci a produrre questi elementi, restituisci comunque il JSON ma marca il gate FALLITO. Non fingere conformità.
Mantieni il JSON dettagliato quanto serve alla verifica.`;
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
        if(body.action==="validate_plan") return J({validation:validatePlan(body.plan,body.words)});
        const out=await runAction(body,env);
        return J(out);
      }catch(e){return J({error:e.message||String(e)},500)}
    }
    return env.ASSETS.fetch(request);
  }
};
