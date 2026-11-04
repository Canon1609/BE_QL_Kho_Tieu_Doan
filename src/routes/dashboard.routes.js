const router = require('express').Router();
const authenticate = require('../middlewares/authenticate');
const authorize = require('../middlewares/authorizeRoles');
const controller = require('../controllers/dashboard.controller');
router.use(authenticate, authorize('BATTALION_ADMIN', 'COMPANY_ADMIN'));
router.get('/units', controller.units);
router.get('/filters', controller.filters);
router.get('/', controller.summary);
module.exports = router;
