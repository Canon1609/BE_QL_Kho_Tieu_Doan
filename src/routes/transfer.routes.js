const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRoles = require('../middlewares/authorizeRoles');
const controller = require('../controllers/transfer.controller');
const rootOnly = (req, res, next) => req.user.unit?.code === 'BATTALION_5' && req.user.unit?.type === 'BATTALION'
  ? next() : res.status(403).json({ success: false, message: 'Forbidden', data: null });
router.use(authenticate);
router.get('/company-assets/:unitId', authorizeRoles('BATTALION_ADMIN', 'COMPANY_ADMIN'), controller.assets);
router.get('/company-assets/:unitId/history', authorizeRoles('BATTALION_ADMIN', 'COMPANY_ADMIN'), controller.history);
router.use(authorizeRoles('BATTALION_ADMIN'), rootOnly);
router.get('/company-units', controller.units);
router.get('/', controller.list);
router.get('/:id', controller.detail);
router.post('/', controller.create);
router.patch('/:id', controller.update);
router.delete('/:id', controller.remove);
router.post('/:id/post', controller.post);
module.exports = router;
