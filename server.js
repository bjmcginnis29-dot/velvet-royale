const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.static("public"));
app.get("/health", (_, res) => res.json({ ok: true }));

const rooms = new Map();
const SUITS = ["♠", "♥", "♦", "♣"];
const freshDeck = () => {
  const d = [];
  for (let s = 0; s < 4; s++) for (let r = 2; r <= 14; r++) d.push({ r, s });
  for (let i = d.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};
const roomCode = () => crypto.randomBytes(3).toString("hex").toUpperCase();

function handValue(cards) {
  const ranks = cards.map(c => c.r).sort((a,b) => b-a);
  const counts = new Map();
  ranks.forEach(r => counts.set(r, (counts.get(r)||0)+1));
  const groups = [...counts.entries()].sort((a,b) => b[1]-a[1] || b[0]-a[0]);
  const flush = cards.every(c => c.s === cards[0].s);
  const unique = [...new Set(ranks)].sort((a,b) => b-a);
  let straightHigh = 0;
  if (unique.length >= 5) {
    for (let i=0;i<=unique.length-5;i++) {
      if (unique[i]-unique[i+4]===4) { straightHigh=unique[i]; break; }
    }
    if (!straightHigh && [14,5,4,3,2].every(r=>unique.includes(r))) straightHigh=5;
  }
  const top = groups[0], second = groups[1] || [0,0];
  const kickers = groups.slice(1).map(g=>g[0]);
  if (flush && straightHigh) return [8,straightHigh];
  if (top[1]===4) return [7,top[0],second[0]];
  if (top[1]===3 && second[1]>=2) return [6,top[0],second[0]];
  if (flush) return [5,...ranks];
  if (straightHigh) return [4,straightHigh];
  if (top[1]===3) return [3,top[0],...kickers];
  if (top[1]===2 && second[1]===2) return [2,Math.max(top[0],second[0]),Math.min(top[0],second[0]),groups[2]?.[0]||0];
  if (top[1]===2) return [1,top[0],...kickers];
  return [0,...ranks];
}
function bestHand(seven) {
  let best = null;
  for (let a=0;a<7;a++) for (let b=a+1;b<7;b++) {
    const five=seven.filter((_,i)=>i!==a&&i!==b);
    const v=handValue(five);
    if (!best || compare(v,best)>0) best=v;
  }
  return best;
}
function compare(a,b) {
  for(let i=0;i<Math.max(a.length,b.length);i++) {
    const diff=(a[i]||0)-(b[i]||0);
    if(diff) return diff;
  }
  return 0;
}
function handName(v) {
  return ["High card","One pair","Two pair","Three of a kind","Straight","Flush","Full house","Four of a kind","Straight flush"][v[0]];
}
function publicState(room, viewerId) {
  return {
    code: room.code, hostId: room.hostId, phase: room.phase, community: room.community,
    pot: room.pot, currentBet: room.currentBet, turnId: room.turnId,
    dealerIndex: room.dealerIndex, message: room.message, handNo: room.handNo,
    players: room.players.map(p => ({
      id:p.id, name:p.name, chips:p.chips, folded:p.folded, bet:p.bet,
      connected:p.connected, isHost:p.id===room.hostId,
      cards: room.phase==="showdown" || p.id===viewerId ? p.cards : [],
      hand: room.phase==="showdown" && p.cards.length ? handName(bestHand([...p.cards,...room.community])) : ""
    }))
  };
}
function emitRoom(room) {
  room.players.forEach(p => io.to(p.id).emit("state", publicState(room,p.id)));
}
function findNext(room, fromIndex, predicate) {
  for(let step=1;step<=room.players.length;step++) {
    const i=(fromIndex+step)%room.players.length;
    if(predicate(room.players[i])) return i;
  }
  return -1;
}
function activePlayers(room) { return room.players.filter(p=>!p.folded && p.chips>=0); }
function eligible(room) { return room.players.filter(p=>!p.folded); }
function startBettingRound(room, phase) {
  room.phase=phase; room.currentBet=0;
  room.players.forEach(p=>p.bet=0);
  room.turnId = room.players.find(p=>!p.folded)?.id || null;
}
function advanceTurn(room) {
  const live=eligible(room);
  if(live.length<=1) return finishHand(room);
  const actionable=room.players.filter(p=>!p.folded && p.chips>0);
  if(actionable.length===0) return runout(room);
  const currentIndex=room.players.findIndex(p=>p.id===room.turnId);
  const next=findNext(room,currentIndex,p=>!p.folded && p.chips>0);
  if(next<0) return runout(room);
  const allMatched=actionable.every(p=>p.bet===room.currentBet && p.acted);
  if(allMatched) return advanceStreet(room);
  room.turnId=room.players[next].id;
  emitRoom(room);
}
function advanceStreet(room) {
  if(room.phase==="preflop") room.community.push(room.deck.pop(),room.deck.pop(),room.deck.pop());
  else if(room.phase==="flop") room.community.push(room.deck.pop());
  else if(room.phase==="turn") room.community.push(room.deck.pop());
  else return finishHand(room);
  room.players.forEach(p=>{p.bet=0;p.acted=false;});
  room.currentBet=0;
  room.phase=({preflop:"flop",flop:"turn",turn:"river"})[room.phase] || "showdown";
  const first=findNext(room,room.dealerIndex,p=>!p.folded&&p.chips>0);
  room.turnId=first>=0?room.players[first].id:null;
  if(!room.turnId) return runout(room);
  room.message = room.phase==="flop" ? "The flop is out." : room.phase==="turn" ? "The turn is out." : "The river is out.";
  emitRoom(room);
}
function runout(room) {
  while(room.community.length<5) room.community.push(room.deck.pop());
  finishHand(room);
}
function finishHand(room) {
  room.phase="showdown"; room.turnId=null;
  const live=eligible(room);
  if(live.length===1) {
    live[0].chips+=room.pot;
    room.message=`${live[0].name} wins the pot.`;
  } else {
    const scored=live.map(p=>({p,v:bestHand([...p.cards,...room.community])}));
    scored.sort((a,b)=>compare(b.v,a.v));
    const winners=scored.filter(x=>compare(x.v,scored[0].v)===0).map(x=>x.p);
    const share=Math.floor(room.pot/winners.length);
    winners.forEach(p=>p.chips+=share);
    room.message=`${winners.map(p=>p.name).join(" & ")} win with ${handName(scored[0].v)}.`;
  }
  emitRoom(room);
}
function beginHand(room) {
  if(room.players.length<2) return;
  room.players=room.players.filter(p=>p.connected && p.chips>0);
  if(room.players.length<2) {room.message="At least two players with points are needed.";emitRoom(room);return;}
  room.deck=freshDeck(); room.community=[]; room.pot=0; room.currentBet=0;
  room.handNo++; room.phase="preflop"; room.message="Cards dealt. Make your move.";
  room.players.forEach(p=>{p.cards=[room.deck.pop(),room.deck.pop()];p.folded=false;p.bet=0;p.acted=false;});
  room.dealerIndex=(room.dealerIndex+1)%room.players.length;
  const sbIndex=room.dealerIndex, bbIndex=(sbIndex+1)%room.players.length;
  const post=(p,n)=>{const amt=Math.min(n,p.chips);p.chips-=amt;p.bet=amt;room.pot+=amt;};
  post(room.players[sbIndex],5); post(room.players[bbIndex],10);
  room.currentBet=10;
  const first=findNext(room,bbIndex,p=>!p.folded&&p.chips>0);
  room.turnId=first>=0?room.players[first].id:null;
  room.players.forEach(p=>p.acted=false);
  emitRoom(room);
}
io.on("connection", socket => {
  socket.on("createRoom", ({name}) => {
    const code=roomCode();
    const player={id:socket.id,name:String(name||"Player").slice(0,18),chips:1000,bet:0,cards:[],folded:false,acted:false,connected:true};
    const room={code,hostId:socket.id,players:[player],phase:"lobby",community:[],pot:0,currentBet:0,turnId:null,dealerIndex:-1,handNo:0,message:"Invite friends with your room code.",deck:[]};
    rooms.set(code,room);socket.join(code);socket.emit("joined",code);emitRoom(room);
  });
  socket.on("joinRoom", ({code,name}) => {
    const room=rooms.get(String(code||"").toUpperCase());
    if(!room) return socket.emit("errorMessage","Room not found. Check the code.");
    if(room.phase!=="lobby" && room.phase!=="showdown") return socket.emit("errorMessage","That game is already in progress.");
    if(room.players.length>=6) return socket.emit("errorMessage","This table is full (6 players maximum).");
    if(room.players.some(p=>p.id===socket.id)) return;
    room.players.push({id:socket.id,name:String(name||"Player").slice(0,18),chips:1000,bet:0,cards:[],folded:false,acted:false,connected:true});
    socket.join(room.code);socket.emit("joined",room.code);room.message="A friend joined the table.";emitRoom(room);
  });
  socket.on("startGame", () => {
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));
    if(!room||room.hostId!==socket.id)return;
    if(room.phase==="lobby"||room.phase==="showdown")beginHand(room);
  });
  socket.on("action", ({kind,amount}) => {
    const room=[...rooms.values()].find(r=>r.players.some(p=>p.id===socket.id));
    if(!room||room.turnId!==socket.id||!["preflop","flop","turn","river"].includes(room.phase))return;
    const p=room.players.find(x=>x.id===socket.id);
    if(kind==="fold"){p.folded=true;p.acted=true;room.message=`${p.name} folded.`;}
    else if(kind==="check" && p.bet===room.currentBet){p.acted=true;room.message=`${p.name} checked.`;}
    else if(kind==="call"){const due=Math.min(room.currentBet-p.bet,p.chips);p.chips-=due;p.bet+=due;room.pot+=due;p.acted=true;room.message=`${p.name} called.`;}
    else if(kind==="raise"){
      const target=Math.max(room.currentBet+10,Math.min(Number(amount)||room.currentBet+20,p.bet+p.chips));
      const due=Math.min(target-p.bet,p.chips);
      if(due<=0)return;
      p.chips-=due;p.bet+=due;room.pot+=due;room.currentBet=p.bet;
      room.players.forEach(x=>{if(x.id!==p.id&&!x.folded)x.acted=false;});
      p.acted=true;room.message=`${p.name} raised.`;
    } else return;
    if(eligible(room).length<=1)return finishHand(room);
    advanceTurn(room);
  });
  socket.on("disconnect",()=>{
    for(const room of rooms.values()){
      const p=room.players.find(x=>x.id===socket.id);
      if(!p)continue;
      p.connected=false;
      if(room.phase==="lobby")room.players=room.players.filter(x=>x.id!==socket.id);
      else if(room.turnId===socket.id){p.folded=true;advanceTurn(room);}
      if(room.hostId===socket.id)room.hostId=room.players.find(x=>x.connected)?.id||null;
      emitRoom(room);
      if(!room.players.length)rooms.delete(room.code);
    }
  });
});
const port=process.env.PORT||3000;
server.listen(port,()=>console.log(`Velvet Royale listening on ${port}`));