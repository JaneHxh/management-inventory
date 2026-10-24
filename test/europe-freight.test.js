import {test} from 'node:test';import assert from 'node:assert/strict';
import {europeQuote,europeDefaults} from '../src/europe-freight.js';
import {emptyState,addProduct,validateState} from '../src/model.js';
import {parseCSV,prepareImport,suggestMapping,templateCSV} from '../src/importer.js';
const lines=[{productId:'A',qty:100,cbm:1,netKg:70,grossKg:100,group:'PORT-A',aglRate:800,unitCostUSD:10,salePrice:30,declaredPrice:20,fbaPerUnit:4,storagePerUnit:.5},{productId:'B',qty:50,cbm:3,netKg:250,grossKg:200,group:'PORT-A',aglRate:900,unitCostUSD:15,salePrice:50,declaredPrice:30,fbaPerUnit:5,storagePerUnit:.8}];
const cfg={fx:8,usdCny:6,thirdRate:6};
test('AGL组固定费一次，混合仓型按各款CBM费率，第三方逐款取MAX，不用总重MAX',()=>{
 const q=europeQuote(lines,cfg,[{key:'PORT-A',fixedFee:1000}],'UK');assert.equal(q.fixed,1000);assert.equal(q.lines[0].fixed,250);assert.equal(q.lines[1].fixed,750);assert.equal(q.lines[0].variable,800);assert.equal(q.lines[1].variable,2700);assert.equal(q.variable,3500);assert.equal(q.weight,350);assert.equal(q.thirdInternational,2100);assert.equal(q.domestic,800);assert.equal(q.aglTotal,5300);assert.equal(q.thirdTotal,2900);assert.equal(q.cheaper,'第三方');assert.equal(q.lines.reduce((n,l)=>n+l.aglTotal,0),q.aglTotal);
});
test('德国两方案同申报税基，USD经同一汇率换算，不额外加数字服务费',()=>{
 const q=europeQuote(lines,{...cfg,fx:7.5,usdCny:7.5/1.2},[{key:'PORT-A',fixedFee:1000}],'DE');const tax=(20*100+30*50)*.3*.06*7.5;assert.equal(q.tax,tax);assert.equal(q.aglTotal,5300+tax);assert.equal(q.thirdTotal,2900+tax);assert.equal(q.lines[0].aglProfit.unitCostLocal,10/1.2);assert.equal(q.lines[0].aglProfit.digital,0);assert.ok(Math.abs(q.lines[0].aglProfit.vat-30*19/119)<1e-12);
});
test('显式广告0、运营覆盖保留；缺利润输入不伪造利润，缺第三方单价不报价',()=>{
 const q=europeQuote([{...lines[0],promotionPerUnit:0,operationsPerUnit:.1}],cfg,[{key:'PORT-A',fixedFee:1000}],'UK');assert.equal(q.lines[0].thirdProfit.promotion,0);assert.equal(q.lines[0].thirdProfit.operations,.1);assert.equal(q.lines[0].thirdProfit.digital,(30*.15+4)*.02);
 const missing=europeQuote([{...lines[0],fbaPerUnit:null}],{...cfg,thirdRate:null},[{key:'PORT-A',fixedFee:1000}],'UK');assert.equal(missing.aglProfit,null);assert.equal(missing.thirdTotal,null);assert.equal(missing.cheaper,null);
});
test('错误分组、负费用、零汇率、负重量及不明确计税均拒绝',()=>{
 assert.throws(()=>europeQuote(lines,cfg,[{key:'OTHER',fixedFee:1}],'DE'),/对应/);assert.throws(()=>europeQuote(lines,{...cfg,fx:0},[{key:'PORT-A',fixedFee:1}],'DE'),/大于/);
 assert.throws(()=>europeQuote(lines,{...cfg,thirdRate:-1},[{key:'PORT-A',fixedFee:1}],'DE'),/非负/);assert.throws(()=>europeQuote(lines,{...cfg,includeTax:'是'},[{key:'PORT-A',fixedFee:1}],'DE'),/明确/);
 assert.throws(()=>europeQuote([{...lines[0],grossKg:-1}],cfg,[{key:'PORT-A',fixedFee:1}],'DE'),/非负/);assert.throws(()=>europeQuote(lines,cfg,[{key:'PORT-A',fixedFee:1,billingCBM:3}],'DE'),/不得小于/);
});
test('报价最小计费体积明确录入才应用，不自动猜测价卡档位',()=>{
 const q=europeQuote([{...lines[0],cbm:.5}],cfg,[{key:'PORT-A',fixedFee:100,billingCBM:1}],'UK');assert.equal(q.variable,800);assert.equal(q.domestic,100);assert.equal(q.fixed,100);
});
test('英德上传模板、费用组一致性、旧版二期数据兼容与备份验证',()=>{
 const s=emptyState();addProduct(s,{name:'收纳箱',sku:'BX-001',msku:'BX-WH-US',fnsku:'X001EXAMPLE',stock:1,transit:0,fba:0,threshold:0});
 function run(csv){const t=parseCSV(csv);return prepareImport(s,t,'europeEstimates',suggestMapping(t.headers,'europeEstimates'));}
 const good=run(templateCSV('europeEstimates'));assert.equal(good.errors.length,0);assert.equal(good.next.europeEstimates.length,1);assert.equal(s.europeEstimates.length,0);validateState(good.next);
 const bad=run(templateCSV('europeEstimates').replace('"否"','"不清楚"'));assert.equal(bad.next,null);assert.match(bad.errors[0].message,/计税/);
 const old=structuredClone(s);delete old.europeEstimates;assert.deepEqual(validateState(old).europeEstimates,[]);assert.equal(europeDefaults('UK').operationsRate,.07);assert.equal(europeDefaults('DE').operationsRate,.05);
});

test('英德报价拒绝不存在的日期，备份不能丢失费率来源',()=>{
 const s=emptyState();addProduct(s,{name:'收纳箱',sku:'BX-001',msku:'BX-WH-US',fnsku:'X001EXAMPLE',stock:1,transit:0,fba:0,threshold:0});
 const read=csv=>{const t=parseCSV(csv);return prepareImport(s,t,'europeEstimates',suggestMapping(t.headers,'europeEstimates'));};
 const bad=read(templateCSV('europeEstimates').replace(/"\d{4}-\d{2}-\d{2}"/,'"2026-02-30"'));assert.equal(bad.next,null);assert.match(bad.errors[0].message,/日期/);
 const good=read(templateCSV('europeEstimates')).next;good.europeEstimates[0].source='';assert.throws(()=>validateState(good),/来源/);
});
