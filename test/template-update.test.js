import {test} from 'node:test';import assert from 'node:assert/strict';
import {schemas,templateCSV,parseCSV,suggestMapping,prepareImport,tableFromRows} from '../src/importer.js';
import {emptyState,addProduct,activateShipmentDraft,available,today,ship,adjust,validateState} from '../src/model.js';
import {forecast,dayAfter} from '../src/planning.js';
import {addSales,weightedCost} from '../src/costing.js';
import {reviseRecord} from '../src/record-editor.js';
const load=(s,type,csv=templateCSV(type))=>{const t=parseCSV(csv);return prepareImport(s,t,type,suggestMapping(t.headers,type));};
const sample=()=>load(emptyState(),'products').next;
const dataTable=(type,rows)=>tableFromRows([schemas[type].fields.map(f=>f[1]),...rows.map(row=>schemas[type].fields.map(([k])=>row[k]??''))]);
const batch=(s,type,rows)=>{const t=dataTable(type,rows);return prepareImport(s,t,type,suggestMapping(t.headers,type));};
test('五个模板按用户列顺序，FBA不含空白占位列',()=>{
 const expected={products:'产品名称|货号|MSKU|FNSKU|现货数量|在做订单数量|现货订单号+数量|在做订单号+数量|在做订单号+货好日期|国家',fbaInventory:'产品名称|货号|MSKU|FNSKU|FBA在售库存|FBA在途库存|FBA在途库存+预计到货日期|国家',shipments:'批次备注|店铺|货件单号/已申报|PO-ID|采购计划编号/采购单号|注意|品名|SKU|单箱数量（PCS）|箱数|计划发货量|发货仓库|箱规长（cm）|箱规宽（cm）|箱规高（cm）|CBM（m³）|总净重（kg）|总毛重（kg）|单箱净重（kg）|单箱毛重（kg）|仓库地址|仓库类型|MSKU|FNSKU|ASIN|链接|申报价格',costBills:'票数|Shipment ID|货件PO|账号|产品名|item number|SKU|产品小标|注意事项|工厂|PO#|cbm|申报价格|发货数量|接收数量|差异|MRN /IEN|预估运费$|实际运费$|税金(GBP)|国内运费(RMB)|Shipment date|ETD|ETA FBA warehouse|Tracking number|BL|提单号|柜号|封号|状态|备注',sales:'店铺|SKU|周期开始|周期结束|销量'};
 for(const [type,header] of Object.entries(expected)){assert.deepEqual(parseCSV(templateCSV(type)).headers,header.split('|'));const t=parseCSV(templateCSV(type)),m=suggestMapping(t.headers,type);assert.equal(new Set(Object.values(m)).size,Object.values(m).length);}
});
test('国家保留，FBA快照不动国内现货，多批ETA参与预测且重复上传不累加',()=>{
 let s=sample();const p=s.products[0];assert.equal(p.country,'日本');const row={...p,fba:200,transit:50,transitDates:`20+${dayAfter(today(),20)}；30+${dayAfter(today(),30)}`};let result=batch(s,'fbaInventory',[row]);assert.deepEqual(result.errors,[]);s=result.next;assert.equal(s.products[0].stock,100);assert.equal(s.products[0].fba,200);assert.equal(s.products[0].fbaTransitLots.length,2);s=batch(s,'fbaInventory',[row]).next;assert.equal(s.products[0].transit,50);assert.equal(s.products[0].fba,200);
 addSales(s,{productId:p.id,shop:'日本店',start:dayAfter(today(),-7),end:dayAfter(today(),-1),qty:70});assert.equal(forecast(s,s.products[0]).unknownTransit,0);adjust(s,{productId:p.id,kind:'transit-receipt',qty:25,reason:'快照在途到仓'});assert.equal(s.products[0].transit,25);assert.equal(s.products[0].fbaTransitLots.reduce((n,l)=>n+l.qty,0),25);validateState(s);
});
test('FBA可单独建档；批次合计错、假日期、国家不匹配、重复行整批拒绝',()=>{
 const first=load(emptyState(),'fbaInventory');assert.deepEqual(first.errors,[]);assert.equal(first.next.products[0].stock,0);assert.equal(first.next.products[0].fba,200);
 const s=sample(),p=s.products[0],base={...p,fba:200,transit:50,transitDates:'50+2026-12-01'};for(const row of [{...base,transitDates:'49+2026-12-01'},{...base,transitDates:'50+2026-02-30'},{...base,country:'英国'}]){const r=batch(s,'fbaInventory',[row]);assert.equal(r.next,null);assert.ok(r.errors.length);assert.equal(p.fba,0);}assert.equal(batch(s,'fbaInventory',[base,base]).next,null);
});
test('已跟踪出货在途禁止FBA快照覆盖，旧备份平滑迁移新数组',()=>{
 const s=sample();const out=load(s,'shipments').next;activateShipmentDraft(out,out.shipmentDrafts[0].id,today());ship(out,out.shipments[0].id);assert.match(load(out,'fbaInventory').errors[0].message,/出货单在途/);const corrupt=load(s,'fbaInventory').next;corrupt.products[0].fbaTransitLots[0].qty='50';assert.throws(()=>validateState(corrupt),/必须为数字/);const old=structuredClone(s);delete old.shipmentDrafts;delete old.freightRecords;delete old.products[0].country;delete old.products[0].fbaTransitLots;validateState(old);assert.deepEqual(old.shipmentDrafts,[]);assert.deepEqual(old.products[0].fbaTransitLots,[]);
});
test('出货27列保存为草稿不预占，编辑后生成计划保留全部物流字段',()=>{
 const s=load(sample(),'shipments').next,r=s.shipmentDrafts[0];assert.equal(available(s,s.products[0]),100);assert.equal(s.shipments.length,0);reviseRecord(s,'shipmentDrafts',r.id,{...r,batchNote:'英国第100票',asin:'B000TEST',poId:'000123',attention:'请贴标'});activateShipmentDraft(s,r.id,today());assert.equal(s.shipmentDrafts.length,0);assert.equal(available(s,s.products[0]),50);assert.equal(s.shipments[0].poId,'000123');assert.equal(s.shipments[0].attention,'请贴标');assert.equal(s.shipments[0].length,60);const sh=s.shipments[0];reviseRecord(s,'shipments',sh.id,{...sh,batchNote:'更新批次',address:'新仓地址'});assert.equal(s.shipments[0].address,'新仓地址');assert.equal(available(s,s.products[0]),50);validateState(s);
 const bad=templateCSV('shipments').replace('"10","5","50"','"10","6","50"');assert.equal(load(sample(),'shipments',bad).next,null);
});
test('实际账单31列原币种保留，不混入成本；允许同票同货件不同SKU，重复明细拦截',()=>{
 const s=sample();const t=parseCSV(templateCSV('costBills'));const base=Object.fromEntries(schemas.costBills.fields.map(([k],i)=>[k,t.entries[0].cells[i]]));const one={...base,ref:'100',shipmentId:'FBA0001',sku:'000123',sellerSku:'SKU-1',actualUSD:123.45,taxGBP:67.89,domesticCNY:200,receivedQty:45,difference:-5};const r=batch(s,'costBills',[one,{...one,sku:'000124',sellerSku:'SKU-2'}]);assert.deepEqual(r.errors,[]);assert.equal(r.next.freightRecords.length,2);assert.equal(r.next.freightRecords[0].actualUSD,123.45);assert.equal(r.next.freightRecords[0].sku,'000123');assert.equal(r.next.costBills.length,0);assert.equal(weightedCost(r.next,s.products[0].id),null);assert.equal(r.next.products[0].stock,100);
 assert.equal(batch(s,'costBills',[one,one]).next,null);assert.equal(load(s,'costBills').next.freightRecords[0].actualUSD,null);const f=r.next.freightRecords[0];reviseRecord(r.next,'freightRecords',f.id,{...f,actualUSD:150,note:'已收账单'});assert.equal(r.next.freightRecords.at(-1).actualUSD,150);validateState(r.next);
});
test('每周销量SKU支持唯一货号和MSKU，有歧义拒绝；旧MSKU列兼容',()=>{
 const s=sample(),p=s.products[0],row={shop:'日本店',sellerSku:p.sku,start:dayAfter(today(),-7),end:dayAfter(today(),-1),qty:20};const r=batch(s,'sales',[row]);assert.equal(r.errors.length,0);assert.equal(r.next.sales[0].productId,p.id);assert.equal(r.next.sales[0].sellerSku,p.sku);assert.equal(r.next.products[0].stock,100);assert.equal(load(s,'sales',templateCSV('sales').replace('"SKU"','"MSKU"')).errors.length,0);
 addProduct(s,{name:'同货号',sku:p.sku,msku:'M2',fnsku:'F2',stock:0,transit:0,fba:0,threshold:0});assert.match(batch(s,'sales',[row]).errors[0].message,/多个产品/);
});
