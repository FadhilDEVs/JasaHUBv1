import {googleFetch,DRIVE_SCOPE} from './google.js';
const base='https://www.googleapis.com/drive/v3/files';
export async function readMedia(row){
 const response=await googleFetch(`${base}/${encodeURIComponent(row.fileId)}?alt=media&supportsAllDrives=true`,{scopes:[DRIVE_SCOPE]});
 const bytes=Buffer.from(await response.arrayBuffer());
 if(bytes.length>1500000)throw Error('Media too large');
 return {id:row.fileId,data:`data:${row.mime};base64,${bytes.toString('base64')}`};
}
export async function uploadMedia(input){
 const folder=process.env.DRIVE_FOLDER_ID;
 if(!/^[A-Za-z0-9_-]{10,100}$/.test(folder||''))throw Error('Missing DRIVE_FOLDER_ID');
 const boundary='jh-'+crypto.randomUUID();
 const name=input.kind+'-'+input.key+'.'+(input.mime==='image/jpeg'?'jpg':input.mime.split('/')[1]);
 const body=Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name,parents:[folder]})}\r\n--${boundary}\r\nContent-Type: ${input.mime}\r\n\r\n`),input.bytes,Buffer.from(`\r\n--${boundary}--\r\n`)]);
 const response=await googleFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id',{scopes:[DRIVE_SCOPE],method:'POST',headers:{'Content-Type':'multipart/related; boundary='+boundary},body});
 const file=await response.json();return {ref:'drive:'+file.id,id:file.id,row:{id:input.key,fileId:file.id,name,mime:input.mime,size:input.bytes.length,kind:input.kind,createdAt:new Date().toISOString()}};
}
export async function removeMedia(id){await googleFetch(`${base}/${encodeURIComponent(id)}?supportsAllDrives=true`,{scopes:[DRIVE_SCOPE],method:'DELETE'});}
