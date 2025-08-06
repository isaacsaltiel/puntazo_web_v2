// assets/script.js

// ----------------------- utilidades -----------------------
function getQueryParams() {
  const params = {};
  window.location.search
    .substring(1)
    .split("&")
    .forEach(pair => {
      const [key, value] = pair.split("=");
      if (key) params[decodeURIComponent(key)] = decodeURIComponent(value || "");
    });
  return params;
}

function formatAmPm(hour) {
  const h = parseInt(hour, 10);
  const suffix = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 || 12;
  return `${hour12} ${suffix}`;
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function scrollToVideoById(id) {
  const target = document.getElementById(id);
  if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
}

// ----------------------- navegación -----------------------
async function populateLocaciones() {
  try {
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const ul = document.getElementById("locaciones-lista");
    if (!ul) return;
    ul.innerHTML = "";
    config.locaciones.forEach(loc => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      const a = document.createElement("a");
      a.href = `locacion.html?loc=${loc.id}`;
      a.textContent = loc.nombre;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateLocaciones():", err);
  }
}

async function populateCanchas() {
  try {
    const params = getQueryParams();
    const locId = params.loc;
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const loc = config.locaciones.find(l => l.id === locId);
    const ul = document.getElementById("canchas-lista");
    if (!ul || !loc) return;
    ul.innerHTML = "";
    const nombreEl = document.getElementById("nombre-locacion");
    if (nombreEl) nombreEl.textContent = loc.nombre;
    loc.cancha.forEach(can => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      const a = document.createElement("a");
      a.href = `cancha.html?loc=${locId}&can=${can.id}`;
      a.textContent = can.nombre;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateCanchas():", err);
  }
}

async function populateLados() {
  try {
    const params = getQueryParams();
    const locId = params.loc;
    const canId = params.can;
    const url = `data/config_locations.json?cb=${Date.now()}`;
    const res = await fetch(url, { cache: "no-store" });
    const config = await res.json();
    const cancha = config.locaciones.find(l => l.id === locId)?.cancha.find(c => c.id === canId);
    const loc = config.locaciones.find(l => l.id === locId);
    const ul = document.getElementById("lados-lista");
    if (!ul || !cancha || !loc) return;
    ul.innerHTML = "";
    const linkClub = document.getElementById("link-club");
    const linkCancha = document.getElementById("link-cancha");
    if (linkClub) {
      linkClub.textContent = loc.nombre;
      linkClub.href = `locacion.html?loc=${locId}`;
    }
    if (linkCancha) {
      linkCancha.textContent = cancha.nombre;
      linkCancha.href = "#";
    }
    document.getElementById("breadcrumb-sep2").style.display = "none";
    document.getElementById("nombre-lado").style.display = "none";
    cancha.lados.forEach(lado => {
      const li = document.createElement("li");
      li.classList.add("fade-in");
      const a = document.createElement("a");
      a.href = `lado.html?loc=${locId}&can=${canId}&lado=${lado.id}`;
      a.textContent = lado.nombre || lado.id;
      a.classList.add("link-blanco");
      li.appendChild(a);
      ul.appendChild(li);
    });
  } catch (err) {
    console.error("Error en populateLados():", err);
  }
}

// ----------------------- video + filtros -----------------------
let allVideos = [];
let visibilityMap = new Map();
let currentPreviewActive = null;

function createHourFilterUI(videos) {
  const params = getQueryParams();
  const filtroHoraActivo = params.filtro;
  const filtroDiv = document.getElementById("filtro-horario");
  if (!filtroDiv) return;
  filtroDiv.innerHTML = "";
  const horasSet = new Set();
  videos.forEach(v => {
    const match = v.nombre.match(/_(\d{2})(\d{2})(\d{2})\.mp4$/);
    if (match) horasSet.add(match[1]);
  });
  [...horasSet].sort().forEach(h => {
    const btn = document.createElement("button");
    btn.textContent = `${formatAmPm(h)} - ${formatAmPm((+h+1)%24)}`;
    btn.className = "btn-filtro";
    if (filtroHoraActivo === h) btn.classList.add("activo");
    btn.addEventListener("click", () => {
      const p = getQueryParams();
      window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${p.lado}&filtro=${h}`;
    });
    filtroDiv.appendChild(btn);
  });
  const quitarBtn = document.createElement("button");
  quitarBtn.textContent = "Quitar filtro";
  quitarBtn.className = "btn-filtro quitar";
  if (!filtroHoraActivo) quitarBtn.style.display = "none";
  quitarBtn.addEventListener("click", () => {
    const p = getQueryParams();
    window.location.href = `lado.html?loc=${p.loc}&can=${p.can}&lado=${p.lado}`;
  });
  filtroDiv.appendChild(quitarBtn);
  filtroDiv.style.display = "flex";
}

function createPreviewOverlay(videoSrc, duration, parentCard) {
  const preview = document.createElement("video");
  preview.muted = true;
  preview.playsInline = true;
  preview.preload = "none";  // para carga secuencial
  preview.src = videoSrc;
  preview.className = "video-preview";
  preview.setAttribute("aria-label","Vista previa");
  let startTime = duration>15?duration-15:0;
  const endTime = startTime+5;
  preview.addEventListener("loadedmetadata",()=>{ preview.currentTime = startTime; });
  preview.addEventListener("timeupdate",()=>{ if(preview.currentTime>=endTime) preview.currentTime=startTime; });
  const io = new IntersectionObserver(entries=>{
    entries.forEach(entry=>{
      visibilityMap.set(preview,entry.intersectionRatio);
      let max=0,winner=null;
      visibilityMap.forEach((r,node)=>{ if(r>max){max=r;winner=node;} });
      if(winner===preview && entry.isIntersecting){
        const realVid=parentCard.querySelector("video.real");
        const realPlaying = realVid && !realVid.paused;
        if(!realPlaying){ currentPreviewActive&&currentPreviewActive!==preview&&currentPreviewActive.pause(); currentPreviewActive=preview; preview.play().catch(()=>{}); }
      } else preview.pause();
    });
  },{threshold:[0.25,0.5,0.75]});
  io.observe(preview);
  preview.addEventListener("click",()=>{
    const realVid=parentCard.querySelector("video.real");
    if(realVid){ preview.style.display="none"; realVid.style.display="block"; realVid.currentTime=0; realVid.play(); }
  });
  return preview;
}

function setupMutualExclusion(vs){ vs.forEach(v=>v.addEventListener("play",()=>vs.forEach(o=>o!==v&&o.pause()))); }

async function loadPreviewsSequentially(previews){ for(const v of previews){ v.preload="auto"; await new Promise(r=>{ v.addEventListener("loadedmetadata",r,{once:true}); v.load(); }); }}

async function crearBotonAccionCompartir(entry){
  const btn=document.createElement("button");
  btn.className="btn-share-large";
  btn.textContent="Compartir / Descargar";
  btn.title="Compartir video";
  btn.setAttribute("aria-label","Compartir video");
  btn.addEventListener("click",async(e)=>{
    e.preventDefault();
    const original=btn.textContent;
    btn.textContent="Espera un momento...";
    btn.disabled=true;
    try{
      const resp=await fetch(entry.url);
      const blob=await resp.blob();
      const file=new File([blob],entry.nombre,{type:blob.type});
      if(navigator.canShare&&navigator.canShare({files:[file]})) await navigator.share({files:[file],title:"Video Puntazo",text:"Mira este _*PUNTAZO*_ \n www.puntazoclips.com"});
    }catch(err){ console.warn("Share falló",err); }
    btn.textContent=original;
    btn.disabled=false;
  });
  return btn;
}

async function populateVideos(){
  const p=getQueryParams(); const locId=p.loc,canId=p.can,ladoId=p.lado,filtro=p.filtro,target=p.video;
  try{
    const cfg=await (await fetch(`data/config_locations.json?cb=${Date.now()}`,{cache:"no-store"})).json();
    const locObj=cfg.locaciones.find(l=>l.id===locId);
    const canObj=locObj?.cancha.find(c=>c.id===canId);
    const ladoObj=canObj?.lados.find(l=>l.id===ladoId);
    if(!ladoObj||!ladoObj.json_url) return document.getElementById("videos-container").innerHTML="<p style='color:#fff;'>Lado no encontrado.</p>";
    const vids=(await (await fetch(`${ladoObj.json_url}?cb=${Date.now()}`,{cache:"no-store"})).json()).videos;
    const cont=document.getElementById("videos-container"), loadEl=document.getElementById("loading");
    loadEl&& (loadEl.style.display="block"); cont.innerHTML="";
    ["link-club","link-cancha","nombre-lado"].forEach(id=>{const el=document.getElementById(id); if(el)el.textContent=(id==="link-club"?locObj.nombre:(id==="link-cancha"?canObj.nombre:ladoObj.nombre));});
    createHourFilterUI(vids);
    let toRender=vids.filter(v=>!filtro||v.nombre.match(/_(\d{2})/)[1]===filtro);
    allVideos=[];
    toRender.forEach(entry=>{
      const raw=entry.url, match=entry.nombre.match(/_(\d{2})(\d{2})/),hour=match?parseInt(match[1],10):null,minute=match?match[2]:"",ampm=hour!=null?(hour>=12?"PM":"AM"):"",display=hour!=null?`${hour%12||12}:${minute} ${ampm}`:entry.nombre.replace(".mp4","");
      const card=document.createElement("div");card.className="video-card";card.id=entry.nombre;
      const title=document.createElement("div");title.className="video-title";title.textContent=display;card.appendChild(title);
      const wrap=document.createElement("div");wrap.style.position="relative";wrap.style.width="100%";
      const realV=document.createElement("video");realV.classList.add("real");realV.controls=true;realV.playsInline=true;realV.preload="metadata";realV.src=raw;realV.style.display="none";realV.style.width="100%";realV.style.borderRadius="6px";
      const prev=createPreviewOverlay(raw,entry.duracion||60,card);
      wrap.appendChild(realV);wrap.appendChild(prev);card.appendChild(wrap);
      const btnCont=document.createElement("div");btnCont.style.display="flex";btnCont.style.marginTop="12px";
      crearBotonAccionCompartir(entry).then(btn=>{btn.style.flex="1";btnCont.appendChild(btn);});
      card.appendChild(btnCont);cont.appendChild(card);allVideos.push(realV);
    });
    setupMutualExclusion(allVideos);
    // carga previews en serie
    const previews=Array.from(document.querySelectorAll("video.video-preview"));
    loadPreviewsSequentially(previews);
    loadEl&&(loadEl.style.display="none");
    if(target) scrollToVideoById(target);
  }catch(err){console.error("Error en populateVideos():",err);document.getElementById("videos-container").innerHTML="<p style='color:#fff;'>No hay videos disponibles.</p>";const l=document.getElementById("loading");l&&(l.style.display="none");}
}

function createScrollToTopBtn(){
  const btn=document.createElement("button");btn.textContent="↑";btn.className="scroll-top";btn.style.display="none";btn.setAttribute("aria-label","Ir arriba");btn.addEventListener("click",scrollToTop);document.body.appendChild(btn);
  let lastY=window.scrollY;window.addEventListener("scroll",()=>{const y=window.scrollY, cards=document.querySelectorAll(".video-card");btn.style.display=(y>100&&y<lastY&&cards.length>3)?"block":"none";lastY=y;});
}

// ----------------------- arranque -----------------------
document.addEventListener("DOMContentLoaded",()=>{
  const path=window.location.pathname;
  if(path.endsWith("index.html")||path.endsWith("/")) populateLocaciones();
  else if(path.endsWith("locacion.html")) populateCanchas();
  else if(path.endsWith("cancha.html")) populateLados();
  else if(path.endsWith("lado.html")) { populateVideos(); createScrollToTopBtn(); }
  const btnVolver=document.getElementById("btn-volver");
  if(btnVolver){const p=getQueryParams();
    if(path.endsWith("lado.html")) btnVolver.href=`cancha.html?loc=${p.loc}&can=${p.can}`;
    else if(path.endsWith("cancha.html")) btnVolver.href=`locacion.html?loc=${p.loc}`;
    else if(path.endsWith("locacion.html")) btnVolver.href="index.html";
  }
});
