var express = require('express');
const { ObjectId } = require('mongodb');
var router = express.Router();
const db = require("../config/connections");
const collections=require("../config/collections")

router.get('/', function(req, res) {
    res.render('admin/admin',{layout: 'admin-layout'});
});

router.get('/students', function(req, res) {
res.render('admin/students',{layout:false});
});
router.post('/students/register',async(req,res)=>{
    const studentId = "PAD" + Math.floor(1000 + Math.random() * 9000);
    const student={
        studentId:studentId,
        name:req.body.name,
        parentName:req.body.parentName,
        parentNo:req.body.phone,
        class:req.body.class,
        academicYear:req.body.academicYear,
        address:req.body.address
    }
    const response=await db.get().collection(collections.STUDENT_COLLECTION).insertOne(student)
    return res.redirect('/admin')
})
module.exports = router;