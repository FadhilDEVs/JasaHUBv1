import {loadSheets,commit,acquireWriteLock,releaseWriteLock} from '../lib/sheets.js';
import {createEngine} from '../lib/engine.js';
import {readMedia,uploadMedia} from '../lib/media.js';
import {noStore,errorResponse,validatePost} from '../lib/http.js';

export default async function handler(req,res){
 noStore(res);
 if(req.method!=='POST'){res.setHeader('Allow','POST');return res.status(405).json({ok:false,error:'Gunakan POST.'});}
 let lockId=null;
 try{
  const p=validatePost(req);
  const allowed=new Set(['challenge','register','login','me','updateProfile','changePassword','logout','orders','createOrder','confirmPayment','requestRevision','completeOrder','adminData','uploadMedia','saveProduct','saveCategory','deleteProduct','updateCategory','deleteCategory','savePreview','deletePreview','reorderPreviews','updateOrder','saveSettings','media']);
  if(p.action==='catalog')return res.status(400).json({ok:false,error:'Gunakan GET /api/jasa.'});
  if(!allowed.has(p.action))return res.status(400).json({ok:false,error:'Aksi tidak dikenal.'});
  if(!['challenge','me','orders','adminData','media'].includes(p.action))lockId=await acquireWriteLock();
  // Fresh private snapshot per request. Never place this data in a shared cache.
  const engine=createEngine(await loadSheets());
  let data=engine.run(p);
  if(p.action==='media')data=await readMedia(data);
  if(p.action==='uploadMedia'&&data.bytes){
   const file=await uploadMedia(data);
   engine.append('Media',file.row);
   // If a commit response is lost, do not delete a file that may already be referenced.
   await commit(engine,lockId);lockId=null;
   return res.status(200).json({ok:true,data:{ref:file.ref,id:file.id}});
  }
  await commit(engine,lockId);lockId=null;
  return res.status(200).json({ok:true,data});
 }catch(error){return errorResponse(res,error);}
 finally{if(lockId!==null)try{await releaseWriteLock(lockId);}catch(_){console.error('Write lock cleanup failed; see README recovery instructions.');}}
}
