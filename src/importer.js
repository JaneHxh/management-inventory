import {europeQuote,europeDefaults} from './europe-freight.js';
import {addSales,addCostBaseline,addActualBill,japanQuote,decimal,validDate} from './costing.js';
import {addProduct,addOrder,addShipment,validateState,today,id} from './model.js';
export const schemas={
 europeEstimates:{label:'英德AGL与第三方预估',description:'同预估单号合并整票。费用组由实际报价确定，每组固定费只计一次；英国可用不同单号保留4/6元报价，德国第三方按实际元/kg输入。售价/申报价/FBA/仓租为本币，出厂价为美元，汇率为人民币/该币。广告单件覆盖可空白按6%，明确填0表示不计广告。',fields:[['ref','预估单号',true],['market','国家UK或DE',true],['msku','MSKU',true],['group','AGL费用组',true],['fixedFee','费用组固定费人民币',true],['aglRate','选定档位人民币每CBM',true],['thirdRate','第三方人民币每kg',true],['qty','数量',true],['cbm','总cbm',true],['netKg','总净重kg',true],['grossKg','总毛重kg',true],['unitCostUSD','出厂价USD',true],['salePrice','售价本币',true],['declaredPrice','申报单价本币'],['fbaPerUnit','FBA配送单件本币',true],['storagePerUnit','月仓租单件本币',true],['fx','人民币每本币',true],['usdCny','人民币每美元',true],['includeTax','计入税金是或否',true],['promotionPerUnit','广告单件覆盖本币'],['operationsPerUnit','运营单件覆盖本币'],['source','报价及费率来源',true],['rateDate','报价日期',true]]},
 products:{label:'期初库存',description:'新增产品及期初库存。重复 MSKU 不覆盖。',fields:[['name','产品名称',true],['sku','货号',true],['msku','MSKU',true],['fnsku','FNSKU',true],['stock','现货库存'],['transit','FBA在途'],['fba','FBA在售'],['threshold','预警值']]},
 orders:{label:'生产订单',description:'新增生产订单。出厂价为人民币单件价；外箱尺寸为 cm、重量为 kg，空白表示待补。',fields:[['ref','订单编号',true],['name','产品名称'],['sku','货号'],['msku','MSKU',true],['fnsku','FNSKU'],['unitCost','产品出厂价'],['warehouse','本地仓库'],['warehouseCode','本地仓库代码'],['length','外箱长cm'],['width','外箱宽cm'],['height','外箱高cm'],['grossWeight','毛重kg'],['netWeight','净重kg'],['qty','数量',true],['due','货好日期',true],['note','备注']]},
 shipments:{label:'出货计划',description:'按 MSKU 关联产品并预占库存。CBM 为该产品本次总立方数；预计到货可空白，出货后再补录。',fields:[['ref','出货单号',true],['shop','出货店铺'],['productionRef','生产订单编号'],['name','产品名称'],['sku','货号'],['msku','MSKU',true],['fnsku','FNSKU'],['qty','数量',true],['cbm','cbm'],['date','计划出货日期',true],['destination','目的仓库'],['eta','预计到货时间']]},
 sales:{label:'每周销量',description:'每条覆盖连续 7 天。同店铺、同 MSKU 周期不能重叠。销量只用于预测，不重复扣减库存；FBA 现存仍须在库存调整中更新。',fields:[['shop','店铺',true],['msku','MSKU',true],['start','周期开始',true],['end','周期结束',true],['qty','销量',true]]},
 costBases:{label:'历史加权成本',description:'每款产品导入一次历史基数。人民币单件费用；数量是原加权费用对应数量，并非当前库存。实际新账单日期必须晚于基数截至日期。',fields:[['msku','MSKU',true],['qty','基数数量',true],['unitFreight','历史单件加权头程',true],['unitCost','历史单件加权采购成本',true],['asOf','截至日期',true]]},
 estimates:{label:'头程利润预估',description:'同预估单号按整票分摊固定费（CBM 占比）。仅日本规则已提供；出厂价人民币，申报售价/销售价/平台单件费为日元。英国、德国请选「英德AGL与第三方预估」。',fields:[['ref','预估单号',true],['market','国家',true],['msku','MSKU',true],['qty','数量',true],['cbm','总cbm',true],['cartons','箱数',true],['unitCost','出厂价人民币',true],['declaredPrice','申报售价日元',true],['salePrice','销售价日元',true],['platformPerUnit','平台佣金及尾程单件日元',true]]},
 costBills:{label:'实际头程账单',description:'同账单号的总费用、日期、分摊方式须一致。人民币整票实际头程含税总额每行重复填入，系统只计一次；同票同款合并一行。只影响成本，不重复增加库存。',fields:[['ref','账单号',true],['date','账单日期',true],['basis','分摊方式',true],['freight','整票实际头程人民币',true],['msku','MSKU',true],['qty','数量',true],['cbm','总cbm'],['unitCost','实际单件出厂价人民币',true]]}
};
const aliases={name:['产品','名称','品名','productname'],sku:['产品货号','货号','sku'],msku:['msku','卖家sku','sellersku'],fnsku:['fnsku'],stock:['现货','现货库存','期初现货','库存数量'],transit:['fba在途','在途','在途库存'],fba:['fba在售','在售','在售库存'],threshold:['预警值','低库存预警值','安全库存'],ref:['订单编号','订单号','出货单号','出货编号','账单号','预估单号'],qty:['数量','订单数量','出货数量','销量','基数数量'],due:['货好日期','货好时间','预计货好','预计货好日期'],date:['计划出货日期','出货日期','出货时间','账单日期'],note:['备注','说明'],destination:['目的仓库','目的仓','仓库'],shop:['店铺','出货店铺'],productionRef:['生产订单编号'],eta:['预计到货日期','预计到货时间','eta'],unitCost:['出厂价','产品出厂价','出厂价人民币','实际单件出厂价人民币','历史单件加权采购成本'],cbm:['cbm','总cbm','产品总cbm'],length:['长cm','外箱长cm'],width:['宽cm','外箱宽cm'],height:['高cm','外箱高cm'],grossWeight:['毛重kg'],netWeight:['净重kg'],start:['周期开始','开始日期'],end:['周期结束','结束日期'],asOf:['截至日期']};
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
 const next=structuredClone(state),errors=[],groups=new Map();
 for(const entry of table.entries){
  try{
   const data={};for(const [key] of schema.fields)data[key]=mapping[key]>=0?entry.cells[mapping[key]]:undefined;
   for(const [key,label,required] of schema.fields)if(required&&(data[key]===null||data[key]===undefined||String(data[key]).trim()===''))throw Error(`${label}不能为空`);
   if(type==='products'){
    for(const key of ['stock','transit','fba'])data[key]=numeric(data[key]);data.threshold=numeric(data.threshold,100);addProduct(next,data);
   }else{
    const p=next.products.find(p=>p.msku.toLowerCase()===String(data.msku??'').trim().toLowerCase());if(!p)throw Error('MSKU 不存在，请先导入产品库存');
    for(const key of ['name','sku','fnsku'])if(data[key]!==undefined&&data[key]!==null&&String(data[key]).trim()&&String(data[key]).trim()!==p[key])throw Error('产品名称、货号或 FNSKU 与 MSKU 档案不符');
    data.productId=p.id;data.qty=numeric(data.qty);
    if(type==='orders'){data.due=normalizeDate(data.due);addOrder(next,data);}
    else if(type==='shipments'){data.date=normalizeDate(data.date);if(data.eta)data.eta=normalizeDate(data.eta);addShipment(next,data);}
    else if(type==='sales'){data.start=normalizeDate(data.start);data.end=normalizeDate(data.end);addSales(next,data);}
    else if(type==='costBases'){data.asOf=normalizeDate(data.asOf);addCostBaseline(next,data);}
    else if(type==='estimates'||type==='costBills'||type==='europeEstimates'){
     const ref=String(data.ref).trim();
     if(type==='europeEstimates'){
      data.market=String(data.market).trim().toUpperCase();if(!['UK','DE'].includes(data.market))throw Error('国家必须为 UK 或 DE');
      const flag=String(data.includeTax).trim();if(!['是','否','true','false'].includes(flag))throw Error('计税必须明确填写是或否');data.includeTax=['是','true'].includes(flag);
      for(const key of ['fixedFee','aglRate','thirdRate','cbm','netKg','grossKg','unitCostUSD','salePrice','fbaPerUnit','storagePerUnit','fx','usdCny'])data[key]=decimal(data[key],key);
      data.declaredPrice=decimal(data.declaredPrice,'申报单价',!data.includeTax);data.promotionPerUnit=decimal(data.promotionPerUnit,'广告单件覆盖',true);data.operationsPerUnit=decimal(data.operationsPerUnit,'运营单件覆盖',true);data.rateDate=validDate(normalizeDate(data.rateDate),'报价日期');
     }else if(type==='estimates'){
      data.market=String(data.market).trim().toUpperCase();if(!['JP','日本'].includes(data.market))throw Error('日本专用模板仅接受日本；英德请选择对应预估类型');
      data.cbm=decimal(data.cbm,'CBM');data.cartons=numeric(data.cartons);data.unitCost=decimal(data.unitCost,'出厂价');data.declaredPrice=decimal(data.declaredPrice,'申报售价');data.salePrice=decimal(data.salePrice,'销售价');data.platformPerUnit=decimal(data.platformPerUnit,'平台单件费');
     }else{
      data.date=normalizeDate(data.date);data.freight=decimal(data.freight,'整票实际费用');data.unitCost=decimal(data.unitCost,'出厂价');data.cbm=decimal(data.cbm||0,'CBM');data.basis=String(data.basis).trim().toLowerCase();if(data.basis==='数量')data.basis='qty';if(data.basis==='体积')data.basis='cbm';
     }
     if(!groups.has(ref))groups.set(ref,{...data,lines:[],row:entry.row});
     const group=groups.get(ref);
     if(type==='europeEstimates'&&['market','thirdRate','fx','usdCny','includeTax','source','rateDate'].some(k=>data[k]!==group[k]))throw Error('同预估单号的国家、单价、汇率、计税和来源须一致');
     if(type==='costBills'&&(data.date!==group.date||data.freight!==group.freight||data.basis!==group.basis))throw Error('同一账单的日期、整票费用和分摊方式必须一致');
     group.lines.push(data);
    }
   }
  }catch(e){errors.push({row:entry.row,message:e.message});}
 }
 for(const group of groups.values())try{
  if(type==='europeEstimates'){
   if(next.europeEstimates.some(q=>q.ref===group.ref))throw Error('预估单号已存在');const fees=new Map(),seen=new Set();
   for(const l of group.lines){if(!String(l.group||'').trim())throw Error('AGL费用组不能为空');const key=String(l.group).trim();l.group=key;if(fees.has(key)&&fees.get(key).fixedFee!==l.fixedFee)throw Error('同费用组的固定费不一致');fees.set(key,{key,fixedFee:l.fixedFee});if(seen.has(key+'|'+l.productId))throw Error('同费用组同产品重复，请合并数量');seen.add(key+'|'+l.productId);}
   const settings={...europeDefaults(group.market),fx:group.fx,usdCny:group.usdCny,thirdRate:group.thirdRate,includeTax:group.includeTax};europeQuote(group.lines,settings,[...fees.values()],group.market);
   next.europeEstimates.push({id:id(),ref:group.ref,market:group.market,lines:group.lines,settings,groups:[...fees.values()],source:group.source,rateDate:group.rateDate});
  }else if(type==='costBills')addActualBill(next,group);
  else{
   if(next.estimates.some(q=>q.ref===group.ref))throw Error('预估单号已存在');
   if(new Set(group.lines.map(l=>l.productId)).size!==group.lines.length)throw Error('同票同款预估请合并为一行');
   japanQuote(group.lines,next.jpSettings);next.estimates.push({id:id(),ref:group.ref,market:'JP',settings:structuredClone(next.jpSettings),lines:group.lines});
  }
 }catch(e){errors.push({row:group.row,message:e.message});}

 if(!errors.length)validateState(next);
 return {next:errors.length?null:next,errors,count:table.entries.length};
}
export function templateCSV(type){
 const base={name:'收纳箱',sku:'BX-001',msku:'BX-WH-US',fnsku:'X001EXAMPLE',qty:50,shop:'日本店铺',ref:'SH-001',cbm:1.2,unitCost:25};
 const weekEnd=new Date(Date.parse(today()+'T00:00:00Z')-86400000).toISOString().slice(0,10),weekStart=new Date(Date.parse(weekEnd+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
 const examples={europeEstimates:{...base,ref:'UK-QUOTE-001',market:'UK',group:'票号-宁波-标准件',fixedFee:815.68,aglRate:846.34,thirdRate:6,netKg:100,grossKg:120,unitCostUSD:10,salePrice:29.99,declaredPrice:19.99,fbaPerUnit:4,storagePerUnit:.5,fx:8.9066,usdCny:6.682,includeTax:'否',promotionPerUnit:'',source:'请填实际报价及费率来源',rateDate:today()},products:{...base,stock:100,transit:0,fba:20,threshold:50},orders:{...base,ref:'PO-001',qty:200,warehouse:'义乌仓',warehouseCode:'CN-YW',length:60,width:40,height:40,grossWeight:15,netWeight:14,due:today(),note:'首批订单'},shipments:{...base,productionRef:'',date:today(),destination:'日本 FBA',eta:''},sales:{...base,start:weekStart,end:weekEnd,qty:30},costBases:{...base,qty:100,unitFreight:8,asOf:weekStart},estimates:{...base,ref:'EST-001',market:'JP',cartons:5,declaredPrice:2000,salePrice:2500,platformPerUnit:700},costBills:{...base,ref:'BILL-001',date:today(),basis:'cbm',freight:3000}};
 return '\uFEFF'+[schemas[type].fields.map(f=>f[1]),schemas[type].fields.map(f=>examples[type][f[0]]??'')].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
}
