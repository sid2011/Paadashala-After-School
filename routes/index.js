var express = require('express');
var router = express.Router();

/* GET home page. */
router.get('/', function(req, res, next) {
  res.render('user/main-page');
});
router.get('/admin', function(req, res, next) {
  res.render('admin/admin');
});
module.exports = router;
