// === CONFIG ===
const DENSITY = 2;
const BASE_ROWS = 20, BASE_CELL = 30;
const rows = BASE_ROWS * DENSITY;
const cellSize = Math.floor(BASE_CELL / DENSITY);

const TURN_MS = 3000;
const STEP_MS = 80;
const KEY_LAYOUT = "dvorak"; // or "qwerty"

// Colours
const PURPLE = "#c084fc";     // P1 dots
const ORANGE = "#ff9966";     // lighter, redder orange for P2
function lighten(hex, p=0.12){
  const n=parseInt(hex.slice(1),16), r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  const lr=Math.round(r+(255-r)*p), lg=Math.round(g+(255-g)*p), lb=Math.round(b+(255-b)*p);
  return `#${(1<<24 | lr<<16 | lg<<8 | lb).toString(16).slice(1)}`;
}
const PURPLE_RING = lighten(PURPLE,0.12);
const ORANGE_RING = lighten(ORANGE,0.12);

// 8-way headings (0..7) → dx,dy. Note: y+ is down on canvas.
const DIRS = [
  {dx: 1, dy: 0}, {dx: 1, dy:-1}, {dx: 0, dy:-1}, {dx:-1, dy:-1},
  {dx:-1, dy: 0}, {dx:-1, dy: 1}, {dx: 0, dy: 1}, {dx: 1, dy: 1}
];

// Controls
function p2Keys(layout){ return layout==="dvorak" ? {L:"a", R:"e", U:",", D:"o"} : {L:"a", R:"d", U:"w", D:"s"}; }
const TOGGLE_KEYS = KEY_LAYOUT==="dvorak" ? ["z", "."] : ["q", "p"]; // per-player seed toggle
const PLAYERS = [
  { id:0, name:"Purple", color:PURPLE, ring:PURPLE_RING, keys:{L:"ArrowLeft", R:"ArrowRight", U:"ArrowUp", D:"ArrowDown"} },
  { id:1, name:"Orange", color:ORANGE, ring:ORANGE_RING, keys:p2Keys(KEY_LAYOUT) }
];

