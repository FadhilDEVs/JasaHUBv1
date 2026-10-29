import {createHash, createHmac, randomUUID} from 'node:crypto';
import {TABLES} from './schema.js';
// Best-effort per-instance throttle; also configure Vercel Firewall for /api/rpc.
const throttle=new Map();
const ORDER_STATES=['Belum Dibayar','Proses Pengerjaan','Selesai'];
const Utilities={
 getUuid:()=>randomUUID(),
 computeHmacSha256Signature:(v,k)=>[...createHmac('sha256',k).update(v).digest()],
 computeDigest:(_,v)=>[...createHash('sha256').update(v).digest()],
 DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
 base64Decode:v=>[...Buffer.from(v,'base64')],
 formatDate:(d)=>new Date(d.getTime()+8*3600000).toISOString().slice(0,10)
};
export function createEngine(records){
 const changes=[],adds=[];
 function rows_(name){return records[name]||[];}
 function append_(name,o){const row={...o};records[name]??=[];records[name].push(row);adds.push({name,row});}
 function patch_(name,old,next){Object.assign(old,next);if(!adds.some(x=>x.row===old)&&!changes.some(x=>x.row===old))changes.push({name,row:old});}
 function sheet_(name){return {deleteRow(index){const row=rows_(name).find(x=>x._row===index);if(!row)return;records[name]=rows_(name).filter(x=>x!==row);for(const key of TABLES[name])row[key]='';if(!changes.some(x=>x.row===row))changes.push({name,row});}};}
 function mediaFolder_(){return {getId:()=>process.env.DRIVE_FOLDER_ID||''};}
 function readMedia_(id){if(!/^[A-Za-z0-9_-]{10,100}$/.test(id))fail_('ID gambar tidak valid.');const row=rows_('Media').find(x=>String(x.fileId)===id);if(!row)fail_('Gambar tidak terdaftar sebagai media publik.');return clean_(row);}
 function catalog_(){return {products:allProducts_(true),categories:rows_('Categories').filter(x=>yes_(x.active)).map(clean_),settings:settings_()};}
 function run(p){
    if (p.action === 'catalog') return catalog_();
    if (p.action === 'media') return readMedia_(String(p.id||''));
    // rpc.js acquires the write lock before loading this request snapshot.

      if (['challenge','register','login'].indexOf(p.action) >= 0) {
        rate_('auth-global', 180, 60);
        const identifier=text_(p.phone||p.username,80,1);
        rate_('auth-' + p.action + '-' + identifier.toLowerCase(), p.action === 'register' ? 5 : 15, 900);
        if (p.action === 'challenge') {
          const u=findLoginUser_(identifier);
          return {salt:u&&u.salt?u.salt:digest_(identifier).slice(0,32),legacy:!!(u&&!String(u.password||'')&&u.passwordHash),iterations:210000};
        }
        const password=password_(p.password,p.action==='register'?6:1);
        if(p.action==='register') {
          const phone=phone_(identifier);
          if(rows_('Users').some(x=>String(x.phone)===phone))fail_('Nomor sudah terdaftar. Silakan masuk.');
          const user={id:id_('USR'),name:text_(p.name,80,2),phone:phone,salt:Utilities.getUuid().replace(/-/g,''),passwordHash:'',role:'customer',active:true,createdAt:now_(),password:password,username:''};
          append_('Users',user);return loginResult_(user);
        }
        const user=findLoginUser_(identifier);
        if(!user||!yes_(user.active)||!passwordMatches_(user,password,p.passwordKey))fail_('Nomor, username, atau password salah.');
        if(!String(user.password||''))patch_('Users',user,{password:password,passwordHash:''});
        return loginResult_(user);
      }
      const user = auth_(p.token);
      if (p.action === 'me') return publicUser_(user);
      if (p.action === 'updateProfile') {
        const phone=phone_(p.phone);const name=text_(p.name,80,2);
        if(rows_('Users').some(x=>x.id!==user.id&&String(x.phone)===phone))fail_('Nomor sudah digunakan akun lain.');
        patch_('Users',user,{name:name,phone:phone});return publicUser_(Object.assign({},user,{name:name,phone:phone}));
      }
      if (p.action === 'changePassword') {
        rate_('password-'+user.id,5,900);
        if(!passwordMatches_(user,String(p.oldPassword||''),p.oldKey))fail_('Password lama tidak cocok.');
        const next=password_(p.newPassword,6);
        patch_('Users',user,{password:next,passwordHash:''});
        rows_('Sessions').filter(x=>x.userId===user.id).reverse().forEach(x=>sheet_('Sessions').deleteRow(x._row));
        return loginResult_(user);
      }
      if (p.action === 'logout') {
        const session = rows_('Sessions').find(x => x.tokenHash === digest_(String(p.token)));
        if (session) sheet_('Sessions').deleteRow(session._row);
        return {success:true};
      }
      if (p.action === 'orders') return rows_('Orders').filter(x => x.userId === user.id || user.role === 'admin').map(orderPublic_).reverse();
      if (p.action === 'createOrder') {
        rate_('orders-' + user.id, 12, 3600);
        const config=settings_();if(!config.qrisImage||!config.whatsapp)fail_('Pembayaran belum siap. Admin perlu mengunggah QRIS dan mengisi nomor WhatsApp pada Pengaturan.');
        const requestId = text_(p.requestId,80,8);
        const old = rows_('Orders').find(x => x.userId === user.id && x.requestId === requestId);
        if (old) return clean_(old);
        const product = rows_('Products').find(x => x.id === p.productId && yes_(x.active));
        if (!product || !rows_('Categories').some(c=>c.name===product.category&&yes_(c.active))) fail_('Jasa tidak tersedia. Pilih jasa lain.');
        const pkg=rows_('Packages').find(x=>x.productId===product.id&&yes_(x.active)&&(!p.packageId||x.id===p.packageId));
        if(!pkg)fail_('Paket tidak tersedia. Muat ulang detail jasa.');
        // Never trust a price, title, userId, or role supplied by browser.
        const expected = Number(p.expectedPrice);
        if (!Number.isFinite(expected) || expected !== Number(pkg.price)) fail_('Harga telah berubah. Muat ulang katalog sebelum checkout.');
        const deadline = String(p.deadline || '');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(deadline) || isNaN(Date.parse(deadline))) fail_('Tanggal deadline tidak valid.');
        const earliest = new Date(Date.now() + Number(pkg.days)*86400000);
        if (deadline < Utilities.formatDate(earliest,'Asia/Makassar','yyyy-MM-dd')) fail_('Deadline lebih cepat dari estimasi layanan. Pilih tanggal lain.');
        const order = {id:id_('JH'),userId:user.id,productId:product.id,title:product.title,price:Number(pkg.price),days:Number(pkg.days),revisions:Number(pkg.revisions),brief:text_(p.brief,5000,15),materialUrl:url_(p.materialUrl,false),deadline:deadline,status:'Belum Dibayar',paymentStatus:'Belum Dibayar',paymentReference:'',resultUrl:'',adminNote:'',requestId:requestId,createdAt:now_(),updatedAt:now_(),packageId:pkg.id,packageName:pkg.name,customerNote:text_(p.customerNote,2000,0)};
        append_('Orders',order);return clean_(order);
      }
      if (p.action === 'confirmPayment') {
        const order=rows_('Orders').find(x=>x.id===p.id&&x.userId===user.id);if(!order)fail_('Pesanan tidak ditemukan.');
        if(normalStatus_(order)!=='Belum Dibayar')fail_('Pembayaran sudah diverifikasi admin.');
        patch_('Orders',order,{paymentReference:'Pelanggan membuka draft bukti WhatsApp; lampiran belum diverifikasi.',proofOpenedAt:now_(),updatedAt:now_()});
        return {success:true,status:'Belum Dibayar'};
      }
      if (p.action === 'requestRevision') {
        const order=rows_('Orders').find(x=>x.id===p.id&&x.userId===user.id);
        if(!order||normalStatus_(order)!=='Proses Pengerjaan'||!order.resultUrl)fail_('Revisi tersedia setelah admin membagikan hasil pada tahap Proses Pengerjaan.');
        if(Number(order.revisions)<1)fail_('Jatah revisi telah habis. Hubungi admin.');
        patch_('Orders',order,{revisions:Number(order.revisions)-1,brief:order.brief+'\n\nPermintaan revisi: '+text_(p.note,1500,5),updatedAt:now_()});return {success:true};
      }
      if (p.action === 'completeOrder') fail_('Hanya admin yang dapat mengubah status pesanan.');
      if (user.role !== 'admin') fail_('Akses admin diperlukan.');

      if (p.action === 'adminData') return {products:allProducts_(false),categories:rows_('Categories').map(clean_),orders:rows_('Orders').map(orderPublic_).reverse(),customers:rows_('Users').map(publicUser_),settings:settings_(),driveFolderUrl:'https://drive.google.com/drive/folders/'+mediaFolder_().getId()};
      if (p.action === 'uploadMedia') return validateUpload_(p);
      if (p.action === 'saveProduct') {
        const existing = p.id ? rows_('Products').find(x => x.id === p.id) : null;
        if (p.id && !existing) fail_('Jasa tidak ditemukan.');
        const category = text_(p.category,60,2);
        if (!rows_('Categories').some(x => x.name === category && yes_(x.active))) fail_('Pilih kategori aktif.');
        const packages=validatePackages_(p.packages,existing);
        const product = {id:existing?existing.id:id_('SVC'),title:text_(p.title,120,3),category:category,description:text_(p.description,5000,10),price:packages[0].price,days:packages[0].days,revisions:packages[0].revisions,thumbnail:thumbnail_(p.thumbnail),featured:p.featured===true,active:p.active===true,createdAt:existing?existing.createdAt:now_(),updatedAt:now_(),shortDescription:text_(p.shortDescription||p.description,250,5),badge:['','Populer','Terbaru','Unggulan'].includes(p.badge)?p.badge:''};
        if (existing) patch_('Products',existing,product); else append_('Products',product);
        const previous=rows_('Packages').filter(x=>x.productId===product.id);
        packages.forEach((pack,i)=>{const old=previous.find(x=>x.name===pack.name);const row=Object.assign({},pack,{id:old?old.id:id_('PKG'),productId:product.id,sort:i,active:true});if(old)patch_('Packages',old,row);else append_('Packages',row);});
        // Delete bottom-up only after updating retained rows: their _row indexes stay valid.
        previous.filter(old=>!packages.some(pack=>pack.name===old.name)).sort((a,b)=>b._row-a._row).forEach(old=>sheet_('Packages').deleteRow(old._row));
        return product_(product);
      }
      if (p.action === 'saveCategory') {
        const name = text_(p.name,60,2);
        if (rows_('Categories').some(x => x.name.toLowerCase() === name.toLowerCase())) fail_('Kategori sudah ada.');
        append_('Categories',{id:id_('CAT'),name:name,active:p.active!==false,icon:iconKey_(p.icon)});return {success:true};
      }
      if(p.action==='deleteProduct') {
        const product=rows_('Products').find(x=>x.id===p.id);if(!product)fail_('Jasa tidak ditemukan.');
        ['Packages','Previews'].forEach(t=>rows_(t).filter(x=>x.productId===p.id).reverse().forEach(x=>sheet_(t).deleteRow(x._row)));
        sheet_('Products').deleteRow(product._row);return {success:true};
      }
      if(p.action==='updateCategory'||p.action==='deleteCategory') {
        const category=rows_('Categories').find(x=>x.id===p.id);if(!category)fail_('Kategori tidak ditemukan.');
        const linked=rows_('Products').filter(x=>x.category===category.name);
        if(p.action==='deleteCategory'){if(linked.length)fail_('Pindahkan layanan dalam kategori ini sebelum menghapus.');sheet_('Categories').deleteRow(category._row);return {success:true};}
        const name=text_(p.name,60,2);if(rows_('Categories').some(x=>x.id!==p.id&&x.name.toLowerCase()===name.toLowerCase()))fail_('Nama kategori sudah ada.');
        patch_('Categories',category,{name:name,active:p.active===true,icon:iconKey_(p.icon)});
        linked.forEach(x=>patch_('Products',x,{category:name,updatedAt:now_()}));return {success:true};
      }
      if(p.action==='savePreview') {
        if(!rows_('Products').some(x=>x.id===p.productId))fail_('Simpan jasa dahulu.');
        const list=rows_('Previews').filter(x=>x.productId===p.productId);if(list.length>=24)fail_('Maksimal 24 preview per jasa pada versi ini.');
        const row={id:id_('IMG'),productId:p.productId,image:thumbnail_(p.image),caption:text_(p.caption,120,0),sort:list.length};if(!row.image)fail_('Gambar diperlukan.');append_('Previews',row);return clean_(row);
      }
      if(p.action==='deletePreview') {
        const row=rows_('Previews').find(x=>x.id===p.id);if(!row)fail_('Preview tidak ditemukan.');sheet_('Previews').deleteRow(row._row);return {success:true};
      }
      if(p.action==='reorderPreviews') {
        const list=rows_('Previews').filter(x=>x.productId===p.productId);if(!Array.isArray(p.ids)||p.ids.length!==list.length||new Set(p.ids).size!==list.length||p.ids.some(id=>!list.some(x=>x.id===id)))fail_('Urutan preview tidak valid.');
        p.ids.forEach((id,i)=>patch_('Previews',list.find(x=>x.id===id),{sort:i}));return {success:true};
      }
      if (p.action === 'updateOrder') {
        const order = rows_('Orders').find(x => x.id === p.id);
        if (!order) fail_('Pesanan tidak ditemukan.');
        if(!ORDER_STATES.includes(p.status))fail_('Gunakan Belum Dibayar, Proses Pengerjaan, atau Selesai.');
        const old=normalStatus_(order);const next={status:p.status,resultUrl:url_(p.resultUrl,false),adminNote:text_(p.adminNote,2000,0),updatedAt:now_()};
        if(p.status==='Proses Pengerjaan'&&old==='Belum Dibayar'){
          if(p.paymentVerified!==true)fail_('Centang verifikasi setelah memeriksa bukti dan dana yang masuk.');
          next.paymentVerifiedAt=now_();next.paymentVerifiedBy=user.id;next.paymentStatus='Lunas';
        }
        if(p.status==='Belum Dibayar'&&old!=='Belum Dibayar')fail_('Pesanan yang sudah diverifikasi tidak dapat diubah kembali menjadi Belum Dibayar.');
        if(p.status==='Selesai'&&old==='Belum Dibayar')fail_('Verifikasi pembayaran dan mulai pengerjaan sebelum menyelesaikan pesanan.');
        if(p.status==='Selesai'){next.completedAt=order.completedAt||now_();next.paymentStatus='Lunas';}
        if(p.status==='Proses Pengerjaan'&&old==='Selesai')next.completedAt='';
        patch_('Orders',order,next);return {success:true,status:p.status};
      }
      if (p.action === 'saveSettings') {
        const next = {whatsapp:phone_(p.whatsapp),paymentInfo:text_(p.paymentInfo,2000,5)};
        const fields={siteName:80,siteDescription:300,heroTitle:150,heroDescription:400,footerText:300,contactInfo:500};
        Object.keys(fields).forEach(k=>{if(p[k]!==undefined)next[k]=text_(p[k],fields[k],0);});if(p.logoUrl!==undefined)next.logoUrl=thumbnail_(p.logoUrl);if(p.qrisImage!==undefined)next.qrisImage=thumbnail_(p.qrisImage);
        Object.keys(next).forEach(key => {const r=rows_('Settings').find(x=>x.key===key);if(r)patch_('Settings',r,{value:next[key]});else append_('Settings',{key:key,value:next[key]});});return {success:true};
      }
      fail_('Aksi tidak dikenal.');

}
function fail_(message){const e=new Error(message);e.publicMessage=message;throw e;}
function clean_(o){const r=Object.assign({},o);delete r._row;return r;}
function product_(o){const r=clean_(o);r.price=Number(r.price);r.days=Number(r.days);r.revisions=Number(r.revisions);r.featured=yes_(r.featured);r.active=yes_(r.active);return r;}
function settings_(){const o={};rows_('Settings').forEach(x=>{if(['whatsapp','paymentInfo','siteName','siteDescription','heroTitle','heroDescription','footerText','contactInfo','logoUrl','qrisImage'].includes(x.key))o[x.key]=String(x.value);});return o;}
function publicUser_(u){return {id:u.id,name:u.name,phone:String(u.phone),role:u.role,createdAt:u.createdAt,username:String(u.username||'')};}
function loginResult_(user){const token=Utilities.getUuid()+Utilities.getUuid();append_('Sessions',{id:id_('SES'),userId:user.id,tokenHash:digest_(token),expiresAt:new Date(Date.now()+8*3600000).toISOString(),createdAt:now_()});return {token:token,user:publicUser_(user)};}
function auth_(token){if(typeof token!=='string'||token.length<40)fail_('Silakan masuk terlebih dahulu.');const hash=digest_(token);const s=rows_('Sessions').find(x=>equal_(x.tokenHash,hash)&&Date.parse(x.expiresAt)>Date.now());if(!s)fail_('Sesi berakhir. Silakan keluar lalu masuk kembali.');const u=rows_('Users').find(x=>x.id===s.userId&&yes_(x.active));if(!u)fail_('Akun tidak aktif.');return u;}
function secret_(){const p=process.env.AUTH_PEPPER;if(!p)fail_('Konfigurasi AUTH_PEPPER diperlukan untuk akun hash lama.');return p;}
function credential_(key){return hex_(Utilities.computeHmacSha256Signature(key,secret_()));}
function digest_(value){return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8));}
function hex_(bytes){return bytes.map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function equal_(a,b){a=String(a);b=String(b);let d=a.length^b.length;for(let i=0;i<Math.max(a.length,b.length);i++)d|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return d===0;}
function rate_(key,max,ttl){
 const k=digest_(key),now=Date.now();
 if(throttle.size>5000)for(const [id,v] of throttle)if(v.until<=now)throttle.delete(id);
 const v=throttle.get(k);const entry=v&&v.until>now?v:{count:0,until:now+ttl*1000};
 if(++entry.count>max)fail_('Terlalu banyak percobaan. Coba lagi beberapa menit kemudian.');
 throttle.set(k,entry);
}
function phone_(v){let s=String(v||'').replace(/[\s()+-]/g,'');if(s.startsWith('0'))s='62'+s.slice(1);if(!/^628\d{7,11}$/.test(s))fail_('Gunakan nomor Indonesia aktif, contoh 081234567890.');return s;}
function text_(v,max,min){const s=String(v===undefined?'':v).trim();if(s.length<min||s.length>max)fail_('Panjang isian harus '+min+'–'+max+' karakter.');return s;}
function integer_(v,min,max){const n=Number(v);if(!Number.isInteger(n)||n<min||n>max)fail_('Nilai angka harus '+min+'–'+max+'.');return n;}
function url_(v,required){const s=String(v||'').trim();if(!s&&!required)return '';if(s.length>2000||!/^https:\/\/[^\s<>"'\\]+$/i.test(s))fail_('Tautan harus berupa URL HTTPS yang valid.');return s;}
function thumbnail_(v){const s=String(v||'');if(!s)return '';if(/^drive:[A-Za-z0-9_-]{10,100}$/.test(s)){if(!rows_('Media').some(x=>'drive:'+x.fileId===s))fail_('File Drive tidak terdaftar. Unggah melalui dashboard admin.');return s;}if(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s)&&s.length<=42000)return s;return url_(s,true);}
function yes_(v){return v===true||String(v).toLowerCase()==='true';}
function id_(prefix){return prefix+'-'+Utilities.getUuid().replace(/-/g,'').slice(0,16).toUpperCase();}
function now_(){return new Date().toISOString();}

function iconKey_(v){return ['doc','slide','chart','pen','cad','book','grid','layers','settings','user','message'].includes(v)?v:'grid';}
function allProducts_(publicOnly){
  const cats=rows_('Categories');const packs=rows_('Packages');const previews=rows_('Previews');const counts={};rows_('Orders').filter(o=>o.status!=='Dibatalkan').forEach(o=>counts[o.productId]=(counts[o.productId]||0)+1);
  return rows_('Products').filter(p=>!publicOnly||(yes_(p.active)&&cats.some(c=>c.name===p.category&&yes_(c.active)))).map(p=>{
    const out=product_(p);out.orderCount=counts[p.id]||0;out.packages=packs.filter(x=>x.productId===p.id&&yes_(x.active)).sort((a,b)=>Number(a.sort)-Number(b.sort)).map(x=>Object.assign(clean_(x),{price:Number(x.price),days:Number(x.days),revisions:Number(x.revisions)}));
    out.previews=previews.filter(x=>x.productId===p.id).sort((a,b)=>Number(a.sort)-Number(b.sort)).map(clean_);return out;
  });
}
function validatePackages_(input,existing){
  const names=['Basic','Standard','Premium'];
  if(!Array.isArray(input)||input.length<1||input.length>3)fail_('Sisakan minimal satu paket layanan (maksimal tiga).');
  if(input.some(x=>!x||!names.includes(x.name))||new Set(input.map(x=>x.name)).size!==input.length)fail_('Nama paket tidak valid atau duplikat.');
  return names.filter(name=>input.some(x=>x.name===name)).map(name=>{const x=input.find(p=>p.name===name);return {name:name,price:integer_(x.price,1000,100000000),days:integer_(x.days,1,365),revisions:integer_(x.revisions,0,20),features:text_(x.features,1200,5)};});
}

function password_(v,min){if(typeof v!=='string'||v.length<min||v.length>128)fail_('Password harus '+min+'–128 karakter.');return v;}
function findLoginUser_(identifier){
  const name=String(identifier).trim().toLowerCase();const users=rows_('Users');
  const byName=users.find(x=>String(x.username||'').toLowerCase()===name&&name!=='');if(byName)return byName;
  let phone;try{phone=phone_(identifier);}catch(_){return null;}return users.find(x=>String(x.phone)===phone)||null;
}
function passwordMatches_(user,password,key){
  if(String(user.password||''))return equal_(String(user.password),password);
  return !!user.passwordHash&&/^[0-9a-f]{64}$/.test(String(key||''))&&equal_(user.passwordHash,credential_(String(key)));
}

function normalStatus_(order){
  if(ORDER_STATES.includes(order.status))return order.status;
  if(order.status==='Selesai')return 'Selesai';
  if(['Diproses','Review Pelanggan','Revisi'].includes(order.status)||order.paymentStatus==='Lunas'&&order.status!=='Dibatalkan')return 'Proses Pengerjaan';
  return 'Belum Dibayar';
}
function orderPublic_(order){const out=clean_(order);out.status=normalStatus_(order);return out;}
function validateUpload_(p){
  if(!['thumbnail','preview','logo','qris'].includes(p.kind))fail_('Jenis media tidak valid.');
  const data=String(p.data||'');const match=data.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
  if(!match||data.length>2100000)fail_('Gunakan PNG/JPG/WebP maksimal 1,5 MB setelah optimasi.');
  const bytes=Utilities.base64Decode(match[2]);if(bytes.length>1500000||bytes.length<12)fail_('Ukuran berkas tidak valid.');
  const head=bytes.slice(0,12).map(x=>(x+256)%256);const mime=match[1];
  const valid=mime==='image/png'?head.slice(0,8).join(',')==='137,80,78,71,13,10,26,10':mime==='image/jpeg'?head[0]===255&&head[1]===216&&head[2]===255:head.slice(0,4).map(x=>String.fromCharCode(x)).join('')==='RIFF'&&head.slice(8,12).map(x=>String.fromCharCode(x)).join('')==='WEBP';
  if(!valid)fail_('Isi file tidak sesuai format gambar.');
  const key=String(p.requestId||'');if(!/^[a-f0-9]{32}$/.test(key))fail_('ID unggahan tidak valid.');
  const old=rows_('Media').find(x=>x.id===key);if(old)return {ref:'drive:'+old.fileId,id:old.fileId};
  return {bytes:Buffer.from(bytes),mime,kind:p.kind,key};
}

return {run,catalog:catalog_,changes,adds,append:append_};
}
