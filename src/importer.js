import {addProduct,addOrder,addShipment,validateState,today} from './model.js';
export const schemas={
 products:{label:'期初库存',description:'新增产品及期初库存。同一 MSKU 不会重复导入，也不会覆盖已有库存。',fields:[['name','产品名称',true],['sku','货号',true],['msku','MSKU',true],['fnsku','FNSKU',true],['stock','现货库存'],['transit','FBA在途'],['fba','FBA在售'],['threshold','预警值']]},
 orders:{label:'生产订单',description:'按 MSKU 关联已有产品，新增生产订单；不会直接增加现货。',fields:[['ref','订单编号',true],['msku','MSKU',true],['qty','数量',true],['due','货好日期',true],['note','备注']]},
 shipments:{label:'出货计划',description:'按 MSKU 关联已有产品并预占可用现货；实际出货仍需手动确认。',fields:[['ref','出货单号',true],['msku','MSKU',true],['qty','数量',true],['date','计划出货日期',true],['destination','目的仓库']]}
};
const aliases={name:['产品','名称','品名','productname'],sku:['产品货号','货号','sku','货好'],msku:['msku','卖家sku','sellersku'],fnsku:['fnsku'],stock:['现货','现货库存','期初现货','库存数量'],transit:['fba在途','在途','在途库存'],fba:['fba在售','在售','在售库存'],threshold:['预警值','低库存预警值','安全库存'],ref:['订单编号','订单号','出货单号','出货编号'],qty:['数量','订单数量','出货数量'],due:['货好日期','货好时间','预计货好','预计货好日期'],date:['计划出货日期','出货日期','出货时间'],note:['备注','说明'],destination:['目的仓库','目的仓','仓库']};
const normalize=s=>String(s??'').trim().toLowerCase().replace(/[\s_（）()]/g,'');
export function suggestMapping(headers,type) {const map={};for(const [key,label] of schemas[type].fields)map[key]=headers.findIndex(h=>[key,label,...(aliases[key]||[])].some(a=>normalize(a)===normalize(h)));return map;}
export function parseCSV(source) {
 const text=source.replace(/^\uFEFF/,''),rows=[];let row=[],cell='',quoted=false,closed=false;
 function pushRow(){row.push(cell);rows.push(row);row=[];cell='';closed=false;}
 for(let i=0;i<text.length;i++) {
  const c=text[i];
  if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c===','){row.push(cell);cell='';closed=false;}
  else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;pushRow();}
  else if(c==='"'){if(cell.length||closed)throw Error('CSV 引号格式错误，请重新另存为 CSV UTF-8');quoted=true;}
  else {if(closed&&!/\s/.test(c))throw Error('CSV 引号结束后存在无效字符');if(!closed)cell+=c;}
 }
 if(quoted)throw Error('CSV 引号未闭合');if(cell||row.length||closed)pushRow();
 return tableFromRows(rows);
}
export function tableFromRows(rows) {
 if(!rows.length)throw Error('文件没有数据');
 // Keep physical row offsets for meaningful error messages, ignoring only leading empty rows.
 const start=rows.findIndex(r=>r.some(v=>v!==null&&v!==undefined&&String(v).trim()!==''));
 if(start<0)throw Error('文件没有数据');
 const headers=rows[start].map(v=>String(v??'').trim());
 if(headers.length>60)throw Error('最多支持 60 列，请精简表格');
 const entries=rows.slice(start+1).map((cells,index)=>({cells,row:index+start+2})).filter(r=>r.cells.some(v=>v!==null&&v!==undefined&&String(v).trim()!==''));
 if(!entries.length)throw Error('表格只有表头，没有数据行');if(entries.length>2000)throw Error('每次最多导入 2000 行，请分批上传');
 if(entries.some(r=>r.cells.length>headers.length&&r.cells.slice(headers.length).some(v=>String(v??'').trim())))throw Error('部分数据行超过表头列数，请检查分隔符和表头');
 return {headers,entries};
}
function numeric(v,fallback=0){if(v===null||v===undefined||String(v).trim()==='')return fallback;const t=String(v).trim();if(!/^\d+$/.test(t))throw Error('数量须为非负整数，不支持千位逗号、小数或公式');const n=Number(t);if(!Number.isSafeInteger(n)||n>1e8)throw Error('数量不能超过 1 亿');return n;}
function normalizeDate(v){if(v instanceof Date){if(!Number.isFinite(v.getTime()))throw Error('日期无效');return v.toISOString().slice(0,10);}const t=String(v??'').trim();const m=t.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);if(!m)throw Error('日期请使用 YYYY-MM-DD 或 Excel 日期单元格');return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;}
export function prepareImport(state,table,type,mapping) {
 const schema=schemas[type];if(!schema)throw Error('未知导入类型');
 const selected=schema.fields.filter(([key])=>mapping[key]>=0).map(([key])=>mapping[key]);
 if(new Set(selected).size!==selected.length)throw Error('同一列不能匹配多个字段');
 for(const [key,label,required] of schema.fields)if(required&&(!Number.isInteger(mapping[key])||mapping[key]<0||mapping[key]>=table.headers.length))throw Error(`请匹配必填字段：${label}`);
 const next=structuredClone(state),errors=[];
 for(const entry of table.entries){
  try{
   const data={};for(const [key] of schema.fields)data[key]=mapping[key]>=0?entry.cells[mapping[key]]:undefined;
   for(const [key,label,required] of schema.fields)if(required&&(data[key]===null||data[key]===undefined||String(data[key]).trim()===''))throw Error(`${label}不能为空`);
   if(type==='products'){
    for(const key of ['stock','transit','fba'])data[key]=numeric(data[key]);data.threshold=numeric(data.threshold,100);addProduct(next,data);
   }else{
    const p=next.products.find(p=>p.msku.toLowerCase()===String(data.msku??'').trim().toLowerCase());if(!p)throw Error('MSKU 不存在，请先导入产品库存');
    data.productId=p.id;data.qty=numeric(data.qty);
    if(type==='orders'){data.due=normalizeDate(data.due);addOrder(next,data);}else{data.date=normalizeDate(data.date);addShipment(next,data);}
   }
  }catch(e){errors.push({row:entry.row,message:e.message});}
 }
 if(!errors.length)validateState(next);
 return {next:errors.length?null:next,errors,count:table.entries.length};
}
export function templateCSV(type){const rows={products:[['收纳箱','BX-001','BX-WH-US','X001EXAMPLE',100,0,20,50]],orders:[['PO-001','BX-WH-US',200,today(),'首批订单']],shipments:[['SH-001','BX-WH-US',50,today(),'美国 FBA']]};return '\uFEFF'+[schemas[type].fields.map(f=>f[1]),...rows[type]].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');}