// === DOT / GRID ===
class Dot{
  // kind: "coral" | "wall"; angleIdx 0..7 for wall
  constructor(x,y,color,size,kind="coral",angleIdx=null){
    this.x=x; this.y=y; this.color=color; this.kind=kind; this.angleIdx=angleIdx;
    this.size=size;
    this.fullSize = Math.floor(Math.random()*6)+9;   // 9–14
    this.clonedTimer = 60;
  }
  grow(dt){
    const rate = this.kind==="wall" ? 1.8 : 1.0;     // walls metabolise faster
    // halved growth overall
    this.size = Math.min(this.size + (dt/1000)*rate, this.fullSize);
  }
  canReproduce(){ return this.size>=this.fullSize && this.clonedTimer<1; }
  draw(ctx){
    const cx=this.x*cellSize+cellSize/2, cy=this.y*cellSize+cellSize/2;
    if(this.kind==="wall"){
      const d = DIRS[this.angleIdx||0] || DIRS[0];
      const angle = Math.atan2(d.dy, d.dx);         // align pill to heading
      const rw=Math.max(6,cellSize*0.85), rh=Math.max(4,cellSize*0.38);
      const r=Math.min(rh/2,rw/2), w=rw, h=rh;
      ctx.save(); ctx.translate(cx,cy); ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(-w/2+r, -h/2);
      ctx.lineTo( w/2-r, -h/2); ctx.arc(w/2-r,-h/2+r,r,-Math.PI/2,0);
      ctx.lineTo( w/2,  h/2-r); ctx.arc(w/2-r, h/2-r, r, 0, Math.PI/2);
      ctx.lineTo(-w/2+r, h/2);  ctx.arc(-w/2+r, h/2-r, r, Math.PI/2, Math.PI);
      ctx.lineTo(-w/2, -h/2+r); ctx.arc(-w/2+r,-h/2+r,r,Math.PI,1.5*Math.PI);
      ctx.closePath(); ctx.fillStyle=this.color; ctx.globalAlpha=0.95; ctx.fill();
      ctx.restore();
    } else {
      ctx.beginPath();
      ctx.arc(cx, cy, this.size/2, 0, 2*Math.PI);
      ctx.fillStyle=this.color; ctx.fill();
    }
  }
  update(dt,grid){
    if(this.clonedTimer>0) this.clonedTimer-=1;
    this.grow(dt);
    if(!this.canReproduce()) return;

    if(this.kind==="wall"){
      const P_BEND = 1/5;     // when forward is free
      const P_BRANCH = 1/1000;  // when forward blocked

      const straightIdx = this.angleIdx ?? 0;
      const fwd = DIRS[straightIdx];
      const fx=this.x+fwd.dx, fy=this.y+fwd.dy;
      const fwdFree = fx>=0 && fx<grid.width && fy>=0 && fy<grid.height && !grid.grid[fx][fy];

      if (fwdFree){
        // maybe bend ±45° (only if that cell is free), else go straight
        let newIdx = straightIdx;
        if (Math.random() < P_BEND){
          const left = (straightIdx+7)&7, right=(straightIdx+1)&7;
          const cand = Math.random()<0.5 ? left : right;
          const dv = DIRS[cand], tx=this.x+dv.dx, ty=this.y+dv.dy;
          if (tx>=0 && tx<grid.width && ty>=0 && ty<grid.height && !grid.grid[tx][ty]) newIdx=cand;
        }
        const step = DIRS[newIdx]; grid.addDot(new Dot(this.x+step.dx, this.y+step.dy, this.color, 3, "wall", newIdx));
        this.clonedTimer = 20;
      } else {
        // blocked straight: very rarely branch ±45° if free
        if (Math.random() < P_BRANCH){
          const opts = [ (straightIdx+7)&7, (straightIdx+1)&7 ]; // left, right
          // randomise try order
          if (Math.random()<0.5) opts.reverse();
          let placed=false;
          for (const idx of opts){
            const d=DIRS[idx], nx=this.x+d.dx, ny=this.y+d.dy;
            if (nx>=0&&nx<grid.width&&ny>=0&&ny<grid.height&&!grid.grid[nx][ny]){
              grid.addDot(new Dot(nx, ny, this.color, 3, "wall", idx));
              this.clonedTimer=20; placed=true; break;
            }
          }
          if(!placed) this.clonedTimer=12;
        } else {
          this.clonedTimer = 12;
        }
      }
    } else {
      const spots=grid.getAvailablePositions(this.x,this.y);
      if(spots.length){
        const pos=spots[Math.floor(Math.random()*spots.length)];
        grid.addDot(new Dot(pos.x,pos.y,this.color,3,"coral"));
        this.clonedTimer=60;
      }
    }
  }
}
class Grid{
  constructor(w,h){ this.width=w; this.height=h; this.grid=Array(w).fill().map(()=>Array(h).fill(null)); }
  addDot(dot){ if(!this.grid[dot.x][dot.y]){ this.grid[dot.x][dot.y]=dot; return true; } return false; }
  clear(){ for(let x=0;x<this.width;x++) for(let y=0;y<this.height;y++) this.grid[x][y]=null; }
  getAvailablePositions(x,y){
    const a=[]; for(let dx=-1;dx<=1;dx++) for(let dy=-1;dy<=1;dy++){
      const nx=x+dx, ny=y+dy;
      if(nx>=0&&nx<this.width&&ny>=0&&ny<this.height&&!this.grid[nx][ny]) a.push({x:nx,y:ny});
    } return a;
  }
  draw(ctx){ for(let x=0;x<this.width;x++) for(let y=0;y<this.height;y++) if(this.grid[x][y]) this.grid[x][y].draw(ctx); }
  update(dt){ for(let x=0;x<this.width;x++) for(let y=0;y<this.height;y++) if(this.grid[x][y]) this.grid[x][y].update(dt,this); }
  hasEmpty(){ for(let x=0;x<this.width;x++) for(let y=0;y<this.height;y++) if(!this.grid[x][y]) return true; return false; }
  countByColor(c){ let n=0; for(let x=0;x<this.width;x++) for(let y=0;y<this.height;y++) if(this.grid[x][y]?.color===c) n++; return n; }
  allCells(){ const out=[]; for(let y=0;y<this.height;y++) for(let x=0;x<this.width;x++) if(this.grid[x][y]) out.push({x,y,color:this.grid[x][y].color}); return out; }
}

