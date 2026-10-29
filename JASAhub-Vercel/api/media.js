import {loadSheets} from '../lib/sheets.js';
import {googleFetch,DRIVE_SCOPE} from '../lib/google.js';
import {noStore,errorResponse} from '../lib/http.js';
export default async function handler(req,res){
 noStore(res);
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).end();}
 const id=req.query?.id;
 if(typeof id!=='string'||!/^[A-Za-z0-9_-]{10,100}$/.test(id)||Object.keys(req.query).length!==1)return res.status(400).json({ok:false,error:'ID gambar tidak valid.'});
 try{
  const {Media}=await loadSheets(['Media']);
  const row=Media.find(x=>x.fileId===id);
  if(!row)return res.status(404).json({ok:false,error:'Gambar tidak ditemukan.'});
  if(!['image/png','image/jpeg','image/webp'].includes(row.mime))throw Error('Invalid media type');
  const response=await googleFetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`,{scopes:[DRIVE_SCOPE]});
  const bytes=Buffer.from(await response.arrayBuffer());if(bytes.length>1500000)throw Error('Media too large');
  res.removeHeader('Vercel-CDN-Cache-Control');
  res.setHeader('Cache-Control','public, max-age=300, s-maxage=86400, stale-while-revalidate=60');
  res.setHeader('Content-Type',row.mime);
  return res.status(200).send(bytes);
 }catch(error){return errorResponse(res,error);}
}
