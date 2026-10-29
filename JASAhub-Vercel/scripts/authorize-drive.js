// Run on your own computer: node --env-file=.env scripts/authorize-drive.js
import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
const {GOOGLE_OAUTH_CLIENT_ID:client_id,GOOGLE_OAUTH_CLIENT_SECRET:client_secret}=process.env;
if(!client_id||!client_secret)throw Error('Isi GOOGLE_OAUTH_CLIENT_ID dan GOOGLE_OAUTH_CLIENT_SECRET di .env.');
const redirect_uri='http://localhost:53682/callback';
const state=randomBytes(32).toString('hex');
const consent=new URL('https://accounts.google.com/o/oauth2/v2/auth');
Object.entries({client_id,redirect_uri,response_type:'code',access_type:'offline',prompt:'consent',state,scope:'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive'}).forEach(([k,v])=>consent.searchParams.set(k,v));
const server=http.createServer(async(req,res)=>{
 try{
  const u=new URL(req.url,redirect_uri);
  if(u.pathname!=='/callback'){res.writeHead(404).end();return;}
  if(u.searchParams.get('state')!==state||!u.searchParams.get('code'))throw Error('Callback tidak valid atau izin ditolak.');
  const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body:new URLSearchParams({client_id,client_secret,redirect_uri,grant_type:'authorization_code',code:u.searchParams.get('code')}),signal:AbortSignal.timeout(15000)});
  const data=await response.json();if(!response.ok||!data.refresh_token)throw Error('Token tidak tersedia. Ulangi persetujuan akses.');
  await writeFile('.env.oauth',`GOOGLE_OAUTH_REFRESH_TOKEN=${data.refresh_token}\n`,{mode:0o600,flag:'wx'});
  res.end('Berhasil. Tutup halaman ini. Token disimpan di .env.oauth pada komputer Anda.');
  console.log('Selesai: salin nilai dari .env.oauth ke Environment Variables Vercel. Jangan unggah berkas ini.');
  server.close();
 }catch(error){res.writeHead(400).end('Otorisasi gagal. Lihat terminal.');console.error(error.message);server.close();}
});
server.listen(53682,'127.0.0.1',()=>console.log('Buka tautan ini dengan akun Google pemilik Drive:\n'+consent.href));
server.setTimeout(20000);
