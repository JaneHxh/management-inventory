import {decimal,integer,validDate} from './costing.js';
export const shipmentNumberFields=['unitsPerCarton','cartons','qty','length','width','height','cbm','netKg','grossKg','netWeight','grossWeight','declaredPrice'];
export const invoiceNumberFields=['cbm','declaredPrice','qty','receivedQty','difference','estimatedUSD','actualUSD','taxGBP','domesticCNY'];
const trim=v=>String(v??'').trim();
export function normalizeLogistics(input,kind){
 const r={...input};for(const key of Object.keys(r))if(typeof r[key]==='string')r[key]=r[key].trim();
 for(const key of ['ref','shipmentId','shop','sku','sellerSku','fnsku'])r[key]=trim(r[key]);
 if(!trim(r.ref))throw Error('单据编号不能为空');
 for(const key of kind==='shipmentDrafts'?shipmentNumberFields:invoiceNumberFields){
  if(key==='difference'){if(r[key]===''||r[key]===undefined||r[key]===null)r[key]=null;else {r[key]=Number(r[key]);if(!Number.isSafeInteger(r[key]))throw Error('差异须为整数，可为负数');}}
  else r[key]=decimal(r[key],key,true);
 }
 for(const key of ['qty','receivedQty','unitsPerCarton','cartons'])if(r[key]!==null&&r[key]!==undefined)integer(r[key],key,true);
 for(const key of ['date','etd','eta']){r[key]=trim(r[key]);if(r[key])validDate(r[key],key);}
 if(kind==='shipmentDrafts'){
  if(!r.productId)throw Error('出货草稿缺少产品');integer(r.qty,'计划发货量');
  if(r.unitsPerCarton!==null&&r.cartons!==null&&r.unitsPerCarton*r.cartons!==r.qty)throw Error('单箱数量 × 箱数须等于计划发货量');
  if(r.netKg!==null&&r.grossKg!==null&&r.netKg>r.grossKg)throw Error('总净重不能大于总毛重');
  if(r.netWeight!==null&&r.grossWeight!==null&&r.netWeight>r.grossWeight)throw Error('单箱净重不能大于单箱毛重');
 }else{
  if(!trim(r.shipmentId))throw Error('Shipment ID 不能为空');
 }
 return r;
}
export function addLogistics(s,input,kind){const r=normalizeLogistics(input,kind);const same=x=>kind==='shipmentDrafts'?x.ref===r.ref&&x.shop===r.shop&&x.productId===r.productId:x.ref===r.ref&&x.shipmentId===r.shipmentId&&x.sku===r.sku&&x.sellerSku===r.sellerSku&&x.fnsku===r.fnsku;if(s[kind].some(same))throw Error('该单据产品明细已存在，请编辑原记录');s[kind].push({...r,id:crypto.randomUUID()});}
export function parseTransitDates(value){
 const text=trim(value);if(!text)return [];
 return text.split(/[;；\r\n]+/).filter(x=>x.trim()).map(entry=>{const m=entry.trim().match(/^(\d+)\s*[+＋]\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2})$/);if(!m)throw Error('在途日期明细请填写“数量+YYYY-MM-DD”，多批用分号分隔');const parts=m[2].split(/[-/]/);return {qty:integer(m[1],'在途批次数量'),eta:validDate(`${parts[0]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`,'预计到货日期')};});
}
