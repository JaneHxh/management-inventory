import {invoiceNumberFields,shipmentNumberFields} from './logistics.js';
import {schemas} from './importer.js';
const e=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const labels=Object.fromEntries(Object.values(schemas).flatMap(s=>s.fields.map(([k,l])=>[k,l])));
Object.assign(labels,{name:'产品名称',sku:'货号',stock:'国内现货数量',transit:'FBA 在途数量',fba:'FBA 在售数量',threshold:'FBA 低库存预警值',stockOrders:'现货订单号＋数量（多笔用分号分隔）',productId:'产品',ref:'单据编号',qty:'数量',date:'日期',status:'状态',settings:'本票计算参数',groups:'AGL 费用组',lines:'产品明细',key:'费用组名称',group:'所属费用组',billingCBM:'费用组计费 CBM（可空）',shippedAt:'实际出货日期',seaRate:'海运人民币 / CBM',domesticRate:'国内人民币 / CBM',taxBase:'税基系数',taxRate:'税率',labelRate:'贴标人民币 / 箱',clearance:'清关人民币 / 票',declaration:'报关人民币 / 票',fx:'人民币 / 本币汇率',thirdRate:'第三方人民币 / kg',usdCny:'人民币 / 美元',includeTax:'是否计税',vatRate:'VAT 比例',commissionRate:'佣金比例',promotionRate:'广告比例',returnRate:'退货比例',operationsRate:'运营比例',digitalRate:'数字服务费比例',vatPerUnit:'VAT 单件覆盖',commissionPerUnit:'佣金单件覆盖',returnPerUnit:'退货单件覆盖',digitalPerUnit:'数字服务费单件覆盖',reference:'关联单据 / 原因',unitFreight:'历史单件头程人民币'});
const numeric=new Set([...invoiceNumberFields,...shipmentNumberFields,'unitCost','length','width','height','grossWeight','netWeight','cbm','declaredPrice','unitCostUSD','salePrice','fbaPerUnit','storagePerUnit','promotionPerUnit','operationsPerUnit','thirdRate', 'billingCBM']);
const skips=new Set(['id','color','stockAllocation','stockLots','sourceDetails']);
const statuses={producing:'生产中',received:'已入库',planned:'待出货',shipped:'FBA 在途',arrived:'已到仓',cancelled:'已取消'};
export function editableRecord(type,r){
 if(type==='ledger')return {reference:r.reference};
 const data=structuredClone(r);if(type==='products')data.stockOrders=(r.stockLots||[]).filter(l=>l.ref&&l.qty>0).map(l=>l.ref+'+'+l.qty).join('；');return data;
}
export function recordFields(type,data,products){
 const walk=(obj,path=[])=>Object.entries(obj).filter(([k])=>!skips.has(k)&&!(type==='costBills'&&path[0]==='lines'&&k==='freight')).map(([key,value])=>{
  const parts=[...path,key],name=parts.join('.'),label=(type==='europeEstimates'?{salePrice:'售价（本币/件）',declaredPrice:'申报单价（本币）',unitCostUSD:'出厂价（美元/件）',fbaPerUnit:'FBA 配送费（本币/件）',storagePerUnit:'月仓租（本币/件）',promotionPerUnit:'广告覆盖（本币/件）',operationsPerUnit:'运营覆盖（本币/件）'}[key]:null)||labels[key]||key;
  if(Array.isArray(value))return `<fieldset class="record-fieldset"><legend>${e(label)}</legend>${value.map((row,i)=>`<fieldset class="record-fieldset"><legend>第 ${i+1} 项</legend><div class="record-actions"><button type="button" class="small-btn" data-action="copy-record-row" data-path="${e(name)}" data-index="${i}">复制此明细</button><button type="button" class="text-btn danger" data-action="remove-record-row" data-path="${e(name)}" data-index="${i}">移除此明细</button></div><div class="form-grid">${walk(row,[...parts,String(i)])}</div></fieldset>`).join('')}</fieldset>`;
  if(value&&typeof value==='object')return `<fieldset class="record-fieldset"><legend>${e(label)}</legend><div class="form-grid">${walk(value,parts)}</div></fieldset>`;
  let choices=key==='productId'?products.map(p=>[p.id,p.name+' · '+p.msku]):key==='status'&&['orders','shipments'].includes(type)?Object.entries(statuses).filter(([v])=>type==='orders'?['producing','received'].includes(v):!['producing','received'].includes(v)):key==='basis'?[['cbm','CBM 占比'],['qty','数量占比']]:key==='market'?(type==='estimates'?[['JP','日本']]:[['UK','英国'],['DE','德国']]):typeof value==='boolean'?[['true','是'],['false','否']]:null;
  if(choices)return `<label class="field">${e(label)}<select name="${e(name)}">${choices.map(([v,l])=>`<option value="${e(v)}" ${String(v)===String(value)?'selected':''}>${e(l)}</option>`).join('')}</select></label>`;
  if(key==='note'||key==='stockOrders'||key==='reference')return `<label class="field">${e(label)}<textarea name="${e(name)}" rows="3">${e(value)}</textarea></label>`;
  const inputType=['due','date','etd','eta','shippedAt','start','end','asOf','rateDate'].includes(key)?'date':typeof value==='number'||numeric.has(key)?'number':'text';
  return `<label class="field">${e(label)}<input name="${e(name)}" type="${inputType}" value="${e(value)}" ${inputType==='number'?`${key==='difference'?'':'min="0"'} step="any"`:''}></label>`;
 }).join('');
 return `<p class="form-help">数量、订单状态的修改会同步修正库存及预占。生产中数量和货好日期请在对应生产订单中编辑。费用明细保存后重新计算分摊与利润。</p><div class="form-grid record-grid">${walk(data)}</div>`;
}
export function readRecordForm(type,original,form){
 const result=editableRecord(type,original);for(const [name,raw] of new FormData(form)){
  const keys=name.split('.');let obj=result;for(const k of keys.slice(0,-1))obj=obj[k];const key=keys.at(-1),old=obj[key];obj[key]=typeof old==='boolean'?raw==='true':typeof old==='number'||numeric.has(key)?(raw===''?null:Number(raw)):raw.trim();
 }
 return result;
}
