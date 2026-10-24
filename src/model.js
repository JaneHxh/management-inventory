import {ensureStockLots,validateStockLots,addStockLot,planStockLots,takeLots,deductStockLots,parseOrderPairs} from './domestic-stock.js';
import {europeQuote} from './europe-freight.js';
import {defaultPlanning} from './planning.js';
import {decimal,integer,validDate,addSales,addCostBaseline,addActualBill,jpDefaults,japanQuote} from './costing.js';
export const today = () => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date());
export const id = () => crypto.randomUUID();
export function daysUntil(date, base = today()) { return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(base + 'T00:00:00Z')) / 86400000); }
export const emptyState = () => ({version:2, demo:false, reminderDays:7, products:[], orders:[], shipments:[], ledger:[], sales:[], costBases:[], costBills:[], estimates:[], europeEstimates:[], jpSettings:jpDefaults(), planning:defaultPlanning()});
export const reserved = (state, productId) => state.shipments.filter(s => s.productId === productId && s.status === 'planned').reduce((n,s) => n+s.qty,0);
export const available = (state, p) => p.stock - reserved(state,p.id);
export const producing = (state, productId) => state.orders.filter(o=>o.productId===productId && o.status==='producing').reduce((n,o)=>n+o.qty,0);
function qty(value, allowZero=false) { const n=Number(value); if (!Number.isSafeInteger(n) || n < (allowZero?0:1) || n>100000000) throw Error('数量必须为有效的'+(allowZero?'非负':'正')+'整数（最多 1 亿）'); return n; }
function date(value) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value||'') || !Number.isFinite(Date.parse(value+'T00:00:00Z')) || new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value) throw Error('请选择有效日期'); return value; }
const text = v => String(v||'').trim();
function product(state, productId) { const p=state.products.find(p=>p.id===productId); if(!p) throw Error('请先选择产品'); return p; }
function record(state,p,action,stock,transit,fba,reference) { state.ledger.unshift({id:id(),productId:p.id,action,stock,transit,fba,reference,at:new Date().toISOString()}); }
export function addProduct(state, input) {
  const sku=text(input.sku), msku=text(input.msku), fnsku=text(input.fnsku), name=text(input.name);
  if(!sku||!msku||!fnsku||!name) throw Error('请填写产品名称、货号、MSKU 和 FNSKU');
  if(state.products.some(p=>p.msku.toLowerCase()===msku.toLowerCase())) throw Error('该 MSKU 已存在，请勿重复建档');
  const p={id:id(),sku,msku,fnsku,name,stock:qty(input.stock,true),transit:qty(input.transit,true),fba:qty(input.fba,true),threshold:qty(input.threshold,true),color:state.products.length%5};
  if(input.stockLots!==undefined)p.stockLots=structuredClone(input.stockLots);validateStockLots(p);
  state.products.push(p); record(state,p,'期初建档',p.stock,p.transit,p.fba,'初始库存'); return p;
}
export function addOrder(state,input) {
  product(state,input.productId); const amount=qty(input.qty), due=date(input.due);
  const ref=text(input.ref); if(!ref) throw Error('请填写订单编号');
  if(state.orders.some(o=>o.ref===ref&&o.productId===input.productId)) throw Error('订单编号已存在（同产品）');
  state.orders.unshift({id:id(),productId:input.productId,ref,qty:amount,due,status:'producing',note:text(input.note),...orderDetails(input)});
}
export function receiveOrder(state, orderId) {
  const o=state.orders.find(o=>o.id===orderId); if(!o||o.status!=='producing') throw Error('该订单已入库或不存在');
  const p=product(state,o.productId);addStockLot(p,o.ref,o.qty); p.stock+=o.qty; o.status='received'; record(state,p,'生产入库',o.qty,0,0,o.ref);
}
export function addShipment(state,input) {
  const p=product(state,input.productId), amount=qty(input.qty), shipDate=date(input.date), ref=text(input.ref);
  if(!ref) throw Error('请填写出货单号');
  if(state.shipments.some(s=>s.ref===ref&&s.productId===p.id&&text(s.shop)===text(input.shop))) throw Error('出货单号已存在（同店铺同产品）');
  if(amount>available(state,p)) throw Error('可用现货不足，当前可分配 '+available(state,p)+' 件');
  const productionRef=text(input.productionRef);if(productionRef&&!state.orders.some(o=>o.ref===productionRef&&o.productId===p.id)&&!ensureStockLots(p).some(l=>l.ref===productionRef))throw Error('生产订单编号不存在或产品不匹配');
  const eta=text(input.eta);if(eta){date(eta);if(eta<shipDate)throw Error('预计到货时间不能早于计划出货日期');}
  const candidate={id:id(),ref,productId:p.id,qty:amount,date:shipDate,status:'planned',destination:text(input.destination)||'FBA 仓库',shop:text(input.shop),productionRef,cbm:decimal(input.cbm,'CBM',true),eta,shippedAt:''};planStockLots(state,p,candidate);state.shipments.unshift(candidate);
}
export function ship(state, shipmentId) {
  const s=state.shipments.find(s=>s.id===shipmentId); if(!s||s.status!=='planned') throw Error('该出货计划已处理或不存在');
  const p=product(state,s.productId); if(p.stock<s.qty) throw Error('现货不足');
  const allocation=planStockLots(state,p).allocations.get(s.id);deductStockLots(p,allocation);s.stockAllocation=allocation;
  p.stock-=s.qty; p.transit+=s.qty; s.status='shipped';s.shippedAt=today(); record(state,p,'确认出货',-s.qty,s.qty,0,s.ref);
}
export function arrive(state,shipmentId) {
  const s=state.shipments.find(s=>s.id===shipmentId); if(!s||s.status!=='shipped') throw Error('该运单尚未出货或已签收');
  const p=product(state,s.productId); if(p.transit<s.qty) throw Error('在途库存不足，请核对');
  p.transit-=s.qty; p.fba+=s.qty; s.status='arrived'; record(state,p,'FBA 到仓',0,-s.qty,s.qty,s.ref);
}
export function cancelShipment(state,shipmentId) {
  const s=state.shipments.find(s=>s.id===shipmentId); if(!s||s.status!=='planned') throw Error('仅待出货计划可以取消'); s.status='cancelled';
}
export function adjust(state,input) {
  const p=product(state,input.productId), amount=qty(input.qty); const reason=text(input.reason);
  if(!reason) throw Error('请填写调整原因');
  if(input.kind==='sale') { if(amount>p.fba) throw Error('FBA 在售库存不足'); p.fba-=amount; record(state,p,'FBA 销售',0,0,-amount,reason); }
  else if(input.kind==='transit-receipt') { const tracked=state.shipments.filter(sh=>sh.productId===p.id&&sh.status==='shipped').reduce((n,sh)=>n+sh.qty,0);if(amount>p.transit-tracked) throw Error('期初在途可转入数量不足；关联出货单请在出货计划中确认到仓');p.transit-=amount;p.fba+=amount;record(state,p,'期初在途到仓',0,-amount,amount,reason); }
  else if(input.kind==='in') {addStockLot(p,'',amount); p.stock+=amount; record(state,p,'现货入库',amount,0,0,reason); }
  else if(input.kind==='out') { if(amount>available(state,p)) throw Error('可用现货不足，已预占库存不可扣减');const free=planStockLots(state,p).free;deductStockLots(p,takeLots(free,amount)); p.stock-=amount; record(state,p,'现货扣减',-amount,0,0,reason); }
  else throw Error('未知调整类型');
}
export function setStockOrderDetails(state,productId,value){const p=product(state,productId),lots=parseOrderPairs(value);if(lots.length&&lots.reduce((n,l)=>n+l.qty,0)!==p.stock)throw Error('现货订单数量合计必须等于现货数量');const candidate={...p,stockLots:lots.length?lots:(p.stock?[{ref:'',qty:p.stock}]:[])};for(const old of ensureStockLots(p))if(old.ref&&!candidate.stockLots.some(l=>l.ref===old.ref))candidate.stockLots.push({ref:old.ref,qty:0});planStockLots(state,candidate);p.stockLots=candidate.stockLots;record(state,p,'现货订单关联更新',0,0,0,'补充现货订单号与数量');}
export function orderDetails(input){
 const result={warehouse:text(input.warehouse),warehouseCode:text(input.warehouseCode)};
 for(const key of ['unitCost','length','width','height','grossWeight','netWeight'])result[key]=decimal(input[key],key,true);
 if(result.grossWeight!==null&&result.netWeight!==null&&result.netWeight>result.grossWeight)throw Error('净重不能大于毛重');
 return result;
}
export function updateShipmentETA(state,shipmentId,value){const s=state.shipments.find(s=>s.id===shipmentId);if(!s||!['planned','shipped'].includes(s.status))throw Error('仅可更新待出货或在途计划');const eta=text(value);if(eta){date(eta);if(eta<(s.shippedAt||s.date))throw Error('预计到货不能早于出货日期');}s.eta=eta;}
export function validateState(s) {
  if(s?.version===1){s.version=2;s.sales=[];s.costBases=[];s.costBills=[];s.estimates=[];s.jpSettings=jpDefaults();s.planning=defaultPlanning();}

  if(s?.version===2&&s.europeEstimates===undefined)s.europeEstimates=[];
  if(!s || s.version!==2 || typeof s.demo!=='boolean' || !Number.isInteger(s.reminderDays) || s.reminderDays<0 || s.reminderDays>30 || !['products','orders','shipments','ledger','sales','costBases','costBills','estimates','europeEstimates'].every(k=>Array.isArray(s[k]))) throw Error('备份格式不正确');
  const seen=new Set(), skus=new Set();
  for(const p of s.products) {
    if(!p.id||seen.has(p.id)||!['id','name','sku','msku','fnsku'].every(k=>typeof p[k]==='string'&&p[k].trim())) throw Error('产品档案无效');
    seen.add(p.id); if(skus.has(p.msku.toLowerCase())) throw Error('MSKU 重复'); skus.add(p.msku.toLowerCase());
    ['stock','transit','fba','threshold'].forEach(k=>{ if(typeof p[k]!=='number') throw Error('库存数量必须为数字');qty(p[k],true); });
  }
  for(const p of s.products)validateStockLots(p);
  const ids=new Set();
  for(const o of s.orders) { product(s,o.productId);if(typeof o.qty!=='number') throw Error('订单数量无效');qty(o.qty);date(o.due); if(!o.id||ids.has(o.id)||typeof o.ref!=='string'||!['producing','received'].includes(o.status)) throw Error('订单数据无效'); ids.add(o.id); }
  for(const sh of s.shipments) { product(s,sh.productId);if(typeof sh.qty!=='number') throw Error('出货数量无效');qty(sh.qty);date(sh.date); if(!sh.id||ids.has(sh.id)||typeof sh.ref!=='string'||!['planned','shipped','arrived','cancelled'].includes(sh.status)) throw Error('出货数据无效'); ids.add(sh.id); }
  for(const p of s.products) { if(available(s,p)<0) throw Error('预占数量超过现货库存'); const outstanding=s.shipments.filter(sh=>sh.productId===p.id&&sh.status==='shipped').reduce((n,sh)=>n+sh.qty,0);if(outstanding>p.transit) throw Error('在途库存与出货记录不一致'); }
  for(const l of s.ledger) { product(s,l.productId); if(!['action','reference','at'].every(k=>typeof l[k]==='string')||!Number.isFinite(Date.parse(l.at))||!['stock','transit','fba'].every(k=>Number.isSafeInteger(l[k]))) throw Error('库存流水无效'); }
  for(const o of s.orders){Object.assign(o,orderDetails(o));}
  for(const sh of s.shipments){
    sh.shop=text(sh.shop);sh.productionRef=text(sh.productionRef);sh.cbm=decimal(sh.cbm,'CBM',true);sh.eta=text(sh.eta);sh.shippedAt=text(sh.shippedAt);
    if(sh.eta){date(sh.eta);if(sh.eta<(sh.shippedAt||sh.date))throw Error('预计到货时间早于出货');}if(sh.shippedAt)date(sh.shippedAt);
    if(sh.productionRef&&!s.orders.some(o=>o.ref===sh.productionRef&&o.productId===sh.productId)&&!ensureStockLots(product(s,sh.productId)).some(l=>l.ref===sh.productionRef))throw Error('关联生产订单无效');
  }
  for(const p of s.products)planStockLots(s,p);
  const cfg=s.planning;if(!cfg||!Number.isFinite(cfg.multiplier)||cfg.multiplier<1.5||cfg.multiplier>2)throw Error('季节倍率须在 1.5–2 之间');
  for(const key of ['factoryMonths','planningDays','domesticDays','seaDays','fbaDays','lookbackWeeks']){integer(cfg[key],key);if(cfg[key]>365)throw Error('提前期设置过大');}
  if(cfg.factoryMonths>12||cfg.lookbackWeeks>52)throw Error('生产月数或销量回看周数无效');
  if(!s.jpSettings||Object.keys(jpDefaults()).some(k=>typeof s.jpSettings[k]!=='number'))throw Error('日本费用参数无效');
  japanQuote([{qty:1,cbm:1,cartons:1,unitCost:0,declaredPrice:0,salePrice:0,platformPerUnit:0}],s.jpSettings);
  const quoteRefs=new Set();for(const q of s.estimates){if(!q.id||!q.ref||quoteRefs.has(q.ref)||q.market!=='JP')throw Error('预估记录无效');quoteRefs.add(q.ref);for(const l of q.lines)product(s,l.productId);japanQuote(q.lines,q.settings);}
  const europeanRefs=new Set();for(const q of s.europeEstimates){if(!q.id||typeof q.ref!=='string'||!q.ref.trim()||europeanRefs.has(q.ref))throw Error('英德预估单号无效或重复');europeanRefs.add(q.ref);if(typeof q.source!=='string'||!q.source.trim())throw Error('英德报价缺少来源');validDate(q.rateDate,'报价日期');for(const l of q.lines)product(s,l.productId);europeQuote(q.lines,q.settings,q.groups,q.market);}
  const check={products:s.products,sales:[],costBases:[],costBills:[]};
  for(const sale of s.sales){if(!sale.id)throw Error('销量记录无效');addSales(check,sale);}
  for(const base of s.costBases){if(!base.id)throw Error('历史成本无效');addCostBaseline(check,base);}
  for(const bill of s.costBills){if(!bill.id)throw Error('账单记录无效');addActualBill(check,bill);const rebuilt=check.costBills.at(-1);for(let i=0;i<bill.lines.length;i++)if(Math.abs(rebuilt.lines[i].freight-bill.lines[i].freight)>0.000001||!Number.isFinite(bill.lines[i].freight))throw Error('账单分摊金额不一致');}
  return s;
}
export function demoState() {
  const s=emptyState(); s.demo=true;
  const defs=[['折叠收纳箱 · 奶油白','BX-001','BX-WH-US','X0048BX001',1280,460,826,300],['桌面置物架 · 原木色','RK-002','RK-WD-US','X0048RK002',860,320,562,200],['旅行收纳袋 · 雾霾蓝','BG-003','BG-BL-US','X0048BG003',240,600,148,200],['硅胶沥水垫 · 浅灰','MT-004','MT-GY-US','X0048MT004',640,0,390,150],['抽屉分隔板 · 四件装','DV-005','DV-WH-US','X0048DV005',120,240,86,120]];
  for(const [name,sku,msku,fnsku,stock,transit,fba,threshold] of defs) addProduct(s,{name,sku,msku,fnsku,stock,transit,fba,threshold});
  const offset=n=>new Date(Date.parse(today()+'T00:00:00Z')+n*86400000).toISOString().slice(0,10);
  addOrder(s,{productId:s.products[0].id,ref:'PO-2026-1021',qty:1000,due:offset(2),note:'包装确认后安排入库'});
  addOrder(s,{productId:s.products[2].id,ref:'PO-2026-1022',qty:800,due:offset(-1),note:'待工厂确认货好时间'});
  addOrder(s,{productId:s.products[1].id,ref:'PO-2026-1023',qty:600,due:offset(8)});
  addShipment(s,{productId:s.products[0].id,ref:'FBA-SH-001',qty:400,date:offset(1),destination:'美国 · ONT8'});
  addShipment(s,{productId:s.products[1].id,ref:'FBA-SH-002',qty:200,date:offset(3),destination:'美国 · LAX9'});
  for(const o of s.orders){Object.assign(o,orderDetails(o));}
  for(const sh of s.shipments){
    sh.shop=text(sh.shop);sh.productionRef=text(sh.productionRef);sh.cbm=decimal(sh.cbm,'CBM',true);sh.eta=text(sh.eta);sh.shippedAt=text(sh.shippedAt);
    if(sh.eta){date(sh.eta);if(sh.eta<(sh.shippedAt||sh.date))throw Error('预计到货时间早于出货');}if(sh.shippedAt)date(sh.shippedAt);
    if(sh.productionRef&&!s.orders.some(o=>o.ref===sh.productionRef&&o.productId===sh.productId)&&!ensureStockLots(product(s,sh.productId)).some(l=>l.ref===sh.productionRef))throw Error('关联生产订单无效');
  }
  for(const p of s.products)planStockLots(s,p);
  const cfg=s.planning;if(!cfg||!Number.isFinite(cfg.multiplier)||cfg.multiplier<1.5||cfg.multiplier>2)throw Error('季节倍率须在 1.5–2 之间');
  for(const key of ['factoryMonths','planningDays','domesticDays','seaDays','fbaDays','lookbackWeeks']){integer(cfg[key],key);if(cfg[key]>365)throw Error('提前期设置过大');}
  if(cfg.factoryMonths>12||cfg.lookbackWeeks>52)throw Error('生产月数或销量回看周数无效');
  if(!s.jpSettings||Object.keys(jpDefaults()).some(k=>typeof s.jpSettings[k]!=='number'))throw Error('日本费用参数无效');
  japanQuote([{qty:1,cbm:1,cartons:1,unitCost:0,declaredPrice:0,salePrice:0,platformPerUnit:0}],s.jpSettings);
  const quoteRefs=new Set();for(const q of s.estimates){if(!q.id||!q.ref||quoteRefs.has(q.ref)||q.market!=='JP')throw Error('预估记录无效');quoteRefs.add(q.ref);for(const l of q.lines)product(s,l.productId);japanQuote(q.lines,q.settings);}
  const europeanRefs=new Set();for(const q of s.europeEstimates){if(!q.id||typeof q.ref!=='string'||!q.ref.trim()||europeanRefs.has(q.ref))throw Error('英德预估单号无效或重复');europeanRefs.add(q.ref);if(typeof q.source!=='string'||!q.source.trim())throw Error('英德报价缺少来源');validDate(q.rateDate,'报价日期');for(const l of q.lines)product(s,l.productId);europeQuote(q.lines,q.settings,q.groups,q.market);}
  const check={products:s.products,sales:[],costBases:[],costBills:[]};
  for(const sale of s.sales){if(!sale.id)throw Error('销量记录无效');addSales(check,sale);}
  for(const base of s.costBases){if(!base.id)throw Error('历史成本无效');addCostBaseline(check,base);}
  for(const bill of s.costBills){if(!bill.id)throw Error('账单记录无效');addActualBill(check,bill);const rebuilt=check.costBills.at(-1);for(let i=0;i<bill.lines.length;i++)if(Math.abs(rebuilt.lines[i].freight-bill.lines[i].freight)>0.000001||!Number.isFinite(bill.lines[i].freight))throw Error('账单分摊金额不一致');}
  return s;
}
