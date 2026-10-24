import {id,today,daysUntil} from './model.js';
export function decimal(v,label='金额',allowBlank=false){if(v===''||v===undefined||v===null||(typeof v==='string'&&!v.trim())){if(allowBlank)return null;throw Error(label+'不能为空');}if(!['string','number'].includes(typeof v))throw Error(label+'必须为数字');const n=Number(v);if(!Number.isFinite(n)||n<0||n>1e10)throw Error(label+'必须为有效非负数');return n;}
export function positive(v,label){const n=decimal(v,label);if(!n)throw Error(label+'必须大于 0');return n;}
export function integer(v,label,zero=false){const n=decimal(v,label);if(!Number.isSafeInteger(n)||(!zero&&n===0)||n>1e8)throw Error(label+'必须为'+(zero?'非负':'正')+'整数');return n;}
export function validDate(v,label='日期'){if(!/^\d{4}-\d{2}-\d{2}$/.test(v||'')||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error(label+'无效');return v;}
export const jpDefaults=()=>({seaRate:800,domesticRate:200,taxBase:0.29,taxRate:0.13,labelRate:4,clearance:1500,declaration:350,fx:0.047});
export function japanQuote(lines,settings={}){
 const cfg={...jpDefaults(),...settings};for(const key of Object.keys(jpDefaults()))decimal(cfg[key],key);positive(cfg.fx,'日元兑人民币');
 if(!lines.length)throw Error('至少添加一款产品');
 const prepared=lines.map(l=>({...l,qty:integer(l.qty,'数量'),cbm:positive(l.cbm,'CBM'),cartons:integer(l.cartons,'箱数'),unitCost:decimal(l.unitCost,'出厂价'),declaredPrice:decimal(l.declaredPrice,'申报售价'),salePrice:decimal(l.salePrice,'销售价'),platformPerUnit:decimal(l.platformPerUnit,'平台佣金及尾程单件费用')}));
 const totalCBM=prepared.reduce((n,l)=>n+l.cbm,0),fixed=Number(cfg.clearance)+Number(cfg.declaration);
 const result=prepared.map(l=>{
  const sea=l.cbm*cfg.seaRate,domestic=l.cbm*cfg.domesticRate,taxJPY=l.declaredPrice*l.qty*cfg.taxBase*cfg.taxRate,tax=taxJPY*cfg.fx,label=l.cartons*cfg.labelRate,allocatedFixed=fixed*l.cbm/totalCBM;
  const freight=sea+domestic+tax+label+allocatedFixed,productCost=l.qty*l.unitCost,revenue=l.salePrice*l.qty*cfg.fx,platform=l.platformPerUnit*l.qty*cfg.fx,profit=revenue-productCost-freight-platform;
  return {...l,sea,domestic,taxJPY,tax,label,allocatedFixed,freight,freightPerUnit:freight/l.qty,productCost,revenue,platform,profit,margin:revenue?profit/revenue:null};
 });
 return {lines:result,totalCBM,freight:result.reduce((n,l)=>n+l.freight,0),profit:result.reduce((n,l)=>n+l.profit,0),settings:cfg};
}
export function addSales(state,input){
 const p=state.products.find(p=>p.id===input.productId);if(!p)throw Error('产品不存在');
 const start=validDate(input.start),end=validDate(input.end),shop=String(input.shop||'').trim();if(!shop)throw Error('出货店铺不能为空');
 if(daysUntil(end,start)!==6)throw Error('每条周销量必须覆盖连续 7 天（含首尾）');if(end>=today())throw Error('仅导入截至昨天的完整周销量');
 if(state.sales.some(s=>s.productId===p.id&&s.shop===shop&&s.start<=end&&s.end>=start))throw Error('该店铺产品的销量周期重叠，请勿重复导入');
 state.sales.push({id:id(),productId:p.id,shop,sellerSku:String(input.sellerSku||p.msku).trim(),start,end,qty:integer(input.qty,'销量',true)});
}
export function addCostBaseline(state,input){
 const p=state.products.find(p=>p.id===input.productId);if(!p)throw Error('产品不存在');if(state.costBases.some(b=>b.productId===p.id))throw Error('该产品已有历史成本基数');
 const qty=integer(input.qty,'历史成本基数数量');const asOf=validDate(input.asOf,'历史成本截至日期');if(state.costBills.some(b=>b.date<=asOf&&b.lines.some(l=>l.productId===p.id)))throw Error('已有账单早于基数截至日期，会重复计入，请先核对基数');
 state.costBases.push({id:id(),productId:p.id,qty,unitFreight:decimal(input.unitFreight,'历史单件加权头程'),unitCost:decimal(input.unitCost,'历史单件加权采购成本'),asOf});
}
export function addActualBill(state,input){
 const ref=String(input.ref||'').trim();if(!ref)throw Error('账单号不能为空');if(state.costBills.some(b=>b.ref===ref))throw Error('账单号已存在');
 const date=validDate(input.date),basis=input.basis||'cbm';if(!['cbm','qty'].includes(basis))throw Error('分摊方式无效');if(!input.lines?.length)throw Error('至少添加一条账单明细');
 const seen=new Set();const lines=input.lines.map(l=>{const p=state.products.find(p=>p.id===l.productId);if(!p)throw Error('产品不存在');if(seen.has(p.id))throw Error('同票同款产品请合并为一行');seen.add(p.id);const baseline=state.costBases.find(b=>b.productId===p.id);if(baseline&&date<=baseline.asOf)throw Error('账单日期须晚于历史成本截至日期，避免重复计入');return {productId:p.id,qty:integer(l.qty,'数量'),cbm:basis==='cbm'?positive(l.cbm,'CBM'):decimal(l.cbm||0,'CBM'),unitCost:decimal(l.unitCost,'实际单件出厂价')};});
 const freight=decimal(input.freight,'整票实际头程费用'),total=lines.reduce((n,l)=>n+(basis==='cbm'?l.cbm:l.qty),0);
 lines.forEach(l=>{l.freight=freight*(basis==='cbm'?l.cbm:l.qty)/total;});
 state.costBills.push({id:id(),ref,date,basis,freight,lines});
}
export function weightedCost(state,productId){
 const base=state.costBases.find(b=>b.productId===productId),lines=state.costBills.flatMap(b=>b.lines.filter(l=>l.productId===productId));
 const qty=(base?.qty||0)+lines.reduce((n,l)=>n+l.qty,0);if(!qty)return null;
 const freight=(base?base.qty*base.unitFreight:0)+lines.reduce((n,l)=>n+l.freight,0),purchase=(base?base.qty*base.unitCost:0)+lines.reduce((n,l)=>n+l.qty*l.unitCost,0);
 return {qty,unitFreight:freight/qty,unitCost:purchase/qty,landed:(freight+purchase)/qty,history:!!base};
}
