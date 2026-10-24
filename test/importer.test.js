import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseCSV,tableFromRows,suggestMapping,prepareImport,templateCSV} from '../src/importer.js';
import {emptyState,available,ship,arrive} from '../src/model.js';
function load(s,csv,type){const table=parseCSV(csv);return prepareImport(s,table,type,suggestMapping(table.headers,type));}
test('CSV UTF-8 BOM、引号、逗号、换行及双引号转义',()=>{
 const table=parseCSV('\uFEFF名称,备注\r\n"收纳,箱","第一行\n第二行"\r\n"双""引号",ok');assert.deepEqual(table.headers,['名称','备注']);assert.equal(table.entries[0].cells[0],'收纳,箱');assert.equal(table.entries[0].cells[1],'第一行\n第二行');assert.equal(table.entries[1].cells[0],'双"引号');assert.throws(()=>parseCSV('标题\n"未结束'),/未闭合/);
});
test('模板可直接导入：库存 → 生产订单 → 出货计划，不改变原状态',()=>{
 const s=emptyState();const products=load(s,templateCSV('products'),'products');assert.equal(products.errors.length,0);assert.equal(s.products.length,0);assert.equal(products.next.products[0].stock,100);
 const orders=load(products.next,templateCSV('orders'),'orders');assert.equal(orders.next.orders.length,products.next.orders.length+1);assert.equal(orders.next.products[0].stock,100);
 const shipments=load(orders.next,templateCSV('shipments'),'shipments');assert.equal(available(shipments.next,shipments.next.products[0]),50);assert.equal(shipments.next.products[0].stock,100);
 ship(shipments.next,shipments.next.shipments[0].id);assert.equal(shipments.next.products[0].stock,50);arrive(shipments.next,shipments.next.shipments[0].id);assert.equal(shipments.next.products[0].fba,50);
});
test('批量任一行出错则整批不可提交，重复 MSKU / 单号拦截',()=>{
 const s=load(emptyState(),templateCSV('products'),'products').next;
 const result=load(s,templateCSV('products'),'products');assert.equal(result.next,null);assert.match(result.errors[0].message,/已存在/);assert.equal(s.products.length,1);
 const csv='订单编号,MSKU,数量,货好日期\nNEW,BX-WH-US,10,2026-11-01\nBAD,UNKNOWN,10,2026-11-01';const errors=load(s,csv,'orders');assert.equal(errors.next,null);assert.equal(errors.errors[0].row,3);assert.equal(s.orders.length,1);
 const orders=load(s,templateCSV('orders'),'orders').next;assert.equal(load(orders,templateCSV('orders'),'orders').next,null);
});
test('同批计划累计预占，超额整批失败；无效日期、负数和缺列报错',()=>{
 const s=load(emptyState(),templateCSV('products'),'products').next;
 const plans=load(s,'出货单号,MSKU,数量,计划出货日期\nA,BX-WH-US,60,2026-11-01\nB,BX-WH-US,60,2026-11-01','shipments');assert.equal(plans.next,null);assert.match(plans.errors[0].message,/不足/);assert.equal(s.shipments.length,0);
 for(const row of ['A,BX-WH-US,-1,2026-11-01','A,BX-WH-US,1,2026-02-30','A,BX-WH-US,1,'])assert.equal(load(s,'订单编号,MSKU,数量,货好日期\n'+row,'orders').next,null);
 assert.throws(()=>load(s,'MSKU\nBX-WH-US','orders'),/必填字段/);
});
test('Excel Date 对象、列手动匹配、空行及前导零保留',()=>{
 const s=load(emptyState(),templateCSV('products'),'products').next;
 const table=tableFromRows([[],['我的编号','卖家编码','件数','交期'],['0001','BX-WH-US',12,new Date('2026-11-01T00:00:00Z')],[]]);
 const result=prepareImport(s,table,'orders',{ref:0,msku:1,qty:2,due:3,note:-1});assert.equal(result.errors.length,0);assert.equal(result.next.orders[0].ref,'0001');assert.equal(result.next.orders[0].due,'2026-11-01');assert.equal(table.entries[0].row,3);
 assert.throws(()=>prepareImport(s,table,'orders',{ref:0,msku:0,qty:2,due:3}),/同一列/);
});
