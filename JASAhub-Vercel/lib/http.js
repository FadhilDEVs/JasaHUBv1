export function noStore(res){res.setHeader('Cache-Control','private, no-store');res.setHeader('Vercel-CDN-Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');}
export function errorResponse(res,error){
 // Do not expose Google's payload, credentials, cell data or stack traces.
 console.error('JASAhub API:',error.name||'Error',error.publicMessage?'validation':error.message);
 return res.status(error.publicMessage?400:503).json({ok:false,error:error.publicMessage||'Server belum dapat mengakses Google Sheets/Drive. Periksa konfigurasi atau coba lagi.'});
}
export function validatePost(req){
 if(req.method!=='POST'){const e=Error('Gunakan POST.');e.publicMessage=e.message;throw e;}
 const origin=req.headers.origin;
 const host=req.headers['x-forwarded-host']||req.headers.host;
 if(origin&&origin!==`https://${host}`&&!(origin===`http://${host}`&&/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host||''))){const e=Error('Origin tidak diizinkan.');e.publicMessage=e.message;throw e;}
 if(!String(req.headers['content-type']||'').startsWith('application/json')){const e=Error('Gunakan JSON.');e.publicMessage=e.message;throw e;}
 const p=typeof req.body==='string'?JSON.parse(req.body):req.body;
 if(!p||Array.isArray(p)||typeof p!=='object'||JSON.stringify(p).length>2400000){const e=Error('Permintaan tidak valid atau terlalu besar.');e.publicMessage=e.message;throw e;}
 return p;
}
