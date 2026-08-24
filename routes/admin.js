var express = require('express');
var router = express.Router();

router.get('/', function(req, res) {
    res.render('admin/admin',{layout: 'admin-layout'});
});

router.get('/students', function(req, res) {
res.render('admin/students',{layout:false});
});

module.exports = router;