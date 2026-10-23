import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,addProduct,addOrder,addShipment,ship,updateShipmentETA,validateState,today} from '../src/model.js';
import {dayAfter,monthsAfter,season,forecast} from '../src/planning.js';
import {japanQuote,addSales,addActualBill,addCostBaseline,weightedCost} from '../src/costing.js';
import {parseCSV,suggestMapping,prepareImport,templateCSV,schemas} from '../src/importer.js';
const make=()=>{const s=emptyState();const p=addProduct(s,{name:'收纳箱',sku:'BX-001',msku:'BX-WH-US',fnsku:'X001EXAMPLE',stock:100,transit:0,fba:20,threshold:50});return [s,p];};
const importFile=(s,type,csv=templateCSV(type))=>{const t=parseCSV(csv);return prepareImport(s,t,type,suggestMapping(t.headers,type));};
test('生产和出货字段与模板顺序一致，小数尺寸与成本保留，ETA 可晚补',()=>{
 const [s,p]=make();const result=importFile(s,'orders');assert.equal(result.errors.length,0);const o=result.next.orders[0];assert.equal(o.length,60);assert.equal(o.netWeight,14);assert.equal(o.unitCost,25);assert.equal(o.warehouseCode,'CN-YW');
 const out=importFile(result.next,'shipments');assert.equal(out.errors.length,0);const sh=out.next.shipments[0];assert.equal(sh.cbm,1.2);assert.equal(sh.shop,'日本店铺');assert.equal(sh.eta,'');ship(out.next,sh.id);updateShipmentETA(out.next,sh.id,dayAfter(today(),60));validateState(out.next);
 assert.deepEqual(schemas.shipments.fields.map(f=>f[1]),['出货单号','出货店铺','生产订单编号','产品名称','货号','MSKU','FNSKU','数量','cbm','计划出货日期','目的仓库','预计到货时间']);
 assert.throws(()=>updateShipmentETA(out.next,sh.id,'2020-01-01'),/不能早于/);
});
test('生产订单链接核对产品，重量不能倒置，产品档案不匹配整批拒绝',()=>{
 const [s,p]=make();assert.throws(()=>addOrder(s,{productId:p.id,ref:'P',qty:2,due:today(),grossWeight:10,netWeight:11}),/净重/);
 assert.throws(()=>addShipment(s,{productId:p.id,ref:'S',qty:2,date:today(),productionRef:'MISSING'}),/不匹配/);
 const res=importFile(s,'shipments',templateCSV('shipments').replace('收纳箱','错误名称'));assert.equal(res.next,null);assert.match(res.errors[0].message,/不符/);
});
test('周销量只用于预测，不扣库存；重复/重叠周期拒绝',()=>{
 const [s,p]=make(),end=dayAfter(today(),-1),start=dayAfter(end,-6);addSales(s,{productId:p.id,shop:'JP',start,end,qty:70});assert.equal(p.fba,20);
 assert.throws(()=>addSales(s,{productId:p.id,shop:'JP',start,end,qty:70}),/重叠/);assert.throws(()=>addSales(s,{productId:p.id,shop:'JP',start,end:dayAfter(end,-1),qty:70}),/7 天/);
 assert.throws(()=>addSales(s,{productId:p.id,shop:'JP',start:dayAfter(today(),-6),end:today(),qty:70}),/完整周/);
 validateState(s);
});
test('季节日历 9–2 月旺季、3/7 月促销，倍率不叠乘，工厂按日历月',()=>{
 for(const month of ['01','02','03','07','09','10','11','12'])assert.equal(season('2026-'+month+'-01',2).factor,2);
 for(const month of ['04','05','06','08'])assert.equal(season('2026-'+month+'-01',2).factor,1);
 assert.equal(monthsAfter('2026-01-31',1),'2026-02-28');assert.equal(monthsAfter('2026-10-23',3),'2027-01-23');
});
test('还原旺季销量基线，提醒完整 168 天提前期，无数据不判安全',()=>{
 const [s,p]=make();assert.equal(forecast(s,p,'2026-10-23').ready,false);
 addSales(s,{productId:p.id,shop:'JP',start:'2026-10-12',end:'2026-10-18',qty:70});const f=forecast(s,p,'2026-10-23');assert.equal(f.transport,76);assert.equal(f.fullLead,168);assert.ok(Math.abs(f.daily-70/12.25)<1e-9);assert.equal(f.replenish,true);assert.equal(f.reorder,true);assert.ok(f.reorderQty>0);
});
test('远期 ETA、未知在途及逾期生产不虚增覆盖，预占库存不重复计数',()=>{
 const [s,p]=make();addSales(s,{productId:p.id,shop:'JP',start:'2026-10-12',end:'2026-10-18',qty:70});const base=forecast(s,p,'2026-10-23');p.transit=10000;assert.equal(forecast(s,p,'2026-10-23').reorderQty,base.reorderQty);
 addOrder(s,{productId:p.id,ref:'OVERDUE',qty:10000,due:'2026-10-01'});assert.equal(forecast(s,p,'2026-10-23').reorderQty,base.reorderQty);
 addShipment(s,{productId:p.id,ref:'S',qty:50,date:today()});ship(s,s.shipments[0].id);s.shipments[0].eta='2028-01-01';assert.equal(forecast(s,p,'2026-10-23').reorderQty,base.reorderQty+50);
});
test('日本整票费用多款固定费用仅收一次，税金 JPY 转 RMB，利润可对账',()=>{
 const line={qty:100,cbm:1,cartons:10,unitCost:20,declaredPrice:2000,salePrice:3000,platformPerUnit:800};
 const quote=japanQuote([line,{...line,cbm:3}]);assert.ok(Math.abs(quote.lines[0].taxJPY-7540)<1e-9);assert.ok(Math.abs(quote.lines[0].tax-354.38)<1e-9);assert.equal(quote.lines[0].allocatedFixed,462.5);assert.equal(quote.lines[1].allocatedFixed,1387.5);
 assert.ok(Math.abs(quote.freight-(4000+708.76+80+1850))<1e-9);assert.equal(quote.lines[0].revenue,14100);assert.equal(quote.lines[0].platform,3760);
 assert.throws(()=>japanQuote([{...line,cbm:0}]),/大于/);assert.throws(()=>japanQuote([line],{fx:0}),/大于/);
});
test('历史基数与实际账单加权；重复账单和基数日期重叠拦截；预估不混入实际成本',()=>{
 const [s,p]=make();addCostBaseline(s,{productId:p.id,qty:100,unitFreight:10,unitCost:20,asOf:'2026-01-01'});
 addActualBill(s,{ref:'B1',date:'2026-10-23',basis:'qty',freight:2000,lines:[{productId:p.id,qty:100,cbm:1,unitCost:30}]});const c=weightedCost(s,p.id);assert.equal(c.unitFreight,15);assert.equal(c.unitCost,25);assert.equal(c.landed,40);assert.equal(c.qty,200);assert.equal(p.stock,100);
 assert.throws(()=>addActualBill(s,{ref:'B1',date:'2026-10-23',basis:'qty',freight:1,lines:[]}),/已存在/);
 assert.throws(()=>addActualBill(s,{ref:'B2',date:'2026-01-01',basis:'qty',freight:1,lines:[{productId:p.id,qty:1,unitCost:1}]}),/截至日期/);
 const quote=importFile(s,'estimates');assert.equal(quote.errors.length,0);assert.deepEqual(weightedCost(quote.next,p.id),c);validateState(quote.next);
});
test('同票多款账单合并、费用仅计一次，分摊总额守恒',()=>{
 const [s,p]=make(),p2=addProduct(s,{name:'产品2',sku:'2',msku:'TWO',fnsku:'X2',stock:0,transit:0,fba:0,threshold:0});
 const csv='账单号,账单日期,分摊方式,整票实际头程人民币,MSKU,数量,总cbm,实际单件出厂价人民币\nB1,2026-10-23,cbm,1000,BX-WH-US,100,1,20\nB1,2026-10-23,cbm,1000,TWO,200,3,30';const r=importFile(s,'costBills',csv);assert.equal(r.errors.length,0);assert.equal(r.next.costBills.length,1);assert.equal(r.next.costBills[0].lines[0].freight,250);assert.equal(r.next.costBills[0].lines[1].freight,750);assert.equal(weightedCost(r.next,p.id).unitFreight,2.5);assert.equal(weightedCost(r.next,p2.id).unitFreight,3.75);validateState(r.next);
 assert.equal(importFile(s,'costBills',csv.replace('1000,TWO','999,TWO')).next,null);
});
test('旧版备份迁移保留全部库存，坏费用数据校验拒绝，英德不套用日本',()=>{
 const [s,p]=make();const old=structuredClone(s);old.version=1;for(const k of ['sales','costBases','costBills','estimates','planning','jpSettings'])delete old[k];const migrated=validateState(old);assert.equal(migrated.version,2);assert.equal(migrated.products[0].stock,100);assert.equal(migrated.sales.length,0);
 assert.equal(importFile(s,'estimates',templateCSV('estimates').replace('JP','UK')).next,null);const bad=structuredClone(s);bad.planning.multiplier=0;assert.throws(()=>validateState(bad),/倍率/);
});
test('同订单或出货单多款产品分行导入与确认，重复行仍拦截',()=>{
 const [s,p]=make(),p2=addProduct(s,{name:'第二款',sku:'P2',msku:'SECOND',fnsku:'X2',stock:100,transit:0,fba:0,threshold:0});
 addOrder(s,{ref:'PO-MULTI',productId:p.id,qty:10,due:today()});addOrder(s,{ref:'PO-MULTI',productId:p2.id,qty:20,due:today()});assert.equal(s.orders.length,2);
 addShipment(s,{ref:'SH-MULTI',shop:'JP',productId:p.id,productionRef:'PO-MULTI',qty:10,date:today()});addShipment(s,{ref:'SH-MULTI',shop:'JP',productId:p2.id,productionRef:'PO-MULTI',qty:20,date:today()});
 assert.throws(()=>addShipment(s,{ref:'SH-MULTI',shop:'JP',productId:p2.id,qty:10,date:today()}),/已存在/);ship(s,s.shipments[0].id);assert.equal(p2.stock,80);assert.equal(p.stock,100);validateState(s);
});
