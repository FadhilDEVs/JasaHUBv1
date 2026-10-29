import {loadPublicSheets} from '../lib/sheets.js';
import {createEngine} from '../lib/engine.js';
import {noStore,errorResponse} from '../lib/http.js';

export default async function handler(req,res){
 noStore(res);
 if(req.method!=='GET'){res.setHeader('Allow','GET');return res.status(405).json({ok:false,error:'Gunakan GET.'});}
 // One canonical URL avoids unbounded query-string cache variants.
 if(Object.keys(req.query||{}).length)return res.status(400).json({ok:false,error:'Endpoint katalog tidak memerlukan parameter.'});
 try{
  const records=await loadPublicSheets();
  const data=createEngine(records).catalog();
  res.removeHeader('Vercel-CDN-Cache-Control');
  res.setHeader('Cache-Control','public, max-age=0, s-maxage=600, stale-while-revalidate=60');
  return res.status(200).json({ok:true,data});
 }catch(error){return errorResponse(res,error);}
}
