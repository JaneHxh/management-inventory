import {today,daysUntil} from './model.js';
export const dayAfter=(value,days)=>new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
export function monthsAfter(value,months){const d=new Date(value+'T00:00:00Z'),day=d.getUTCDate();d.setUTCDate(1);d.setUTCMonth(d.getUTCMonth()+months);const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString().slice(0,10);}
export const defaultPlanning=()=>({multiplier:1.75,factoryMonths:3,planningDays:3,domesticDays:14,seaDays:45,fbaDays:14,lookbackWeeks:8});
export function season(date,multiplier=1.75){const m=Number(date.slice(5,7));return {factor:([9,10,11,12,1,2,3,7].includes(m)?multiplier:1),label:[9,10,11,12,1,2].includes(m)?'旺季':m===7?'会员日预留月':m===3?'春促预留月':'淡季'};}
// Campaign days are not known yet: conservatively reserve the uplift across March and July.
export function seasonalDays(start,days,multiplier){let sum=0;for(let i=0;i<days;i++)sum+=season(dayAfter(start,i),multiplier).factor;return sum;}
export function forecast(state,p,base=today()){
 const cfg=state.planning||defaultPlanning(),window=dayAfter(base,-cfg.lookbackWeeks*7);
 const sales=(state.sales||[]).filter(s=>s.productId===p.id&&s.end<base&&s.end>=window);
 const shops=[...new Set(sales.map(s=>s.shop))];
 if(!sales.length)return {ready:false,reason:'请上传近 '+cfg.lookbackWeeks+' 周销量',productId:p.id};
 let daily=0;for(const shop of shops){const rows=sales.filter(s=>s.shop===shop);daily+=rows.reduce((n,s)=>n+s.qty,0)/rows.reduce((n,s)=>n+seasonalDays(s.start,7,cfg.multiplier),0);}
 const transport=cfg.planningDays+cfg.domesticDays+cfg.seaDays+cfg.fbaDays;
 const factoryDate=monthsAfter(base,cfg.factoryMonths),fullLead=daysUntil(factoryDate,base)+transport;
 const allProduction=state.orders.filter(o=>o.productId===p.id&&o.status==='producing');
 const production=allProduction.filter(o=>o.due>=base),unconfirmedProduction=allProduction.filter(o=>o.due<base).reduce((n,o)=>n+o.qty,0);
 const shipments=state.shipments.filter(s=>s.productId===p.id&&s.status==='shipped');
 const timedTransit=shipments.filter(s=>s.eta&&s.eta>=base),known=timedTransit.reduce((n,s)=>n+s.qty,0);
 const uncertain=Math.max(0,p.transit-known);
 const planned=state.shipments.filter(s=>s.productId===p.id&&s.status==='planned'),reservedQty=planned.reduce((n,s)=>n+s.qty,0);
 const events=[{day:transport,qty:p.stock-reservedQty}];
 for(const s of planned)events.push({day:Math.max(transport,s.eta?daysUntil(s.eta,base):Math.max(0,daysUntil(s.date,base))+cfg.domesticDays+cfg.seaDays+cfg.fbaDays),qty:s.qty});
 for(const s of timedTransit)events.push({day:daysUntil(s.eta,base),qty:s.qty});
 for(const o of production)events.push({day:daysUntil(o.due,base)+transport,qty:o.qty});
 let balance=p.fba,firstShortage=null,firstReorder=null,minBalance=balance,need=0;
 for(let i=0;i<fullLead;i++){
  balance+=events.filter(e=>e.day===i).reduce((n,e)=>n+e.qty,0);
  const demand=daily*season(dayAfter(base,i),cfg.multiplier).factor;balance-=demand;need+=demand;
  if(balance<0&&firstShortage===null)firstShortage=dayAfter(base,i);
  if(balance<0&&i<transport&&firstReorder===null)firstReorder=dayAfter(base,i);
  minBalance=Math.min(minBalance,balance);
 }
 const committedSupply=p.fba+events.filter(e=>e.day<fullLead).reduce((n,e)=>n+e.qty,0);
 const reorderQty=Math.max(0,Math.ceil(need-committedSupply));
 const latest=sales.reduce((d,s)=>s.end>d?s.end:d,'');
 return {ready:true,productId:p.id,daily,transport,fullLead,demand:Math.ceil(need),replenish:!!firstReorder,reorder:reorderQty>0,reorderQty,replenishQty:Math.max(0,Math.ceil(daily*seasonalDays(base,transport,cfg.multiplier)-p.fba-timedTransit.filter(s=>daysUntil(s.eta,base)<transport).reduce((n,s)=>n+s.qty,0))),firstShortage,minBalance,latestOrderDate:firstShortage?monthsAfter(dayAfter(firstShortage,-transport),-cfg.factoryMonths):null,latestShipPlanDate:firstShortage?dayAfter(firstShortage,-transport):null,unknownTransit:uncertain,unconfirmedProduction,latest,stale:daysUntil(base,latest)>14,domestic:p.stock,production:production.reduce((n,o)=>n+o.qty,0)};
}
