const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRoles = require('../middlewares/authorizeRoles');
const controller = require('../controllers/material-master.controller');
router.use(authenticate, authorizeRoles('BATTALION_ADMIN', 'COMPANY_ADMIN'));
const battalion = (req, res, next) => req.user.unit?.code === 'BATTALION_5' && req.user.unit?.type === 'BATTALION'
  ? next() : res.status(403).json({ success: false, message: 'Forbidden', data: null });
router.get('/:kind', controller.list);
router.get('/:kind/:id', controller.detail);
router.post('/:kind', authorizeRoles('BATTALION_ADMIN'), battalion, controller.create);
router.patch('/:kind/:id/status', authorizeRoles('BATTALION_ADMIN'), battalion, controller.active);
router.patch('/:kind/:id', authorizeRoles('BATTALION_ADMIN'), battalion, controller.update);
router.delete('/:kind/:id', authorizeRoles('BATTALION_ADMIN'), battalion, controller.remove);
module.exports = router;
