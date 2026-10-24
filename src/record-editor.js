import {validateState,addProduct,addOrder,receiveOrder,addShipment,ship,arrive,id} from './model.js';
import {addStockLot,parseOrderPairs,ensureStockLots} from './domestic-stock.js';
import {addSales,addCostBaseline,addActualBill} from './costing.js';
export const recordNames={products:'产品与库存',orders:'生产订单',shipments:'出货计划',sales:'每周销量',costBases:'历史成本',costBills:'实际账单',estimates:'日本预估',europeEstimates:'英德预估',ledger:'库存流水'};
const escapeId=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const recordActions=(type,recordId)=>{const id=escapeId(recordId);return `<span class="record-actions"><button type="button" class="small-btn" data-action="edit-record" data-type="${type}" data-id="${id}">编辑</button>${type==='ledger'?'':`<button type="button" class="text-btn danger" data-action="delete-record" data-type="${type}" data-id="${id}">删除</button>`}</span>`;};
const audit=(s,pid,action,reference,delta={})=>s.ledger.unshift({id:id(),productId:pid,action,reference,at:new Date().toISOString(),stock:delta.stock||0,transit:delta.transit||0,fba:delta.fba||0});
function undo(s,type,r){
 const p=s.products.find(p=>p.id===r.productId);if(type==='orders'&&r.status==='received'){
  const lot=ensureStockLots(p).find(l=>l.ref===r.ref);if(!lot||lot.qty<r.qty)throw Error('该订单现货已被使用，无法撤回入库；请先处理关联出货或库存调整');
  lot.qty-=r.qty;p.stock-=r.qty;
 }
 if(type==='shipments'&&['shipped','arrived'].includes(r.status)){
  if(r.status==='arrived'){if(p.fba<r.qty)throw Error('该票到仓库存已销售或扣减，无法撤回；请先核对 FBA 库存');p.fba-=r.qty;}
  else {if(p.transit<r.qty)throw Error('在途库存不足，无法撤回出货');p.transit-=r.qty;}
  const lots=r.stockAllocation||[{ref:r.productionRef||'',qty:r.qty}];if(lots.reduce((n,l)=>n+l.qty,0)!==r.qty)throw Error('原出货批次数量不一致');
  for(const l of lots)addStockLot(p,l.ref,l.qty);p.stock+=r.qty;
 }
}
function apply(s,type,data,old){
 if(type==='orders'){addOrder(s,data);const r=s.orders[0];r.id=old.id;if(data.status==='received')receiveOrder(s,r.id);else if(data.status!=='producing')throw Error('生产状态无效');return;}
 if(type==='shipments'){
  if(data.status==='cancelled'){const check=structuredClone(s),p=check.products.find(p=>p.id===data.productId);if(!p)throw Error('产品不存在');p.stock+=Number(data.qty);addStockLot(p,'',Number(data.qty));addShipment(check,data);s.shipments.unshift({...check.shipments[0],id:old.id,status:'cancelled',shippedAt:''});return;}
  addShipment(s,data);const r=s.shipments[0];r.id=old.id;if(['shipped','arrived'].includes(data.status)){ship(s,r.id);r.shippedAt=data.shippedAt||old.shippedAt||r.shippedAt;}if(data.status==='arrived')arrive(s,r.id);if(!['planned','shipped','arrived'].includes(data.status))throw Error('出货状态无效');return;
 }
 if(type==='sales'||type==='costBases'||type==='costBills'){({sales:addSales,costBases:addCostBaseline,costBills:addActualBill}[type])(s,data);s[type].at(-1).id=old.id;return;}
 s[type].push({...data,id:old.id});
}
// Mutate only a validated clone: failed edits never leave partial reversals behind.
export function reviseRecord(state,type,recordId,input=null){
 if(!Object.hasOwn(recordNames,type))throw Error('记录类型无效');const s=structuredClone(state),index=s[type].findIndex(r=>r.id===recordId);if(index<0)throw Error('记录不存在');const old=s[type][index],before=new Map(s.products.map(p=>[p.id,{stock:p.stock,transit:p.transit,fba:p.fba}]));
 if(type==='ledger'){
  if(input===null)throw Error('库存流水保留用于核对，不可直接删除；请修改原始业务单据');
  old.reference=String(input.reference||'').trim();if(!old.reference)throw Error('关联单据 / 原因不能为空');validateState(s);Object.assign(state,s);return;
 }
 if(type==='products'){
  if(input===null){
   const linked=['orders','shipments','sales','costBases'].some(k=>s[k].some(r=>r.productId===old.id))||['costBills','estimates','europeEstimates'].some(k=>s[k].some(r=>r.lines.some(l=>l.productId===old.id)));
   if(linked)throw Error('该产品还有关联订单、出货、销量或费用，请先删除关联业务记录，再删除产品');
   s.products.splice(index,1);s.ledger=s.ledger.filter(l=>l.productId!==old.id);
  }else{
   const data={...input};if(typeof data.stockOrders==='string'){
    const lots=parseOrderPairs(data.stockOrders);data.stockLots=lots.length?lots:(Number(data.stock)?[{ref:'',qty:Number(data.stock)}]:[]);
    for(const lot of ensureStockLots(old))if(lot.ref&&!data.stockLots.some(l=>l.ref===lot.ref))data.stockLots.push({ref:lot.ref,qty:0});
   }
   s.products.splice(index,1);addProduct(s,data);const p=s.products.at(-1);p.id=old.id;p.color=old.color;s.ledger.shift();s.products.splice(s.products.length-1,1);s.products.splice(index,0,p);
   audit(s,p.id,'编辑产品与库存',`${old.msku} → ${p.msku}`,{stock:p.stock-old.stock,transit:p.transit-old.transit,fba:p.fba-old.fba});
  }
 }else{
  const data=input===null?null:{...old,...input,id:old.id};
  const inventoryKeys=type==='orders'?['productId','qty','ref','status']:type==='shipments'?['productId','qty','productionRef','status']:[];
  const movementChanged=data===null||inventoryKeys.some(k=>data[k]!==old[k]);
  s[type].splice(index,1);
  if(['orders','shipments'].includes(type)&&movementChanged)undo(s,type,old);
  if(data){
   if(['orders','shipments'].includes(type)&&!movementChanged){
    // Reuse input validators without replaying any completed inventory movement.
    const check=structuredClone(s);if(type==='orders'){addOrder(check,data);Object.assign(data,check.orders[0],{id:old.id,status:old.status});}
    else {const p=check.products.find(p=>p.id===data.productId);p.stock+=data.qty;addStockLot(p,'',data.qty);addShipment(check,data);Object.assign(data,check.shipments[0],{id:old.id,status:old.status,shippedAt:input.shippedAt??old.shippedAt,stockAllocation:old.stockAllocation});}
    s[type].splice(index,0,data);
   }else apply(s,type,data,old);
  }
  // Generated movements above are replaced by a single correction per affected product.
  const originalLedgerIds=new Set(state.ledger.map(l=>l.id));s.ledger=s.ledger.filter(l=>originalLedgerIds.has(l.id));
  const pids=new Set([old.productId,data?.productId,...(old.lines||[]).map(l=>l.productId),...(data?.lines||[]).map(l=>l.productId)].filter(Boolean));
  for(const pid of pids){const p=s.products.find(p=>p.id===pid),b=before.get(pid);audit(s,pid,(data?'编辑':'删除')+recordNames[type],old.ref||old.shop||old.asOf||'',{stock:p.stock-b.stock,transit:p.transit-b.transit,fba:p.fba-b.fba});}
 }
 validateState(s);Object.assign(state,s);return state;
}
