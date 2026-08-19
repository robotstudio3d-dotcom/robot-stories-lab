
const $ = id => document.getElementById(id);
const state = { current: null };

function setStatus(msg){ $("status").textContent = msg; }
function setStep(n){
  document.querySelectorAll(".step").forEach(el=>{
    const k=Number(el.dataset.step);
    el.classList.toggle("active", k===n);
    el.classList.toggle("done", k<n);
  });
}
function parseJSON(text){
  try { return JSON.parse(text); }
  catch {
    const m = text.match(/\{[\s\S]*\}/);
    if(m) try { return JSON.parse(m[0]); } catch {}
    return { raw:text };
  }
}
async function api(action, payload){
  const res = await fetch("/api/run",{
    method:"POST",
    headers:{
      "content-type":"application/json",
      "x-lab-access-key": $("accessKey").value || ""
    },
    body:JSON.stringify({action,...payload})
  });
  const data=await res.json();
  if(!res.ok) throw new Error(data.error||"Errore API");
  return data.text;
}
function randOrder(a,b){
  return Math.random()<.5 ? {x:a,y:b,baselineLabel:"X",rsLabel:"Y"} :
                            {x:b,y:a,baselineLabel:"Y",rsLabel:"X"};
}
function saveHistory(exp){
  const all=JSON.parse(localStorage.getItem("rsLabHistory")||"[]");
  all.unshift(exp);
  localStorage.setItem("rsLabHistory", JSON.stringify(all.slice(0,30)));
  renderHistory();
}
function renderHistory(){
  const all=JSON.parse(localStorage.getItem("rsLabHistory")||"[]");
  $("history").innerHTML=all.length?all.map((x,i)=>`
    <div class="history-item">
      <div><b>${new Date(x.createdAt).toLocaleString()}</b><div class="small">${(x.seed||"").slice(0,75)}${x.seed?.length>75?"…":""}</div></div>
      <button class="ghost" onclick="loadHistory(${i})">OPEN</button>
    </div>`).join(""):`<div class="small">Nessun esperimento salvato.</div>`;
}
window.loadHistory=function(i){
  const all=JSON.parse(localStorage.getItem("rsLabHistory")||"[]");
  if(all[i]) display(all[i]);
}
function display(exp){
  state.current=exp;
  $("storyA").textContent=exp.display?.x||"—";
  $("storyB").textContent=exp.display?.y||"—";
  $("labelA").textContent=exp.display?.baselineLabel==="X"?"BASELINE":"ROBOT STORIES";
  $("labelB").textContent=exp.display?.baselineLabel==="Y"?"BASELINE":"ROBOT STORIES";
  $("arbiter").textContent=JSON.stringify(exp.arbiter,null,2);
  $("editor").textContent=JSON.stringify(exp.editor,null,2);
  $("reader").textContent=JSON.stringify(exp.reader,null,2);
  $("diagnostic").textContent=JSON.stringify(exp.diagnostic,null,2);
  $("winner").textContent=exp.editor?.winner||"—";
  $("readerWinner").textContent=exp.reader?.preferred||"—";
  $("execScore").textContent=Number.isFinite(exp.arbiter?.execution_score)?`${exp.arbiter.execution_score}%`:"—";
  $("rsResult").textContent=exp.diagnostic?.rs_result||"—";
  setStep(0);
}
async function loadDefaultEngine(){
  try{
    const r=await fetch("/robot_stories_engine_default.md");
    $("engine").value=await r.text();
  }catch{ $("engine").value=""; }
}
$("engineFile").addEventListener("change", async e=>{
  const f=e.target.files?.[0];
  if(f) $("engine").value=await f.text();
});
$("runBtn").addEventListener("click", async ()=>{
  const seed=$("seed").value.trim();
  const engine=$("engine").value.trim();
  const words=Number($("words").value||2000);
  const language=$("language").value;
  if(!seed||!engine){setStatus("Manca innesco o motore.");return}
  $("runBtn").disabled=true;
  try{
    const exp={id:crypto.randomUUID(),createdAt:new Date().toISOString(),seed,words,language};
    setStep(1);setStatus("1/6 Genero la baseline in contesto isolato…");
    exp.baseline=await api("baseline",{seed,words,language});

    setStep(2);setStatus("2/6 Eseguo Robot Stories in una nuova chiamata isolata…");
    exp.rs=await api("robot_stories",{seed,words,language,engine});

    const order=randOrder(exp.baseline,exp.rs);
    exp.display=order;
    $("storyA").textContent=order.x;$("storyB").textContent=order.y;
    $("labelA").textContent=order.baselineLabel==="X"?"BASELINE":"ROBOT STORIES";
    $("labelB").textContent=order.baselineLabel==="Y"?"BASELINE":"ROBOT STORIES";

    setStep(3);setStatus("3/6 Arbitro: verifico l'esecuzione di RS…");
    exp.arbiter=parseJSON(await api("arbiter",{engine,story:exp.rs}));
    $("arbiter").textContent=JSON.stringify(exp.arbiter,null,2);
    $("execScore").textContent=Number.isFinite(exp.arbiter.execution_score)?`${exp.arbiter.execution_score}%`:"—";

    setStep(4);setStatus("4/6 Editor cieco A/B…");
    exp.editor=parseJSON(await api("editor",{x:order.x,y:order.y}));
    $("editor").textContent=JSON.stringify(exp.editor,null,2);
    $("winner").textContent=exp.editor.winner||"—";

    setStep(5);setStatus("5/6 Reader cieco…");
    exp.reader=parseJSON(await api("reader",{x:order.x,y:order.y}));
    $("reader").textContent=JSON.stringify(exp.reader,null,2);
    $("readerWinner").textContent=exp.reader.preferred||"—";

    setStep(6);setStatus("6/6 Diagnosi sperimentale…");
    exp.diagnostic=parseJSON(await api("diagnostic",{
      arbiter:JSON.stringify(exp.arbiter),
      editor:JSON.stringify(exp.editor),
      reader:JSON.stringify(exp.reader),
      baselineLabel:order.baselineLabel,
      rsLabel:order.rsLabel
    }));
    $("diagnostic").textContent=JSON.stringify(exp.diagnostic,null,2);
    $("rsResult").textContent=exp.diagnostic.rs_result||"—";

    state.current=exp;
    saveHistory(exp);
    setStatus("Esperimento completato e salvato nel browser.");
    setStep(0);
  }catch(err){
    console.error(err);
    setStatus("ERRORE: "+err.message);
  }finally{$("runBtn").disabled=false}
});
$("exportBtn").addEventListener("click", ()=>{
  if(!state.current){setStatus("Nessun esperimento da esportare.");return}
  const blob=new Blob([JSON.stringify(state.current,null,2)],{type:"application/json"});
  const a=document.createElement("a");a.href=URL.createObjectURL(blob);
  a.download=`rs-lab-${state.current.id}.json`;a.click();URL.revokeObjectURL(a.href);
});
$("clearBtn").addEventListener("click", ()=>{
  state.current=null;
  ["storyA","storyB"].forEach(id=>$(id).textContent="Nessun test eseguito.");
  ["arbiter","editor","reader","diagnostic"].forEach(id=>$(id).textContent="—");
  ["winner","readerWinner","execScore","rsResult"].forEach(id=>$(id).textContent="—");
  setStatus("Vista pulita. La cronologia salvata resta disponibile.");
});
async function status(){
  try{
    const r=await fetch("/api/status");const s=await r.json();
    $("apiPill").textContent=`${s.model} · ${s.apiConfigured?"API READY":"API KEY MISSING"}`;
  }catch{$("apiPill").textContent="API: offline"}
}
loadDefaultEngine();renderHistory();status();
