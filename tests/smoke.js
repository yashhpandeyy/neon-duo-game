/* Run: node tests/smoke.js — dependency-free logic smoke tests. */
const assert=require('assert');
const vm=require('vm');
const fs=require('fs');
const io={ handlers:{},sockets:{sockets:new Map()},on(k,v){this.handlers[k]=v;},to(room){return {emit:(event,data)=>{
  for(const sock of io.sockets.sockets.values())if(sock.joined.has(room))sock.emit(event,data);
}}}};
class FakeSocket {
  constructor(id){this.id=id;this.data={};this.joined=new Set();this.handlers={};this.messages=[];io.sockets.sockets.set(id,this);io.handlers.connection(this);}
  on(event,fn){this.handlers[event]=fn;}
  trigger(event,data){assert(this.handlers[event],`missing ${event}`);this.handlers[event](data);}
  emit(event,data){this.messages.push({event,data});}
  join(room){this.joined.add(room);}
  leave(room){this.joined.delete(room);}
  last(event){return this.messages.filter(x=>x.event===event).at(-1)?.data;}
}
const fakeExpress=()=>({use(){},get(){}});fakeExpress.static=()=>{};
const fakeRequire=n=>n==='express'?fakeExpress:n==='http'?{createServer:()=>({listen(){}})}:n==='socket.io'?{Server:class {constructor(){return io;}}}:require(n);
let tick;
const fakeInterval=(fn,ms)=>{if(ms<1000)tick=fn;return{unref(){}};};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'..','server.js'),'utf8'),{
  require:fakeRequire,process:{env:{}},console,setInterval:fakeInterval,
});
const alice=new FakeSocket('alice');
alice.trigger('createRoom',{name:'Alex',mode:'duel'});
const joined=alice.last('joined');assert(joined.code.length===5);assert.equal(joined.slot,0);
const bob=new FakeSocket('bob');bob.trigger('joinRoom',{name:'Sam',code:joined.code});
assert.equal(bob.last('joined').slot,1);assert.equal(alice.last('lobby').members.length,2);
alice.trigger('startGame');assert.equal(alice.last('gameStarted').mode,'duel');
alice.trigger('input',{dx:0,dy:-1,aimX:900,aimY:300,shoot:false});
for(let i=0;i<108;i++)tick();
const duel=alice.last('state');assert(duel.players[0].y<310,'movement should be server simulated');
assert.equal(duel.players[1].name,'Sam');
assert(duel.countdown>=0,'countdown is included');
// Align both players in the small open firing lane, then test real projectile hits.
alice.trigger('input',{dx:0,dy:1,aimX:925,aimY:265,shoot:false});
bob.trigger('input',{dx:0,dy:-1,aimX:115,aimY:265,shoot:false});
for(let i=0;i<6;i++)tick();
bob.trigger('input',{dx:0,dy:0,aimX:115,aimY:265,shoot:false});
for(let i=0;i<5;i++)tick();
alice.trigger('input',{dx:0,dy:0,aimX:925,aimY:265,shoot:true});
for(let i=0;i<100;i++)tick();
const afterShots=bob.last('state');
assert(afterShots.players[1].hp<100||afterShots.players[0].score>0,'projectiles should damage opponent');
alice.trigger('backLobby');assert.equal(bob.last('lobby').status,'waiting');
alice.trigger('setMode','coop');assert.equal(bob.last('lobby').mode,'coop');
alice.trigger('startGame');assert.equal(bob.last('gameStarted').gems.length,3);
for(let i=0;i<115;i++)tick();
const coop=alice.last('state');assert.equal(coop.level,0);assert.equal(coop.gems.length,3);assert.equal(coop.bots.length,2);
alice.trigger('leaveRoom');assert.equal(bob.last('joined').slot,0);assert.equal(bob.last('lobby').members.length,1);
const charlie=new FakeSocket('charlie');charlie.trigger('joinRoom',{name:'Charlie',code:joined.code});
assert.equal(charlie.last('joined').slot,1);bob.trigger('startGame');assert.equal(charlie.last('gameStarted').players[0].name,'Sam');
console.log('PASS: create, join, start, input, ticks, switch modes, co-op state, host migration, rejoin.');