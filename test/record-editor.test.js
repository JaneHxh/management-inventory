import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,addProduct,addOrder,receiveOrder,addShipment,ship,arrive,adjust,today,validateState} from '../src/model.js';
import {reviseRecord} from '../src/record-editor.js';
import {addSales,addActualBill,addCostBaseline,weightedCost} from '../src/costing.js';
const sample=()=>{const s=emptyState();addProduct(s,{name:'测试',sku:'A',msku:'M',fnsku:'F',stock:100,transit:0,fba:0,threshold:10});return s;};
const edit=(s,t,r,changes)=>reviseRecord(s,t,r.id,{...r,...changes});
test('产品可编辑身份、库存和批次，库存变更留差额流水，关联删除受保护',()=>{
 const s=sample(),r=s.products[0];edit(s,'products',r,{name:'修改',stock:90,stockOrders:'PO-0+90'});assert.equal(s.products[0].name,'修改');assert.equal(s.ledger[0].stock,-10);
 addOrder(s,{productId:r.id,ref:'P1',qty:50,due:today()});const snap=structuredClone(s);assert.throws(()=>reviseRecord(s,'products',r.id),/关联/);assert.deepEqual(s,snap);
 reviseRecord(s,'orders',s.orders[0].id);reviseRecord(s,'products',r.id);assert.equal(s.products.length,0);assert.equal(s.ledger.length,0);validateState(s);
});
test('在做订单修改、入库状态修改、数量修正与删除同步库存',()=>{
 const s=sample();addOrder(s,{productId:s.products[0].id,ref:'P1',qty:50,due:today()});let r=s.orders[0];edit(s,'orders',r,{qty:80,status:'received'});assert.equal(s.products[0].stock,180);r=s.orders[0];edit(s,'orders',r,{qty:60});assert.equal(s.products[0].stock,160);assert.equal(s.ledger[0].stock,-20);
 reviseRecord(s,'orders',r.id);assert.equal(s.products[0].stock,100);assert.equal(s.orders.length,0);validateState(s);
});
test('已使用的生产入库不能撤回，备注和价格仍可编辑，失败无副作用',()=>{
 const s=sample();addOrder(s,{productId:s.products[0].id,ref:'P1',qty:50,due:today()});const oid=s.orders[0].id;receiveOrder(s,oid);addShipment(s,{productId:s.products[0].id,ref:'S1',productionRef:'P1',qty:40,date:today()});ship(s,s.shipments[0].id);
 edit(s,'orders',s.orders[0],{note:'已核对',unitCost:30});assert.equal(s.products[0].stock,110);assert.equal(s.orders[0].unitCost,30);const snap=structuredClone(s);assert.throws(()=>reviseRecord(s,'orders',oid),/已被使用/);assert.deepEqual(s,snap);
});
test('计划数量修改重新预占，出货和到仓修改、删除按批次恢复库存',()=>{
 const s=sample(),pid=s.products[0].id;addShipment(s,{productId:pid,ref:'S1',qty:40,date:today()});let r=s.shipments[0];edit(s,'shipments',r,{qty:60});assert.equal(s.products[0].stock,100);r=s.shipments[0];edit(s,'shipments',r,{status:'shipped'});assert.equal(s.products[0].stock,40);assert.equal(s.products[0].transit,60);
 edit(s,'shipments',s.shipments[0],{qty:50});assert.equal(s.products[0].stock,50);assert.equal(s.products[0].transit,50);arrive(s,r.id);edit(s,'shipments',s.shipments[0],{shop:'英国',eta:today()});assert.equal(s.products[0].fba,50);
 reviseRecord(s,'shipments',r.id);assert.equal(s.products[0].stock,100);assert.equal(s.products[0].fba,0);assert.equal(s.products[0].transit,0);validateState(s);
});
test('已销售到仓单不能撤回；无现货时仍可编辑、删除已取消计划',()=>{
 const s=sample(),pid=s.products[0].id;addShipment(s,{productId:pid,ref:'S1',qty:100,date:today()});ship(s,s.shipments[0].id);arrive(s,s.shipments[0].id);adjust(s,{productId:pid,kind:'sale',qty:10,reason:'售出'});const snap=structuredClone(s);assert.throws(()=>reviseRecord(s,'shipments',s.shipments[0].id),/已销售/);assert.deepEqual(s,snap);
 const t=sample();addShipment(t,{productId:t.products[0].id,ref:'C1',qty:20,date:today()});edit(t,'shipments',t.shipments[0],{status:'cancelled'});adjust(t,{productId:t.products[0].id,kind:'out',qty:100,reason:'转出'});edit(t,'shipments',t.shipments[0],{status:'cancelled',shop:'新店铺'});reviseRecord(t,'shipments',t.shipments[0].id);validateState(t);
});
test('负数、重复单号、重复MSKU和批次预占冲突整次修改回滚',()=>{
 const s=sample();addProduct(s,{name:'二',sku:'B',msku:'M2',fnsku:'F2',stock:0,transit:0,fba:0,threshold:10});addShipment(s,{ref:'S1',productId:s.products[0].id,qty:80,date:today()});
 for(const [t,r,c] of [['products',s.products[0],{stock:20,stockOrders:''}],['products',s.products[0],{msku:'M2'}],['shipments',s.shipments[0],{qty:-1}]]){const snap=structuredClone(s);assert.throws(()=>edit(s,t,r,c));assert.deepEqual(s,snap);}
});
test('成本账单修改自动重分摊，删除重算加权成本且不影响实物库存',()=>{
 const s=sample(),pid=s.products[0].id;addCostBaseline(s,{productId:pid,qty:100,asOf:'2026-01-01',unitFreight:5,unitCost:10});addActualBill(s,{ref:'B1',date:'2026-02-01',basis:'qty',freight:1000,lines:[{productId:pid,qty:100,cbm:1,unitCost:20}]});edit(s,'costBills',s.costBills[0],{freight:2000});assert.equal(s.costBills[0].lines[0].freight,2000);assert.equal(weightedCost(s,pid).unitFreight,12.5);assert.equal(s.products[0].stock,100);
 reviseRecord(s,'costBills',s.costBills[0].id);assert.equal(weightedCost(s,pid).unitFreight,5);edit(s,'costBases',s.costBases[0],{unitFreight:8});assert.equal(weightedCost(s,pid).unitFreight,8);reviseRecord(s,'costBases',s.costBases[0].id);assert.equal(weightedCost(s,pid),null);
});
test('销量可改可删，周期冲突拒绝，流水可编辑原因并保留库存审计',()=>{
 const s=sample(),pid=s.products[0].id;addSales(s,{productId:pid,shop:'UK',start:'2026-01-01',end:'2026-01-07',qty:10});edit(s,'sales',s.sales[0],{qty:20});assert.equal(s.sales[0].qty,20);assert.equal(s.products[0].stock,100);reviseRecord(s,'sales',s.sales[0].id);assert.equal(s.sales.length,0);
 const l=s.ledger[0];edit(s,'ledger',l,{reference:'更正原因'});assert.equal(s.ledger[0].reference,'更正原因');assert.throws(()=>reviseRecord(s,'ledger',l.id),/不可直接删除/);
});
test('同票多款修改后重新分摊；日本预估重算且删除不影响实物库存',async()=>{
 const {jpDefaults,japanQuote}=await import('../src/costing.js');const s=sample(),pid=s.products[0].id;addProduct(s,{name:'二',sku:'B',msku:'M2',fnsku:'F2',stock:0,transit:0,fba:0,threshold:10});const p2=s.products[1].id;
 addActualBill(s,{ref:'B1',date:'2026-02-01',freight:1000,basis:'cbm',lines:[{productId:pid,qty:100,cbm:1,unitCost:20},{productId:p2,qty:50,cbm:1,unitCost:30}]});edit(s,'costBills',s.costBills[0],{lines:[{productId:pid,qty:100,cbm:3,unitCost:20},{productId:p2,qty:50,cbm:1,unitCost:30}]});assert.deepEqual(s.costBills[0].lines.map(l=>l.freight),[750,250]);
 s.estimates.push({id:'Q1',ref:'Q1',market:'JP',settings:jpDefaults(),lines:[{productId:pid,qty:100,cbm:1,cartons:10,unitCost:20,declaredPrice:1000,salePrice:3000,platformPerUnit:500}]});const old=japanQuote(s.estimates[0].lines,s.estimates[0].settings).freight;edit(s,'estimates',s.estimates[0],{settings:{...jpDefaults(),seaRate:900}});assert.equal(japanQuote(s.estimates[0].lines,s.estimates[0].settings).freight,old+100);const snapshot=structuredClone(s);assert.throws(()=>edit(s,'estimates',s.estimates[0],{lines:[]}));assert.deepEqual(s,snapshot);reviseRecord(s,'estimates','Q1');assert.equal(s.products[0].stock,100);
});
