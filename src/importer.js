import {addLogistics,parseTransitDates} from './logistics.js';
import {parseOrderPairs} from './domestic-stock.js';
import {europeQuote,europeDefaults} from './europe-freight.js';
import {addSales,addCostBaseline,addActualBill,japanQuote,decimal,validDate} from './costing.js';
import {addProduct,addOrder,addShipment,validateState,today,id} from './model.js';
export const schemas={
 europeEstimates:{label:'英德AGL与第三方预估',description:'同预估单号合并整票。费用组由实际报价确定，每组固定费只计一次；英国可用不同单号保留4/6元报价，德国第三方按实际元/kg输入。售价/申报价/FBA/仓租为本币，出厂价为美元，汇率为人民币/该币。广告单件覆盖可空白按6%，明确填0表示不计广告。',fields:[['ref','预估单号',true],['market','国家UK或DE',true],['msku','MSKU',true],['group','AGL费用组',true],['fixedFee','费用组固定费人民币',true],['aglRate','选定档位人民币每CBM',true],['thirdRate','第三方人民币每kg',true],['qty','数量',true],['cbm','总cbm',true],['netKg','总净重kg',true],['grossKg','总毛重kg',true],['unitCostUSD','出厂价USD',true],['salePrice','售价本币',true],['declaredPrice','申报单价本币'],['fbaPerUnit','FBA配送单件本币',true],['storagePerUnit','月仓租单件本币',true],['fx','人民币每本币',true],['usdCny','人民币每美元',true],['includeTax','计入税金是或否',true],['promotionPerUnit','广告单件覆盖本币'],['operationsPerUnit','运营单件覆盖本币'],['source','报价及费率来源',true],['rateDate','报价日期',true]]},
 products:{label:'国内库存',description:'一行一款，现货与在做数量分开。订单填写如 PO-001+60；PO-002+40，多笔用分号分隔。在做日期填写 PO-003+2026-12-01。明细合计须与汇总一致，重复 MSKU 不覆盖。现货订单暂缺可留空，面板会标注未关联。',fields:[['name','产品名称',true],['sku','货号',true],['msku','MSKU',true],['fnsku','FNSKU',true],['stock','现货数量'],['productionQty','在做订单数量'],['stockOrders','现货订单号+数量'],['productionOrders','在做订单号+数量'],['productionDates','在做订单号+货好日期'],['country','国家']]},
 fbaInventory:{label:'FBA库存',description:'按 MSKU 关联产品，可为独立 FBA 产品建档；现售和在途为当前快照。日期明细填写“数量+YYYY-MM-DD”，多批用分号隔开，合计须等于在途。已由出货计划跟踪的产品请在出货计划更新，避免重复计数。重复上传相同数量不累加，空白国家保留原值。',fields:[['name','产品名称',true],['sku','货号',true],['msku','MSKU',true],['fnsku','FNSKU',true],['fba','FBA在售库存',true],['transit','FBA在途库存',true],['transitDates','FBA在途库存+预计到货日期'],['country','国家']]},
 orders:{label:'生产订单',description:'新增生产订单。出厂价为人民币单件价；外箱尺寸为 cm、重量为 kg，空白表示待补。',fields:[['ref','订单编号',true],['name','产品名称'],['sku','货号'],['msku','MSKU',true],['fnsku','FNSKU'],['unitCost','产品出厂价'],['warehouse','本地仓库'],['warehouseCode','本地仓库代码'],['length','外箱长cm'],['width','外箱宽cm'],['height','外箱高cm'],['grossWeight','毛重kg'],['netWeight','净重kg'],['qty','数量',true],['due','货好日期',true],['note','备注']]},
 shipments:{label:'出货计划',description:'按原业务表顺序保留 27 列。因模板没有计划出货日期，默认导入草稿，不预占、不扣库存；补全日期和产品关联后可生成出货计划。旧版含日期的表格仍按原流程导入。',fields:[['batchNote','批次备注'],['shop','店铺'],['ref','货件单号/已申报',true],['poId','PO-ID'],['productionRef','采购计划编号/采购单号'],['attention','注意'],['name','品名'],['sku','SKU'],['unitsPerCarton','单箱数量（PCS）'],['cartons','箱数'],['qty','计划发货量',true],['warehouse','发货仓库'],['length','箱规长（cm）'],['width','箱规宽（cm）'],['height','箱规高（cm）'],['cbm','CBM（m³）'],['netKg','总净重（kg）'],['grossKg','总毛重（kg）'],['netWeight','单箱净重（kg）'],['grossWeight','单箱毛重（kg）'],['address','仓库地址'],['warehouseType','仓库类型'],['msku','MSKU',true],['fnsku','FNSKU'],['asin','ASIN'],['url','链接'],['declaredPrice','申报价格']]},
 sales:{label:'每周销量',description:'每条覆盖连续 7 天。SKU 可填写唯一 MSKU 或唯一货号，匹配多款时报错。同店铺同产品周期不能重叠。销量只用于预测，不重复扣减库存；FBA 现存仍须在库存调整中更新。',fields:[['shop','店铺',true],['sellerSku','SKU',true],['start','周期开始',true],['end','周期结束',true],['qty','销量',true]]},
 costBases:{label:'历史加权成本',description:'每款产品导入一次历史基数。人民币单件费用；数量是原加权费用对应数量，并非当前库存。实际新账单日期必须晚于基数截至日期。',fields:[['msku','MSKU',true],['qty','基数数量',true],['unitFreight','历史单件加权头程',true],['unitCost','历史单件加权采购成本',true],['asOf','截至日期',true]]},
 estimates:{label:'头程利润预估',description:'同预估单号按整票分摊固定费（CBM 占比）。仅日本规则已提供；出厂价人民币，申报售价/销售价/平台单件费为日元。英国、德国请选「英德AGL与第三方预估」。',fields:[['ref','预估单号',true],['market','国家',true],['msku','MSKU',true],['qty','数量',true],['cbm','总cbm',true],['cartons','箱数',true],['unitCost','出厂价人民币',true],['declaredPrice','申报售价日元',true],['salePrice','销售价日元',true],['platformPerUnit','平台佣金及尾程单件日元',true]]},
 costBills:{label:'实际头程账单',description:'31 列原始账单明细，保留美元运费、英镑税金、人民币国内费。不会把空白费用当零，不会自动汇总为人民币或进入加权成本；请另用实际费用核算补充确认的人民币费用和采购成本。',fields:[['ref','票数',true],['shipmentId','Shipment ID',true],['shipmentPO','货件PO'],['shop','账号'],['name','产品名'],['sku','item number'],['sellerSku','SKU'],['fnsku','产品小标'],['attention','注意事项'],['factory','工厂'],['productionRef','PO#'],['cbm','cbm'],['declaredPrice','申报价格'],['qty','发货数量'],['receivedQty','接收数量'],['difference','差异'],['mrn','MRN /IEN'],['estimatedUSD','预估运费$'],['actualUSD','实际运费$'],['taxGBP','税金(GBP)'],['domesticCNY','国内运费(RMB)'],['date','Shipment date'],['etd','ETD'],['eta','ETA FBA warehouse'],['tracking','Tracking number'],['bl','BL'],['billOfLading','提单号'],['container','柜号'],['seal','封号'],['status','状态'],['note','备注']]},
 costAllocations:{label:'实际费用核算（人民币）',description:'同账单号的总费用、日期、分摊方式须一致。人民币整票实际头程含税总额每行重复填入，系统只计一次；同票同款合并一行。只影响成本，不重复增加库存。',fields:[['ref','账单号',true],['date','账单日期',true],['basis','分摊方式',true],['freight','整票实际头程人民币',true],['msku','MSKU',true],['qty','数量',true],['cbm','总cbm'],['unitCost','实际单件出厂价人民币',true]]}
};
const aliases={name:['产品','产品名称','名称','品名','productname'],sku:['产品货号','货号','sku'],msku:['msku','卖家sku','sellersku'],fnsku:['fnsku'],stock:['现货数量','现货','现货库存','期初现货','库存数量'],transit:['fba在途','在途','在途库存'],fba:['fba在售','在售','在售库存'],threshold:['预警值','低库存预警值','安全库存'],ref:['订单编号','订单号','出货单号','出货编号','账单号','预估单号'],qty:['数量','订单数量','出货数量','销量','基数数量'],due:['货好日期','货好时间','预计货好','预计货好日期'],date:['计划出货日期','出货日期','出货时间','账单日期'],note:['备注','说明'],destination:['目的仓库','目的仓','仓库'],shop:['店铺','出货店铺'],productionRef:['生产订单编号'],eta:['预计到货日期','预计到货时间','eta'],unitCost:['出厂价','产品出厂价','出厂价人民币','实际单件出厂价人民币','历史单件加权采购成本'],cbm:['cbm','总cbm','产品总cbm'],length:['长cm','外箱长cm'],width:['宽cm','外箱宽cm'],height:['高cm','外箱高cm'],grossWeight:['毛重kg'],netWeight:['净重kg'],start:['周期开始','开始日期'],end:['周期结束','结束日期'],asOf:['截至日期']};
Object.assign(aliases,{sellerSku:['SKU','MSKU','卖家SKU'],country:['国家','站点'],ref:[...aliases.ref,'货件单号/已申报','票数'],productionRef:[...aliases.productionRef,'采购计划编号/采购单号'],qty:[...aliases.qty,'计划发货量','发货数量'],cbm:[...aliases.cbm,'CBM（m³）']});
const normalize=s=>String(s??'').trim().toLowerCase().replace(/[\s_（）()]/g,'');
export function suggestMapping(headers,type) {const map={};for(const [key,label] of schemas[type].fields){map[key]=headers.findIndex(h=>normalize(h)===normalize(label));if(map[key]<0)map[key]=headers.findIndex(h=>[key,...(aliases[key]||[])].some(a=>normalize(a)===normalize(h)));}return map;}
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
 if(type==='costBills'&&table.headers.some(h=>normalize(h)===normalize('整票实际头程人民币'))){type='costAllocations';mapping=suggestMapping(table.headers,type);}
 const schema=schemas[type];if(type==='costAllocations')type='costBillsLegacy';if(!schema)throw Error('未知导入类型');
 const selected=schema.fields.filter(([key])=>mapping[key]>=0).map(([key])=>mapping[key]);
 if(new Set(selected).size!==selected.length)throw Error('同一列不能匹配多个字段');
 for(const [key,label,required] of schema.fields)if(required&&(!Number.isInteger(mapping[key])||mapping[key]<0||mapping[key]>=table.headers.length))throw Error(`请匹配必填字段：${label}`);
 const next=validateState(structuredClone(state)),errors=[],groups=new Map(),fbaSeen=new Set();
 const extra=(entry,key)=>{const i=table.headers.findIndex(h=>[key,...(aliases[key]||[])].some(a=>normalize(a)===normalize(h)));return i<0?'':entry.cells[i];};
 for(const entry of table.entries){
  try{
   const data={};for(const [key] of schema.fields)data[key]=mapping[key]>=0?entry.cells[mapping[key]]:undefined;
   for(const [key,label,required] of schema.fields)if(required&&(data[key]===null||data[key]===undefined||String(data[key]).trim()===''))throw Error(`${label}不能为空`);
   if(type==='fbaInventory'){
    const key=String(data.msku).trim().toLowerCase();if(fbaSeen.has(key))throw Error('同批 FBA 快照的 MSKU 重复，请一款保留一行');fbaSeen.add(key);importFbaSnapshot(next,data);
   }else if(type==='costBills'){
    for(const k of ['date','etd','eta'])if(data[k])data[k]=normalizeDate(data[k]);
    addLogistics(next,Object.fromEntries(Object.entries(data).map(([k,v])=>[k,v??''])),'freightRecords');
   }else if(type==='products'){
    const lots=parseOrderPairs(data.stockOrders),orders=parseOrderPairs(data.productionOrders),dates=parseOrderPairs(data.productionDates,'date');
    data.stock=numeric(data.stock);const sumStock=lots.reduce((n,l)=>n+l.qty,0),sumProduction=orders.reduce((n,o)=>n+o.qty,0);
    if(lots.length&&sumStock!==data.stock)throw Error('现货订单数量合计 '+sumStock+' 与现货数量 '+data.stock+' 不一致');
    const productionQty=numeric(data.productionQty,sumProduction);if(productionQty!==sumProduction)throw Error('在做订单明细合计 '+sumProduction+' 与在做订单数量 '+productionQty+' 不一致');
    if(dates.length!==orders.length||orders.some(o=>!dates.some(d=>d.ref===o.ref)))throw Error('每个在做订单须有且仅有对应货好日期，日期列不得有额外订单');
    const legacyNumber=key=>{const i=table.headers.findIndex(h=>[key,...(aliases[key]||[])].some(a=>normalize(a)===normalize(h)));return numeric(i<0?undefined:entry.cells[i],key==='threshold'?100:0);};
    const p=addProduct(next,{...data,stockLots:lots.length?lots:undefined,transit:legacyNumber('transit'),fba:legacyNumber('fba'),threshold:legacyNumber('threshold')});
    for(const o of orders)addOrder(next,{productId:p.id,ref:o.ref,qty:o.qty,due:dates.find(d=>d.ref===o.ref).due,note:'国内库存模板导入的在做订单'});
   }else{
    const code=String(type==='sales'?data.sellerSku:data.msku??'').trim().toLowerCase();
    const matches=next.products.filter(p=>type==='sales'?(p.msku.toLowerCase()===code||p.sku.toLowerCase()===code):p.msku.toLowerCase()===code);
    if(matches.length>1)throw Error('SKU 匹配多个产品，请填写唯一 MSKU');const p=matches[0];if(!p)throw Error('SKU / MSKU 不存在，请先导入产品库存');
    for(const key of ['name','sku','fnsku'])if(data[key]!==undefined&&data[key]!==null&&String(data[key]).trim()&&String(data[key]).trim()!==p[key])throw Error('产品名称、货号或 FNSKU 与 MSKU 档案不符');
    data.productId=p.id;data.qty=numeric(data.qty);
    if(type==='orders'){data.due=normalizeDate(data.due);addOrder(next,data);}
    else if(type==='shipments'){
     data.date=extra(entry,'date');data.eta=extra(entry,'eta');data.destination=extra(entry,'destination')||data.address||data.warehouse||'FBA 仓库';
     if(data.date){data.date=normalizeDate(data.date);if(data.eta)data.eta=normalizeDate(data.eta);addShipment(next,data);}
     else addLogistics(next,{...data,date:'',eta:data.eta?normalizeDate(data.eta):''},'shipmentDrafts');
    }
    else if(type==='sales'){data.start=normalizeDate(data.start);data.end=normalizeDate(data.end);addSales(next,data);}
    else if(type==='costBases'){data.asOf=normalizeDate(data.asOf);addCostBaseline(next,data);}
    else if(type==='estimates'||type==='costBillsLegacy'||type==='europeEstimates'){
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
     if(type==='costBillsLegacy'&&(data.date!==group.date||data.freight!==group.freight||data.basis!==group.basis))throw Error('同一账单的日期、整票费用和分摊方式必须一致');
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
  }else if(type==='costBillsLegacy')addActualBill(next,group);
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
 const base={name:'收纳箱',sku:'BX-001',msku:'BX-WH-US',fnsku:'X001EXAMPLE',country:'日本',qty:50,shop:'日本店铺',ref:'SH-001',cbm:1.2,unitCost:25};
 const weekEnd=new Date(Date.parse(today()+'T00:00:00Z')-86400000).toISOString().slice(0,10),weekStart=new Date(Date.parse(weekEnd+'T00:00:00Z')-6*86400000).toISOString().slice(0,10);
 const examples={europeEstimates:{...base,ref:'UK-QUOTE-001',market:'UK',group:'票号-宁波-标准件',fixedFee:815.68,aglRate:846.34,thirdRate:6,netKg:100,grossKg:120,unitCostUSD:10,salePrice:29.99,declaredPrice:19.99,fbaPerUnit:4,storagePerUnit:.5,fx:8.9066,usdCny:6.682,includeTax:'否',promotionPerUnit:'',source:'请填实际报价及费率来源',rateDate:today()},products:{...base,stock:100,productionQty:200,stockOrders:'PO-STOCK-001+60；PO-STOCK-002+40',productionOrders:'PO-DOM-001+200',productionDates:'PO-DOM-001+'+new Date(Date.parse(today()+'T00:00:00Z')+21*86400000).toISOString().slice(0,10)},orders:{...base,ref:'PO-001',qty:200,warehouse:'义乌仓',warehouseCode:'CN-YW',length:60,width:40,height:40,grossWeight:15,netWeight:14,due:today(),note:'首批订单'},shipments:{...base,productionRef:'',unitsPerCarton:10,cartons:5,warehouse:'义乌仓',length:60,width:40,height:40,netKg:70,grossKg:75,netWeight:14,grossWeight:15,warehouseType:'FBA',address:'请填写目的仓库地址',declaredPrice:2000},fbaInventory:{...base,fba:200,transit:50,transitDates:'50+'+new Date(Date.parse(today()+'T00:00:00Z')+30*86400000).toISOString().slice(0,10)},sales:{...base,sellerSku:base.msku,start:weekStart,end:weekEnd,qty:30},costBases:{...base,qty:100,unitFreight:8,asOf:weekStart},estimates:{...base,ref:'EST-001',market:'JP',cartons:5,declaredPrice:2000,salePrice:2500,platformPerUnit:700},costBills:{...base,ref:'第1票',shipmentId:'FBA-EXAMPLE-001',sellerSku:base.msku,qty:50,receivedQty:'',difference:'',date:today(),actualUSD:'',estimatedUSD:'',taxGBP:'',domesticCNY:'',status:'待账单',note:'差异及各币种费用按原账单填写；空白表示待补'},costAllocations:{...base,ref:'BILL-001',date:today(),basis:'cbm',freight:3000}};
 return '\uFEFF'+[schemas[type].fields.map(f=>f[1]),schemas[type].fields.map(f=>examples[type][f[0]]??'')].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n');
}

function importFbaSnapshot(s,data){
 let p=s.products.find(p=>p.msku.toLowerCase()===String(data.msku).trim().toLowerCase());
 const fba=numeric(data.fba),transit=numeric(data.transit),lots=parseTransitDates(data.transitDates),country=String(data.country||'').trim();
 if(lots.length&&lots.reduce((n,l)=>n+l.qty,0)!==transit)throw Error('在途日期明细数量合计必须等于 FBA 在途库存');
 if(p){for(const key of ['name','sku','fnsku'])if(String(data[key]).trim()!==p[key])throw Error('产品名称、货号或 FNSKU 与 MSKU 档案不符');if(country&&p.country&&country!==p.country)throw Error('国家与产品档案不一致，请核对 MSKU');if(s.shipments.some(sh=>sh.productId===p.id&&sh.status==='shipped'))throw Error('该产品有出货单在途，请先在出货计划处理到仓，避免快照与运单重复计数');}
 else p=addProduct(s,{...data,stock:0,transit:0,fba:0,threshold:100});
 const oldFba=p.fba,oldTransit=p.transit;p.fba=fba;p.transit=transit;p.fbaTransitLots=lots;if(country)p.country=country;
 s.ledger.unshift({id:id(),productId:p.id,action:'FBA库存快照更新',stock:0,transit:transit-oldTransit,fba:fba-oldFba,reference:'上传FBA库存模板（替换FBA数量，国内库存不变）',at:new Date().toISOString()});
}
