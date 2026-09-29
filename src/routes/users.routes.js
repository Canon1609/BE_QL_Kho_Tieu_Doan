const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorizeRoles = require('../middlewares/authorizeRoles');
const users = require('../controllers/users.controller');

router.use(authenticate, authorizeRoles('BATTALION_ADMIN'), (req, res, next) => {
  if (req.user.unit?.code !== 'BATTALION_5' || req.user.unit?.type !== 'BATTALION') {
    return res.status(403).json({ success: false, message: 'Forbidden', data: null });
  }
  return next();
});
router.get('/company-units', users.units);
router.get('/', users.list);
router.post('/', users.create);
router.get('/:id', users.detail);
router.patch('/:id/status', users.active);
router.post('/:id/reset-password', users.resetPassword);
router.patch('/:id', users.update);
router.delete('/:id', users.remove);
module.exports = router;