// === CANVAS & STATE ===
let lastTime = Date.now();
const canvas = document.querySelector('#canvas');
const ctx = canvas.getContext('2d');
const dpr = window.devicePixelRatio || 1;
const container = canvas.parentElement;
const cs = getComputedStyle(container);
const padX = parseFloat(cs.paddingLeft)+parseFloat(cs.paddingRight);
const innerW = Math.max(0, container.clientWidth - padX);
const cols = Math.max(1, Math.floor(innerW / cellSize));
const grid = new Grid(cols, rows);

canvas.style.display='block'; canvas.style.margin='0';
canvas.width  = cols*cellSize*dpr; canvas.height = rows*cellSize*dpr;
canvas.style.width  = (cols*cellSize)+'px';
canvas.style.height = (rows*cellSize)+'px';

const cursors = [
  { x:Math.floor(cols*0.25), y:Math.floor(rows/2), dir:null, nextStepAt:0 },
  { x:Math.floor(cols*0.75), y:Math.floor(rows/2), dir:null, nextStepAt:0 }
];
let active = 0;
let turnEndsAt = performance.now()+TURN_MS;
let gameOver = false;
let highlightAnim = null;

// Per-player seed selection: 0=coral, 1..8=wall heading
const SEED_OPTIONS = 9;
const seedsIdx = [0, 0];
function seedOf(pi){ const idx=seedsIdx[pi]; return idx===0 ? {kind:"coral", angleIdx:null} : {kind:"wall", angleIdx:(idx-1)}; }

// HUD
const $turnName=document.getElementById('turnName');
const $timer=document.getElementById('timer');
const $p1Name=document.getElementById('p1Name');
const $p2Name=document.getElementById('p2Name');
const $p1Score=document.getElementById('p1Score');
const $p2Score=document.getElementById('p2Score');
const $nextDot=document.getElementById('nextDot'); // optional colour puck if present
$p1Name.textContent=PLAYERS[0].name; $p2Name.textContent=PLAYERS[1].name;

function setNextPreview(){ if($nextDot){ $nextDot.style.color = PLAYERS[active].ring; } }
function updateHUD(){
  $turnName.textContent=PLAYERS[active].name;
  $p1Score.textContent=grid.countByColor(PLAYERS[0].color);
  $p2Score.textContent=grid.countByColor(PLAYERS[1].color);
  const t=Math.max(0,(turnEndsAt-performance.now())/1000); $timer.textContent=t.toFixed(1);
}
function nextTurn(){ active=(active+1)%2; turnEndsAt=performance.now()+TURN_MS; setNextPreview(); }

// Movement + toggles
const dirVec={L:{dx:-1,dy:0}, R:{dx:1,dy:0}, U:{dx:0,dy:-1}, D:{dx:0,dy:1}};
const keyToDir=[
  Object.fromEntries(Object.entries(PLAYERS[0].keys).map(([d,k])=>[k,d])),
  Object.fromEntries(Object.entries(PLAYERS[1].keys).map(([d,k])=>[k,d]))
];
window.addEventListener('keydown', (e)=>{
  if(e.key===TOGGLE_KEYS[0]){ seedsIdx[0]=(seedsIdx[0]+1)%SEED_OPTIONS; e.preventDefault(); return; }
  if(e.key===TOGGLE_KEYS[1]){ seedsIdx[1]=(seedsIdx[1]+1)%SEED_OPTIONS; e.preventDefault(); return; }
  for(let i=0;i<2;i++){ const d=keyToDir[i][e.key]; if(d){ cursors[i].dir=d; e.preventDefault(); } }
});
window.addEventListener('keyup', (e)=>{
  for(let i=0;i<2;i++){ const d=keyToDir[i][e.key]; if(d && cursors[i].dir===d){ cursors[i].dir=null; e.preventDefault(); } }
});
canvas.addEventListener('click',(ev)=>{
  const r=canvas.getBoundingClientRect();
  const sx=(canvas.width/dpr)/r.width, sy=(canvas.height/dpr)/r.height;
  const x=Math.floor(((ev.clientX-r.left)*sx)/cellSize);
  const y=Math.floor(((ev.clientY-r.top )*sy)/cellSize);
  if(x>=0&&x<grid.width&&y>=0&&y<rows){ cursors[active].x=x; cursors[active].y=y; }
});
function stepCursors(now){
  for(let i=0;i<2;i++){
    const c=cursors[i];
    if(!c.dir) continue;
    if(now>=c.nextStepAt){
      const v=dirVec[c.dir];
      c.x=Math.max(0,Math.min(grid.width-1,c.x+v.dx));
      c.y=Math.max(0,Math.min(rows-1,c.y+v.dy));
      c.nextStepAt=now+STEP_MS;
    }
  }
}

