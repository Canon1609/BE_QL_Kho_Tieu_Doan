const router=require('express').Router();
const authenticate=require('../middlewares/authenticate');
const authorizeRoles=require('../middlewares/authorizeRoles');
const c=require('../controllers/reporting.controller');
router.use(authenticate,authorizeRoles('BATTALION_ADMIN','COMPANY_ADMIN'));
router.get('/inventory',c.data);router.get('/transactions',c.transactions);router.get('/stocktakes',(req,res)=>res.status(410).json({success:false,message:'Báo cáo kiểm kê hiện không được cung cấp.'}));router.get('/damage-loss',c.damageLoss);router.get('/export.xlsx',c.exportXlsx);
module.exports=router;
