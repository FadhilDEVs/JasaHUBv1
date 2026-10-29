import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {Script} from 'node:vm';
import {createHash,generateKeyPairSync} from 'node:crypto';
import {createEngine} from '../lib/engine.js';
import {TABLES} from '../lib/schema.js';
import handler from '../api/jasa.js';
const digest=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const data=Object.fromEntries(Object.keys(TABLES).map(k=>[k,[]]));
 data.Users=[{_row:2,id:'u1',name:'Pelanggan',phone:'6281234567890',password:'customer-pass',active:true,role:'customer',salt:'a'.repeat(32)},{_row:3,id:'u2',name:'Admin',phone:'6281234567891',username:'admin',password:'admin-pass',active:true,role:'admin'}];
 data.Sessions=[{_row:2,id:'s1',userId:'u1',tokenHash:digest('c'.repeat(64)),expiresAt:new Date(Date.now()+3600000).toISOString()},{_row:3,id:'s2',userId:'u2',tokenHash:digest('a'.repeat(64)),expiresAt:new Date(Date.now()+3600000).toISOString()}];
 data.Products=[{_row:2,id:'p1',title:'Desain Logo',category:'Design',description:'Desain logo untuk usaha Anda.',price:50000,days:2,revisions:2,active:true,featured:true}];
 data.Categories=[{_row:2,id:'cat1',name:'Design',active:true}];
 data.Packages=[{_row:2,id:'pack1',productId:'p1',name:'Basic',price:50000,days:2,revisions:2,active:true,features:'Logo PNG dan revisi',sort:0}];
 data.Settings=[{_row:2,key:'qrisImage',value:'https://example.com/qris.png'},{_row:3,key:'whatsapp',value:'6281234567891'}];
 return data;
}
const order=()=>({action:'createOrder',token:'c'.repeat(64),productId:'p1',packageId:'pack1',expectedPrice:50000,requestId:'request-unique-123',deadline:new Date(Date.now()+10*86400000).toISOString().slice(0,10),brief:'Buat logo bisnis dengan gaya sederhana.'});
test('frontend classic script parses and all local assets exist',()=>{
 const html=readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
 const js=readFileSync(new URL('../public/assets/jasahub.js',import.meta.url),'utf8');
 new Script(js);assert.ok(html.includes('src="/assets/jasahub.js"'));assert.ok(!js.includes('script.google.com'));
 for(const path of [...html.matchAll(/(?:src|href)="(\/[^"#?]*)"/g)].map(x=>x[1]))assert.ok(existsSync(new URL('../public'+path,import.meta.url)),path);
 assert.ok(js.includes("fetch(action==='catalog'?'/api/jasa':'/api/rpc'"));
});
test('public catalog keeps packages and never exposes customer data',()=>{
 const result=createEngine(fixture()).catalog();assert.equal(result.products[0].packages[0].id,'pack1');
 assert.ok(!JSON.stringify(result).includes('customer-pass'));assert.ok(!JSON.stringify(result).includes('6281234567890'));
});
test('login is compatible with existing plain password rows',()=>{
 const result=createEngine(fixture()).run({action:'login',phone:'081234567890',password:'customer-pass'});
 assert.equal(result.user.id,'u1');assert.equal(result.token.length,72);assert.ok(!('password' in result.user));
});
test('expired session is rejected and customer cannot access admin',()=>{
 const f=fixture();f.Sessions[0].expiresAt='2000-01-01';assert.throws(()=>createEngine(f).run({action:'me',token:'c'.repeat(64)}),/Sesi berakhir/);
 assert.throws(()=>createEngine(fixture()).run({action:'adminData',token:'c'.repeat(64)}),/Akses admin/);
});
test('checkout checks price and uses server-owned customer and status',()=>{
 assert.throws(()=>createEngine(fixture()).run({...order(),expectedPrice:1}),/Harga telah berubah/);
 const engine=createEngine(fixture());const result=engine.run({...order(),userId:'u2',status:'Selesai',price:1});
 assert.equal(result.price,50000);assert.equal(result.userId,'u1');assert.equal(result.status,'Belum Dibayar');
 const again=engine.run(order());assert.equal(again.id,result.id);assert.equal(engine.adds.filter(x=>x.name==='Orders').length,1);
});
test('only admin can verify payment, proof action does not mark paid',()=>{
 const f=fixture(),engine=createEngine(f);const result=engine.run(order());
 engine.run({action:'confirmPayment',token:'c'.repeat(64),id:result.id});assert.equal(f.Orders[0].status,'Belum Dibayar');
 assert.throws(()=>engine.run({action:'updateOrder',token:'c'.repeat(64),id:result.id,status:'Selesai'}),/Akses admin/);
 assert.throws(()=>engine.run({action:'updateOrder',token:'a'.repeat(64),id:result.id,status:'Selesai'}),/Verifikasi/);
 assert.throws(()=>engine.run({action:'updateOrder',token:'a'.repeat(64),id:result.id,status:'Proses Pengerjaan'}),/Centang/);
 engine.run({action:'updateOrder',token:'a'.repeat(64),id:result.id,status:'Proses Pengerjaan',paymentVerified:true});
 assert.equal(f.Orders[0].paymentStatus,'Lunas');
 engine.run({action:'updateOrder',token:'a'.repeat(64),id:result.id,status:'Selesai'});assert.equal(f.Orders[0].status,'Selesai');
});
test('orders belonging to another account are hidden',()=>{
 const f=fixture();f.Orders=[{id:'other',userId:'u2',status:'Belum Dibayar'}];assert.deepEqual(createEngine(f).run({action:'orders',token:'c'.repeat(64)}),[]);
});
test('package deletion keeps remaining package IDs and physical row positions',()=>{
 const f=fixture();f.Packages.push({_row:3,id:'pack2',productId:'p1',name:'Premium',active:true});
 const engine=createEngine(f);engine.run({action:'saveProduct',token:'a'.repeat(64),id:'p1',title:'Desain Logo',category:'Design',description:'Layanan desain logo bisnis Anda.',shortDescription:'Logo bisnis',active:true,packages:[{name:'Basic',price:50000,days:2,revisions:2,features:'Logo dengan revisi'}]});
 assert.equal(f.Packages[0].id,'pack1');assert.equal(f.Packages[0]._row,2);assert.ok(engine.changes.some(x=>x.name==='Packages'&&x.row._row===3&&x.row.id===''));
});
test('media validates file signature and requires admin',()=>{
 const p={action:'uploadMedia',token:'a'.repeat(64),kind:'qris',data:'data:image/png;base64,'+Buffer.from('not a real image signature').toString('base64'),requestId:'a'.repeat(32)};
 assert.throws(()=>createEngine(fixture()).run(p),/Isi file/);
 assert.throws(()=>createEngine(fixture()).run({...p,token:'c'.repeat(64)}),/Akses admin/);
});
function response(){return {headers:{},setHeader(k,v){this.headers[k]=v;},removeHeader(k){delete this.headers[k];},status(s){this.code=s;return this;},json(data){this.body=data;return this;}};}
test('catalog endpoint caches only success and loads no account tables',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
 process.env.GOOGLE_SHEET_ID='test-sheet';process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL='test@example.com';process.env.GOOGLE_PRIVATE_KEY=privateKey.export({type:'pkcs8',format:'pem'});
 const previous=globalThis.fetch;const ranges=[];
 globalThis.fetch=async url=>{
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token',expires_in:3600});
  const r=new URL(url).searchParams.getAll('ranges');ranges.push(...r);const f=fixture();
  return Response.json({valueRanges:r.map(range=>{const name=range.split('!')[0].replaceAll("'",'');if(range.includes('2:'))return {values:[]};return {values:[TABLES[name],...(f[name]||[]).map(row=>TABLES[name].map(k=>row[k]??''))]};})});
 };
 try{
  const res=response();await handler({method:'GET',query:{}},res);
  assert.equal(res.code,200);assert.match(res.headers['Cache-Control'],/s-maxage=600, stale-while-revalidate=60/);assert.equal(res.body.ok,true);
  assert.ok(!ranges.some(x=>/Users|Sessions|Media/.test(x)));
  globalThis.fetch=async()=>{throw Error('upstream unavailable');};const failure=response();await handler({method:'GET',query:{}},failure);
  assert.equal(failure.code,503);assert.equal(failure.headers['Cache-Control'],'private, no-store');assert.ok(!JSON.stringify(failure.body).includes('test-token'));
  const invalid=response();await handler({method:'POST',query:{}},invalid);assert.equal(invalid.code,405);assert.equal(invalid.headers['Cache-Control'],'private, no-store');
 }finally{globalThis.fetch=previous;}
});

test('RPC persists login/order/status atomically and releases write lock on validation failure',async()=>{
 const {default:rpc}=await import('../api/rpc.js');
 const f=fixture();let nextId=1;
 const tabs=Object.fromEntries(Object.keys(TABLES).map(name=>[name,{id:nextId++,name,values:[TABLES[name],...f[name].map(row=>TABLES[name].map(k=>row[k]??''))]}]));
 const previous=globalThis.fetch;let batches=0;
 globalThis.fetch=async(url,options={})=>{
  if(String(url).includes('oauth2.googleapis.com'))return Response.json({access_token:'test-token',expires_in:3600});
  if(String(url).endsWith(':batchUpdate')){
   const {requests}=JSON.parse(options.body);batches++;
   for(const r of requests){
    if(r.addSheet){const p=r.addSheet.properties;if(Object.values(tabs).some(t=>t.id===p.sheetId||t.name===p.title))return Response.json({error:'exists'},{status:400});tabs[p.title]={id:p.sheetId,name:p.title,values:[]};}
    if(r.updateCells){const p=r.updateCells,t=Object.values(tabs).find(t=>t.id===p.start.sheetId);assert.ok(t);t.values[p.start.rowIndex]=p.rows[0].values.map(c=>Object.values(c.userEnteredValue)[0]);}
    if(r.appendCells){const p=r.appendCells,t=Object.values(tabs).find(t=>t.id===p.sheetId);assert.ok(t);t.values.push(...p.rows.map(row=>row.values.map(c=>Object.values(c.userEnteredValue)[0])));}
    if(r.deleteSheet){const t=Object.values(tabs).find(t=>t.id===r.deleteSheet.sheetId);if(!t)return Response.json({error:'missing'},{status:400});delete tabs[t.name];}
   }
   return Response.json({replies:requests.map(()=>({}))});
  }
  const u=new URL(url);if(u.pathname.endsWith('/values:batchGet'))return Response.json({valueRanges:u.searchParams.getAll('ranges').map(range=>({values:tabs[range.split('!')[0].replaceAll("'",'')].values}))});
  return Response.json({sheets:Object.values(tabs).map(t=>({properties:{sheetId:t.id,title:t.name}}))});
 };
 const invoke=async p=>{const res=response();await rpc({method:'POST',headers:{'content-type':'application/json',host:'example.com',origin:'https://example.com'},body:p},res);assert.ok(!tabs.__JASAHUB_WRITE_LOCK,'lock released');return res;};
 try{
  const login=await invoke({action:'login',phone:'081234567890',password:'customer-pass'});assert.equal(login.code,200);assert.ok(tabs.Sessions.values.length===4);
  const created=await invoke({...order(),token:login.body.data.token,requestId:'integrated-request'});assert.equal(created.code,200);assert.equal(tabs.Orders.values.length,2);
  const repeated=await invoke({...order(),token:login.body.data.token,requestId:'integrated-request'});assert.equal(repeated.body.data.id,created.body.data.id);assert.equal(tabs.Orders.values.length,2);
  const invalid=await invoke({action:'updateOrder',token:'a'.repeat(64),id:created.body.data.id,status:'Proses Pengerjaan'});assert.equal(invalid.code,400);
  const paid=await invoke({action:'updateOrder',token:'a'.repeat(64),id:created.body.data.id,status:'Proses Pengerjaan',paymentVerified:true});assert.equal(paid.code,200);assert.equal(tabs.Orders.values[1][TABLES.Orders.indexOf('paymentStatus')],'Lunas');
  assert.ok(batches>=10);assert.equal(paid.headers['Cache-Control'],'private, no-store');
 }finally{globalThis.fetch=previous;}
});
