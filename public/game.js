(() => {
  'use strict';
  const W=1040,H=620,TAU=Math.PI*2;
  const $=id=>document.getElementById(id);
  const socket=io({ reconnection:true,reconnectionAttempts:5 });
  const el={menu:$('menu'),lobby:$('lobby'),game:$('game'),toast:$('toast'),name:$('nameInput'),code:$('codeInput'),
    modeDuel:$('selectDuel'),modeCoop:$('selectCoop'),create:$('createBtn'),join:$('joinBtn'),
    lobbyDuel:$('lobbyDuel'),lobbyCoop:$('lobbyCoop'),start:$('startBtn'),roomCode:$('roomCode'),
    canvas:$('arena'),stage:$('gameStage'),sound:$('soundToggle')};
  const ctx=el.canvas.getContext('2d',{alpha:false});
  let mode='duel',room=null,slot=0,game=null,smooth={},audio=null,muted=false,mouse={x:520,y:310,active:false,shoot:false};
  let lobbyData=null,latestEvent=-1,lastHp=100,lastShot=0,toastTimer=0,autoJoined=false,isTouch=false,dashTapUntil=0;
  const held=new Set(),pad={dx:0,dy:0,fire:false,use:false,dash:false};
  const stars=Array.from({length:92},(_,i)=>({x:(i*763.4)%W,y:(i*257.3)%H,r:.8+(i%3)*.32,a:.07+(i%8)*.027}));
  const colors=['#ff6484','#4be9f5'];
  const now=()=>performance.now();
  const clip=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  const view=name=>{for(const v of [el.menu,el.lobby,el.game])v.classList.add('hidden');el[name].classList.remove('hidden');};
  function toast(s){el.toast.textContent=s;el.toast.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.toast.classList.remove('show'),3000);}
  function tone(freq=440,kind='sine',length=.1,vol=.03){if(muted)return;try{audio=audio||new (window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();const o=audio.createOscillator(),g=audio.createGain();o.type=kind;o.frequency.setValueAtTime(freq,audio.currentTime);o.frequency.exponentialRampToValueAtTime(Math.max(70,freq*.63),audio.currentTime+length);g.gain.setValueAtTime(vol,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+length);o.connect(g);g.connect(audio.destination);o.start();o.stop(audio.currentTime+length)}catch(_){}}
  function selectMode(v){mode=v;el.modeDuel.classList.toggle('active',v==='duel');el.modeCoop.classList.toggle('active',v==='coop');tone(410,'triangle',.06,.02);}
  function validName(){let name=el.name.value.trim();if(!name){name='Player';el.name.value=name;}try{localStorage.setItem('neonDuoNick',name);}catch(_){}return name;}
  function inviteUrl(){return `${location.origin}${location.pathname}?room=${encodeURIComponent(room)}`;}
  async function copy(value,label){try{await navigator.clipboard.writeText(value);toast(`${label} copied — send it to your partner!`);}catch(_){const input=document.createElement('textarea');input.value=value;document.body.appendChild(input);input.select();document.execCommand('copy');input.remove();toast(`${label} copied!`);}tone(620);}
  function joined(payload){room=payload.code;slot=payload.slot;history.replaceState({},'',`?room=${room}`);$('roomCode').textContent=room;$('gameRoomCode').textContent=room;view('lobby');tone(740,'sine',.15);}
  function updateLobby(data){lobbyData=data;room=data.code;mode=data.mode;
    $('roomCode').textContent=room;$('gameRoomCode').textContent=room;
    $('lobbyP1').textContent=data.members[0]?.name||'Waiting...';$('lobbyP2').textContent=data.members[1]?.name||'Waiting for invite...';
    $('p1Status').textContent=data.members[0]?'● CONNECTED':'○ WAITING';
    $('p2Status').textContent=data.members[1]?'● CONNECTED':'○ WAITING';
    $('p2Status').classList.toggle('absent',!data.members[1]);
    const host=data.host===socket.id,ready=data.members.length===2;
    el.start.disabled=!host || !ready;el.start.textContent=!host?'WAITING FOR HOST TO START...':!ready?'WAITING FOR SECOND PLAYER...':'START GAME →';
    for(const button of [el.lobbyDuel,el.lobbyCoop]){button.classList.toggle('active',button.dataset.mode===mode);button.disabled=!host;}
    if(data.status==='waiting'){game=null;view('lobby');}
  }
  function begin(g){game=g;smooth={};lastHp=100;latestEvent=g.eventId;view('game');$('endOverlay').classList.add('hidden');tone(640,'sawtooth',.15,.025);setTimeout(()=>tone(880,'triangle',.25),125);updateHud();}
  function gameEnd(){
    const co=game.mode==='coop',win=co||game.winner===slot;
    $('endTitle').textContent=co?'THE GRID IS SAVED ♡':win?'YOU WIN!':'REVENGE TIME?';
    $('endTitle').style.color=co||win?'#caff8a':'#ff7b99';
    $('endDescription').textContent=co?'Three stages. Two people. One unstoppable team.':win?'You are officially the superior gamer. Tell them.':'You lost this round. The rematch is personal.';
    $('endOverlay').classList.remove('hidden');$('playAgainBtn').disabled=lobbyData?.host!==socket.id;
    $('playAgainBtn').textContent=lobbyData?.host===socket.id?'PLAY AGAIN ↗':'WAITING FOR HOST TO REMATCH...';
    tone(co||win?660:220,'triangle',.38,.045);
  }
  socket.on('connect',()=>{ $('statusText').textContent='CONNECTED ONLINE';$('statusDot').classList.add('online');if(autoJoined&&room)toast('Reconnected. Rejoin your room if needed.');autoJoined=true;});
  socket.on('disconnect',()=>{$('statusText').textContent='OFFLINE · RECONNECTING';$('statusDot').classList.remove('online');toast('Connection lost — reconnecting...');});
  socket.on('joined',joined);
  socket.on('lobby',updateLobby);
  socket.on('gameStarted',begin);
  socket.on('notice',toast);
  socket.on('gameError',toast);
  socket.on('state',s=>{
    const was=game?.status;
    game=s;
    if(s.eventId!==latestEvent){latestEvent=s.eventId;if(s.announcement)tone(s.mode==='coop'?650:490,'triangle',.15,.035);}
    if(was!=='finished'&&s.status==='finished')gameEnd();
    updateHud();
  });
  el.modeDuel.addEventListener('click',()=>selectMode('duel'));el.modeCoop.addEventListener('click',()=>selectMode('coop'));
  el.create.addEventListener('click',()=>{if(!socket.connected)return toast('Connecting to game server...');socket.emit('createRoom',{name:validName(),mode});});
  el.join.addEventListener('click',()=>{if(!socket.connected)return toast('Connecting to game server...');const code=el.code.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);if(code.length!==5)return toast('Enter the 5-letter invite code.');socket.emit('joinRoom',{name:validName(),code});});
  el.code.addEventListener('input',()=>{el.code.value=el.code.value.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);});
  el.code.addEventListener('keydown',e=>{if(e.key==='Enter')el.join.click();});
  el.name.addEventListener('keydown',e=>{if(e.key==='Enter')el.create.click();});
  for(const button of [el.lobbyDuel,el.lobbyCoop])button.addEventListener('click',()=>socket.emit('setMode',button.dataset.mode));
  el.start.addEventListener('click',()=>socket.emit('startGame'));
  $('copyCodeBtn').addEventListener('click',()=>copy(room,'Room code'));
  $('copyLinkBtn').addEventListener('click',()=>copy(inviteUrl(),'Invite link'));
  $('copyInviteInGame').addEventListener('click',()=>copy(inviteUrl(),'Invite link'));
  function exit(){socket.emit('leaveRoom');room=null;game=null;history.replaceState({},'',location.pathname);view('menu');tone(270,'triangle',.1);}
  $('leaveLobbyBtn').addEventListener('click',exit);
  $('exitGameBtn').addEventListener('click',()=>{if(confirm('Leave this match and return to the home screen?'))exit();});
  $('playAgainBtn').addEventListener('click',()=>socket.emit('startGame'));
  $('backLobbyBtn').addEventListener('click',()=>{if(lobbyData?.host===socket.id)socket.emit('backLobby');else toast('Ask the host to return everyone to the lobby.');});
  el.sound.addEventListener('click',()=>{muted=!muted;el.sound.classList.toggle('off',muted);el.sound.textContent=muted?'♪̸':'♪';if(!muted)tone(630);});
  function updateHud(){if(!game)return;const p=game.players;const a=p[0],b=p[1];if(!a||!b)return;
    $('nameA').textContent=a.name.toUpperCase();$('nameB').textContent=b.name.toUpperCase();
    $('hpA').style.width=`${a.hp}%`;$('hpB').style.width=`${b.hp}%`;
    $('scoreA').textContent=game.mode==='duel'?a.score:game.gems.filter(v=>v.got).length;
    $('scoreB').textContent=game.mode==='duel'?b.score:game.gems.length;
    $('scoreCenter').textContent=game.mode==='duel'?'VS':'/';
    $('roundLabel').textContent=game.title;$('roundSub').textContent=game.subtitle;
    const local=p[slot];if(local){const cd=local.dashCd;$('specialHint').textContent=local.down?'DOWN · WAIT FOR A REVIVE':local.respawn>0?'RESPAWNING...':cd>0?`DASH RECHARGING · ${cd.toFixed(1)}S`:'⚡ DASH READY';}
    $('countdown').classList.toggle('hidden',game.countdown<=.05||game.status==='finished');
    $('countdown').textContent=Math.ceil(game.countdown);
    $('announcement').classList.toggle('hidden',!game.announcement||game.countdown>0||game.status==='finished');
    $('announcement').textContent=game.announcement;
    const coop=game.mode==='coop';$('coopGuide').classList.toggle('hidden',!coop||game.status==='finished');
    if(coop){const got=game.gems.filter(v=>v.got).length,total=game.gems.length;
      $('coopGuide').textContent=game.gateTimer>0?`GATE OPEN · ${Math.ceil(game.gateTimer)}s · BOTH TO THE PORTAL!`:got<total?`✦ COLLECT SHARDS ${got}/${total} · DEFEAT DRONES`:'✦ ALL SHARDS FOUND · STAND ON YOUR COLOR PAD!';
    }
    const hp=local?.hp??100;if(hp<lastHp)tone(150,'sawtooth',.06,.035);lastHp=hp;
  }
  function getInput(){const p=game?.players?.[slot];if(!p)return null;
    let dx=(held.has('KeyD')||held.has('ArrowRight')?1:0)-(held.has('KeyA')||held.has('ArrowLeft')?1:0)+pad.dx;
    let dy=(held.has('KeyS')||held.has('ArrowDown')?1:0)-(held.has('KeyW')||held.has('ArrowUp')?1:0)+pad.dy;
    const len=Math.hypot(dx,dy);if(len>1){dx/=len;dy/=len;}
    const auto=held.has('Space')||pad.fire;
    let aimX=mouse.x,aimY=mouse.y;
    if(auto){
      const candidates=game.mode==='duel'?game.players.filter(v=>v.slot!==slot&&v.respawn===0):game.bots.filter(b=>b.alive);
      candidates.sort((a,b)=>distance(a,p)-distance(b,p));
      if(candidates[0]){aimX=candidates[0].x;aimY=candidates[0].y;}
      else{aimX=p.x+Math.cos(p.a)*180;aimY=p.y+Math.sin(p.a)*180;}
    }else if(!mouse.active){aimX=p.x+Math.cos(p.a)*180;aimY=p.y+Math.sin(p.a)*180;}
    return {dx,dy,aimX,aimY,shoot:mouse.shoot||held.has('Space')||pad.fire,
      dash:held.has('ShiftLeft')||held.has('ShiftRight')||held.has('KeyQ')||pad.dash||now()<dashTapUntil,
      interact:held.has('KeyE')||pad.use};
  }
  setInterval(()=>{if(!game||game.status!=='playing'||!socket.connected)return;const input=getInput();if(input){socket.emit('input',input);if(input.shoot&&now()-lastShot>210){lastShot=now();tone(390,'triangle',.055,.009);}}},1000/30);
  document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
    if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)&&!el.game.classList.contains('hidden'))e.preventDefault();held.add(e.code);
  });
  document.addEventListener('keyup',e=>held.delete(e.code));window.addEventListener('blur',()=>{held.clear();mouse.shoot=false;pad.fire=false;pad.use=false;pad.dash=false;pad.dx=0;pad.dy=0;});
  function pointerToWorld(e){const r=el.canvas.getBoundingClientRect();return{x:clip((e.clientX-r.left)/r.width*W,0,W),y:clip((e.clientY-r.top)/r.height*H,0,H)};}
  el.canvas.addEventListener('pointermove',e=>{if(e.pointerType==='mouse'){mouse.active=true;Object.assign(mouse,pointerToWorld(e));}});
  el.canvas.addEventListener('pointerdown',e=>{if(e.pointerType==='mouse'&&e.button===0){mouse.active=true;mouse.shoot=true;Object.assign(mouse,pointerToWorld(e));}});
  window.addEventListener('pointerup',e=>{if(e.pointerType==='mouse')mouse.shoot=false;});
  el.canvas.addEventListener('contextmenu',e=>e.preventDefault());
  const stick=$('touchStick'),knob=$('stickKnob');
  function stickMove(e){const b=stick.getBoundingClientRect(),cx=b.left+b.width/2,cy=b.top+b.height/2;
    let x=(e.clientX-cx)/(b.width*.42),y=(e.clientY-cy)/(b.height*.42);const n=Math.hypot(x,y);if(n>1){x/=n;y/=n;}pad.dx=x;pad.dy=y;
    knob.style.left=`${50+x*31}%`;knob.style.top=`${50+y*31}%`;
  }
  function stickReset(){pad.dx=0;pad.dy=0;knob.style.left='50%';knob.style.top='50%';}
  stick.addEventListener('pointerdown',e=>{isTouch=true;stick.setPointerCapture(e.pointerId);stickMove(e);});
  stick.addEventListener('pointermove',e=>{if(stick.hasPointerCapture(e.pointerId))stickMove(e);});
  for(const ev of ['pointerup','pointercancel','lostpointercapture'])stick.addEventListener(ev,stickReset);
  const touchButton=(id,key)=>{const b=$(id);b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);pad[key]=true;});for(const type of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(type,()=>pad[key]=false);};
  touchButton('touchFire','fire');touchButton('touchUse','use');touchButton('touchDash','dash');
  $('touchDash').addEventListener('pointerdown',()=>{dashTapUntil=now()+180;});
  function frame(t){render(t);requestAnimationFrame(frame);}requestAnimationFrame(frame);
  function render(t){if(el.game.classList.contains('hidden')||!game)return;
    const dpr=Math.min(devicePixelRatio||1,2),rect=el.canvas.getBoundingClientRect();
    const dw=Math.max(1,Math.round(rect.width*dpr)),dh=Math.max(1,Math.round(rect.height*dpr));
    if(el.canvas.width!==dw||el.canvas.height!==dh){el.canvas.width=dw;el.canvas.height=dh;}
    ctx.setTransform(dw/W,0,0,dh/H,0,0);
    paintBackground(t);
    if(game.mode==='coop'){drawPortal(t);drawPads(t);}
    drawBlocks(t);if(game.mode==='coop')drawGate(t);
    for(const gem of game.gems)if(!gem.got)drawGem(gem,t);
    for(const pickup of game.pickups)drawPickup(pickup,t);
    for(const bot of game.bots)if(bot.alive)drawBot(bot,t);
    for(const bullet of game.bullets)drawBullet(bullet,t);
    for(const p of game.players)drawPlayer(p,t);
    if(game.mode==='duel')drawDuelLines(t);
    drawFrame();
  }
  function glow(color,blur=15){ctx.shadowColor=color;ctx.shadowBlur=blur;}
  function noGlow(){ctx.shadowBlur=0;}
  function rr(x,y,w,h,r){const rad=Math.min(r,w/2,h/2);ctx.beginPath();ctx.roundRect(x,y,w,h,rad);}
  function paintBackground(t){const gradient=ctx.createLinearGradient(0,0,W,H);gradient.addColorStop(0,'#0e1732');gradient.addColorStop(.55,'#0a1026');gradient.addColorStop(1,'#071329');ctx.fillStyle=gradient;ctx.fillRect(0,0,W,H);
    const pulse=ctx.createRadialGradient(520,310,0,520,310,510);pulse.addColorStop(0,'#24446b42');pulse.addColorStop(1,'#0000');ctx.fillStyle=pulse;ctx.fillRect(0,0,W,H);
    ctx.strokeStyle='#3445642b';ctx.lineWidth=1;
    const shift=(t*.007)%44;for(let x=30;x<W;x+=44){ctx.beginPath();ctx.moveTo(x+shift,28);ctx.lineTo(x+shift,H-28);ctx.stroke();}
    for(let y=30;y<H;y+=44){ctx.beginPath();ctx.moveTo(28,y);ctx.lineTo(W-28,y);ctx.stroke();}
    for(const s of stars){ctx.fillStyle=`rgba(154,195,240,${s.a*(.8+.2*Math.sin(t*.002+s.x))})`;ctx.beginPath();ctx.arc(s.x,s.y,s.r,0,TAU);ctx.fill();}
    ctx.strokeStyle='#455b7b90';ctx.lineWidth=4;rr(28,28,W-56,H-56,13);ctx.stroke();
    ctx.strokeStyle='#253756';ctx.lineWidth=1;rr(36,36,W-72,H-72,12);ctx.stroke();
  }
  function drawBlocks(t){for(const b of game.blocks){ctx.fillStyle='#182942';ctx.strokeStyle='#56759a';ctx.lineWidth=2;glow('#1e9df138',11);rr(b.x,b.y,b.w,b.h,7);ctx.fill();ctx.stroke();noGlow();
      ctx.fillStyle='#263b59';rr(b.x+7,b.y+7,b.w-14,b.h-14,3);ctx.fill();
      ctx.strokeStyle='#5e8aaf88';ctx.lineWidth=1;ctx.setLineDash([9,12]);rr(b.x+5,b.y+5,b.w-10,b.h-10,4);ctx.stroke();ctx.setLineDash([]);
    }}
  function drawFrame(){ctx.strokeStyle='#91d7f070';ctx.lineWidth=4;for(const x of [41,999])for(const y of [41,579]){const sx=x<500?1:-1,sy=y<310?1:-1;ctx.beginPath();ctx.moveTo(x+sx*22,y);ctx.lineTo(x,y);ctx.lineTo(x,y+sy*22);ctx.stroke();}}
  function drawDuelLines(t){ctx.strokeStyle='#ffffff17';ctx.lineWidth=2;ctx.setLineDash([5,14]);ctx.beginPath();ctx.moveTo(W/2,55);ctx.lineTo(W/2,H-55);ctx.stroke();ctx.setLineDash([]);
    ctx.save();ctx.globalAlpha=.1;ctx.fillStyle='#ff6484';ctx.font='800 110px Oxanium';ctx.fillText('01',86,540);ctx.fillStyle='#4be9f5';ctx.textAlign='right';ctx.fillText('02',965,540);ctx.restore();}
  function drawPlayer(p,t){
    const key=`p${p.slot}`,prev=smooth[key];const x=prev?lerp(prev.x,p.x,.45):p.x,y=prev?lerp(prev.y,p.y,.45):p.y;
    smooth[key]={x,y};const color=colors[p.slot];
    if(p.respawn>0){ctx.fillStyle='#ffffff66';ctx.font='700 14px Oxanium';ctx.textAlign='center';ctx.fillText(`RESPAWN ${Math.ceil(p.respawn)}`,x,y-40);return;}
    ctx.save();ctx.translate(x,y);ctx.globalAlpha=p.down?.36:1;
    if(p.invuln>0 && Math.floor(t/100)%2===0)ctx.globalAlpha*=.42;
    const mag=20+Math.sin(t*.005+p.slot)*1.6;
    ctx.beginPath();ctx.arc(0,0,mag+7,0,TAU);ctx.strokeStyle=color+'33';ctx.lineWidth=7;ctx.stroke();
    glow(color,24);ctx.fillStyle=p.slot===0?'#7a274f':'#16647f';ctx.strokeStyle=color;ctx.lineWidth=4;ctx.beginPath();ctx.arc(0,0,19,0,TAU);ctx.fill();ctx.stroke();noGlow();
    ctx.rotate(p.a);ctx.beginPath();ctx.moveTo(9,-10);ctx.lineTo(31,0);ctx.lineTo(9,10);ctx.closePath();ctx.fillStyle=color;ctx.fill();ctx.fillStyle='#ffffffdd';rr(3,-7,7,14,2);ctx.fill();
    ctx.restore();ctx.textAlign='center';ctx.font='800 13px Oxanium';ctx.fillStyle='#dce5ff';ctx.fillText(p.name.toUpperCase(),x,y-39);
    ctx.fillStyle='#1a253c';rr(x-25,y+29,50,5,3);ctx.fill();ctx.fillStyle=color;rr(x-25,y+29,50*p.hp/100,5,3);ctx.fill();
    if(p.down){ctx.fillStyle='#ffb6c6';ctx.font='700 15px Oxanium';ctx.fillText('DOWN · HOLD E TO REVIVE',x,y-54);
      if(p.revive>0){ctx.beginPath();ctx.strokeStyle='#baff8a';ctx.lineWidth=4;ctx.arc(x,y,29,-Math.PI/2,-Math.PI/2+p.revive*TAU);ctx.stroke();}}
    if(p.slot===slot){ctx.save();ctx.strokeStyle='#e5f6ff70';ctx.setLineDash([3,4]);ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(x,y,31,0,TAU);ctx.stroke();ctx.restore();ctx.fillStyle='#fff';ctx.font='800 9px Oxanium';ctx.fillText('YOU',x,y-53);}
  }
  function drawBullet(b,t){const color=b.byBot?'#ff9d56':colors[b.team]||'#ffcf88';ctx.save();ctx.strokeStyle=color+'77';ctx.lineWidth=4;ctx.beginPath();const mx=b.byBot?9:15;const v=Math.hypot(b.x-520,b.y-310);ctx.moveTo(b.x-2*Math.sin(v),b.y+2*Math.cos(v));ctx.lineTo(b.x-6,b.y-5);ctx.stroke();glow(color,18);ctx.fillStyle=color;ctx.beginPath();ctx.arc(b.x,b.y,b.byBot?6:5,0,TAU);ctx.fill();noGlow();ctx.restore();}
  function drawBot(b,t){const a=b.a;ctx.save();ctx.translate(b.x,b.y);ctx.rotate(a);glow('#ffb067',15);ctx.beginPath();ctx.moveTo(24,0);ctx.lineTo(11,19);ctx.lineTo(-18,15);ctx.lineTo(-22,-14);ctx.lineTo(11,-19);ctx.closePath();ctx.fillStyle='#633548';ctx.fill();ctx.strokeStyle='#ff965c';ctx.lineWidth=3;ctx.stroke();noGlow();ctx.fillStyle='#ffe9b9';ctx.fillRect(-7,-5,15,10);ctx.restore();ctx.fillStyle='#a63a4d';rr(b.x-20,b.y-30,40,4,2);ctx.fill();ctx.fillStyle='#ffd17c';rr(b.x-20,b.y-30,40*b.hp/90,4,2);ctx.fill();}
  function drawGem(g,t){const spin=t*.0017+g.id;const bob=Math.sin(t*.003+g.id*2)*4;ctx.save();ctx.translate(g.x,g.y+bob);ctx.rotate(spin);glow('#d0fcff',24);ctx.fillStyle='#55ebed';ctx.strokeStyle='#daffff';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,-15);ctx.lineTo(12,0);ctx.lineTo(0,15);ctx.lineTo(-12,0);ctx.closePath();ctx.fill();ctx.stroke();noGlow();ctx.restore();}
  function drawPickup(item,t){const r=18+Math.sin(t*.004)*2;ctx.save();glow('#caff8a',21);ctx.fillStyle='#3b694f';ctx.strokeStyle='#caff8a';ctx.lineWidth=3;ctx.beginPath();ctx.arc(item.x,item.y,r,0,TAU);ctx.fill();ctx.stroke();noGlow();ctx.fillStyle='#e4ffac';ctx.font='800 23px Oxanium';ctx.textAlign='center';ctx.fillText('+',item.x,item.y+8);ctx.restore();}
  function drawPads(t){const pads=[{x:638,y:134},{x:638,y:486}];pads.forEach((pad,i)=>{const p=game.players[i],active=p&&!p.down&&distance(p,pad)<43;const c=colors[i];ctx.save();ctx.translate(pad.x,pad.y);glow(c,active?24:8);ctx.fillStyle=active?c+'59':c+'1f';ctx.strokeStyle=c;ctx.lineWidth=active?5:3;ctx.beginPath();ctx.arc(0,0,39,0,TAU);ctx.fill();ctx.stroke();noGlow();ctx.setLineDash([5,8]);ctx.lineWidth=2;ctx.beginPath();ctx.arc(0,0,29,0,TAU);ctx.stroke();ctx.setLineDash([]);ctx.fillStyle=c;ctx.textAlign='center';ctx.font='800 14px Oxanium';ctx.fillText(`P${i+1}`,0,5);ctx.restore();});
    if(game.padCharge>0&&game.gateTimer<=0){ctx.strokeStyle='#caff8a';ctx.lineWidth=5;ctx.beginPath();ctx.arc(745,310,34,-Math.PI/2,-Math.PI/2+game.padCharge*TAU);ctx.stroke();}}
  function drawGate(t){if(!game.gate)return;const b=game.gate,opened=game.gateTimer>0;ctx.save();if(opened){ctx.strokeStyle='#baff8a77';ctx.lineWidth=2;ctx.setLineDash([9,10]);ctx.strokeRect(b.x,b.y,b.w,b.h);ctx.setLineDash([]);ctx.fillStyle='#aaff8e';ctx.font='800 17px Oxanium';ctx.textAlign='center';ctx.fillText('OPEN!',b.x+12,33);}else{glow('#ff5577',18);ctx.fillStyle='#6a203e';rr(b.x,b.y,b.w,b.h,6);ctx.fill();noGlow();ctx.fillStyle='#ff6c8c';for(let y=b.y+8;y<b.y+b.h-8;y+=34){rr(b.x+3,y,b.w-6,13,2);ctx.fill();}ctx.font='800 15px Oxanium';ctx.fillStyle='#ffb2c3';ctx.textAlign='center';ctx.fillText('LOCKED',b.x+12,33);}ctx.restore();}
  function drawPortal(t){const p=game.portal,open=game.gateTimer>0;ctx.save();ctx.translate(p.x,p.y);const c=open?'#baff9c':'#8d749d';glow(c,open?30:10);ctx.strokeStyle=c;ctx.lineWidth=5;ctx.setLineDash([12,8]);ctx.beginPath();ctx.arc(0,0,42,t*.0007,t*.0007+TAU);ctx.stroke();ctx.setLineDash([]);ctx.strokeStyle=c+'77';ctx.lineWidth=14;ctx.beginPath();ctx.arc(0,0,28,0,TAU);ctx.stroke();noGlow();ctx.fillStyle=c;ctx.font='800 12px Oxanium';ctx.textAlign='center';ctx.fillText('EXIT',0,5);ctx.restore();}
  // Restore the nickname and read invite URLs for frictionless room joining.
  try{el.name.value=localStorage.getItem('neonDuoNick')||'';}catch(_){el.name.value='';}
  const codeFromUrl=new URLSearchParams(location.search).get('room');
  if(codeFromUrl){el.code.value=codeFromUrl.toUpperCase().slice(0,5);toast('Invite detected. Enter a nickname and press JOIN ROOM.');}
})();