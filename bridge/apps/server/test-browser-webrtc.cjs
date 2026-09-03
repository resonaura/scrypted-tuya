const http=require('http'); const WebSocket=require('ws');
function getJson(path){return new Promise((res,rej)=>http.get({host:'127.0.0.1',port:9223,path},r=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>res(JSON.parse(d)))}).on('error',rej))}
(async()=>{
 const pages=await getJson('/json/list'); const p=pages.find(x=>x.type==='page'); if(!p) throw new Error('no page');
 const ws=new WebSocket(p.webSocketDebuggerUrl); let id=0; const pending=new Map();
 ws.on('message',raw=>{const m=JSON.parse(raw); if(m.id&&pending.has(m.id)){const [r,j]=pending.get(m.id);pending.delete(m.id);m.error?j(m.error):r(m.result)}});
 await new Promise(r=>ws.on('open',r));
 const cmd=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,[resolve,reject]);ws.send(JSON.stringify({id:n,method,params}))});
 const expression=`(async()=>{
   const pc=new RTCPeerConnection({bundlePolicy:'max-bundle'});
   const stream=new MediaStream(); let tracks=[];
   pc.addTransceiver('video',{direction:'recvonly'}); pc.addTransceiver('audio',{direction:'recvonly'});
   pc.ontrack=e=>{tracks.push(e.track.kind);stream.addTrack(e.track)};
   await pc.setLocalDescription(await pc.createOffer());
   await new Promise(resolve=>{if(pc.iceGatheringState==='complete')return resolve();const f=()=>{if(pc.iceGatheringState==='complete'){pc.removeEventListener('icegatheringstatechange',f);resolve()}};pc.addEventListener('icegatheringstatechange',f);setTimeout(resolve,4000)});
   const response=await fetch('/api/streaming/eba0193b64396cb4fbyqwf/webrtc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(pc.localDescription.toJSON())});
   const created=await response.json(); if(!response.ok) throw new Error(JSON.stringify(created));
   await pc.setRemoteDescription(created.answer); const video=document.createElement('video'); video.autoplay=true; video.muted=true; video.srcObject=stream; document.body.appendChild(video); await video.play().catch(()=>{}); await new Promise(r=>setTimeout(r,8000));
   const stats=[...((await pc.getStats()).values())].filter(x=>x.type==='inbound-rtp').map(x=>({kind:x.kind,bytesReceived:x.bytesReceived,packetsReceived:x.packetsReceived,framesDecoded:x.framesDecoded,jitter:x.jitter}));
   await fetch('/api/streaming/eba0193b64396cb4fbyqwf/webrtc/'+created.sessionId,{method:'DELETE'});
   pc.close(); return {state:pc.connectionState,tracks,stats};
 })()`;
 const out=await cmd('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true}); console.log(JSON.stringify(out,null,2)); ws.close();
})().catch(e=>{console.error(e);process.exit(1)});
