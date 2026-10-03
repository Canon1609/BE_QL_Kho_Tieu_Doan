const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRoles = require('../middlewares/authorizeRoles');
const controller = require('../controllers/stock.controller');
router.use(authenticate, authorizeRoles('BATTALION_ADMIN'));
router.use((req, res, next) => req.user.unit?.code === 'BATTALION_5' && req.user.unit?.type === 'BATTALION'
  ? next() : res.status(403).json({ success: false, message: 'Forbidden', data: null }));
router.get('/references', controller.references);
router.get('/receipts', controller.list);
router.get('/receipts/:id', controller.detail);
router.post('/receipts', controller.create);
router.patch('/receipts/:id', controller.update);
router.delete('/receipts/:id', controller.remove);
router.post('/receipts/:id/post', controller.post);
router.get('/ledger', controller.ledger);
router.get('/balance', controller.balance);
module.exports = router;
