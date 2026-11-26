import { supabase, raise } from './supabase';

const settingsFromDb = (x:any) => x ? ({serverName:x.server_name,serverAddress:x.server_address,upiId:x.upi_id,payeeName:x.payee_name,announcement:x.announcement,currency:x.currency}) : {};
const productFromDb = (x:any) => ({id:x.id,name:x.name,category:x.category,description:x.description,price:x.price,active:x.active,featured:x.featured});
const orderFromDb = (x:any) => ({id:x.id,edition:x.edition,minecraftName:x.minecraft_name,productName:x.product_name,quantity:x.quantity,total:x.total,currency:x.currency,status:x.status,utr:x.utr,createdAt:x.created_at});
const topupFromDb = (x:any) => ({id:x.id,userId:x.user_id,rupees:x.rupees,coins:x.coins,utr:x.utr,status:x.status,createdAt:x.created_at});

async function result<T>(query:PromiseLike<{data:T,error:any}>) { const {data,error}=await query; if(error) raise(error); return data; }
async function rpc(name:string,args:any={}) { return await result<any>(supabase.rpc(name,args)); }

export const api = {
 async get(path:string, config:any={}) {
  if(path==='/api/shop') {
   const [products,settings]=await Promise.all([
    result<any[]>(supabase.from('shop_products').select('*').order('created_at',{ascending:false})),
    result<any>(supabase.from('shop_settings').select('*').eq('id','main').maybeSingle())
   ]);
   return {data:{products:(products||[]).filter(p=>p.active).map(productFromDb),settings:settingsFromDb(settings)}};
  }
  if(path==='/api/wallet') return {data:await rpc('kc_get_my_wallet')};
  if(path==='/api/admin/session') {
   const {data:user}=await supabase.auth.getUser(); if(!user.user) raise({message:'Sign in required'});
   const row=await result<any>(supabase.from('shop_team_roles').select('role').eq('user_id',user.user.id).maybeSingle());
   return {data:{role:row?{role:row.role,scopes:[]}:null}};
  }
  if(path==='/api/admin/orders') {
   const rows=await result<any[]>(supabase.from('shop_orders').select('*').order('created_at',{ascending:false}).limit(100));
   return {data:{orders:(rows||[]).map(orderFromDb)}};
  }
  if(path==='/api/admin/wallet-topups') {
   const rows=await result<any[]>(supabase.from('kc_topups').select('*').eq('status','pending').order('created_at',{ascending:false}).limit(100));
   return {data:{items:(rows||[]).map(topupFromDb)}};
  }
  if(path==='/api/admin/products') {
   const rows=await result<any[]>(supabase.from('shop_products').select('*').order('created_at',{ascending:false}).limit(100));
   return {data:{items:(rows||[]).map(productFromDb)}};
  }
  if(path==='/api/admin/team') {
   const rows=await result<any[]>(supabase.from('shop_team_roles').select('user_id,role').order('created_at'));
   return {data:{members:(rows||[]).map(x=>({userId:x.user_id,role:x.role}))}};
  }
  const track=path.match(/^\/api\/orders\/([^/]+)$/);
  if(track) return {data:{order:await rpc('shop_track_order',{p_order_id:decodeURIComponent(track[1]),p_minecraft_name:config.params?.minecraftName||''})}};
  raise({message:'Unsupported shop request: '+path});
 },
 async post(path:string, body:any={}) {
  if(path==='/api/wallet/topups') return {data:await rpc('kc_submit_topup',{p_rupees:Number(body.rupees),p_utr:String(body.utr||'').trim()})};
  if(path==='/api/orders') return {data:await rpc('shop_create_order',{p_product_id:body.productId,p_edition:body.edition,p_minecraft_name:body.minecraftName,p_quantity:Number(body.quantity),p_promo_code:body.promoCode||''})};
  if(path==='/api/admin/products') {
   const row=await result<any>(supabase.from('shop_products').insert({name:body.name,category:body.category,description:body.description,price:Number(body.price),active:body.active!==false}).select('*').single());
   return {data:{id:row.id,created:true}};
  }
  if(path==='/api/admin/team/invite-co-owner' || path==='/api/admin/team/invite') {
   const role=path.endsWith('invite-co-owner')?'co-owner':'staff';
   await rpc('shop_assign_team_role',{p_email:String(body.email||'').trim(),p_role:role});
   return {data:{emailed:false,joinUrl:null}};
  }
  raise({message:'Unsupported shop request: '+path});
 },
 async put(path:string, body:any={}) {
  const approve=path.match(/^\/api\/admin\/wallet-topups\/([^/]+)\/approve$/);
  if(approve) return {data:await rpc('kc_approve_topup',{p_topup_id:approve[1]})};
  const order=path.match(/^\/api\/admin\/orders\/([^/]+)$/);
  if(order) return {data:await rpc('shop_update_order_status',{p_order_id:order[1],p_status:body.status})};
  const product=path.match(/^\/api\/admin\/products\/([^/]+)$/);
  if(product) {
   const patch:any={}; for(const k of ['name','category','description','price','active']) if(body[k]!==undefined) patch[k]=body[k];
   const row=await result<any>(supabase.from('shop_products').update(patch).eq('id',product[1]).select('id').maybeSingle());
   if(!row) raise({message:'Product not found.'}); return {data:{updated:true}};
  }
  if(path==='/api/admin/settings') {
   const row=await result<any>(supabase.from('shop_settings').upsert({id:'main',server_name:body.serverName,server_address:body.serverAddress,upi_id:body.upiId,payee_name:body.payeeName,announcement:body.announcement,currency:'KC'},{onConflict:'id'}).select('id').single());
   return {data:{saved:!!row}};
  }
  const payment=path.match(/^\/api\/orders\/([^/]+)\/payment$/);
  if(payment) {
   const {data:user}=await supabase.auth.getUser(); if(!user.user) raise({message:'Sign in required'});
   const row=await result<any>(supabase.from('shop_orders').update({utr:body.utr,status:'payment_submitted',updated_at:new Date().toISOString()}).eq('id',payment[1]).eq('user_id',user.user.id).eq('minecraft_name',body.minecraftName).eq('status','awaiting_payment').select('*').maybeSingle());
   if(!row) raise({message:'This order is not accepting a new payment reference.'}); return {data:{order:orderFromDb(row)}};
  }
  raise({message:'Unsupported shop request: '+path});
 },
 async delete(path:string) {
  const product=path.match(/^\/api\/admin\/products\/([^/]+)$/);
  if(product) { await result<any>(supabase.from('shop_products').delete().eq('id',product[1])); return {data:{deleted:true}}; }
  raise({message:'Unsupported shop request: '+path});
 }
};
export { auth } from './supabase';