// Placement
function tryPlaceActive(){
  const c=cursors[active], seed=seedOf(active);
  if(seed.kind==="wall"){
    grid.addDot(new Dot(c.x,c.y,PLAYERS[active].color,8,"wall",seed.angleIdx));
  } else {
    grid.addDot(new Dot(c.x,c.y,PLAYERS[active].color,7,"coral"));
  }
  nextTurn();
}

// Rings
function drawCircleRing(x,y,color,scale=1,alpha=1){
  const cx=x*cellSize+cellSize/2, cy=y*cellSize+cellSize/2, r=(cellSize/2-4)*scale;
  ctx.save(); ctx.scale(dpr,dpr); ctx.globalAlpha=alpha;
  ctx.beginPath(); ctx.lineWidth=3; ctx.strokeStyle=color;
  ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke(); ctx.restore();
}
function drawPillRing(x,y,color,angleIdx,scale=1,alpha=1){
  const d=DIRS[angleIdx||0]||DIRS[0]; const angle=Math.atan2(d.dy,d.dx);
  const cx=x*cellSize+cellSize/2, cy=y*cellSize+cellSize/2;
  const baseW=cellSize*0.9, baseH=cellSize*0.42, w=baseW*scale, h=baseH*scale, r=Math.min(h/2,w/2);
  ctx.save(); ctx.scale(dpr,dpr); ctx.globalAlpha=alpha; ctx.translate(cx,cy); ctx.rotate(angle);
  ctx.beginPath(); ctx.lineWidth=3; ctx.strokeStyle=color;
  ctx.moveTo(-w/2+r, -h/2);
  ctx.lineTo( w/2-r, -h/2); ctx.arc(w/2-r, -h/2+r, r, -Math.PI/2, 0);
  ctx.lineTo( w/2,  h/2-r); ctx.arc(w/2-r,  h/2-r, r, 0, Math.PI/2);
  ctx.lineTo(-w/2+r, h/2);  ctx.arc(-w/2+r,  h/2-r, r, Math.PI/2, Math.PI);
  ctx.lineTo(-w/2, -h/2+r); ctx.arc(-w/2+r, -h/2+r, r, Math.PI, 1.5*Math.PI);
  ctx.stroke(); ctx.restore();
}

// tally flash
function flashDot(x,y){
  const cx=x*cellSize+cellSize/2, cy=y*cellSize+cellSize/2;
  ctx.save(); ctx.scale(dpr,dpr); ctx.globalAlpha=0.6;
  ctx.fillStyle="#ffffff"; ctx.beginPath(); ctx.arc(cx,cy,(cellSize/2-5),0,Math.PI*2); ctx.fill(); ctx.restore();
}

