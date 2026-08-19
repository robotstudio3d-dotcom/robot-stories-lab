
const $=id=>document.getElementById(id);
let engine=localStorage.getItem("rsLabEngine")||"";
let current=null;
const STEPS=["baseline","plan","validator","rs","arbiter","editor","reader","diagnostic"];

function setStatus(s){$("status").textContent=s}
function parseJSON(t){try{return JSON.parse(t)}catch{const m=t.match(/\{[\s\S]*\}/);if(m)try{return JSON.parse(m[0])}catch{}return{raw:t}}}
function save(exp){
  current=exp;
  localStorage.setItem("rsLabCurrent",JSON.stringify(exp));
  const all=JSON.parse(localStorage.getItem("rsLabHistoryV2")||"[]");
  const i=all.findIndex(x=>x.id===exp.id); if(i>=0) all.splice(i,1);
  all.unshift(exp); localStorage.setItem("rsLabHistoryV2",JSON.stringify(all.slice(0,40)));
  renderHistory(); display(exp);
}
function renderHistory(){
 const all=JSON.parse(localStorage.getItem("rsLabHistoryV2")||"[]");
 $("history").innerHTML=all.length?all.map((e,i)=>`<div class="history-item"><div><b>${e.status||"PARTIAL"}</b><div class="small">${new Date(e.createdAt).toLocaleString()}</div><div class="small">${(e.seed||"").slice(0,55)}…</div></div><button class="ghost" onclick="openHistory(${i})">OPEN</button></div>`).join(""):`<div class="small">Nessun test.</div>`;
}
window.openHistory=i=>{const a=JSON.parse(localStorage.getItem("rsLabHistoryV2")||"[]");if(a[i]){current=a[i];display(current)}}
function display(e){
 if(!e)return;
 const o=e.order||{};
 $("storyX").textContent=o.x||"—";$("storyY").textContent=o.y||"—";
 $("labelX").textContent=o.baselineLabel==="X"?"BASELINE":o.rsLabel==="X"?"ROBOT STORIES":"—";
 $("labelY").textContent=o.baselineLabel==="Y"?"BASELINE":o.rsLabel==="Y"?"ROBOT STORIES":"—";
 $("plan").textContent=JSON.stringify(e.plan||{},null,2);
 $("validator").textContent=JSON.stringify(e.validator||{},null,2); $("repairLog").textContent=JSON.stringify(e.repairHistory||[],null,2);
 $("arbiter").textContent=JSON.stringify(e.arbiter||{},null,2);
 $("editor").textContent=JSON.stringify(e.editor||{},null,2);
 $("reader").textContent=JSON.stringify(e.reader||{},null,2);
 $("diagnostic").textContent=JSON.stringify(e.diagnostic||{},null,2);
 $("editorWinner").textContent=e.editor?.winner||"—";$("readerWinner").textContent=e.reader?.preferred||"—";
 $("planScore").textContent=Number.isFinite(e.arbiter?.planning_score)?e.arbiter.planning_score+"%":"—";
 $("execScore").textContent=Number.isFinite(e.arbiter?.execution_score)?e.arbiter.execution_score+"%":"—";
 $("rsResult").textContent=e.diagnostic?.rs_result||"—";
 setSteps(e);
}
function setSteps(e){
 document.querySelectorAll(".step").forEach((el,i)=>{el.className="step";const key=STEPS[i];if(e?.completed?.includes(key))el.classList.add("done");if(e?.failedStep===key)el.classList.add("failed");});
 if(e?.runningStep){const i=STEPS.indexOf(e.runningStep);if(i>=0)document.querySelectorAll(".step")[i].classList.add("active")}
}
async function api(action,payload,provider){
 const r=await fetch("/api/run",{method:"POST",headers:{"content-type":"application/json","x-lab-access-key":$("accessKey").value||""},body:JSON.stringify({action,provider,allowFallback:$("fallback").checked,...payload})});
 const d=await r.json(); if(!r.ok)throw new Error(d.error||"Errore API"); return d;
}
function chooseOrder(a,b){return Math.random()<.5?{x:a,y:b,baselineLabel:"X",rsLabel:"Y"}:{x:b,y:a,baselineLabel:"Y",rsLabel:"X"}}
function requireEngine(){if(!engine){setStatus("Carica prima il file .md di Robot Stories.");return false}return true}
async function execute(exp,fromIndex=0){
 if(!requireEngine())return;
 $("runBtn").disabled=true;$("resumeBtn").disabled=true;$("retryBtn").disabled=true;
 try{
  for(let i=fromIndex;i<STEPS.length;i++){
   const step=STEPS[i]; if(exp.completed.includes(step))continue;
   exp.runningStep=step;exp.failedStep=null;save(exp);
   const gp=exp.genProvider, ep=exp.evalProvider;
   if(step==="baseline"){setStatus("1/7 Baseline isolata…");const r=await api("baseline",{seed:exp.seed,words:exp.words,language:exp.language},gp);exp.baseline=r.text;exp.meta.baseline=r}
   if(step==="plan"){setStatus("2/8 Compilo gli artefatti Robot Stories…");const r=await api("rs_plan",{engine,seed:exp.seed,words:exp.words,language:exp.language},gp);exp.plan=parseJSON(r.text);exp.planRaw=r.text;exp.meta.plan=r}
   if(step==="validator"){
     setStatus("3/8 VALIDATOR: controllo bloccante prima della prosa…");
     let r=await api("validate_plan",{plan:exp.plan,words:exp.words});
     exp.validator=r.validation;exp.meta.validator_initial=r;
     exp.repairHistory=exp.repairHistory||[];
     save(exp);
     let attempt=0;
     while(!r.validation?.pass && attempt<2){
       attempt++;
       setStatus(`3/8 AUTO-REPAIR ${attempt}/2: correggo solo i blocchi rilevati…`);
       const repair=await api("repair_plan",{
         engine,
         plan:exp.planRaw,
         validation:r.validation,
         seed:exp.seed,
         words:exp.words,
         language:exp.language,
         attempt
       },gp);
       const repairedPlan=parseJSON(repair.text);
       const before=r.validation;
       exp.plan=repairedPlan;
       exp.planRaw=repair.text;
       const recheck=await api("validate_plan",{plan:exp.plan,words:exp.words});
       r=recheck;
       exp.validator=r.validation;
       exp.repairHistory.push({
         attempt,
         provider:repair.provider,
         model:repair.model,
         blocking_before:before.blocking_errors||[],
         blocking_after:r.validation?.blocking_errors||[],
         pass:!!r.validation?.pass,
         repaired_plan:repairedPlan
       });
       exp.meta[`repair_${attempt}`]=repair;
       exp.meta[`validator_after_repair_${attempt}`]=recheck;
       save(exp);
     }
     exp.meta.validator_final=r;
     if(!r.validation?.pass){
       exp.preProseStatus="PRE-PROSE FAILED";
       throw new Error("PRE-PROSE FAILED AFTER 2 REPAIRS: "+(r.validation?.blocking_errors||[]).join(" | "));
     }
     exp.preProseStatus=attempt?`PASS AFTER ${attempt} REPAIR${attempt>1?"S":""}`:"PASS";
   }
   if(step==="rs"){setStatus("4/8 Genero la prosa solo dal piano validato…");const r=await api("robot_stories",{engine,plan:exp.planRaw,validation:exp.validator,seed:exp.seed,words:exp.words,language:exp.language},gp);exp.rs=r.text;exp.meta.rs=r;exp.order=chooseOrder(exp.baseline,exp.rs)}
   if(step==="arbiter"){setStatus("5/8 Arbitro: piano + prosa…");const r=await api("arbiter",{engine,plan:exp.planRaw,story:exp.rs},ep);exp.arbiter=parseJSON(r.text);exp.meta.arbiter=r}
   if(step==="editor"){setStatus("6/8 Editor cieco…");const r=await api("editor",{x:exp.order.x,y:exp.order.y},ep);exp.editor=parseJSON(r.text);exp.meta.editor=r}
   if(step==="reader"){setStatus("7/8 Reader cieco…");const r=await api("reader",{x:exp.order.x,y:exp.order.y},ep);exp.reader=parseJSON(r.text);exp.meta.reader=r}
   if(step==="diagnostic"){setStatus("8/8 Diagnosi…");const r=await api("diagnostic",{arbiter:JSON.stringify(exp.arbiter),editor:JSON.stringify(exp.editor),reader:JSON.stringify(exp.reader),baselineLabel:exp.order.baselineLabel,rsLabel:exp.order.rsLabel},ep);exp.diagnostic=parseJSON(r.text);exp.meta.diagnostic=r}
   exp.completed.push(step);exp.runningStep=null;exp.status=exp.completed.length===STEPS.length?"COMPLETE":"PARTIAL";save(exp);
  }
  setStatus("Esperimento completo. Tutto salvato nel browser.");
 }catch(err){
  exp.failedStep=exp.runningStep;exp.runningStep=null;exp.lastError=err.message;exp.status=err.message.startsWith("PRE-PROSE FAILED")?"PRE-PROSE FAILED":"PARTIAL";save(exp);setStatus(`FALLITO ${exp.failedStep}: ${err.message}. Puoi usare RETRY FAILED o RESUME.`);
 }finally{$("runBtn").disabled=false;$("resumeBtn").disabled=false;$("retryBtn").disabled=false}
}
$("engineFile").addEventListener("change",async e=>{const f=e.target.files?.[0];if(f){engine=await f.text();localStorage.setItem("rsLabEngine",engine);$("engineState").textContent=`Caricato: ${f.name} · ${Math.round(engine.length/1000)}k caratteri`;setStatus("Motore salvato localmente nel browser.")}});
$("runBtn").onclick=()=>{if(!requireEngine())return;const exp={id:crypto.randomUUID(),createdAt:new Date().toISOString(),seed:$("seed").value.trim(),words:Number($("words").value),language:$("language").value,genProvider:$("genProvider").value,evalProvider:$("evalProvider").value,completed:[],failedStep:null,runningStep:null,status:"PARTIAL",meta:{}};save(exp);execute(exp,0)};
$("resumeBtn").onclick=()=>{if(!current){setStatus("Nessun test da riprendere.");return}const idx=STEPS.findIndex(s=>!current.completed.includes(s));if(idx<0){setStatus("Il test è già completo.");return}execute(current,idx)};
$("retryBtn").onclick=()=>{if(!current?.failedStep){setStatus("Nessuna fase fallita.");return}const idx=STEPS.indexOf(current.failedStep);execute(current,Math.max(0,idx))};
$("exportBtn").onclick=()=>{if(!current){setStatus("Nessun test da esportare.");return}const b=new Blob([JSON.stringify(current,null,2)],{type:"application/json"});const a=document.createElement("a");a.href=URL.createObjectURL(b);a.download=`rs-lab-${current.status.toLowerCase()}-${current.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);setStatus(`Esportato JSON ${current.status}.`)};
$("clearBtn").onclick=()=>{current=null;["storyX","storyY"].forEach(x=>$(x).textContent="—");["plan","validator","repairLog","arbiter","editor","reader","diagnostic"].forEach(x=>$(x).textContent="—");setStatus("Vista pulita. I test salvati non sono stati cancellati.")};
async function status(){try{const r=await fetch("/api/status");const s=await r.json();const p=Object.entries(s.providers).map(([k,v])=>`${k}:${v.configured?"✓":"×"} ${v.model}`).join(" · ");$("apiPill").textContent=p}catch{$("apiPill").textContent="API offline"}}
if(engine)$("engineState").textContent=`Motore già salvato nel browser · ${Math.round(engine.length/1000)}k caratteri`;
const saved=localStorage.getItem("rsLabCurrent");if(saved){try{current=JSON.parse(saved);display(current)}catch{}}
renderHistory();status();
