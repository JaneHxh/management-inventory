import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyState,addProduct,addOrder,receiveOrder,addShipment,ship,arrive,cancelShipment,adjust,available,reserved,producing,validateState,daysUntil,demoState} from '../src/model.js';
const make = () => {const s=emptyState();const p=addProduct(s,{name:'收纳箱',sku:'BX01',msku:'BX-WH',fnsku:'X001',stock:100,transit:0,fba:10,threshold:20});return [s,p];};
test('完整流转：生产入库 → 计划预占 → 出货扣减 → FBA 到仓 → 销售',()=>{
 const [s,p]=make();addOrder(s,{productId:p.id,ref:'PO1',qty:50,due:'2026-10-29'});assert.equal(producing(s,p.id),50);assert.equal(p.stock,100);
 receiveOrder(s,s.orders[0].id);assert.equal(p.stock,150);assert.equal(producing(s,p.id),0);
 addShipment(s,{productId:p.id,ref:'SH1',qty:80,date:'2026-10-30'});assert.equal(p.stock,150);assert.equal(reserved(s,p.id),80);assert.equal(available(s,p),70);
 ship(s,s.shipments[0].id);assert.equal(p.stock,70);assert.equal(p.transit,80);assert.equal(reserved(s,p.id),0);
 arrive(s,s.shipments[0].id);assert.equal(p.transit,0);assert.equal(p.fba,90);
 adjust(s,{productId:p.id,kind:'sale',qty:15,reason:'销售日报'});assert.equal(p.fba,75);assert.equal(s.ledger.length,5);validateState(s);
 assert.equal(p.stock+p.transit+p.fba,145);
});
test('多个出货计划共享可用库存，禁止超额预占；取消释放预占',()=>{
 const [s,p]=make();addShipment(s,{productId:p.id,ref:'S1',qty:80,date:'2026-10-30'});
 assert.throws(()=>addShipment(s,{productId:p.id,ref:'S2',qty:21,date:'2026-10-30'}),/不足/);
 assert.throws(()=>adjust(s,{productId:p.id,kind:'out',qty:21,reason:'损耗'}),/不足/);
 cancelShipment(s,s.shipments[0].id);assert.equal(available(s,p),100);assert.equal(p.stock,100);
 assert.throws(()=>ship(s,s.shipments[0].id),/已处理/);
});
test('重复入库、重复出货和重复到仓均不得再次计数',()=>{
 const [s,p]=make();addOrder(s,{productId:p.id,ref:'P1',qty:10,due:'2026-10-29'});receiveOrder(s,s.orders[0].id);
 assert.throws(()=>receiveOrder(s,s.orders[0].id),/已入库/);assert.equal(p.stock,110);
 addShipment(s,{productId:p.id,ref:'S1',qty:20,date:'2026-10-30'});const sh=s.shipments[0];
 assert.throws(()=>arrive(s,sh.id),/尚未出货/);ship(s,sh.id);assert.throws(()=>ship(s,sh.id),/已处理/);assert.equal(p.stock,90);
 arrive(s,sh.id);assert.throws(()=>arrive(s,sh.id),/已签收/);assert.equal(p.fba,30);
});
test('拒绝负数、非整数、虚假日期、重复 MSKU 和超卖',()=>{
 const [s,p]=make();for(const qty of [-1,0,1.5,'abc'])assert.throws(()=>addOrder(s,{productId:p.id,ref:'X',qty,due:'2026-10-29'}));
 assert.throws(()=>addOrder(s,{productId:p.id,ref:'X',qty:1,due:'2026-02-30'}),/有效日期/);
 assert.throws(()=>addProduct(s,{...p,msku:'bx-wh'}),/已存在/);
 assert.throws(()=>adjust(s,{productId:p.id,kind:'sale',qty:11,reason:'销售'}),/不足/);assert.equal(p.fba,10);
});
test('备份可往返，拒绝损坏数据和不一致库存',()=>{
 const [s,p]=make();assert.deepEqual(validateState(JSON.parse(JSON.stringify(s))),s);
 const corrupt=structuredClone(s);corrupt.products[0].stock='100';assert.throws(()=>validateState(corrupt));
 assert.throws(()=>validateState({version:2}));
 addShipment(s,{productId:p.id,ref:'S1',qty:80,date:'2026-10-30'});p.stock=20;assert.throws(()=>validateState(s),/预占/);
 validateState(demoState());
});
test('默认提前 7 天，日期按自然日判断，包含今天和逾期',()=>{
 assert.equal(emptyState().reminderDays,7);assert.equal(daysUntil('2026-10-29','2026-10-22'),7);assert.equal(daysUntil('2026-10-22','2026-10-22'),0);assert.equal(daysUntil('2026-10-21','2026-10-22'),-1);
});
test('期初在途可确认到仓，不挪用关联出货单的在途库存',()=>{
 const [s,p]=make();p.transit=50;addShipment(s,{productId:p.id,ref:'S1',qty:40,date:'2026-10-30'});ship(s,s.shipments[0].id);
 assert.throws(()=>adjust(s,{productId:p.id,kind:'transit-receipt',qty:51,reason:'期初到仓'}),/不足/);
 adjust(s,{productId:p.id,kind:'transit-receipt',qty:50,reason:'期初到仓'});assert.equal(p.transit,40);assert.equal(p.fba,60);validateState(s);
 arrive(s,s.shipments[0].id);assert.equal(p.transit,0);assert.equal(p.fba,100);
});
