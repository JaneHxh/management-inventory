import {test} from 'node:test';import assert from 'node:assert/strict';
import {parseOrderPairs} from '../src/domestic-stock.js';
import {emptyState,addProduct,addOrder,receiveOrder,addShipment,ship,cancelShipment,adjust,validateState,producing,setStockOrderDetails,today} from '../src/model.js';
import {schemas,templateCSV,parseCSV,prepareImport,suggestMapping} from '../src/importer.js';
const load=(s,csv)=>{const t=parseCSV(csv);return prepareImport(s,t,'products',suggestMapping(t.headers,'products'));};
const sample=()=>load(emptyState(),templateCSV('products')).next;
test('国内库存模板九列按用户顺序，批量导入现货订单及真实在做订单',()=>{
 assert.equal(schemas.products.label,'国内库存');assert.deepEqual(schemas.products.fields.map(f=>f[1]),['产品名称','货号','MSKU','FNSKU','现货数量','在做订单数量','现货订单号+数量','在做订单号+数量','在做订单号+货好日期']);
 const s=sample(),p=s.products[0];assert.equal(p.stock,100);assert.deepEqual(p.stockLots,[{ref:'PO-STOCK-001',qty:60},{ref:'PO-STOCK-002',qty:40}]);assert.equal(producing(s,p.id),200);assert.equal(s.orders.length,1);assert.equal(p.fba,0);validateState(s);
 receiveOrder(s,s.orders[0].id);assert.equal(p.stock,300);assert.equal(producing(s,p.id),0);assert.equal(p.stockLots.find(l=>l.ref==='PO-DOM-001').qty,200);validateState(s);
});
test('多笔数量或日期对不上、重复订单、假日期或负数，整批不写入',()=>{
 const base=templateCSV('products'),original=emptyState();
 for(const csv of [base.replace('"100"','"99"'),base.replace('"200"','"199"'),base.replace(/PO-DOM-001\+\d{4}-\d{2}-\d{2}/,'OTHER+2026-12-01'),base.replace(/PO-DOM-001\+\d{4}-\d{2}-\d{2}/,'PO-DOM-001+2026-02-30'),base.replace('PO-STOCK-002+40','PO-STOCK-001+40'),base.replace('PO-STOCK-001+60','PO-STOCK-001+-60')]){const r=load(original,csv);assert.equal(r.next,null);assert.ok(r.errors.length);assert.equal(original.products.length,0);assert.equal(original.orders.length,0);}
});
test('支持分号、换行及中文加号；日期按订单号匹配而非依赖顺序',()=>{
 assert.deepEqual(parseOrderPairs('PO-1＋10；PO-2+20\nPO-3:30'),[{ref:'PO-1',qty:10},{ref:'PO-2',qty:20},{ref:'PO-3',qty:30}]);
 const header=schemas.products.fields.map(f=>f[1]).join(','),s=load(emptyState(),header+'\n箱,A,M,F,10,30,P0+10,P1+10；P2+20,P2+2026-12-02；P1+2026-12-01').next;assert.equal(s.orders.find(o=>o.ref==='P1').due,'2026-12-01');assert.equal(s.orders.find(o=>o.ref==='P2').due,'2026-12-02');
});
test('指定现货订单出货准确扣该批；普通出货不挪用已预占批次',()=>{
 const s=sample(),p=s.products[0];addShipment(s,{ref:'GENERIC',productId:p.id,qty:40,date:today()});addShipment(s,{ref:'SPECIFIC',productId:p.id,qty:60,date:today(),productionRef:'PO-STOCK-001'});
 const generic=s.shipments.find(sh=>sh.ref==='GENERIC');ship(s,generic.id);assert.equal(p.stockLots.find(l=>l.ref==='PO-STOCK-001').qty,60);assert.equal(p.stockLots.find(l=>l.ref==='PO-STOCK-002').qty,0);ship(s,s.shipments.find(sh=>sh.ref==='SPECIFIC').id);assert.equal(p.stock,0);validateState(s);
});
test('同PO不能超额预占，取消释放，损耗扣数保护指定PO预占',()=>{
 const s=sample(),p=s.products[0];addShipment(s,{ref:'A',productId:p.id,qty:60,date:today(),productionRef:'PO-STOCK-001'});
 assert.throws(()=>addShipment(s,{ref:'B',productId:p.id,qty:1,date:today(),productionRef:'PO-STOCK-001'}),/对应可用现货不足/);
 adjust(s,{productId:p.id,kind:'out',qty:20,reason:'损耗'});assert.equal(p.stockLots.find(l=>l.ref==='PO-STOCK-002').qty,20);assert.equal(p.stockLots.find(l=>l.ref==='PO-STOCK-001').qty,60);
 cancelShipment(s,s.shipments[0].id);addShipment(s,{ref:'C',productId:p.id,qty:60,date:today(),productionRef:'PO-STOCK-001'});validateState(s);
});
test('同PO部分现货、部分在做不重复计数，入库合并现货批次',()=>{
 const s=emptyState(),p=addProduct(s,{name:'箱',sku:'A',msku:'M',fnsku:'F',stock:60,transit:0,fba:0,threshold:0,stockLots:[{ref:'PO-1',qty:60}]});addOrder(s,{productId:p.id,ref:'PO-1',qty:40,due:today()});receiveOrder(s,s.orders[0].id);assert.deepEqual(p.stockLots,[{ref:'PO-1',qty:100}]);assert.equal(p.stock,100);assert.equal(producing(s,p.id),0);validateState(s);
});
test('旧数据迁移不编造PO，兼容旧模板FBA列；补录不改库存且保留历史出货关联',()=>{
 const csv='产品名称,货号,MSKU,FNSKU,现货库存,FBA在途,FBA在售,预警值\n箱,A,M,F,100,20,30,10';const s=load(emptyState(),csv).next,p=s.products[0];assert.deepEqual(p.stockLots,[{ref:'',qty:100}]);assert.equal(p.fba,30);assert.equal(p.transit,20);
 delete p.stockLots;validateState(s);assert.deepEqual(p.stockLots,[{ref:'',qty:100}]);setStockOrderDetails(s,p.id,'PO-A+100');assert.equal(p.stock,100);addShipment(s,{ref:'SH',productId:p.id,qty:50,date:today(),productionRef:'PO-A'});ship(s,s.shipments[0].id);
 setStockOrderDetails(s,p.id,'PO-B+50');assert.equal(p.stock,50);assert.ok(p.stockLots.some(l=>l.ref==='PO-A'&&l.qty===0));validateState(s);assert.throws(()=>setStockOrderDetails(s,p.id,'PO-C+49'),/合计/);assert.equal(p.stock,50);
});
test('备份不能带入不一致的现货订单总数',()=>{const s=sample();s.products[0].stockLots[0].qty=59;assert.throws(()=>validateState(s),/现货订单数量合计/);});
