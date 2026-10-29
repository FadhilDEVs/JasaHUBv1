import {createSign} from 'node:crypto';
const tokens=new Map();
const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
function configError(message){throw new Error(message);}
export async function googleToken(scopes){
 const oauth=!!process.env.GOOGLE_OAUTH_REFRESH_TOKEN;
 const key=(oauth?'oauth:':'service:')+scopes.join(' ');
 const old=tokens.get(key);if(old&&old.expires>Date.now()+60000)return old.token;
 let body;
 if(oauth){
  for(const key of ['GOOGLE_OAUTH_CLIENT_ID','GOOGLE_OAUTH_CLIENT_SECRET'])if(!process.env[key])configError('Missing '+key);
  body=new URLSearchParams({grant_type:'refresh_token',client_id:process.env.GOOGLE_OAUTH_CLIENT_ID,client_secret:process.env.GOOGLE_OAUTH_CLIENT_SECRET,refresh_token:process.env.GOOGLE_OAUTH_REFRESH_TOKEN});
 }else{
  const email=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
  const privateKey=process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g,'\n');
  if(!email||!privateKey)configError('Missing service account credentials');
  const now=Math.floor(Date.now()/1000);
  const input=encode({alg:'RS256',typ:'JWT'})+'.'+encode({iss:email,scope:scopes.join(' '),aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
  const signature=createSign('RSA-SHA256').update(input).sign(privateKey,'base64url');
  body=new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:input+'.'+signature});
 }
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',body,signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw new Error('Google token failed: '+response.status);
 const data=await response.json();if(!data.access_token)throw new Error('Google token missing');
 tokens.set(key,{token:data.access_token,expires:Date.now()+Number(data.expires_in||3600)*1000});return data.access_token;
}
export const SHEETS_SCOPE='https://www.googleapis.com/auth/spreadsheets';
export const DRIVE_SCOPE='https://www.googleapis.com/auth/drive';
export async function googleFetch(url,{scopes=[SHEETS_SCOPE],...options}={}){
 const token=await googleToken(scopes);
 const response=await fetch(url,{...options,headers:{...options.headers,Authorization:'Bearer '+token},signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new Error('Google API failed: '+response.status);
 return response;
}
