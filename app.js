(() => {
  'use strict';

  // ===== Canvas & Layout =====
  const cvs = document.getElementById('game');
  const ctx = cvs.getContext('2d');

  const UI = {
    score: document.getElementById('score'),
    lives: document.getElementById('lives'),
    level: document.getElementById('level'),
    btnLeft: document.getElementById('btnLeft'),
    btnRight: document.getElementById('btnRight'),
    btnFire: document.getElementById('btnFire'),
    btnPause: document.getElementById('btnPause'),
    btnRestart: document.getElementById('btnRestart')
  };

  // Responsive scale (keep aspect ratio 2:3)
  function fitCanvas() {
    const w = cvs.parentElement.clientWidth;
    const h = window.innerHeight * 0.72;
    const scale = Math.min(w / 360, h / 540);
    cvs.style.width = (360 * scale) + 'px';
    cvs.style.height = (540 * scale) + 'px';
  }
  window.addEventListener('resize', fitCanvas);
  window.addEventListener('orientationchange', fitCanvas);
  fitCanvas();

  // ===== Audio (WebAudio minimal) =====
  const Audio = (()=>{
    const Ctx = window.AudioContext || window.webkitAudioContext;
    let ctx, vol;
    function ensure(){
      if (!ctx){ ctx = new Ctx(); vol = ctx.createGain(); vol.gain.value = 0.12; vol.connect(ctx.destination); }
      return ctx;
    }
    function beep({f=440, t=0.08, type='square', slide=0, decay=0.002, startVol=0.85}){
      const c = ensure();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f, c.currentTime);
      if (slide){ o.frequency.exponentialRampToValueAtTime(Math.max(40,f*slide), c.currentTime + t); }
      g.gain.setValueAtTime(startVol, c.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + t - decay);
      o.connect(g); g.connect(vol);
      o.start(); o.stop(c.currentTime + t);
    }
    function noise({t=0.05, bp=1500}){
      const c = ensure();
      const bufferSize = Math.floor(c.sampleRate * t);
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i=0;i<bufferSize;i++){ data[i] = Math.random()*2-1; }
      const src = c.createBufferSource(); src.buffer = buffer;
      const biquad = c.createBiquadFilter(); biquad.type='bandpass'; biquad.frequency.value=bp; biquad.Q.value=0.5;
      const g = c.createGain(); g.gain.value = 0.25;
      src.connect(biquad); biquad.connect(g); g.connect(vol);
      src.start(); src.stop(c.currentTime+t);
    }
    return {
      unlock(){ ensure(); },
      shoot(){ beep({f:880, t:0.06, type:'square'}); },
      hitShroom(){ beep({f:220, t:0.04, type:'triangle'}); },
      hitSegment(head=false){ head ? beep({f:660, t:0.08, type:'sawtooth'}) : beep({f:520, t:0.06, type:'sawtooth'}); },
      bonusSpider(){ beep({f:900, t:0.06, type:'square'}); beep({f:1200, t:0.08, type:'square'}); },
      lose(){ noise({t:0.22, bp:500}); beep({f:180, t:0.2, type:'triangle', slide:0.4}); },
      levelUp(){ beep({f:600, t:0.08}); beep({f:760, t:0.08}); beep({f:920, t:0.1}); }
    };
  })();

  // ===== Grid & Helpers =====
  const CELL = 12;               // logical cell size
  const COLS = Math.floor(cvs.width / CELL); // 30
  const ROWS = Math.floor(cvs.height / CELL); // 45
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const rand = (a,b) => Math.floor(Math.random()*(b-a+1))+a;

  // ===== Game State =====
  const STATE = {
    running: true,
    score: 0,
    lives: 3,
    level: 1,
    bullets: [],
    shrooms: new Map(),  // key "x,y" -> hp (1..4)
    centipedes: [],
    spider: null,
    inputs: { left:false, right:false, fire:false }
  };

  // ===== Entities =====
  const player = {
    w: CELL*2, h: CELL,
    x: (COLS*CELL)/2 - CELL,
    y: (ROWS-2)*CELL,
    speed: 180, // px/s
    fireCooldown: 0,
    fireDelay: 140, // ms
  };

  function key(x,y){ return `${x},${y}`; }

  function addShroom(cx, cy, hp=4) {
    if (cy > ROWS-4) return;
    const k = key(cx,cy);
    STATE.shrooms.set(k, clamp(hp,1,4));
  }

  function damageShroom(cx, cy) {
    const k = key(cx,cy);
    if (!STATE.shrooms.has(k)) return false;
    const hp = STATE.shrooms.get(k)-1;
    if (hp<=0) STATE.shrooms.delete(k); else STATE.shrooms.set(k, hp);
    return true;
  }

  function spawnInitialShrooms(density=0.08) {
    STATE.shrooms.clear();
    for (let y=2; y<ROWS-6; y++) {
      for (let x=1; x<COLS-1; x++) {
        if (Math.random() < density) addShroom(x,y, rand(2,4));
      }
    }
  }

  // Centipede: array of segments [{x,y,dir}] dir=+1 right, -1 left, head at index 0
  function spawnCentipede(len=12, speedCellsPerSec=8) {
    const dir = Math.random()<0.5 ? 1 : -1;
    const startX = dir>0 ? 2 : COLS-3;
    const row = 0;
    const segs = [];
    for (let i=0;i<len;i++){
      segs.push({x: startX - i*dir, y: row, dir, moveTimer:0, speed: speedCellsPerSec, head: i===0});
    }
    STATE.centipedes.push(segs);
  }

  function splitCentipede(centi, hitIndex){
    const seg = centi[hitIndex];
    addShroom(seg.x, seg.y, 4);
    const tail = centi.slice(hitIndex+1);
    const headPart = centi.slice(0, hitIndex);
    if (headPart.length>0) headPart[0].head = true;
    if (tail.length>0){
      tail[0].head = true;
      STATE.centipedes.push(tail);
    }
    return headPart;
  }

  function spawnSpider(){
    STATE.spider = {
      x: rand(0, COLS-1)*CELL, y: rand((ROWS-12)*CELL, (ROWS-5)*CELL),
      vx: (Math.random()<0.5?-1:1)* (60 + rand(0,40)),
      vy: (Math.random()<0.5?-1:1)* (60 + rand(0,40)),
      r: CELL*0.9, alive:true, timer: 12000
    };
  }

  function reset(level=1){
    STATE.level = level;
    STATE.bullets.length = 0;
    STATE.centipedes.length = 0;
    spawnInitialShrooms(0.06 + (level-1)*0.01);
    spawnCentipede(10 + Math.min(10, level*2), 7 + Math.min(6, level));
    STATE.spider = null;
  }

  // ===== Rendering =====
  function drawBG(){
    ctx.fillStyle = '#0e1117';
    ctx.fillRect(0,0,cvs.width,cvs.height);
    ctx.fillStyle = '#161a22';
    const ROWS = Math.floor(cvs.height/12), COLS = Math.floor(cvs.width/12);
    for (let y=0;y<ROWS;y++){
      for (let x=0;x<COLS;x++){
        if (((x+y)&7)===0) ctx.fillRect(x*12, y*12, 1,1);
      }
    }
  }
  function drawPlayer(){
    ctx.fillStyle = '#e6e6e6';
    ctx.fillRect(player.x, player.y, player.w, player.h);
    ctx.fillStyle = '#6cd061';
    ctx.fillRect(player.x+2, player.y+2, player.w-4, player.h-4);
  }
  function drawBullets(){
    ctx.fillStyle = '#a9d1ff';
    for (const b of STATE.bullets) {
      ctx.fillRect(b.x, b.y, 2, 8);
    }
  }
  function drawShrooms(){
    for (const [k,hp] of STATE.shrooms.entries()){
      const [cx,cy] = k.split(',').map(Number);
      const x = cx*12, y = cy*12;
      const c = ['#2a3a2a','#3b5f3b','#4f8a4f','#6cd061'][hp-1] || '#6cd061';
      ctx.fillStyle = c;
      ctx.fillRect(x+2, y+2, 12-4, 12-4);
      ctx.fillStyle = '#233';
      ctx.fillRect(x+4, y+4, 12-8, 12-8);
    }
  }
  function drawCentipedes(){
    for (const segs of STATE.centipedes){
      for (let i=segs.length-1;i>=0;i--){
        const s = segs[i];
        const x = s.x*12, y = s.y*12;
        ctx.fillStyle = i===0 ? '#ffcc66' : '#6cd061';
        ctx.fillRect(x+2, y+2, 12-4, 12-4);
        ctx.fillStyle = '#2a3040';
        ctx.fillRect(x+1, y+12-3, 12-2, 2);
      }
    }
  }
  function drawSpider(){
    const sp = STATE.spider;
    if (!sp || !sp.alive) return;
    ctx.fillStyle = '#ff6b6b';
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, sp.r*0.5, 0, Math.PI*2);
    ctx.fill();
    ctx.strokeStyle = '#652a2a';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sp.x-sp.r*0.7, sp.y-2); ctx.lineTo(sp.x+sp.r*0.7, sp.y-2);
    ctx.moveTo(sp.x-sp.r*0.6, sp.y+2); ctx.lineTo(sp.x+sp.r*0.6, sp.y+2);
    ctx.stroke();
  }

  // ===== Update =====
  let last = performance.now();
  function loop(now){
    const dt = Math.min(48, now-last);
    last = now;
    if (STATE.running) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  function update(dt){
    const dx =
      (STATE.inputs.left ? -1 : 0) +
      (STATE.inputs.right ? +1 : 0);
    player.x += dx * player.speed * (dt/1000);
    player.x = clamp(player.x, 0, cvs.width-player.w);

    player.fireCooldown -= dt;
    if ((STATE.inputs.fire) && player.fireCooldown<=0){
      STATE.bullets.push({x: player.x + player.w/2 - 1, y: player.y-8, vy: -420});
      player.fireCooldown = player.fireDelay;
      Audio.shoot();
    }

    for (let i=STATE.bullets.length-1;i>=0;i--){
      const b = STATE.bullets[i];
      b.y += b.vy * (dt/1000);
      if (b.y < -12) { STATE.bullets.splice(i,1); continue; }

      const cx = Math.floor((b.x)/12), cy = Math.floor(b.y/12);
      if (damageShroom(cx,cy)){
        STATE.score += 1;
        Audio.hitShroom();
        STATE.bullets.splice(i,1);
        continue;
      }

      let hit = false;
      for (let c=STATE.centipedes.length-1;c>=0; c--){
        const segs = STATE.centipedes[c];
        for (let s=0; s<segs.length; s++){
          const seg = segs[s];
          const rx = seg.x*12, ry = seg.y*12;
          if (b.x >= rx && b.x <= rx+12 && b.y >= ry && b.y <= ry+12){
            STATE.score += (s===0?10:5);
            Audio.hitSegment(s===0);
            const headPart = splitCentipede(segs, s);
            if (headPart.length>0) STATE.centipedes[c] = headPart; else STATE.centipedes.splice(c,1);
            STATE.bullets.splice(i,1);
            hit = true;
            break;
          }
        }
        if (hit) break;
      }
    }

    for (let ci=STATE.centipedes.length-1; ci>=0; ci--){
      const segs = STATE.centipedes[ci];
      const speed = segs[0]?.speed || 6;
      for (let s=0; s<segs.length; s++){
        segs[s].moveTimer = (segs[s].moveTimer||0) + dt;
      }
      if ((segs[0].moveTimer||0) >= 1000/speed){
        for (let s=0; s<segs.length; s++) segs[s].moveTimer = 0;
        const head = segs[0];
        let nx = head.x + head.dir;
        let ny = head.y;
        const blocked = (nx<0 || nx>=Math.floor(cvs.width/12)) || STATE.shrooms.has(`${nx},${ny}`);
        if (blocked){
          head.dir *= -1;
          ny = head.y + 1;
          nx = clamp(head.x + head.dir, 0, Math.floor(cvs.width/12)-1);
        }
        for (let s=segs.length-1; s>0; s--){
          segs[s].x = segs[s-1].x;
          segs[s].y = segs[s-1].y;
          segs[s].dir = segs[s-1].dir;
        }
        head.x = nx; head.y = ny;

        if (head.y >= Math.floor(cvs.height/12)-2){
          loseLife();
          break;
        }
      }
    }

    if (!STATE.spider && Math.random()<0.003) spawnSpider();
    if (STATE.spider){
      const sp = STATE.spider;
      sp.timer -= dt;
      sp.x += sp.vx * (dt/1000);
      sp.y += sp.vy * (dt/1000);
      if (sp.x<10 || sp.x>cvs.width-10) sp.vx*=-1;
      if (sp.y<Math.floor(cvs.height*0.65) || sp.y>cvs.height-10) sp.vy*=-1;
      if (sp.timer<=0) STATE.spider=null;

      for (let i=STATE.bullets.length-1;i>=0;i--){
        const b = STATE.bullets[i];
        const dx = b.x - sp.x, dy = b.y - sp.y;
        if (dx*dx+dy*dy <= (sp.r*0.5)**2){
          STATE.score += 100;
          Audio.bonusSpider();
          STATE.bullets.splice(i,1); STATE.spider=null; break;
        }
      }

      if (sp){
        const px = player.x+player.w/2, py = player.y+player.h/2;
        const dx = px - sp.x, dy = py - sp.y;
        if (dx*dx+dy*dy <= (sp.r+10)**2) loseLife();
      }
    }

    if (STATE.centipedes.length===0){
      STATE.level += 1;
      Audio.levelUp();
      UI.level.textContent = STATE.level;
      reset(STATE.level);
      STATE.score += 200;
    }

    UI.score.textContent = STATE.score;
    UI.lives.textContent = STATE.lives;
  }

  function loseLife(){
    STATE.lives -= 1;
    Audio.lose();
    UI.lives.textContent = STATE.lives;
    if (STATE.lives <= 0){
      STATE.running = false;
      toast('GAME OVER — premi R per ripartire');
    } else {
      STATE.bullets.length = 0;
      player.x = (Math.floor(cvs.width/12)*12)/2 - player.w/2;
      for (const segs of STATE.centipedes){
        for (const s of segs){ s.y = Math.max(0, s.y-3); }
      }
      toast('💥 Hai perso una vita!');
    }
  }

  function render(){
    drawBG();
    drawShrooms();
    drawCentipedes();
    drawSpider();
    drawBullets();
    drawPlayer();
  }

  const keys = {};
  function setFire(v){ STATE.inputs.fire = v; }
  function setLeft(v){ STATE.inputs.left = v; }
  function setRight(v){ STATE.inputs.right = v; }

  window.addEventListener('keydown', e => {
    keys[e.code]=true;
    if (e.code==='ArrowLeft' || e.code==='KeyA') setLeft(true);
    if (e.code==='ArrowRight' || e.code==='KeyD') setRight(true);
    if (e.code==='Space' || e.code==='Enter') setFire(true);
    if (e.code==='KeyP'){ Audio.unlock(); STATE.running = !STATE.running; toast(STATE.running?'▶ Riprendi':'⏸ Pausa'); }
    if (e.code==='KeyR'){ Audio.unlock(); startGame(); }
  });
  window.addEventListener('keyup', e => {
    keys[e.code]=false;
    if (e.code==='ArrowLeft' || e.code==='KeyA') setLeft(false);
    if (e.code==='ArrowRight' || e.code==='KeyD') setRight(false);
    if (e.code==='Space' || e.code==='Enter') setFire(false);
  });

  UI.btnLeft.addEventListener('touchstart', e=>{e.preventDefault(); Audio.unlock(); setLeft(true);});
  UI.btnLeft.addEventListener('touchend', e=>{e.preventDefault(); setLeft(false);});
  UI.btnRight.addEventListener('touchstart', e=>{e.preventDefault(); Audio.unlock(); setRight(true);});
  UI.btnRight.addEventListener('touchend', e=>{e.preventDefault(); setRight(false);});
  UI.btnFire.addEventListener('touchstart', e=>{e.preventDefault(); Audio.unlock(); setFire(true);});
  UI.btnFire.addEventListener('touchend', e=>{e.preventDefault(); setFire(false);});

  UI.btnPause.addEventListener('click', ()=>{ Audio.unlock(); STATE.running = !STATE.running; toast(STATE.running?'▶ Riprendi':'⏸ Pausa'); });
  UI.btnRestart.addEventListener('click', ()=> { Audio.unlock(); startGame(); });

  let toastTimer=0;
  function toast(msg){
    let el = document.getElementById('toast');
    if (!el){
      el = document.createElement('div');
      el.id='toast';
      el.style.position='absolute';
      el.style.left='50%';
      el.style.top='30%';
      el.style.transform='translate(-50%,-50%)';
      el.style.background='rgba(0,0,0,.6)';
      el.style.color='#fff';
      el.style.padding='10px 14px';
      el.style.border='1px solid #2a3040';
      el.style.borderRadius='10px';
      el.style.pointerEvents='none';
      el.style.zIndex='9';
      document.getElementById('stageWrap').appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(()=>{ el.style.opacity='0'; }, 1400);
  }

  function startGame(){
    STATE.running = true;
    STATE.score = 0;
    STATE.lives = 3;
    UI.score.textContent = 0;
    UI.lives.textContent = 3;
    reset(1);
    toast('Pronto! Usa ◀ ▶ e spara');
  }

  const unlockers = ['touchstart','mousedown','keydown'];
  unlockers.forEach(ev => window.addEventListener(ev, ()=>Audio.unlock(), {once:true}));

  startGame();
  requestAnimationFrame(loop);
})();