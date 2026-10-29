import {TABLES} from './schema.js';
import {googleFetch} from './google.js';
const quote=name=>"'"+name.replaceAll("'","''")+"'";
function base(){const id=process.env.GOOGLE_SHEET_ID;if(!/^[a-zA-Z0-9_-]+$/.test(id||''))throw Error('Missing GOOGLE_SHEET_ID');return 'https://sheets.googleapis.com/v4/spreadsheets/'+id;}
export async function loadSheets(names=Object.keys(TABLES)){
 const url=new URL(base()+'/values:batchGet');
 for(const name of names)url.searchParams.append('ranges',quote(name)+'!A:AZ');
 url.searchParams.set('valueRenderOption','UNFORMATTED_VALUE');url.searchParams.set('dateTimeRenderOption','FORMATTED_STRING');
 const result=await(await googleFetch(url)).json();const records={};
 for(const [index,name] of names.entries()){
  const values=result.valueRanges?.[index]?.values||[];
  if(!TABLES[name].every((key,i)=>values[0]?.[i]===key))throw Error('Header mismatch in '+name);
  records[name]=values.slice(1).map((values,i)=>Object.fromEntries([['_row',i+2],...TABLES[name].map((key,j)=>[key,values[j]??''])])).filter(row=>String(row[TABLES[name][0]]||'')!=='');
 }
 return records;
}
// Public reads never load Users, Sessions, Media or customer briefs.
export async function loadPublicSheets(){
 const names=['Products','Categories','Packages','Previews','Settings'];
 const records=await loadSheets(names);
 records.Orders=[]; // order counts fetched separately, without personal order fields
 const url=new URL(base()+'/values:batchGet');
 url.searchParams.append('ranges',"'Orders'!C2:C");url.searchParams.append('ranges',"'Orders'!K2:K");
 const result=await(await googleFetch(url)).json();
 records.Orders=(result.valueRanges?.[0]?.values||[]).map((row,i)=>({productId:row[0],status:result.valueRanges?.[1]?.values?.[i]?.[0]}));
 return records;
}
function cells(name,row){return TABLES[name].map(key=>{const value=row[key]??'';return {userEnteredValue:typeof value==='boolean'?{boolValue:value}:typeof value==='number'&&Number.isFinite(value)?{numberValue:value}:{stringValue:String(value)}};});}
export async function commit(engine,lockId=null){
 if(!engine.changes.length&&!engine.adds.length&&lockId===null)return;
 const metadata=await(await googleFetch(base()+'?fields=sheets.properties')).json();
 const ids=Object.fromEntries(metadata.sheets.map(s=>[s.properties.title,s.properties.sheetId]));
 const requests=[];
 for(const {name,row} of engine.changes)requests.push({updateCells:{start:{sheetId:ids[name],rowIndex:row._row-1,columnIndex:0},rows:[{values:cells(name,row)}],fields:'userEnteredValue'}});
 for(const name of Object.keys(TABLES)){
  const rows=engine.adds.filter(x=>x.name===name).map(x=>({values:cells(name,x.row)}));
  if(rows.length)requests.push({appendCells:{sheetId:ids[name],rows,fields:'userEnteredValue'}});
 }
 if(lockId!==null)requests.push({deleteSheet:{sheetId:lockId}});
 await googleFetch(base()+':batchUpdate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests})});
}

// Cooperating Vercel writers acquire a reserved temporary tab before reading.
// Google refuses duplicate tab titles. Each owner uses its own sheetId so
// a delayed cleanup cannot delete a different writer's lock.
export async function acquireWriteLock(){
 const {randomInt}=await import('node:crypto');
 for(let attempt=0;attempt<3;attempt++){
  const sheetId=randomInt(100000000,2000000000);
  try{
   await googleFetch(base()+':batchUpdate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:[{addSheet:{properties:{sheetId,title:'__JASAHUB_WRITE_LOCK',hidden:true,gridProperties:{rowCount:1,columnCount:1}}}}]})});
   return sheetId;
  }catch(error){
   const metadata=await(await googleFetch(base()+'?fields=sheets.properties')).json();
   if(!metadata.sheets.some(s=>s.properties.title==='__JASAHUB_WRITE_LOCK'))throw error;
   if(attempt<2)await new Promise(resolve=>setTimeout(resolve,800+Math.random()*400));
  }
 }
 const error=Error('Ada perubahan lain yang sedang disimpan. Tunggu sebentar lalu coba lagi.');error.publicMessage=error.message;throw error;
}
export async function releaseWriteLock(sheetId){
 await googleFetch(base()+':batchUpdate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({requests:[{deleteSheet:{sheetId}}]})});
}