// Scene
function drawScene(){
  ctx.save(); ctx.scale(dpr,dpr);
  ctx.clearRect(0,0,canvas.width/dpr, canvas.height/dpr);
  grid.draw(ctx); ctx.restore();

  const remain=Math.max(0,turnEndsAt-performance.now());
  const p=1-(remain/TURN_MS);
  const activeScale = 1.9 - 1.0*p;
  const activeScaleDot = activeScale * 1.5;   // dots read larger than pills
  const blink = remain<300 && Math.floor(remain/100)%2===0;

  const s0=seedOf(0), s1=seedOf(1);
  if(active===0){
    // inactive P2
    if(s1.kind==="wall") drawPillRing(cursors[1].x,cursors[1].y,PLAYERS[1].ring,s1.angleIdx,1.0,0.95);
    else drawCircleRing(cursors[1].x,cursors[1].y,PLAYERS[1].ring,1.0,0.95);
    // active P1
    if(!blink){
      if(s0.kind==="wall") drawPillRing(cursors[0].x,cursors[0].y,PLAYERS[0].ring,s0.angleIdx,activeScale,1.0);
      else drawCircleRing(cursors[0].x,cursors[0].y,PLAYERS[0].ring,activeScaleDot,1.0);
    }
  } else {
    if(s0.kind==="wall") drawPillRing(cursors[0].x,cursors[0].y,PLAYERS[0].ring,s0.angleIdx,1.0,0.95);
    else drawCircleRing(cursors[0].x,cursors[0].y,PLAYERS[0].ring,1.0,0.95);
    if(!blink){
      if(s1.kind==="wall") drawPillRing(cursors[1].x,cursors[1].y,PLAYERS[1].ring,s1.angleIdx,activeScale,1.0);
      else drawCircleRing(cursors[1].x,cursors[1].y,PLAYERS[1].ring,activeScaleDot,1.0);
    }
  }

  if(highlightAnim && highlightAnim.show){
    flashDot(highlightAnim.x,highlightAnim.y);
    const rc = (highlightAnim.color===PLAYERS[0].color?PLAYERS[0].ring:PLAYERS[1].ring);
    drawCircleRing(highlightAnim.x,highlightAnim.y,rc,1.25,0.85);
  }
}

// Loop
function gameLoop(){
  const nowMS=Date.now(), dt=nowMS-lastTime; lastTime=nowMS;
  if(gameOver) return;

  stepCursors(performance.now());
  if(performance.now()>=turnEndsAt) tryPlaceActive();

  grid.update(dt);
  drawScene();
  updateHUD();

  if(!grid.hasEmpty()){ gameOver=true; startWinCountAnimation(); return; }
  requestAnimationFrame(gameLoop);
}

// Winner tally
function startWinCountAnimation(){
  const cells=grid.allCells(); let i=0,c0=0,c1=0;
  const SHOW_MS=40, STEP_MS_FAST=10;
  function step(){
    if(i<cells.length){
      const cell=cells[i++]; if(cell.color===PLAYERS[0].color) c0++; else if(cell.color===PLAYERS[1].color) c1++;
      $p1Score.textContent=c0; $p2Score.textContent=c1;
      highlightAnim={x:cell.x,y:cell.y,color:cell.color,show:true};
      drawScene();
      setTimeout(()=>{ if(highlightAnim){ highlightAnim.show=false; drawScene(); } }, SHOW_MS);
      setTimeout(step, STEP_MS_FAST);
    } else {
      highlightAnim=null;
      const msg=c0===c1?"Draw":((c0>c1?PLAYERS[0].name:PLAYERS[1].name)+" wins");
      $timer.textContent=msg;
    }
  } step();
}

// Reset
document.getElementById('reset')?.addEventListener('click', ()=>{
  grid.clear();
  cursors[0]={x:Math.floor(cols*0.25), y:Math.floor(rows/2), dir:null, nextStepAt:0};
  cursors[1]={x:Math.floor(cols*0.75), y:Math.floor(rows/2), dir:null, nextStepAt:0};
  seedsIdx[0]=0; seedsIdx[1]=0;
  active=0; turnEndsAt=performance.now()+TURN_MS; gameOver=false; highlightAnim=null;
  lastTime=Date.now(); setNextPreview(); requestAnimationFrame(gameLoop);
});

// Init
document.getElementById('turnName').textContent=PLAYERS[active].name;
setNextPreview();
lastTime=Date.now(); requestAnimationFrame(gameLoop);