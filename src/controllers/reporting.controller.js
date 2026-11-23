const reports=require('../services/reporting.service');
const ExcelJS=require('exceljs');
const {sequelize}=require('../models');
const labels=require('../utils/report-labels');
const {QueryTypes}=require('sequelize');

async function stocktakes(req,res,next){try{const rows=await queryStocktakes(req.query,req.user);res.json({success:true,data:{rows,emptyMessage:rows.length?null:'Chưa có dữ liệu kiểm kê trong khoảng thời gian đã chọn.'}})}catch(e){next(e)}}
async function damageLoss(req,res,next){try{const rows=await queryDamageLoss(req.query,req.user);res.json({success:true,data:rows})}catch(e){next(e)}}
async function data(req,res,next){try{res.json({success:true,data:await reports.inventory(req.query,req.user)})}catch(e){next(e)}}
async function transactions(req,res,next){try{res.json({success:true,data:reports.classify(await reports.transactions(req.query,req.user))})}catch(e){next(e)}}
async function queryStocktakes(query,user){const period=reports.range(query),unit=user.role.code==='COMPANY_ADMIN'?user.unit_id:(query.unitId||null);try{return await sequelize.query(`SELECT st.id stocktake_id,st.name,st.inventory_date,un.name unit_name,st.status,m.code material_code,m.name material_name,um.name uom_name,l.system_quantity,l.actual_quantity,l.reason,CASE WHEN l.actual_quantity IS NULL THEN NULL ELSE l.actual_quantity-l.system_quantity END variance FROM stocktakes st JOIN stocktake_lines l ON l.stocktake_id=st.id JOIN materials m ON m.id=l.material_id JOIN units_of_measure um ON um.id=l.uom_id JOIN units un ON un.id=st.unit_id WHERE (:unit IS NULL OR st.unit_id=:unit) AND st.inventory_date>=:from AND st.inventory_date<DATE_ADD(:to, INTERVAL 1 DAY) ORDER BY st.inventory_date,st.id,m.name`,{replacements:{unit,from:period.start,to:period.end},type:QueryTypes.SELECT})}catch(e){if((e.original?.code||e.parent?.code)==='ER_NO_SUCH_TABLE'){const missing=new Error('Chưa triển khai bảng kiểm kê trên cơ sở dữ liệu này.');missing.status=503;missing.code='STOCKTAKE_SCHEMA_NOT_APPLIED';throw missing}throw e}}
async function queryDamageLoss(query,user){const period=reports.range(query),unit=user.role.code==='COMPANY_ADMIN'?user.unit_id:(query.unitId||null);return sequelize.query(`SELECT r.id,r.code,r.incident_type,r.status,r.discovered_on occurred_at,u.name unit_name,m.code material_code,m.name material_name,s.name source_name,c.name condition_name,l.name location_name,i.quantity FROM damage_loss_reports r JOIN damage_loss_items i ON i.report_id=r.id JOIN materials m ON m.id=i.material_id JOIN units u ON u.id=r.unit_id LEFT JOIN material_sources s ON s.id=i.source_id LEFT JOIN condition_levels c ON c.id=i.condition_id LEFT JOIN locations l ON l.id=i.location_id WHERE (:unit IS NULL OR r.unit_id=:unit) AND r.discovered_on>=:from AND r.discovered_on<DATE_ADD(:to, INTERVAL 1 DAY) ORDER BY r.discovered_on DESC`,{replacements:{unit,from:period.start,to:period.end},type:QueryTypes.SELECT})}
async function buildWorkbook(kind,query,user){
 if(!['inventory','transactions','stocktakes','damage-loss'].includes(kind)){const e=new Error('Loại báo cáo không hợp lệ');e.status=400;throw e}
 const period=reports.range(query);let rows=[],title='';
 if(kind==='inventory'){rows=(await reports.inventory(query,user)).rows;title='Báo cáo tồn kho'}
 else if(kind==='transactions'){rows=reports.classify(await reports.transactions(query,user));title='Báo cáo biến động kho'}
 else if(kind==='stocktakes'){
  const unit=user.role.code==='COMPANY_ADMIN'?user.unit_id:(query.unitId||null);
  rows=await queryStocktakes(query,user);
  title='Báo cáo kiểm kê và chênh lệch';
 }else{
  const unit=user.role.code==='COMPANY_ADMIN'?user.unit_id:(query.unitId||null);
  rows=await queryDamageLoss(query,user);title='Báo cáo hỏng/mất';
 }
 const wb=new ExcelJS.Workbook();wb.creator='Hệ thống Quản lý kho Tiểu đoàn 5';wb.created=new Date();const ws=wb.addWorksheet('Báo cáo');
 ws.addRow(['HỆ THỐNG QUẢN LÝ KHO TIỂU ĐOÀN 5']);ws.addRow([title]);ws.addRow([`Kỳ báo cáo: ${period.start} đến ${period.end}`]);ws.addRow([`Thời gian xuất: ${new Date().toLocaleString('vi-VN')}`]);
 const printable=rows.map(row=>{const view=labels.printable(row);if(kind==='stocktakes')view['Trạng thái kiểm kê']=row.status==='COMPLETED'?'Đã xác nhận kết quả kiểm kê':row.status;if(row.transaction_name)view['Loại giao dịch']=row.transaction_name;if(row.incident_type)view['Nghiệp vụ']=row.incident_type==='DAMAGE'?'Báo hỏng':row.incident_type==='LOSS'?'Báo mất':'Nghiệp vụ chưa được phân loại';if(kind==='stocktakes'&&row.actual_quantity!==null&&row.actual_quantity!==undefined)view['Chênh lệch']=Number(row.actual_quantity)-Number(row.system_quantity);return view});
 let keys=rows.length?Object.keys(printable[0]):labels.columnsFor(rows);
 if(!rows.length)keys=kind==='inventory'?['Mã vật chất','Tên vật chất','Đơn vị quản lý','Địa điểm lưu giữ','Nguồn hình thành','Tình trạng vật chất','Đơn vị tính','Tồn đầu kỳ','Tăng trong kỳ','Giảm trong kỳ','Tồn cuối kỳ']:kind==='transactions'?['Thời điểm ghi sổ','Loại giao dịch','Tên vật chất','Đơn vị quản lý','Nguồn hình thành','Tình trạng vật chất','Biến động số lượng','Nghiệp vụ']:kind==='stocktakes'?['Tên kỳ','Ngày kiểm kê','Đơn vị quản lý','Tình trạng','Mã vật chất','Tên vật chất','Đơn vị tính','Số lượng theo sổ','Số lượng thực tế','Lý do chênh lệch','Chênh lệch']:['Số hiệu','Nghiệp vụ','Tình trạng','Ngày phát hiện','Đơn vị quản lý','Mã vật chất','Tên vật chất','Nguồn hình thành','Tình trạng vật chất','Địa điểm lưu giữ','Số lượng'];
 ws.addRow(['Số thứ tự',...keys]);if(kind==='stocktakes'&&!rows.length)ws.addRow(['','Chưa có dữ liệu kiểm kê trong khoảng thời gian đã chọn.']);printable.forEach((row,i)=>ws.addRow([i+1,...keys.map(k=>row[k]??'')]));const header=ws.getRow(5);header.font={bold:true,color:{argb:'FFFFFFFF'}};header.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF1F4E78'}};ws.views=[{state:'frozen',ySplit:5}];ws.autoFilter={from:{row:5,column:1},to:{row:5,column:keys.length+1}};ws.columns=[{width:12},...keys.map(()=>({width:25}))];ws.pageSetup.orientation='landscape';ws.pageSetup.paperSize=9;return wb;
}
async function exportXlsx(req,res,next){try{const kind=req.query.report||'inventory',wb=await buildWorkbook(kind,req.query,req.user),buf=await wb.xlsx.writeBuffer();res.status(200).set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="Bao_cao_${kind}_${req.query.to||new Date().toISOString().slice(0,10)}.xlsx"`,'Content-Length':String(buf.length)}).send(Buffer.from(buf))}catch(e){next(e)}}
module.exports={data,transactions,stocktakes,damageLoss,exportXlsx,buildWorkbook,queryStocktakes,queryDamageLoss};
