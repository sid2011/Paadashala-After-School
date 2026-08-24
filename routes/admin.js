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
    await db.get().collection(collections.STUDENT_COLLECTION).insertOne(student)
    return res.redirect('/admin')
})
router.get('/teachers', function(req, res) {
res.render('admin/teachers',{layout:false});
});
router.post('/teachers/register',async(req,res)=>{
    const teacherId = "TCH" + Math.floor(1000 + Math.random() * 9000);
    const teacher={
        teacherId:teacherId,
        name:req.body.name,
        phoneNo:req.body.phone,
        subject:req.body.subject,
        address:req.body.address
    }
    await db.get().collection(collections.TEACHER_COLLECTION).insertOne(teacher)
    return res.redirect('/admin')
})
module.exports = router;