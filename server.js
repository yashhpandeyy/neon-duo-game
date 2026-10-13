'use strict';
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { pingInterval: 12000, pingTimeout: 20000, maxHttpBufferSize: 16 * 1024 });
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, activeRooms: rooms.size }));
const PORT = process.env.PORT || 3000;
const W = 1040, H = 620, R = 17, FPS = 30, WIN_SCORE = 5;
const rooms = new Map();
const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const rnd = (a, b) => a + Math.random() * (b - a);
const finite = (v, fallback = 0) => typeof v === 'number' && Number.isFinite(v) ? v : fallback;
const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 16) || 'Player';
const randCode = () => { let code; do { code = Array.from({length: 5}, () => CHARS[Math.floor(Math.random()*CHARS.length)]).join(''); } while (rooms.has(code)); return code; };
const duelBlocks = [
  { x: 490, y: 95, w: 60, h: 154 }, { x: 490, y: 371, w: 60, h: 154 },
  { x: 268, y: 283, w: 114, h: 54 }, { x: 658, y: 283, w: 114, h: 54 }
];
const coopBlocks = [
  {x: 260, y: 100, w: 48, h: 185}, {x: 260, y: 390, w: 48, h: 130},
  {x: 460, y: 215, w: 50, h: 190}, {x: 755, y: 220, w: 35, h: 180}
];
const coopLevels = [
  { title: 'ACT I · FIRST CONTACT', subtitle: 'Find the light. Trust your partner.', gems: [[170,135],[440,95],[615,505]], bots: 2 },
  { title: 'ACT II · THE CROSSOVER', subtitle: 'Stick together when the grid fights back.', gems: [[155,470],[395,148],[585,475],[690,110]], bots: 4 },
  { title: 'ACT III · HEART OF THE GRID', subtitle: 'One last connection. Get out together.', gems: [[125,115],[390,510],[550,105],[690,510],[712,275]], bots: 6 }
];
function player(slot, id, name) {
  return {slot, id, name: cleanName(name), x: slot === 0 ? 115 : 925, y: slot === 0 ? 310 : 310,
    a: slot === 0 ? 0 : Math.PI, hp: 100, score: 0, dashCd: 0, dashTimer: 0,
    invuln: 0, fireCd: 0, down: false, revive: 0, respawn: 0, kills: 0,
    input: { dx:0,dy:0,aimX:slot===0?920:120,aimY:310,shoot:false,dash:false,interact:false },
    lastDash:false, lastInput: Date.now() };
}
function newGame(room) {
  room.game = { mode: room.mode, status: 'playing', t: 0, seq: 0, players: room.members.map((m,i) => player(i,m.id,m.name)),
    bullets: [], particles: [], pickups: [], bots: [], gems: [], blocks: [], gate: null,
    padCharge: 0, padActive: false, gateTimer: 0, portal: {x:958,y:310,r:46},
    level: 0, countdown: 3, winner: null, announcement: '', annUntil: 0, progress: 0, eventId: 0 };
  if (room.mode === 'duel') {
    room.game.blocks = duelBlocks.map(o => ({...o}));
    announce(room.game, 'FIRST TO FIVE WINS · FIGHT!', 2.4);
  } else setupCoopLevel(room.game, 0);
}
function announce(g, text, seconds = 2) { g.announcement = text; g.annUntil = g.t + seconds; g.eventId++; }
function setupCoopLevel(g, level) {
  g.level = level; g.gems = coopLevels[level].gems.map(([x,y],i) => ({id:i,x,y,got:false}));
  g.blocks = coopBlocks.map(b=>({...b}));
  if (level >= 1) g.blocks.push({x:595,y:225,w:80,h:32});
  g.gate = { x: 833, y: 44, w: 23, h: 532 };
  g.gateTimer = 0; g.padCharge = 0; g.padActive = false;
  g.portal = {x:955,y:310,r:44};
  g.bots = Array.from({length:coopLevels[level].bots}, (_,i) => ({ id:i, x: rnd(375,720), y:rnd(75,540), hp: 65 + level*8, a:0, shootCd:rnd(.8,2), speed: 70+level*8, alive:true }));
  g.bullets = []; g.pickups = []; g.particles = [];
  for (const p of g.players) {
    p.x = 110 + p.slot*75; p.y = 290 + p.slot*40; p.hp = 100; p.down = false; p.revive = 0;
    p.invuln = 2; p.fireCd=0; p.dashCd=0; p.respawn=0;
  }
  g.countdown = level === 0 ? 3 : 1.5;
  announce(g, coopLevels[level].title, 3.3);
}
function publicGame(g) {
  if (!g) return null;
  return { mode:g.mode, status:g.status, t:Math.round(g.t*10)/10, seq:g.seq,
    players:g.players.map(p => ({slot:p.slot, name:p.name, x:p.x,y:p.y,a:p.a,hp:p.hp,score:p.score,dashCd:p.dashCd,invuln:p.invuln,down:p.down,revive:p.revive,respawn:p.respawn})),
    bullets:g.bullets.map(b => ({x:b.x,y:b.y,team:b.team,byBot:b.byBot})),
    bots:g.bots.map(b=>({x:b.x,y:b.y,hp:b.hp,alive:b.alive,a:b.a})),
    blocks:g.blocks, gems:g.gems, pickups:g.pickups,gate:g.gate,gateTimer:g.gateTimer,
    padCharge:g.padCharge,portal:g.portal,level:g.level,countdown:g.countdown,winner:g.winner,
    announcement:g.t<g.annUntil ? g.announcement : '',eventId:g.eventId,
    title:g.mode==='coop'?coopLevels[g.level].title:'NEON DUEL',
    subtitle:g.mode==='coop'?coopLevels[g.level].subtitle:'First to 5 wins · No mercy',
    progress:g.progress};
}
function publicLobby(room) {
  return {code:room.code,mode:room.mode,host:room.members[0]?.id,
    members:room.members.map((m,i)=>({id:m.id,slot:i,name:m.name})),
    status:room.game?.status || 'waiting'};
}
function emitLobby(room) {io.to(room.code).emit('lobby',publicLobby(room));}
function circleRect(x,y,r,b) {
  const cx = clamp(x,b.x,b.x+b.w), cy=clamp(y,b.y,b.y+b.h);
  return (x-cx)**2+(y-cy)**2<r*r;
}
function hitsWall(x,y,r,blocks) {return blocks.some(b => circleRect(x,y,r,b));}
function collides(x,y,r,g) {
  if(x<r+28 || y<r+28 || x>W-r-28 || y>H-r-28) return true;
  if(hitsWall(x,y,r,g.blocks)) return true;
  if(g.mode==='coop' && g.gate && g.gateTimer<=0 && circleRect(x,y,r,g.gate)) return true;
  return false;
}
function moveCircle(o, dx,dy, r,g) {
  if(!collides(o.x+dx,o.y,r,g)) o.x+=dx;
  if(!collides(o.x,o.y+dy,r,g)) o.y+=dy;
}
function spawnBullet(g,p,bot=false) {
  const angle = p.a;
  g.bullets.push({x:p.x+Math.cos(angle)*25,y:p.y+Math.sin(angle)*25,
    vx:Math.cos(angle)*(bot?350:730),vy:Math.sin(angle)*(bot?350:730),
    team:bot?-1:p.slot,byBot:bot,ttl:bot?2.1:1.35,damage:bot?12:20});
  if(g.bullets.length>170)g.bullets.splice(0,20);
}
function hurt(g,p,amt,from) {
  if(p.down || p.respawn>0 || p.invuln>0) return;
  p.hp=clamp(p.hp-amt,0,100);
  if(p.hp<=0){
    if(g.mode==='duel') {
      p.respawn=2.2;
      const killer=g.players[from];
      if(killer) {killer.score++; killer.kills++; announce(g,`${killer.name.toUpperCase()} SCORES!`,1.6);}
      if(killer && killer.score>=WIN_SCORE){g.status='finished';g.winner=killer.slot;announce(g,`${killer.name.toUpperCase()} WINS THE DUEL!`,999);}
    } else {
      p.down=true;p.revive=0;announce(g,`${p.name.toUpperCase()} IS DOWN — HOLD E TO REVIVE!`,2.8);
      if(g.players.every(pl=>pl.down)){setupCoopLevel(g,g.level);announce(g,'BOTH DOWN · TRY AGAIN!',2.5);}
    }
  }
}
function tickRoom(room,dt){
  const g=room.game;
  if(!g || g.status!=='playing')return;
  g.t+=dt;g.seq++;
  if(g.countdown>0){g.countdown=Math.max(0,g.countdown-dt);return;}
  for(const p of g.players){
    p.dashCd=Math.max(0,p.dashCd-dt);p.fireCd=Math.max(0,p.fireCd-dt);
    p.invuln=Math.max(0,p.invuln-dt);
    if(p.respawn>0){
      p.respawn=Math.max(0,p.respawn-dt);
      if(p.respawn===0){p.hp=100;p.invuln=1.65;p.x=p.slot===0?115:925;p.y=310;}
      continue;
    }
    if(p.down) continue;
    const input=p.input;
    let dx=clamp(finite(input.dx),-1,1),dy=clamp(finite(input.dy),-1,1);
    const mag=Math.hypot(dx,dy); if(mag>1){dx/=mag;dy/=mag;}
    const ax=clamp(finite(input.aimX,p.x+100),0,W),ay=clamp(finite(input.aimY,p.y),0,H);
    if(Math.hypot(ax-p.x,ay-p.y)>5) p.a=Math.atan2(ay-p.y,ax-p.x);
    if(input.dash && !p.lastDash && p.dashCd===0 && (mag>.1)){
      p.dashCd=2.9;p.dashTimer=.19;p.invuln=.22;
    }
    p.lastDash=!!input.dash;
    p.dashTimer=Math.max(0,p.dashTimer-dt);
    moveCircle(p,dx*(p.dashTimer>0?680:238)*dt,dy*(p.dashTimer>0?680:238)*dt,R,g);
    if(input.shoot && p.fireCd===0){p.fireCd=g.mode==='coop'?.16:.19;spawnBullet(g,p);}
  }
  for(let i=g.bullets.length-1;i>=0;i--){
    const b=g.bullets[i];b.x+=b.vx*dt;b.y+=b.vy*dt;b.ttl-=dt;
    if(b.ttl<=0 || collides(b.x,b.y,5,g)){g.bullets.splice(i,1);continue;}
    let used=false;
    if(g.mode==='duel'){
      for(const p of g.players)if(p.slot!==b.team && p.respawn===0 && Math.hypot(p.x-b.x,p.y-b.y)<R+6){hurt(g,p,b.damage,b.team);used=true;break;}
    } else if(b.byBot){
      for(const p of g.players)if(!p.down && Math.hypot(p.x-b.x,p.y-b.y)<R+6){hurt(g,p,b.damage,-1);used=true;break;}
    } else {
      for(const bot of g.bots)if(bot.alive && Math.hypot(bot.x-b.x,bot.y-b.y)<22){
        bot.hp-=b.damage;used=true;
        if(bot.hp<=0){bot.alive=false;announce(g,'DRONE ELIMINATED!',1.2);}
        break;
      }
    }
    if(used)g.bullets.splice(i,1);
  }
  if(g.mode==='duel') tickDuel(g,dt); else tickCoop(g,dt);
}
function tickDuel(g,dt){
  // A restorative heart appears periodically to shift the momentum.
  if(g.t>7 && g.pickups.length===0 && Math.floor((g.t-7)/11)!==Math.floor((g.t-dt-7)/11)){
    const spots=[[520,310],[195,120],[840,490],[185,490],[840,125]];
    const [x,y]=spots[Math.floor(Math.random()*spots.length)];
    g.pickups.push({x,y,kind:'heal',ttl:8});
  }
  for(let i=g.pickups.length-1;i>=0;i--){
    const item=g.pickups[i];item.ttl-=dt;
    for(const p of g.players)if(p.respawn===0 && Math.hypot(item.x-p.x,item.y-p.y)<30){
      p.hp=Math.min(100,p.hp+32);item.ttl=0;announce(g,`${p.name.toUpperCase()} PICKED UP +32 HP`,1.3);
    }
    if(item.ttl<=0)g.pickups.splice(i,1);
  }
}
function tickCoop(g,dt){
  for(const gem of g.gems) if(!gem.got && g.players.some(p=>!p.down && Math.hypot(gem.x-p.x,gem.y-p.y)<27)){
    gem.got=true;announce(g,'ENERGY SHARD COLLECTED!',1.25);
  }
  const pads=[{x:638,y:134},{x:638,y:486}];
  const onPads=g.players.every(p=>!p.down && dist(p,pads[p.slot])<43);
  const allGems=g.gems.every(v=>v.got);
  if(allGems && onPads && g.gateTimer<=0)g.padCharge=Math.min(1,g.padCharge+dt/1.35);
  else if(g.gateTimer<=0)g.padCharge=Math.max(0,g.padCharge-dt*1.3);
  if(g.padCharge>=1 && g.gateTimer<=0){g.gateTimer=15;announce(g,'GATE OPEN! BOTH GET TO THE PORTAL!',3);}
  if(g.gateTimer>0)g.gateTimer=Math.max(0,g.gateTimer-dt);
  if(g.gateTimer===0 && g.padCharge===1)g.padCharge=0;
  if(g.gateTimer>0 && g.players.every(p=>!p.down && dist(p,g.portal)<55)){
    if(g.level>=coopLevels.length-1){g.status='finished';g.winner='team';announce(g,'YOU DID IT — TOGETHER. ♡',999);}
    else setupCoopLevel(g,g.level+1);
    return;
  }
  for(const p of g.players)if(p.down){
    const partner=g.players[1-p.slot];
    if(!partner.down && partner.input.interact && dist(p,partner)<75) p.revive=Math.min(1,p.revive+dt/1.8);
    else p.revive=Math.max(0,p.revive-dt*.5);
    if(p.revive>=1){p.down=false;p.hp=60;p.revive=0;p.invuln=1.5;announce(g,`${p.name.toUpperCase()} REVIVED!`,1.5);}
  }
  for(const bot of g.bots)if(bot.alive){
    const living=g.players.filter(p=>!p.down);
    if(!living.length)continue;
    const target=living.sort((a,b)=>dist(bot,a)-dist(bot,b))[0];
    bot.a=Math.atan2(target.y-bot.y,target.x-bot.x);
    const range=dist(bot,target);
    const speed=bot.speed*dt;
    if(range>140)moveCircle(bot,Math.cos(bot.a)*speed,Math.sin(bot.a)*speed,19,g);
    if(range<70)hurt(g,target,14*dt,-1);
    bot.shootCd-=dt;
    if(bot.shootCd<=0 && range<470){spawnBullet(g,bot,true);bot.shootCd=1.65+rnd(0,.8);}
  }
}
function getRoom(socket){return rooms.get(socket.data.roomCode);}
function safely(socket, event, fn){ try{fn();}catch(err){console.error(`[${event}]`,err);socket.emit('gameError','Something went wrong. Please try again.');} }
function leaveRoom(socket){
  const room=getRoom(socket);if(!room)return;
  room.members=room.members.filter(m=>m.id!==socket.id);
  socket.leave(room.code);socket.data.roomCode=null;
  room.game=null;
  if(!room.members.length){rooms.delete(room.code);return;}
  // The remaining player becomes slot 0 / host so a new joiner can take slot 1.
  const survivor = io.sockets.sockets.get(room.members[0].id);
  if (survivor) survivor.emit('joined', {code:room.code, slot:0});
  emitLobby(room);io.to(room.code).emit('notice','Your partner left the room. Waiting for them to rejoin.');
}
io.on('connection',socket=>{
  socket.on('createRoom',({name,mode}={})=>safely(socket,'createRoom',()=>{
    leaveRoom(socket);
    if(!['duel','coop'].includes(mode))mode='duel';
    const code=randCode();const room={code,mode,members:[{id:socket.id,name:cleanName(name)}],game:null,created:Date.now()};
    rooms.set(code,room);socket.data.roomCode=code;socket.join(code);
    socket.emit('joined',{code,slot:0});emitLobby(room);
  }));
  socket.on('joinRoom',({name,code}={})=>safely(socket,'joinRoom',()=>{
    code=String(code||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,5);
    if(socket.data.roomCode===code){socket.emit('gameError','You are already in this room.');return;}
    const room=rooms.get(code);
    if(!room){socket.emit('gameError','Room not found. Check the five-letter code.');return;}
    if(room.members.length>=2){socket.emit('gameError','Room full — only two players allowed.');return;}
    leaveRoom(socket);
    const slot=room.members.length;room.members.push({id:socket.id,name:cleanName(name)});
    socket.data.roomCode=code;socket.join(code);
    socket.emit('joined',{code,slot});emitLobby(room);
    io.to(code).emit('notice','Both players connected! Host can start the game.');
  }));
  socket.on('setMode',mode=>safely(socket,'setMode',()=>{
    const room=getRoom(socket);if(!room||room.members[0]?.id!==socket.id || !['duel','coop'].includes(mode))return;
    room.mode=mode;room.game=null;emitLobby(room);
  }));
  socket.on('startGame',()=>safely(socket,'startGame',()=>{
    const room=getRoom(socket);
    if(!room||room.members[0]?.id!==socket.id || room.members.length!==2)return;
    newGame(room);emitLobby(room);io.to(room.code).emit('gameStarted',publicGame(room.game));
  }));
  socket.on('backLobby',()=>safely(socket,'backLobby',()=>{
    const room=getRoom(socket);if(!room||room.members[0]?.id!==socket.id)return;
    room.game=null;emitLobby(room);
  }));
  socket.on('input',data=>{
    const room=getRoom(socket);if(!room || !room.game || room.game.status!=='playing')return;
    const p=room.game.players.find(p=>p.id===socket.id);if(!p||!data||typeof data!=='object')return;
    p.input={dx:clamp(finite(data.dx),-1,1),dy:clamp(finite(data.dy),-1,1),
      aimX:clamp(finite(data.aimX,p.x+100),0,W),aimY:clamp(finite(data.aimY,p.y),0,H),
      shoot:!!data.shoot,dash:!!data.dash,interact:!!data.interact};p.lastInput=Date.now();
  });
  socket.on('leaveRoom',()=>leaveRoom(socket));
  socket.on('disconnect',()=>leaveRoom(socket));
});
const loop = () => {
  for(const room of rooms.values()){
    if(room.game?.status==='playing')tickRoom(room,1/FPS);
    if(room.game && room.members.length===2)io.to(room.code).emit('state',publicGame(room.game));
  }
};
setInterval(loop,1000/FPS);
setInterval(()=>{
  const now=Date.now();for(const room of rooms.values())if(now-room.created>24*60*60*1000 && !room.members.length)rooms.delete(room.code);
},3600000).unref();
server.listen(PORT,()=>console.log(`NEON DUO ready on port ${PORT}`));