import {integer,validDate} from './costing.js';
export function parseOrderPairs(value,type='qty'){
 const text=String(value??'').trim();if(!text)return [];
 const seen=new Set();return text.split(/[;；\r\n]+/).map(s=>s.trim()).filter(Boolean).map(entry=>{
  const match=entry.match(/^([^+＋:：=]+)\s*[+＋:：=]\s*(.+)$/);if(!match)throw Error('订单明细请按“订单号+数量”或“订单号+YYYY-MM-DD”填写，多笔用分号分隔');
  const ref=match[1].trim(),raw=match[2].trim();if(!ref||seen.has(ref))throw Error('订单号为空或重复：'+ref);seen.add(ref);
  if(type==='date'){const m=raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);if(!m)throw Error('货好日期请使用 YYYY-MM-DD');return {ref,due:validDate(`${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`,'货好日期')};}
  if(!/^\d+$/.test(raw))throw Error('订单数量必须为正整数');return {ref,qty:integer(raw,'订单数量')};
 });
}
export function ensureStockLots(p){if(p.stockLots===undefined)p.stockLots=p.stock?[{ref:'',qty:p.stock}]:[];return p.stockLots;}
export function validateStockLots(p){
 const lots=ensureStockLots(p);if(!Array.isArray(lots))throw Error('现货订单明细格式无效');const refs=new Set();let total=0;
 for(const lot of lots){if(typeof lot.ref!=='string'||refs.has(lot.ref)||!Number.isSafeInteger(lot.qty)||lot.qty<0)throw Error('现货订单号重复或数量无效');refs.add(lot.ref);total+=lot.qty;}
 if(total!==p.stock)throw Error('现货订单数量合计必须等于现货数量');
}
export function addStockLot(p,ref,amount){ensureStockLots(p);const lot=p.stockLots.find(l=>l.ref===ref);if(lot)lot.qty+=amount;else p.stockLots.push({ref,qty:amount});}
export function takeLots(lots,amount,ref=''){
 const indices=ref?[...lots.keys()].filter(i=>lots[i].ref===ref).concat([...lots.keys()].filter(i=>lots[i].ref==='')):[...lots.keys()].sort((a,b)=>(lots[a].ref?1:0)-(lots[b].ref?1:0));
 const total=indices.reduce((n,i)=>n+lots[i].qty,0);if(amount>total)throw Error(ref?`订单 ${ref} 对应可用现货不足（剩余 ${total} 件），请核对现货订单关联`:'可用现货不足');
 const used=[];for(const i of indices){const n=Math.min(amount,lots[i].qty);if(n){lots[i].qty-=n;used.push({ref:lots[i].ref,qty:n});amount-=n;}if(!amount)break;}return used;
}
export function planStockLots(state,p,extra=null){
 const free=ensureStockLots(p).map(l=>({...l})),allocations=new Map();const plans=state.shipments.filter(s=>s.productId===p.id&&s.status==='planned');if(extra)plans.push(extra);
 plans.sort((a,b)=>(a.productionRef?0:1)-(b.productionRef?0:1));
 for(const s of plans)allocations.set(s.id,takeLots(free,s.qty,s.productionRef||''));return {free,allocations};
}
export function deductStockLots(p,used){for(const a of used){const lot=p.stockLots.find(l=>l.ref===a.ref);if(!lot||lot.qty<a.qty)throw Error('现货订单明细不足，请核对');}for(const a of used)p.stockLots.find(l=>l.ref===a.ref).qty-=a.qty;}
