import {decimal,positive,integer} from './costing.js';
export function europeDefaults(market){if(!['UK','DE'].includes(market))throw Error('仅支持 UK、DE');return {domesticRate:200,taxBase:.3,taxRate:.06,includeTax:market==='DE',vatRate:market==='UK'?1/6:19/119,commissionRate:.15,promotionRate:.06,returnRate:.05,operationsRate:market==='UK'?.07:.05,digitalRate:market==='UK'?.02:0};}
export function europeQuote(lines,settings,groups,market){
 const cfg={...europeDefaults(market),...settings};positive(cfg.fx,'人民币/本币汇率');positive(cfg.usdCny,'人民币/美元汇率');decimal(cfg.domesticRate,'国内运费');
 if(typeof cfg.includeTax!=='boolean')throw Error('必须明确是否计税');
 for(const key of ['taxBase','taxRate','vatRate','commissionRate','promotionRate','returnRate','operationsRate','digitalRate'])if(decimal(cfg[key],key)>1)throw Error('比例不能超过 100%');
 const thirdRate=cfg.thirdRate===undefined||cfg.thirdRate===null||cfg.thirdRate===''?null:decimal(cfg.thirdRate,'第三方元/kg');
 if(!lines?.length||!groups?.length)throw Error('产品和 AGL 费用组不能为空');
 const groupMap=new Map();for(const g of groups){if(!g.key||groupMap.has(g.key))throw Error('费用组为空或重复');groupMap.set(g.key,{key:g.key,fixedFee:decimal(g.fixedFee,'费用组固定费'),billingCBM:g.billingCBM===undefined?null:positive(g.billingCBM,'计费 CBM'),cbm:0,variable:0,qty:0});}
 const prepared=lines.map(l=>{
  const group=groupMap.get(l.group);if(!group)throw Error('产品缺少对应 AGL 费用组');
  const row={...l,qty:integer(l.qty,'数量'),cbm:positive(l.cbm,'产品总 CBM'),netKg:decimal(l.netKg,'产品总净重'),grossKg:decimal(l.grossKg,'产品总毛重'),aglRate:decimal(l.aglRate,'选定档位元/CBM')};
  group.cbm+=row.cbm;group.variable+=row.cbm*row.aglRate;group.qty+=row.qty;
  row.declaredPrice=cfg.includeTax?decimal(l.declaredPrice,'申报单价'):null;
  for(const key of ['unitCostUSD','salePrice','fbaPerUnit','storagePerUnit'])row[key]=decimal(l[key],key,true);
  if(row.unitCostUSD===0)throw Error('出厂成本不能为 0，请补有效成本');
  return row;
 });
 for(const g of groupMap.values()){if(!g.cbm)throw Error('存在没有产品的费用组');if(g.billingCBM!==null){if(g.billingCBM<g.cbm)throw Error('计费 CBM 不得小于实际 CBM');g.variable*=g.billingCBM/g.cbm;}}
 const results=prepared.map(l=>{
  const g=groupMap.get(l.group),share=l.cbm/g.cbm,fixed=g.fixedFee*share,variable=l.cbm*l.aglRate*(g.billingCBM===null?1:g.billingCBM/g.cbm),domestic=l.cbm*cfg.domesticRate,billedWeight=Math.max(l.netKg,l.grossKg);
  if(thirdRate!==null&&billedWeight<=0)throw Error('第三方报价需要有效的产品总重量');
  const taxLocal=cfg.includeTax?l.declaredPrice*l.qty*cfg.taxBase*cfg.taxRate:0,tax=taxLocal*cfg.fx,aglInternational=fixed+variable,thirdInternational=thirdRate===null?null:billedWeight*thirdRate;
  const profitFor=freight=>{if(freight===null||[l.unitCostUSD,l.salePrice,l.fbaPerUnit,l.storagePerUnit].some(x=>x===null))return null;const override=(key,base)=>l[key]===undefined||l[key]===null||l[key]===''?base:decimal(l[key],key);const unitCostLocal=l.unitCostUSD*cfg.usdCny/cfg.fx,vat=override('vatPerUnit',l.salePrice*cfg.vatRate),commission=override('commissionPerUnit',l.salePrice*cfg.commissionRate),promotion=override('promotionPerUnit',l.salePrice*cfg.promotionRate),returns=override('returnPerUnit',l.salePrice*cfg.returnRate),operations=override('operationsPerUnit',l.salePrice*cfg.operationsRate),digital=override('digitalPerUnit',(commission+l.fbaPerUnit)*cfg.digitalRate);
   const unitFreight=freight/cfg.fx/l.qty,unitProfit=l.salePrice-vat-commission-promotion-returns-operations-digital-unitCostLocal-l.fbaPerUnit-l.storagePerUnit-unitFreight;
   return {unitCostLocal,vat,commission,promotion,returns,operations,digital,fba:l.fbaPerUnit,storage:l.storagePerUnit,unitFreight,unitProfit,totalProfit:unitProfit*l.qty,revenue:l.salePrice*l.qty,margin:l.salePrice?unitProfit/l.salePrice:null};};
  const aglTotal=aglInternational+domestic+tax,thirdTotal=thirdInternational===null?null:thirdInternational+domestic+tax;
  return {...l,fixed,variable,domestic,billedWeight,tax,taxLocal,aglInternational,thirdInternational,aglTotal,thirdTotal,aglProfit:profitFor(aglTotal),thirdProfit:profitFor(thirdTotal)};
 });
 const sum=key=>results.reduce((n,l)=>n+l[key],0),aglTotal=sum('aglTotal'),thirdTotal=thirdRate===null?null:sum('thirdTotal');
 const profitSum=key=>results.some(l=>l[key]===null)?null:results.reduce((n,l)=>n+l[key].totalProfit,0);
 return {market,currency:market==='UK'?'GBP':'EUR',settings:cfg,groups:[...groupMap.values()],lines:results,quantity:sum('qty'),cbm:sum('cbm'),weight:sum('billedWeight'),fixed:sum('fixed'),variable:sum('variable'),domestic:sum('domestic'),tax:sum('tax'),aglInternational:sum('aglInternational'),thirdInternational:thirdRate===null?null:sum('thirdInternational'),aglTotal,thirdTotal,aglProfit:profitSum('aglProfit'),thirdProfit:profitSum('thirdProfit'),difference:thirdTotal===null?null:Math.abs(aglTotal-thirdTotal),cheaper:thirdTotal===null?null:Math.abs(aglTotal-thirdTotal)<1e-9?'相同':aglTotal<thirdTotal?'AGL':'第三方',saving:thirdTotal===null?null:Math.max(aglTotal,thirdTotal)?Math.abs(aglTotal-thirdTotal)/Math.max(aglTotal,thirdTotal):0};
}
